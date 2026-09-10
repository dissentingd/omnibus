// __tests__/api/library-issues-search.test.ts
// Regression for the issues-browse search 500 (beta.014): the route hardcoded mode:'insensitive',
// which the sqlite-generated Prisma client rejects at runtime. The where clause must now be
// provider-shaped: no `mode` key under SQLite, mode:'insensitive' under Postgres.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/library/issues/route';

const mocks = vi.hoisted(() => ({
    issueFindMany: vi.fn(),
    seriesFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        issue: { findMany: mocks.issueFindMany },
        series: { findMany: mocks.seriesFindMany },
    }
}));

vi.mock('next-auth/next', () => ({
    getServerSession: vi.fn().mockResolvedValue({ user: { id: 'admin_1', role: 'ADMIN' } })
}));


vi.mock('@/lib/library-access', () => ({
    getAccessibleLibraryIds: vi.fn().mockResolvedValue('ALL')
}));


const req = (q: string) => new Request(`http://localhost/api/library/issues?limit=5&q=${encodeURIComponent(q)}`);

describe('API Route: /api/library/issues search (provider-aware contains)', () => {
    beforeEach(() => {
        mocks.issueFindMany.mockResolvedValue([]);
        mocks.seriesFindMany.mockResolvedValue([]);
    });
    afterEach(() => vi.unstubAllEnvs());

    it('never sends the mode argument to a SQLite client (the 500 regression)', async () => {
        vi.stubEnv('DATABASE_URL', 'file:./omnibus.db');

        const res = await GET(req('bat'));
        expect(res.status).toBe(200);

        const where = mocks.issueFindMany.mock.calls[0][0].where;
        expect(where.OR).toHaveLength(2);
        expect(where.OR[0].name).toEqual({ contains: 'bat' });
        expect('mode' in where.OR[0].name).toBe(false);
        expect('mode' in where.OR[1].series.name).toBe(false);
    });

    it('sends mode insensitive on Postgres so search is case-insensitive there', async () => {
        vi.stubEnv('DATABASE_URL', 'postgresql://u:p@host:5432/omnibus');

        const res = await GET(req('bat'));
        expect(res.status).toBe(200);

        const where = mocks.issueFindMany.mock.calls[0][0].where;
        expect(where.OR[0].name).toEqual({ contains: 'bat', mode: 'insensitive' });
        expect(where.OR[1].series.name).toEqual({ contains: 'bat', mode: 'insensitive' });
    });
});

// Requesting from the library-wide view (field report by robotshavehearts2): each row carries what
// the series page has in hand, and says whether a request could resolve at all.
describe('API Route: /api/library/issues — request fields', () => {
    beforeEach(() => {
        mocks.issueFindMany.mockResolvedValue([]);
        mocks.seriesFindMany.mockResolvedValue([]);
    });

    const row = (id: string, over: any = {}) => ({
        id, number: '12', name: null, coverUrl: null, releaseDate: '2024-06-01', filePath: null,
        isAnnual: false, attachedVolume: null,
        series: { name: 'Batman', publisher: 'DC Comics', year: 2016, folderPath: '/comics/Batman', metadataId: '42821', metadataSource: 'COMICVINE' },
        ...over,
    });

    it('marks a missing issue of a matched series requestable, and carries the provider identity', async () => {
        mocks.issueFindMany.mockResolvedValue([row('i1')]);
        const data = await (await GET(new Request('http://localhost/api/library/issues?status=WANTED') as any)).json();
        expect(data.issues[0]).toMatchObject({
            id: 'i1', onDisk: false, requestable: true,
            seriesMetadataId: '42821', metadataSource: 'COMICVINE', isAnnual: false, isCollected: false, collectionName: null,
        });
    });

    it('never offers a request that cannot resolve: owned issues, and series with only a placeholder id', async () => {
        mocks.issueFindMany.mockResolvedValue([
            row('owned', { filePath: '/comics/Batman/012.cbz' }),
            row('unmatched', { series: { name: 'Local TPB', publisher: 'Other', year: 2019, folderPath: '/comics/Local', metadataId: 'unmatched_abc', metadataSource: 'LOCAL' } }),
            row('noid', { series: { name: 'Bare', publisher: 'Other', year: 2019, folderPath: '/comics/Bare', metadataId: null, metadataSource: 'COMICVINE' } }),
        ]);
        const data = await (await GET(new Request('http://localhost/api/library/issues') as any)).json();
        expect(data.issues.map((i: any) => [i.id, i.requestable])).toEqual([['owned', false], ['unmatched', false], ['noid', false]]);
    });

    it('carries the annual and collected domains so the composite can be built correctly', async () => {
        mocks.issueFindMany.mockResolvedValue([
            row('ann', { isAnnual: true }),
            row('tpb', { name: 'Volume 01', attachedVolume: { kind: 'COLLECTED', name: 'From the Ashes' } }),
            row('annatt', { isAnnual: true, attachedVolume: { kind: 'ANNUAL', name: 'Batman Annual' } }),
        ]);
        const data = await (await GET(new Request('http://localhost/api/library/issues') as any)).json();
        const by = Object.fromEntries(data.issues.map((i: any) => [i.id, i]));
        expect(by.ann).toMatchObject({ isAnnual: true, isCollected: false });
        expect(by.tpb).toMatchObject({ isCollected: true, collectionName: 'From the Ashes' });
        // An annual attachment is not a collection: no collection name leaks onto it.
        expect(by.annatt).toMatchObject({ isAnnual: true, isCollected: false, collectionName: null });
    });
});
