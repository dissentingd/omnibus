// /api/library/series (GET reconciler) — the beta.010 regression (#203, anacronismo 2026-09-10).
// Rows of an ATTACHED lane are keyed `att:<attachment>:<n>`, but the folder's files can only be
// keyed `annual:<n>` / `<n>`, so after an attach had claimed an annual file every visit created a
// second, unmatched row for the SAME path. These pin the two halves of the fix: the file sync
// recognises an indexed file by PATH before it consults the number key, and an existing twin is
// healed on the next visit — while the behaviours the key match exists for still work.
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

// The folder EXISTS here — the file sync is the subject. `files` is what readdir answers.
const disk = vi.hoisted(() => ({ files: [] as string[] }));
vi.mock('fs-extra', () => ({
    default: {
        existsSync: vi.fn(() => true),
        promises: { readdir: vi.fn(async () => disk.files), access: vi.fn(async () => undefined) },
    }
}));

const FOLDER = '/comics/Batman';
const ANNUAL_FILE = `${FOLDER}/Batman Annual #001 (2012).cbz`;

describe('#203 beta.010 regression: attached-lane rows vs. the folder file sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        disk.files = [];
        (prisma.library.findMany as any).mockResolvedValue([{ id: 'lib1', path: '/comics' }]);
        (prisma.series.findFirst as any).mockResolvedValue({
            id: 's1', name: 'Batman', year: 2011, folderPath: FOLDER, metadataId: '42821', metadataSource: 'COMICVINE',
        });
        (prisma.issue.deleteMany as any).mockResolvedValue({ count: 0 });
        (prisma.issue.createMany as any).mockResolvedValue({ count: 0 });
        (prisma.issue.update as any).mockResolvedValue({});
    });

    const deletedIds = () => (prisma.issue.deleteMany as any).mock.calls.flatMap((c: any[]) => c[0]?.where?.id?.in || []);
    const created = () => (prisma.issue.createMany as any).mock.calls.flatMap((c: any[]) => c[0]?.data || []);

    it("an attached annual's file on disk is recognised by PATH — never re-created under its file key", async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            // Claimed by the "Batman Annual (2012)" lane: keyed att:att1:1, which the filename can't produce.
            { id: 'claimed', number: '1', isAnnual: true, metadataId: '400001', filePath: ANNUAL_FILE, attachedVolumeId: 'att1' },
            { id: 'main1', number: '1', isAnnual: false, metadataId: '300001', filePath: `${FOLDER}/Batman #001 (2011).cbz`, attachedVolumeId: null },
        ]);
        disk.files = ['Batman Annual #001 (2012).cbz', 'Batman #001 (2011).cbz'];

        const res = await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(FOLDER)}`));
        expect(res.status).toBe(200);
        expect(created()).toEqual([]);                      // the regression: a second row for ANNUAL_FILE
        expect(prisma.issue.update).not.toHaveBeenCalled();  // nothing to re-point either
        expect(deletedIds()).toEqual([]);
    });

    it('a twin the regression already made is healed: the unattached row sharing an attached row\'s path goes', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            { id: 'claimed', number: '1', isAnnual: true, metadataId: '400001', filePath: ANNUAL_FILE, attachedVolumeId: 'att1' },
            // Born by an earlier visit: unmatched, same file. The Diagnostics "same path twice".
            { id: 'twin', number: '1', isAnnual: true, metadataId: 'unmatched_abc', filePath: ANNUAL_FILE, attachedVolumeId: null },
            // A different annual file with NO attachment is not a twin of anything.
            { id: 'loner', number: '2', isAnnual: true, metadataId: 'unmatched_def', filePath: `${FOLDER}/Batman Annual #002 (2013).cbz`, attachedVolumeId: null },
        ]);
        disk.files = ['Batman Annual #001 (2012).cbz', 'Batman Annual #002 (2013).cbz'];

        await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(FOLDER)}`));
        expect(deletedIds()).toEqual(['twin']);
        expect(created()).toEqual([]);
        expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('the key match still does its job: a WANTED row receives its file, and a file with no row is created', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            // Provider skeleton for annual #1, no file yet — the file on disk should be handed to it.
            { id: 'wanted', number: '1', isAnnual: true, metadataId: '400001', filePath: null, attachedVolumeId: null },
        ]);
        disk.files = ['Batman Annual #001 (2012).cbz', 'Batman #005 (2011).cbz'];

        await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(FOLDER)}`));
        expect(prisma.issue.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'wanted' },
            data: expect.objectContaining({ filePath: expect.stringContaining('Batman Annual #001 (2012).cbz') }),
        }));
        const rows = created();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(expect.objectContaining({ number: '5', isAnnual: false, filePath: expect.stringContaining('Batman #005 (2011).cbz') }));
        expect(deletedIds()).toEqual([]);
    });

    // #203 name-anchored (anacronismo): a one-off named like its parent carries no Annual token.
    it("keys a file named after an attached volume as that lane — no '96-vs-1963 \"#1 duplicate\", and a new file lands in the lane's domain", async () => {
        const ASM = '/comics/ASM';
        (prisma.series.findFirst as any).mockResolvedValue({
            id: 's1', name: 'The Amazing Spider-Man', year: 1963, folderPath: ASM, metadataId: '2350', metadataSource: 'COMICVINE',
        });
        (prisma.attachedVolume.findMany as any).mockResolvedValue([{ id: 'att96', name: "The Amazing Spider-Man '96", kind: 'ANNUAL' }]);
        (prisma.issue.findMany as any).mockResolvedValue([
            { id: 'main1', number: '1', isAnnual: false, metadataId: '300001', filePath: `${ASM}/The Amazing Spider-Man #001 (1963).cbz`, attachedVolumeId: null },
        ]);
        disk.files = ['The Amazing Spider-Man #001 (1963).cbz', "The Amazing Spider-Man '96 #001 (1996).cbz"];

        const body = await (await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(ASM)}`))).json();
        // Two files, two slots: the '96 file is the lane's #1, not a second main-run #1.
        expect(body.duplicates).toEqual([]);
        const rows = created();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(expect.objectContaining({ number: '1', isAnnual: true, filePath: expect.stringContaining("'96 #001") }));
    });

    // #205 (BeepbopbeepityBop): ComicVine stores Bone (1991) #13.5 as "13½"; the file is named
    // "Bone (1991) 13.5.cbz" and parses to "13.5". Keyed as raw strings those never met, so the
    // page kept a matched row with no file beside an unmatched row holding the file — "missing and
    // there at the same time". One number, one group: the matched row wins and takes the file.
    it('#205: a ComicVine "13½" row and the file\'s "13.5" row are one issue — the split heals', async () => {
        const F = '/comics/Bone';
        (prisma.series.findFirst as any).mockResolvedValue({
            id: 's1', name: 'Bone', year: 1991, folderPath: F, metadataId: '2127', metadataSource: 'COMICVINE',
        });
        const file = `${F}/Bone (1991) 13.5.cbz`;
        (prisma.issue.findMany as any).mockResolvedValue([
            { id: 'cv', number: '13½', isAnnual: false, metadataId: '317233', filePath: null, attachedVolumeId: null },
            { id: 'split', number: '13.5', isAnnual: false, metadataId: 'unmatched_z', filePath: file, attachedVolumeId: null },
            { id: 'i13', number: '13', isAnnual: false, metadataId: '317232', filePath: `${F}/Bone (1991) 13.cbz`, attachedVolumeId: null },
        ]);
        disk.files = ['Bone (1991) 13.cbz', 'Bone (1991) 13.5.cbz'];

        const body = await (await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(F)}`))).json();
        // The placeholder goes; the ComicVine row is the survivor.
        expect(deletedIds()).toEqual(['split']);
        // …and it takes the file the placeholder was holding, by the same key.
        // (path.join emits the platform separator, hence the contains-match.)
        expect((prisma.issue.update as any).mock.calls.map((c: any[]) => c[0])).toContainEqual(
            expect.objectContaining({ where: { id: 'cv' }, data: expect.objectContaining({ filePath: expect.stringContaining('Bone (1991) 13.5.cbz'), status: 'DOWNLOADED' }) })
        );
        expect(created()).toEqual([]);
        expect(body.duplicates).toEqual([]);
    });

    it('#205: a file parsing to "13.5" binds to an existing "13½" row instead of spawning a row of its own', async () => {
        const F = '/comics/Bone';
        (prisma.series.findFirst as any).mockResolvedValue({
            id: 's1', name: 'Bone', year: 1991, folderPath: F, metadataId: '2127', metadataSource: 'COMICVINE',
        });
        (prisma.issue.findMany as any).mockResolvedValue([
            { id: 'cv', number: '13½', isAnnual: false, metadataId: '317233', filePath: null, attachedVolumeId: null },
        ]);
        disk.files = ['Bone (1991) 13.5.cbz'];

        await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(F)}`));
        expect(created()).toEqual([]);
        expect((prisma.issue.update as any).mock.calls.map((c: any[]) => c[0])).toContainEqual(
            expect.objectContaining({ where: { id: 'cv' }, data: expect.objectContaining({ filePath: expect.stringContaining('Bone (1991) 13.5.cbz') }) })
        );
    });

    // #203 round 3: the page labels an attached row with its volume's name and can sort by release
    // date, so both ride on every issue row — the lane's name for attached rows only.
    it('carries the attached volume\'s name and the release date on each issue row', async () => {
        const ASM = '/comics/ASM';
        (prisma.series.findFirst as any).mockResolvedValue({
            id: 's1', name: 'The Amazing Spider-Man', year: 1963, folderPath: ASM, metadataId: '2350', metadataSource: 'COMICVINE',
        });
        (prisma.attachedVolume.findMany as any).mockResolvedValue([{ id: 'att96', name: "The Amazing Spider-Man '96", kind: 'ANNUAL' }]);
        (prisma.issue.findMany as any).mockResolvedValue([
            { id: 'main1', number: '1', isAnnual: false, metadataId: '300001', releaseDate: '1963-03-01', filePath: `${ASM}/The Amazing Spider-Man #001 (1963).cbz`, attachedVolumeId: null, attachedVolume: null },
            { id: 'a96', number: '1', isAnnual: true, metadataId: '143308', releaseDate: '1996-11-01', filePath: `${ASM}/The Amazing Spider-Man '96 #001 (1996).cbz`, attachedVolumeId: 'att96', attachedVolume: { kind: 'ANNUAL', name: "The Amazing Spider-Man '96" } },
            { id: 'loose', number: '2', isAnnual: true, metadataId: 'unmatched_x', releaseDate: null, filePath: `${ASM}/The Amazing Spider-Man Annual #002 (1965).cbz`, attachedVolumeId: null, attachedVolume: null },
        ]);
        disk.files = ['The Amazing Spider-Man #001 (1963).cbz', "The Amazing Spider-Man '96 #001 (1996).cbz", 'The Amazing Spider-Man Annual #002 (1965).cbz'];

        const body = await (await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(ASM)}`))).json();
        const byId = Object.fromEntries(body.downloadedIssues.map((i: any) => [i.id, i]));
        expect(byId.main1).toEqual(expect.objectContaining({ attachmentName: null, releaseDate: '1963-03-01', isAnnual: false }));
        expect(byId.a96).toEqual(expect.objectContaining({ attachmentName: "The Amazing Spider-Man '96", releaseDate: '1996-11-01', isAnnual: true, attachedVolumeId: 'att96' }));
        expect(byId.loose).toEqual(expect.objectContaining({ attachmentName: null, releaseDate: null, isAnnual: true }));
    });

    // #203 COLLECTED coverage walk (2026-09-15): an OWNED trade in a lane named like its parent — the
    // usual shape of a provider's "collected editions" volume — can't be name-claimed, so its file
    // parsed as run #3 and the page flagged it as a duplicate of issue #3. A file that already
    // belongs to a row groups under THAT row's key, whatever its filename says.
    it("an owned collected-lane file whose name parses to a run number groups under its row — never a duplicate of that issue", async () => {
        const F = '/comics/AbsBat';
        (prisma.series.findFirst as any).mockResolvedValue({
            id: 's1', name: 'Absolute Batman', year: 2024, folderPath: F, metadataId: '160294', metadataSource: 'COMICVINE',
        });
        (prisma.attachedVolume.findMany as any).mockResolvedValue([{ id: 'attC', name: 'Absolute Batman', kind: 'COLLECTED' }]);
        (prisma.issue.findMany as any).mockResolvedValue([
            { id: 'main3', number: '3', isAnnual: false, metadataId: '300003', filePath: `${F}/Absolute Batman #003 (2024).cbz`, attachedVolumeId: null },
            { id: 'vol3', number: '3', isAnnual: false, metadataId: '1192024', filePath: `${F}/Absolute Batman Vol. 3 (2026).cbz`, attachedVolumeId: 'attC' },
        ]);
        disk.files = ['Absolute Batman #003 (2024).cbz', 'Absolute Batman Vol. 3 (2026).cbz'];

        const body = await (await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(F)}`))).json();
        expect(body.duplicates).toEqual([]);
        expect(created()).toEqual([]);
        expect(prisma.issue.update).not.toHaveBeenCalled();
        expect(deletedIds()).toEqual([]);
    });

    // A LOCAL collected edition has no engine lane to claim its files, so a new file whose name says
    // it belongs to one is bound to it HERE, outright — a provider lane's file is still created
    // unbound for the engine's id-anchored claim (unchanged).
    it('binds a new file to a LOCAL lane by name, while a provider lane file stays for the engine to claim', async () => {
        (prisma.attachedVolume.findMany as any).mockResolvedValue([
            { id: 'attLocal', name: 'Batman: The Court of Owls', kind: 'COLLECTED', metadataSource: 'LOCAL' },
            { id: 'attCv', name: 'Batman Annual', kind: 'ANNUAL', metadataSource: 'COMICVINE' },
        ]);
        (prisma.issue.findMany as any).mockResolvedValue([]);
        disk.files = ['Batman The Court of Owls 01.cbz', 'Batman Annual 001 (2012).cbz'];

        await GET(getReq(`http://localhost/api/library/series?path=${encodeURIComponent(FOLDER)}`));

        const rows = created();
        const localBook = rows.find((r: any) => String(r.filePath).includes('Court of Owls'));
        const annual = rows.find((r: any) => String(r.filePath).includes('Annual 001'));
        expect(localBook).toEqual(expect.objectContaining({
            attachedVolumeId: 'attLocal', number: '1', isAnnual: false, metadataSource: 'LOCAL', matchState: 'MATCHED', name: 'Vol. 1', status: 'DOWNLOADED',
        }));
        expect(String(localBook.metadataId)).toMatch(/^local_attLocal_1$/);
        expect(annual).toEqual(expect.objectContaining({ number: '1', isAnnual: true, matchState: 'UNMATCHED' }));
        expect(annual.attachedVolumeId).toBeUndefined();
    });
});
