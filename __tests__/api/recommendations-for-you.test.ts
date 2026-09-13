// Library-aware recommendations, Beta B: the For-You read route only serves the engine-built cache
// and hides what went stale since the rebuild (acquired / attached / requested / dismissed); the
// dismiss route is per user.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../../src/app/api/recommendations/for-you/route';
import { POST as dismissPost, DELETE as dismissDelete } from '../../src/app/api/recommendations/for-you/dismiss/route';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    settingFindUnique: vi.fn(),
    seriesFindMany: vi.fn(),
    attachedFindMany: vi.fn(),
    requestFindMany: vi.fn(),
    dismissalFindMany: vi.fn(),
    dismissalUpsert: vi.fn(),
    dismissalDeleteMany: vi.fn(),
    log: vi.fn(),
}));

vi.mock('next-auth/next', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('../../src/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/lib/db', () => ({
    prisma: {
        systemSetting: { findUnique: mocks.settingFindUnique },
        series: { findMany: mocks.seriesFindMany },
        attachedVolume: { findMany: mocks.attachedFindMany },
        request: { findMany: mocks.requestFindMany },
        recommendationDismissal: { findMany: mocks.dismissalFindMany, upsert: mocks.dismissalUpsert, deleteMany: mocks.dismissalDeleteMany },
    },
}));
vi.mock('../../src/lib/logger', () => ({ Logger: { log: mocks.log } }));

const item = (volumeId: string, name: string, over: any = {}) => ({
    volumeId, name, startYear: 2020, publisher: 'Marvel', image: `https://cv.example/${volumeId}.jpg`, countOfIssues: 12,
    description: null, siteUrl: null, score: 1.5, because: [{ kind: 'CHARACTER', id: '1440', name: 'Wolverine' }], metadataSource: 'COMICVINE',
    ...over,
});

const cache = (items: any[], extra: any = {}) => ({ value: JSON.stringify({ builtAt: '2026-09-12T18:00:00Z', seeds: [{ kind: 'CHARACTER', id: '1440', name: 'Wolverine', weight: 1, series: 10, role: 'character' }], items, ...extra }) });

describe('GET /api/recommendations/for-you', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
        mocks.seriesFindMany.mockResolvedValue([]);
        mocks.attachedFindMany.mockResolvedValue([]);
        mocks.requestFindMany.mockResolvedValue([]);
        mocks.dismissalFindMany.mockResolvedValue([]);
    });

    it('requires a session', async () => {
        mocks.getServerSession.mockResolvedValue(null);
        const res = await GET(new Request('http://x/api/recommendations/for-you') as any);
        expect(res.status).toBe(401);
    });

    it('serves the cached items with proxied covers and the seeds, without a provider call', async () => {
        mocks.settingFindUnique.mockResolvedValue(cache([item('100', 'Uncanny X-Men'), item('200', 'X-Force')]));
        const body = await (await GET(new Request('http://x/api/recommendations/for-you') as any)).json();
        expect(body.builtAt).toBe('2026-09-12T18:00:00Z');
        expect(body.total).toBe(2);
        expect(body.items.map((i: any) => i.name)).toEqual(['Uncanny X-Men', 'X-Force']);
        expect(body.items[0].image).toBe(`/api/library/cover?path=${encodeURIComponent('https://cv.example/100.jpg')}`);
        expect(body.items[0].because[0].name).toBe('Wolverine');
        expect(body.seeds[0].name).toBe('Wolverine');
        expect(body.nextOffset).toBeNull();
    });

    it('hides what went stale since the rebuild: acquired, attached, requested, and dismissed volumes', async () => {
        mocks.settingFindUnique.mockResolvedValue(cache([item('1', 'Keep'), item('2', 'Acquired'), item('3', 'Attached'), item('4', 'Requested'), item('5', 'Dismissed')]));
        mocks.seriesFindMany.mockResolvedValue([{ metadataId: '2' }]);
        mocks.attachedFindMany.mockResolvedValue([{ volumeId: '3' }]);
        mocks.requestFindMany.mockResolvedValue([{ volumeId: '4' }]);
        mocks.dismissalFindMany.mockResolvedValue([{ volumeId: '5' }]);
        const body = await (await GET(new Request('http://x/api/recommendations/for-you') as any)).json();
        expect(body.items.map((i: any) => i.name)).toEqual(['Keep']);
        expect(body.total).toBe(1);
        // The dismissal lookup is scoped to the caller.
        expect(mocks.dismissalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }));
    });

    it('pages with offset/limit over the visible set', async () => {
        mocks.settingFindUnique.mockResolvedValue(cache([item('1', 'A'), item('2', 'B'), item('3', 'C')]));
        const body = await (await GET(new Request('http://x/api/recommendations/for-you?limit=2') as any)).json();
        expect(body.items.map((i: any) => i.name)).toEqual(['A', 'B']);
        expect(body.nextOffset).toBe(2);
        const page2 = await (await GET(new Request('http://x/api/recommendations/for-you?limit=2&offset=2') as any)).json();
        expect(page2.items.map((i: any) => i.name)).toEqual(['C']);
        expect(page2.nextOffset).toBeNull();
    });

    it('answers empty (not an error) before the first rebuild, and carries the engine\'s reason when it wrote one', async () => {
        mocks.settingFindUnique.mockResolvedValue(null);
        const body = await (await GET(new Request('http://x/api/recommendations/for-you') as any)).json();
        expect(body).toEqual({ builtAt: null, items: [], seeds: [], total: 0, nextOffset: null });

        mocks.settingFindUnique.mockResolvedValue(cache([], { reason: 'no_credits' }));
        const body2 = await (await GET(new Request('http://x/api/recommendations/for-you') as any)).json();
        expect(body2.items).toEqual([]);
        expect(body2.reason).toBe('no_credits');
    });
});

describe('/api/recommendations/for-you/dismiss', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
    });

    it('POST records a per-user dismissal (idempotent upsert) and DELETE removes it', async () => {
        const post = await dismissPost(new Request('http://x/d', { method: 'POST', body: JSON.stringify({ volumeId: 4050 }) }) as any);
        expect(post.status).toBe(200);
        expect(mocks.dismissalUpsert).toHaveBeenCalledWith({
            where: { userId_source_volumeId: { userId: 'u1', source: 'COMICVINE', volumeId: '4050' } },
            update: {},
            create: { userId: 'u1', source: 'COMICVINE', volumeId: '4050' },
        });

        const del = await dismissDelete(new Request('http://x/d', { method: 'DELETE', body: JSON.stringify({ volumeId: '4050' }) }) as any);
        expect((await del.json()).dismissed).toBe(false);
        expect(mocks.dismissalDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', source: 'COMICVINE', volumeId: '4050' } });
    });

    it('rejects a missing or non-numeric volumeId, and an anonymous caller', async () => {
        expect((await dismissPost(new Request('http://x/d', { method: 'POST', body: JSON.stringify({ volumeId: 'abc' }) }) as any)).status).toBe(400);
        expect((await dismissPost(new Request('http://x/d', { method: 'POST', body: '{}' }) as any)).status).toBe(400);
        mocks.getServerSession.mockResolvedValue(null);
        expect((await dismissPost(new Request('http://x/d', { method: 'POST', body: JSON.stringify({ volumeId: '1' }) }) as any)).status).toBe(401);
        expect(mocks.dismissalUpsert).not.toHaveBeenCalled();
    });
});
