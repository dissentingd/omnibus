// Volume-level credits → SeriesCredit (library-aware recommendations, Beta A). The parser rules
// are mirrored in omnibus-engine/src/metadata.rs (parse_volume_credits tests) — keep both in step.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    deleteMany: vi.fn((args: any) => ({ op: 'deleteMany', args })),
    createMany: vi.fn((args: any) => ({ op: 'createMany', args })),
    seriesUpdate: vi.fn((args: any) => ({ op: 'seriesUpdate', args })),
}));
vi.mock('@/lib/db', () => ({
    prisma: {
        $transaction: mocks.transaction,
        seriesCredit: { deleteMany: mocks.deleteMany, createMany: mocks.createMany },
        series: { update: mocks.seriesUpdate },
    },
}));

import { parseVolumeCredits, persistSeriesCredits, CV_VOLUME_CREDIT_FIELDS } from '@/lib/utils/volume-credits';

describe('parseVolumeCredits', () => {
    it('asks the volume resource for its real credit fields', () => {
        expect(CV_VOLUME_CREDIT_FIELDS).toBe('people,characters');
    });

    it("reads people and characters with the provider's (string) appearance counts", () => {
        const rows = parseVolumeCredits({
            name: 'X-Men',
            people: [{ id: 41609, name: 'Tom Brevoort', count: '36' }, { id: 1, name: 'Jed MacKay', count: 36 }],
            characters: [{ id: 1462, name: 'Beast', count: '32' }],
        });
        expect(rows).toEqual([
            { kind: 'PERSON', providerId: '41609', name: 'Tom Brevoort', count: 36 },
            { kind: 'PERSON', providerId: '1', name: 'Jed MacKay', count: 36 },
            { kind: 'CHARACTER', providerId: '1462', name: 'Beast', count: 32 },
        ]);
    });

    it('returns null when the payload carries neither key, so existing rows are left alone', () => {
        expect(parseVolumeCredits({ name: 'Batman', concepts: [] })).toBeNull();
        expect(parseVolumeCredits(null)).toBeNull();
        expect(parseVolumeCredits(undefined)).toBeNull();
    });

    it('treats a present-but-null list as empty (ComicVine sends null for an empty list)', () => {
        expect(parseVolumeCredits({ people: null, characters: [{ id: 7, name: 'Robin', count: '2' }] }))
            .toEqual([{ kind: 'CHARACTER', providerId: '7', name: 'Robin', count: 2 }]);
        expect(parseVolumeCredits({ people: null, characters: null })).toEqual([]);
    });

    it('skips entries without a numeric id or a name, defaults a bad count to 0, and keeps the first of a duplicate', () => {
        const rows = parseVolumeCredits({
            people: [
                { id: 'abc', name: 'No Id' },
                { id: 5, name: '   ' },
                { id: 5, name: 'Twice', count: 'lots' },
                { id: '5', name: 'Twice Again', count: 9 },
                { id: 6, name: 'Negative', count: -3 },
            ],
        });
        expect(rows).toEqual([
            { kind: 'PERSON', providerId: '5', name: 'Twice', count: 0 },
            { kind: 'PERSON', providerId: '6', name: 'Negative', count: 0 },
        ]);
    });
});

describe('persistSeriesCredits', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('replaces the provider\'s rows and stamps creditsSyncedAt in ONE transaction', async () => {
        await persistSeriesCredits('s1', 'COMICVINE', [
            { kind: 'PERSON', providerId: '41609', name: 'Tom Brevoort', count: 36 },
            { kind: 'CHARACTER', providerId: '1462', name: 'Beast', count: 32 },
        ]);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        const ops = mocks.transaction.mock.calls[0][0];
        expect(ops.map((o: any) => o.op)).toEqual(['deleteMany', 'createMany', 'seriesUpdate']);
        expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { seriesId: 's1', source: 'COMICVINE' } });
        expect(mocks.createMany).toHaveBeenCalledWith({
            data: [
                { seriesId: 's1', source: 'COMICVINE', kind: 'PERSON', providerId: '41609', name: 'Tom Brevoort', count: 36 },
                { seriesId: 's1', source: 'COMICVINE', kind: 'CHARACTER', providerId: '1462', name: 'Beast', count: 32 },
            ],
        });
        expect(mocks.seriesUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { creditsSyncedAt: expect.any(Date) } });
    });

    it('an empty set still clears the old rows and stamps the series — no createMany with nothing', async () => {
        await persistSeriesCredits('s1', 'COMICVINE', []);
        const ops = mocks.transaction.mock.calls[0][0];
        expect(ops.map((o: any) => o.op)).toEqual(['deleteMany', 'seriesUpdate']);
        expect(mocks.createMany).not.toHaveBeenCalled();
    });
});
