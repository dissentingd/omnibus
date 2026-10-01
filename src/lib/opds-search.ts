// src/lib/opds-search.ts
//
// The OPDS search query side (#221 point 1). Deliberately the same discipline as the Komga facade's
// searchSeries/searchBooks (lib/komga/data.ts): the caller's library grants are the FIRST clause,
// outside anything the request contributes, so a search term can never widen what a key may see.
// The facade's own helpers are not reused here because they answer with Komga DTOs — shaped for
// Paperback — while an OPDS entry needs the raw rows (see lib/opds-sections.ts).
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { ciContains } from '@/lib/utils/db-search';
import { nestedSeriesAccessWhere, seriesAccessWhere, type AccessibleLibraries } from '@/lib/library-access';

/** Series are listed first, then issues; each is capped at the feeds' page size. */
export const OPDS_SEARCH_LIMIT = 50;

export async function searchSeriesRows(libs: AccessibleLibraries, terms: string) {
    return prisma.series.findMany({
        where: {
            AND: [
                seriesAccessWhere(libs) as Prisma.SeriesWhereInput,
                { name: ciContains(terms) },
            ],
        },
        orderBy: [{ name: 'asc' }, { year: 'asc' }, { id: 'asc' }],
        take: OPDS_SEARCH_LIMIT,
    });
}

export async function searchIssueRows(libs: AccessibleLibraries, terms: string) {
    return prisma.issue.findMany({
        where: {
            AND: [
                { filePath: { not: null } },
                nestedSeriesAccessWhere(libs) as Prisma.IssueWhereInput,
                { name: ciContains(terms) },
            ],
        },
        include: { series: { select: { id: true, name: true, publisher: true, writers: true, artists: true } } },
        orderBy: [{ seriesId: 'asc' }, { number: 'asc' }, { id: 'asc' }],
        take: OPDS_SEARCH_LIMIT,
    });
}
