// /api/library/series — #203 COLLECTED coverage (field report by robotshavehearts2): an OWNED
// collected book that says which run issues it reprints takes those issues out of "missing".
// They move to `coveredIssues`, each naming the book; annuals are never covered; an unowned book
// covers nothing; a book with no coverage changes nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/library/series/route';
import { prisma } from '@/lib/db';
import { getReq } from '../helpers/request';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));
vi.mock('@/lib/audit-logger', () => ({ AuditLogger: { log: vi.fn() } }));
vi.mock('@/lib/library-access', () => ({
    getAccessibleLibraryPaths: vi.fn(async () => []),
    canAccessPath: vi.fn(() => true),
}));
vi.mock('@/lib/db', () => ({
    prisma: {
        library: { findMany: vi.fn() },
        series: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
        issue: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
        attachedVolume: { findMany: vi.fn(async () => []) },
        favorite: { findUnique: vi.fn() },
        seriesFollow: { findUnique: vi.fn() },
        readProgress: { findMany: vi.fn() },
    }
}));
// Every stored path "exists" on disk here; the folder itself is absent (no file sync).
vi.mock('fs-extra', () => ({
    default: {
        existsSync: vi.fn(() => false),
        promises: { readdir: vi.fn(async () => []), access: vi.fn(async () => undefined) },
    }
}));

const F = '/comics/Batman';
const tpb = { kind: 'COLLECTED', name: 'Batman: The Court of Owls' };
const run = (id: string, n: string, file: string | null) => ({ id, number: n, isAnnual: false, metadataId: `30000${n}`, filePath: file, attachedVolumeId: null, attachedVolume: null, name: null });
const book = (id: string, n: string, file: string | null, covers: string | null) => ({ id, number: n, isAnnual: false, metadataId: `50000${n}`, filePath: file, attachedVolumeId: 'att_tpb', attachedVolume: tpb, coversIssues: covers, name: `Vol. ${n}` });

describe('#203 COLLECTED coverage in the series reconciler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.library.findMany as any).mockResolvedValue([{ id: 'lib1', path: '/comics' }]);
        (prisma.series.findFirst as any).mockResolvedValue({ id: 's1', name: 'Batman', year: 2011, folderPath: F, metadataId: '42821', metadataSource: 'COMICVINE' });
        (prisma.issue.deleteMany as any).mockResolvedValue({ count: 0 });
    });

    const load = async () => (await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(F)}`))).json();

    it('an owned book covering 1-3 takes #2 and #3 out of missing and names itself on them', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            run('i1', '1', `${F}/Batman #001.cbz`),
            run('i2', '2', null), run('i3', '3', null), run('i4', '4', null),
            book('b1', '1', `${F}/Batman Vol. 1.cbz`, '1-3'),
        ]);
        const body = await load();
        expect(body.missingIssues.map((i: any) => i.number)).toEqual(['4']);
        expect(body.coveredIssues.map((i: any) => i.number)).toEqual(['2', '3']);
        expect(body.coveredIssues[0].coveredBy).toEqual({ id: 'b1', number: '1', name: 'Vol. 1', collectionName: 'Batman: The Court of Owls' });
        // The book itself still reads as an owned collected edition, carrying its coverage.
        expect(body.collectedEditions.map((b: any) => b.coversIssues)).toEqual(['1-3']);
    });

    it('an UNOWNED book covers nothing, and an owned book with no coverage changes nothing', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            run('i2', '2', null), run('i3', '3', null),
            book('b1', '1', null, '1-3'),                       // wanted, not on disk
            book('b2', '2', `${F}/Batman Vol. 2.cbz`, null),    // owned, says nothing
        ]);
        const body = await load();
        expect(body.missingIssues.map((i: any) => i.number)).toEqual(['2', '3']);
        expect(body.coveredIssues).toEqual([]);
        expect(body.missingCollectedEditions.map((b: any) => b.number)).toEqual(['1']);
    });

    it('coverage names main-run numbers only: a missing annual #2 is not covered by "1-3"', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            { ...run('a2', '2', null), isAnnual: true, metadataId: '400002' },
            run('i2', '2', null),
            book('b1', '1', `${F}/Batman Vol. 1.cbz`, '1-3'),
        ]);
        const body = await load();
        expect(body.coveredIssues.map((i: any) => `${i.isAnnual ? 'A' : ''}${i.number}`)).toEqual(['2']);
        expect(body.missingIssues.map((i: any) => `${i.isAnnual ? 'A' : ''}${i.number}`)).toEqual(['A2']);
    });
});
