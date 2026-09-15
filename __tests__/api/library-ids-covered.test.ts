// /api/library/ids — the feed behind Discover's and the request search's ownership badges. #203
// COLLECTED coverage: a run issue nobody has on disk but an OWNED collected edition reprints is not
// missing, so its provider id rides in a `covered` list of its own — never among the owned ids
// (it is not "In Library"), never absent (it is not something to bulk-request either).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1', role: 'USER' } }) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));
// A SCOPED user: the route's 30s admin cache never applies, so every test computes fresh.
vi.mock('@/lib/library-access', () => ({
    getAccessibleLibraryIds: vi.fn(async () => ['lib1']),
    seriesAccessWhere: (ids: string[]) => ({ libraryId: { in: ids } }),
    nestedSeriesAccessWhere: (ids: string[]) => ({ series: { libraryId: { in: ids } } }),
}));
vi.mock('@/lib/db', () => ({
    prisma: { series: { findMany: vi.fn() }, issue: { findMany: vi.fn() }, request: { findMany: vi.fn() } },
}));

import { prisma } from '@/lib/db';
import { GET } from '@/app/api/library/ids/route';

describe('/api/library/ids — covered issues', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.series.findMany as any).mockResolvedValue([{ cvId: null, metadataId: '160294', monitored: true, name: 'Absolute Batman' }]);
        (prisma.request.findMany as any).mockResolvedValue([]);
    });

    it('lists the provider ids of issues an owned collected edition covers, apart from the owned ones', async () => {
        (prisma.issue.findMany as any).mockImplementation(async ({ where }: any) => {
            // The covering books: owned, COLLECTED, with coverage.
            if (where.attachedVolume) return [{ seriesId: 's1', coversIssues: '15-23' }];
            // The file-less run rows of the series those books belong to.
            if (where.filePath === null) return [
                { seriesId: 's1', number: '21', cvId: null, metadataId: '1192021' },
                { seriesId: 's1', number: '22', cvId: null, metadataId: '1192022' },
                { seriesId: 's1', number: '24', cvId: null, metadataId: '1192024' }, // past the trade
            ];
            // What is actually on disk.
            return [{ cvId: null, metadataId: '300001', number: '1', series: { name: 'Absolute Batman' } }];
        });

        const body = await (await GET()).json();

        expect(body.issues).toEqual(['300001']);
        expect(body.covered).toEqual(['1192021', '1192022']);
        // The scope the caller has travels into every lookup.
        for (const call of (prisma.issue.findMany as any).mock.calls) {
            expect(call[0].where).toEqual(expect.objectContaining({ series: { libraryId: { in: ['lib1'] } } }));
        }
    });

    it('sends an empty covered list, and looks no further, when no owned book covers anything', async () => {
        (prisma.issue.findMany as any).mockImplementation(async ({ where }: any) => {
            if (where.attachedVolume) return [];
            if (where.filePath === null) throw new Error('should not query file-less rows with nothing covering them');
            return [];
        });

        const body = await (await GET()).json();
        expect(body.covered).toEqual([]);
        expect((prisma.issue.findMany as any).mock.calls).toHaveLength(2);
    });
});
