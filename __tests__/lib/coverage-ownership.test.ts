// #203 COLLECTED coverage as ownership: the ONE question every "is this issue missing?" decision
// outside the series page asks — which run numbers do the OWNED collected books of a series cover?
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { issue: { findMany: vi.fn() } } }));

import { prisma } from '@/lib/db';
import { ownedCoverageBySeries } from '@/lib/coverage-ownership';

describe('ownedCoverageBySeries', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('maps each series to the numbers its OWNED collected books cover — merged, expanded, in order', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([
            { seriesId: 's1', coversIssues: '1-3' },
            { seriesId: 's1', coversIssues: '3, 8' },
            { seriesId: 's2', coversIssues: '½' },
            { seriesId: 's3', coversIssues: 'abc' }, // unreadable → contributes nothing
        ]);

        const m = await ownedCoverageBySeries({ seriesId: { in: ['s1', 's2', 's3'] } });

        expect(m.get('s1')).toEqual(['1', '2', '3', '8']);
        expect(m.get('s2')).toEqual(['0.5']);
        expect(m.has('s3')).toBe(false);
        // Only books that are ON DISK, of a COLLECTED attachment, with coverage — and the caller's scope on top.
        expect((prisma.issue.findMany as any).mock.calls[0][0].where).toEqual(expect.objectContaining({
            filePath: { not: null },
            coversIssues: { not: null },
            attachedVolume: { kind: 'COLLECTED' },
            seriesId: { in: ['s1', 's2', 's3'] },
        }));
    });

    it('is empty when nothing is covered', async () => {
        (prisma.issue.findMany as any).mockResolvedValue([]);
        expect((await ownedCoverageBySeries()).size).toBe(0);
    });
});
