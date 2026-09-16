import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    issueFindMany: vi.fn(),
    issueGroupBy: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: { issue: { findMany: mocks.issueFindMany, groupBy: mocks.issueGroupBy } }
}));

vi.mock('fs-extra', () => ({
    existsSync: mocks.existsSync,
    statSync: mocks.statSync,
    default: { existsSync: mocks.existsSync, statSync: mocks.statSync },
}));

import { findDuplicateGroups, filenamesDisagree } from '@/lib/duplicate-detector';

type Lane = { id: string; name: string; kind?: string } | null;
const issue = (id: string, seriesId: string, number: string, filePath: string, seriesName = 'Batman', metadataId: string | null = null, metadataSource: string | null = null, isAnnual = false, lane: Lane = null) =>
    ({ id, seriesId, number, isAnnual, filePath, series: { name: seriesName, metadataId, metadataSource },
       attachedVolumeId: lane ? lane.id : null, attachedVolume: lane ? { name: lane.name, kind: lane.kind || 'ANNUAL' } : null });

// Drive both prisma calls from one dataset: groupBy returns the (seriesId, number, isAnnual,
// attachedVolumeId) tuples the DB would report with count > 1 (#203: the annual domain joined the
// grouping key; the attached LANE joined it after anacronismo's seven-annual-volumes report), and
// findMany returns the issues in those candidate series (as the real `seriesId in seriesIds` query would).
function setIssues(issues: ReturnType<typeof issue>[]) {
    const counts = new Map<string, number>();
    for (const i of issues) {
        const k = `${i.seriesId} ${i.isAnnual ? 1 : 0} ${i.attachedVolumeId || '-'} ${i.number}`;
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    const groups = [...counts.entries()]
        .filter(([, n]) => n > 1)
        .map(([k, n]) => { const [seriesId, ann, lane, number] = k.split(' '); return { seriesId, number, isAnnual: ann === '1', attachedVolumeId: lane === '-' ? null : lane, _count: { seriesId: n } }; });
    mocks.issueGroupBy.mockResolvedValue(groups);
    const candidateSeries = new Set(groups.map(g => g.seriesId));
    mocks.issueFindMany.mockResolvedValue(issues.filter(i => candidateSeries.has(i.seriesId)));
}

beforeEach(() => {
    mocks.existsSync.mockReturnValue(true);
    mocks.statSync.mockReturnValue({ size: 100 });
});

describe('findDuplicateGroups', () => {
    it('flags two existing files for the same series + number as a duplicate (and ignores singletons)', async () => {
        setIssues([
            issue('a', 's1', '1', '/lib/s1/Batman 1.cbz'),
            issue('b', 's1', '1', '/lib/s1/Batman 001.cbz'),
            issue('c', 's1', '2', '/lib/s1/Batman 2.cbz'), // singleton → not a dupe
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].seriesId).toBe('s1');
        expect(groups[0].issueNumber).toBe('1');
        expect(groups[0].files.map(f => f.id).sort()).toEqual(['a', 'b']);
    });

    it('does NOT flag a group when only one of the files actually exists on disk', async () => {
        mocks.existsSync.mockImplementation((p: string) => p.includes('exists'));
        setIssues([
            issue('a', 's1', '1', '/lib/s1/exists.cbz'),
            issue('b', 's1', '1', '/lib/s1/missing.cbz'),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(0);
    });

    // #203 Phase 0: the annual domain is part of the grouping key — the anacronismo layout
    // ("Batman Annual 001" co-located with "Batman 001") stops producing phantom duplicates.
    it('does NOT flag a co-located annual sharing its number with a regular issue', async () => {
        setIssues([
            issue('a', 's1', '1', '/lib/s1/Batman 001.cbz'),
            issue('b', 's1', '1', '/lib/s1/Batman Annual 001.cbz', 'Batman', null, null, true),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(0);
    });

    it('still flags two files inside the SAME annual domain, reported with the flag', async () => {
        setIssues([
            issue('a', 's1', '1', '/lib/s1/Batman Annual 001.cbz', 'Batman', null, null, true),
            issue('b', 's1', '1', '/lib/s1/Batman Annual 01 (2012).cbz', 'Batman', null, null, true),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].isAnnual).toBe(true);
        expect(groups[0].issueNumber).toBe('1');
    });

    it('keys by series, so the same number across different series is not a duplicate', async () => {
        setIssues([
            issue('a', 's1', '1', '/lib/s1/a.cbz', 'Batman'),
            issue('b', 's2', '1', '/lib/s2/b.cbz', 'Superman'),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(0);
    });

    it('returns an empty array when there are no issues', async () => {
        setIssues([]);
        expect(await findDuplicateGroups()).toEqual([]);
    });
});

// #203 round 3 (anacronismo, 2026-09-13): seven attached annual volumes on The Amazing Spider-Man
// (the 1964 annual, '96, '97, '98, 1999, 2000, 2001) each own a "#1" — seven different comics that
// the resolver grouped as ONE "Annual #1" with a "Delete 6 in this group" button. An attached lane
// is its own numbering domain (the series page has keyed it so since beta.010); the detector must too.
describe('attached lanes (#203)', () => {
    const asm = (id: string, file: string, lane: Lane) =>
        issue(id, 'asm', '1', `/comics/Marvel/The Amazing Spider-Man (1963)/${file}`, 'The Amazing Spider-Man', '2127', 'COMICVINE', true, lane);

    it('asks the database to group by the attached lane as well', async () => {
        setIssues([]);
        await findDuplicateGroups();
        expect(mocks.issueGroupBy).toHaveBeenCalledWith(expect.objectContaining({
            by: expect.arrayContaining(['seriesId', 'number', 'isAnnual', 'attachedVolumeId']),
        }));
    });

    it('never groups the same number across different attached lanes (the seven ASM annual #1s)', async () => {
        setIssues([
            asm('a64', 'The Amazing Spider-Man Annual #001 (1964).cbz', { id: 'v60436', name: 'The Amazing Spider-Man Annual' }),
            asm('a96', "The Amazing Spider-Man '96 #001 (1996).cbz", { id: 'v60438', name: "The Amazing Spider-Man '96" }),
            asm('a97', "The Amazing Spider-Man '97 #001 (1997).cbz", { id: 'v60440', name: "The Amazing Spider-Man '97" }),
            asm('a98', "Spider-Man '98 #001 (1998).cbz", { id: 'v60441', name: "Spider-Man '98" }),
            asm('a99', 'The Amazing Spider-Man 1999 #001 (1999).cbz', { id: 'v60442', name: 'The Amazing Spider-Man 1999' }),
            asm('a00', 'The Amazing Spider-Man 2000 #001 (2000).cbz', { id: 'v60443', name: 'The Amazing Spider-Man 2000' }),
            asm('a01', 'The Amazing Spider-Man 2001 #001 (2001).cbz', { id: 'v60444', name: 'The Amazing Spider-Man 2001' }),
        ]);
        expect(await findDuplicateGroups()).toHaveLength(0);

        // With a genuine second copy in ONE lane the series becomes a candidate and every row comes
        // back from the database — the in-memory pass must still keep the other six lanes apart.
        setIssues([
            asm('a64', 'The Amazing Spider-Man Annual #001 (1964).cbz', { id: 'v60436', name: 'The Amazing Spider-Man Annual' }),
            asm('a96', "The Amazing Spider-Man '96 #001 (1996).cbz", { id: 'v60438', name: "The Amazing Spider-Man '96" }),
            asm('a96b', "The Amazing Spider-Man '96 #01 (1996) (digital).cbz", { id: 'v60438', name: "The Amazing Spider-Man '96" }),
            asm('a97', "The Amazing Spider-Man '97 #001 (1997).cbz", { id: 'v60440', name: "The Amazing Spider-Man '97" }),
            asm('a98', "Spider-Man '98 #001 (1998).cbz", { id: 'v60441', name: "Spider-Man '98" }),
            asm('a99', 'The Amazing Spider-Man 1999 #001 (1999).cbz', { id: 'v60442', name: 'The Amazing Spider-Man 1999' }),
            asm('a00', 'The Amazing Spider-Man 2000 #001 (2000).cbz', { id: 'v60443', name: 'The Amazing Spider-Man 2000' }),
            asm('a01', 'The Amazing Spider-Man 2001 #001 (2001).cbz', { id: 'v60444', name: 'The Amazing Spider-Man 2001' }),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].files.map(f => f.id).sort()).toEqual(['a96', 'a96b']);
    });

    it('does not group a lane\'s annual with an unattached annual of the same number', async () => {
        setIssues([
            asm('loose', 'The Amazing Spider-Man Annual 001.cbz', null),
            asm('a96', "The Amazing Spider-Man '96 #001 (1996).cbz", { id: 'v60438', name: "The Amazing Spider-Man '96" }),
        ]);
        expect(await findDuplicateGroups()).toHaveLength(0);
    });

    it('still flags two copies inside ONE lane, naming the lane so the resolver can say which', async () => {
        setIssues([
            asm('copy1', "The Amazing Spider-Man '96 #001 (1996).cbz", { id: 'v60438', name: "The Amazing Spider-Man '96" }),
            asm('copy2', "The Amazing Spider-Man '96 #01 (1996) (digital).cbz", { id: 'v60438', name: "The Amazing Spider-Man '96" }),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ issueNumber: '1', isAnnual: true, attachedVolumeId: 'v60438', laneName: "The Amazing Spider-Man '96", laneKind: 'ANNUAL', suspectedMispair: false });
        expect(groups[0].files.map(f => f.id).sort()).toEqual(['copy1', 'copy2']);
    });

    it('reports a collected lane\'s kind, and no lane for a main-run group', async () => {
        setIssues([
            issue('t1', 's1', '1', '/lib/s1/Batman Vol. 001.cbz', 'Batman', null, null, false, { id: 'tpb', name: 'Batman: The Deluxe Edition', kind: 'COLLECTED' }),
            issue('t2', 's1', '1', '/lib/s1/Batman Vol. 01 (2012).cbz', 'Batman', null, null, false, { id: 'tpb', name: 'Batman: The Deluxe Edition', kind: 'COLLECTED' }),
            issue('m1', 's1', '2', '/lib/s1/Batman 002.cbz'),
            issue('m2', 's1', '2', '/lib/s1/Batman 02.cbz'),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(2);
        const tpb = groups.find(g => g.attachedVolumeId === 'tpb')!;
        expect(tpb).toMatchObject({ laneName: 'Batman: The Deluxe Edition', laneKind: 'COLLECTED', issueNumber: '1' });
        const main = groups.find(g => g.issueNumber === '2')!;
        expect(main).toMatchObject({ attachedVolumeId: null, laneName: null, laneKind: null });
    });
});

// Issue #196: the resolver grouped files 001 and 004 of a mini-series as "duplicates of Issue #4" —
// crossed records from the corruption-era sync, not real duplicates. Deleting a copy would have
// removed a real comic. These pin the guard: filename disagreement → suspectedMispair, per-file
// parsed numbers surface the disagreement, provider linkage rides along for one-click refresh.
describe('filenamesDisagree', () => {
    it('flags genuinely different parsed numbers', () => {
        expect(filenamesDisagree(['1', '4'])).toBe(true);
        expect(filenamesDisagree(['3', '3', '4'])).toBe(true);
        expect(filenamesDisagree(['1.5', '1'])).toBe(true);
    });

    it('never flags padding/suffix-equivalent, single, or empty entries', () => {
        expect(filenamesDisagree(['001', '1'])).toBe(false);
        expect(filenamesDisagree(['2', '2'])).toBe(false);
        expect(filenamesDisagree(['1A', '1a'])).toBe(false);
        expect(filenamesDisagree(['3'])).toBe(false);
        expect(filenamesDisagree([])).toBe(false);
    });
});

describe('suspected-mispair detection (issue #196)', () => {
    it('flags the anacronismo case: files 001 and 004 sharing DB number "4"', async () => {
        setIssues([
            issue('i1', 's1', '4', '/comics/DH/Cyberpunk 2077 Blackout (2022)/Cyberpunk 2077 Blackout 001 (2022).cbz', 'Cyberpunk 2077: Blackout', '143306', 'COMICVINE'),
            issue('i4', 's1', '4', '/comics/DH/Cyberpunk 2077 Blackout (2022)/Cyberpunk 2077 Blackout 004 (2022).cbz', 'Cyberpunk 2077: Blackout', '143306', 'COMICVINE'),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        const g = groups[0];
        expect(g.suspectedMispair).toBe(true);
        // The year-like "2077" in the title must never be read as the issue number.
        expect(g.files.map(f => f.parsedNumber)).toEqual(['1', '4']);
        // Provider linkage for the UI's one-click Refresh Metadata steer.
        expect(g.seriesMetadataId).toBe('143306');
        expect(g.seriesMetadataSource).toBe('COMICVINE');
    });

    it('does not flag a true duplicate (padding/edition variants of the same number)', async () => {
        setIssues([
            issue('a', 's1', '1', '/comics/Image/Saga (2012)/Saga 001 (2012).cbz', 'Saga'),
            issue('b', 's1', '1', '/comics/Image/Saga (2012)/Saga 01 (2012) (digital).cbz', 'Saga'),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].suspectedMispair).toBe(false);
        expect(groups[0].files.map(f => f.parsedNumber)).toEqual(['1', '1']);
    });

    it('carries null provider linkage for an unmatched series (UI hides the refresh steer)', async () => {
        setIssues([
            issue('x', 's2', '2', '/comics/X/Thing 001.cbz', 'Thing'),
            issue('y', 's2', '2', '/comics/X/Thing 002.cbz', 'Thing'),
        ]);
        const groups = await findDuplicateGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].suspectedMispair).toBe(true);
        expect(groups[0].seriesMetadataId).toBeNull();
        expect(groups[0].seriesMetadataSource).toBeNull();
    });
});
