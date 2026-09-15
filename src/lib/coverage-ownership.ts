// src/lib/coverage-ownership.ts
//
// #203 COLLECTED coverage as OWNERSHIP (field report by robotshavehearts2). Beta A made a collected
// book's coverage take issues out of the series page's "missing"; this is the same fact for every
// other place that decides whether an issue is missing — the Discover and request-search badges, a
// volume request's expansion into per-issue requests (the engine's monitor carries its own twin).
// One question, answered once: which run numbers do the OWNED collected books of a series cover?
import { prisma } from '@/lib/db';
import { expandCoverage } from '@/lib/utils/coverage';

/**
 * seriesId → the expanded numbers its owned COLLECTED books cover (merged across books, no
 * duplicates, in order). `where` narrows the lookup — a series, an access scope. A series with
 * nothing covered is absent from the map.
 */
export async function ownedCoverageBySeries(where: Record<string, unknown> = {}): Promise<Map<string, string[]>> {
    const books = await prisma.issue.findMany({
        where: { ...where, filePath: { not: null }, coversIssues: { not: null }, attachedVolume: { kind: 'COLLECTED' } },
        select: { seriesId: true, coversIssues: true },
    });
    const out = new Map<string, string[]>();
    for (const b of books) {
        const nums = expandCoverage(b.coversIssues);
        if (nums.length === 0) continue;
        const list = out.get(b.seriesId) || [];
        for (const n of nums) if (!list.includes(n)) list.push(n);
        out.set(b.seriesId, list);
    }
    return out;
}
