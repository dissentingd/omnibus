// PATCH /api/library/issue — #203 COLLECTED coverage: `coversIssues` is curation of its own kind.
// It is validated to the canonical form, only a collected edition may carry it, and a coverage-only
// save touches nothing else — no narrative lock, no ComicInfo embed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    issueFindUnique: vi.fn(),
    issueUpdate: vi.fn(),
    attachedFindUnique: vi.fn(),
    settingFindUnique: vi.fn(),
    getServerSession: vi.fn(),
    cachedCvGet: vi.fn(),
    metronGetIssueDetails: vi.fn(),
    queueAdd: vi.fn(),
    fsExistsSync: vi.fn(),
    fsPromisesUnlink: vi.fn(),
    fsPromisesMkdir: vi.fn(),
    fsPromisesWriteFile: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        issue: { findUnique: mocks.issueFindUnique, update: mocks.issueUpdate },
        attachedVolume: { findUnique: mocks.attachedFindUnique },
        systemSetting: { findUnique: mocks.settingFindUnique },
    }
}));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/library-access', () => ({ getAccessibleLibraryIds: async () => 'ALL', canAccessLibraryId: () => true }));
vi.mock('@/lib/metadata/metadata-cache', () => ({ cachedCvGet: mocks.cachedCvGet }));
vi.mock('@/lib/metadata/providers/metron', () => ({ MetronProvider: class { getIssueDetails = mocks.metronGetIssueDetails; } }));
vi.mock('@/lib/queue', () => ({ omnibusQueue: { add: mocks.queueAdd } }));
vi.mock('@/lib/utils/sanitize', () => ({ sanitizeDescription: (s: unknown) => s, providerWikiBase: () => null }));
vi.mock('@/lib/utils/paths', () => ({ CONFIG_DIR: '/config' }));
vi.mock('fs', () => {
    const promises = { unlink: mocks.fsPromisesUnlink, mkdir: mocks.fsPromisesMkdir, writeFile: mocks.fsPromisesWriteFile };
    return { existsSync: mocks.fsExistsSync, promises, default: { existsSync: mocks.fsExistsSync, promises } };
});

import { PATCH } from '@/app/api/library/issue/route';

const bookRow = (over: any = {}) => ({
    id: 'b1', number: '1', name: 'Vol. 1', description: null, releaseDate: null, universe: null,
    metadataId: '500001', metadataSource: 'COMICVINE', matchState: 'MATCHED', hasCustomMetadata: false, hasCustomCover: false,
    attachedVolumeId: 'att_tpb', coversIssues: null,
    writers: null, artists: null, coverArtists: null, colorists: null, letterers: null, characters: null, genres: null, storyArcs: null, teams: null, locations: null,
    series: { libraryId: 'lib1', metadataId: '42821', metadataSource: 'COMICVINE', name: 'Batman' },
    ...over,
});
const patch = (body: any) => PATCH(new Request('http://localhost/api/library/issue', { method: 'PATCH', body: JSON.stringify(body) }) as any);

describe('PATCH /api/library/issue — coversIssues', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'admin_1', role: 'ADMIN' } });
        mocks.issueUpdate.mockResolvedValue({});
        mocks.attachedFindUnique.mockResolvedValue({ kind: 'COLLECTED' });
    });

    it('saves the canonical form on a collected book and touches nothing else', async () => {
        mocks.issueFindUnique.mockResolvedValue(bookRow());
        const res = await patch({ issueId: 'b1', coversIssues: ' 1 - 6 , 8 ' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, changed: true, wroteToFile: false, coversIssues: '1-6, 8' });
        expect(mocks.issueUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.issueUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { coversIssues: '1-6, 8' } });
        expect(mocks.queueAdd).not.toHaveBeenCalled(); // no ComicInfo embed
    });

    it('clears with an empty value, and a same-value save writes nothing', async () => {
        mocks.issueFindUnique.mockResolvedValue(bookRow({ coversIssues: '1-6' }));
        expect(await (await patch({ issueId: 'b1', coversIssues: '' })).json()).toMatchObject({ changed: true, coversIssues: null });
        expect(mocks.issueUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { coversIssues: null } });
        mocks.issueUpdate.mockClear();
        expect(await (await patch({ issueId: 'b1', coversIssues: '1-6' })).json()).toMatchObject({ changed: false });
        expect(mocks.issueUpdate).not.toHaveBeenCalled();
    });

    it('refuses an unreadable expression, and coverage on anything but a collected edition', async () => {
        mocks.issueFindUnique.mockResolvedValue(bookRow());
        expect((await patch({ issueId: 'b1', coversIssues: 'the first arc' })).status).toBe(400);
        mocks.issueFindUnique.mockResolvedValue(bookRow({ attachedVolumeId: null }));
        expect((await patch({ issueId: 'b1', coversIssues: '1-6' })).status).toBe(400);
        mocks.attachedFindUnique.mockResolvedValue({ kind: 'ANNUAL' });
        mocks.issueFindUnique.mockResolvedValue(bookRow());
        expect((await patch({ issueId: 'b1', coversIssues: '1-6' })).status).toBe(400);
        expect(mocks.issueUpdate).not.toHaveBeenCalled();
    });
});
