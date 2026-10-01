// src/lib/opds-feed.ts
//
// The pieces all three OPDS feeds share (#218): the Atom `<updated>` values, the `<author>` list
// built from a row's creators, the issue entry title, and the feed media type. Kept in one module so
// the rules live in a single place and the three routes cannot drift apart.
import { escapeXml } from '@/lib/utils/xml';
import { authorsFromRows, type KomgaAuthor } from '@/lib/komga/dto';

/** An Atom `<updated>` is required even for an empty feed; 1970 is the only honest "no content" value. */
export const OPDS_EPOCH = new Date(0).toISOString();

/** The response media type: `navigation` feeds list routes, `acquisition` feeds list publications. */
export function feedContentType(kind: 'navigation' | 'acquisition'): string {
    return `application/atom+xml;profile=opds-catalog;kind=${kind}; charset=utf-8`;
}

function toIso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? date.toISOString() : null;
}

/** An entry's `<updated>`, from its own `updatedAt`. */
export function entryUpdated(value: Date | string | null | undefined): string {
    return toIso(value) ?? OPDS_EPOCH;
}

/** A feed's own `<updated>`: the newest of its entries. */
export function feedUpdated(values: Array<Date | string | null | undefined>): string {
    let newest = 0;
    for (const value of values) {
        const iso = toIso(value);
        if (iso) newest = Math.max(newest, new Date(iso).getTime());
    }
    return new Date(newest).toISOString();
}

/**
 * Each creator as its own `<author>` element (#218 §5.1.1). An entry whose creators are unknown
 * emits none — the feed carries its own `<author>`, which keeps the document valid Atom.
 */
export function authorElements(authors: KomgaAuthor[]): string {
    return authors.map((a) => `<author><name>${escapeXml(a.name)}</name></author>`).join('\n    ');
}

/** The publisher element, moved out of `<author>` (#218). Emitted only when the publisher is known. */
export function publisherElement(publisher: string | null | undefined): string {
    return publisher ? `<dc:publisher>${escapeXml(publisher)}</dc:publisher>` : '';
}

/**
 * An issue's creators: its own `writers`/`artists`, falling back per field to the series' (#218).
 */
export function issueCreators(
    issue: { writers?: string | null; artists?: string | null },
    series: { writers?: string | null; artists?: string | null },
): KomgaAuthor[] {
    return authorsFromRows([{
        writers: issue.writers ?? series.writers,
        artists: issue.artists ?? series.artists,
    }]);
}

/**
 * The issue entry's title (#218): `Series #N - Title`, reduced to `Series #N` when there is no story
 * title or the title only repeats the series and the number. An annual says so, matching the series page.
 */
export function issueEntryTitle(
    seriesName: string,
    issue: { number: string; name?: string | null; isAnnual?: boolean | null },
): string {
    const num = String(issue.number ?? '').trim();
    const base = `${seriesName}${issue.isAnnual ? ' Annual' : ''} #${num}`;
    const name = (issue.name ?? '').trim();
    if (!name) return base;
    if (name.toLowerCase() === seriesName.trim().toLowerCase()) return base;
    if (name === `#${num}` || name === base) return base;
    return `${base} - ${name}`;
}
