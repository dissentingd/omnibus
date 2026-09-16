// src/lib/utils/issue-sort.ts
//
// #203 round 3 (anacronismo, 2026-09-13): the series page listed the run by number and then every
// attached volume's annuals by number after it, so seven "Annual #1"s from seven volumes sat in a
// row with nothing on them saying which volume each was from — and a reader working through a
// long series had no way to see annuals where they were published. Two small things, shared by
// every list on the page:
//   - laneLabel: an attached row names its volume ahead of the domain ("The Amazing Spider-Man
//     '96 · Annual"), the way the Duplicate Resolver names a lane group (beta.025);
//   - sortIssuesForDisplay: by number (the run first, then the annuals — the page's historical
//     order, in either direction) or by release date, where annuals fall into place between the
//     issues they were published among. Rows with no date go last whichever way the sort runs, so
//     a newest-first list never opens with undated skeletons.

export type IssueSortMode = 'number_asc' | 'number_desc' | 'date_asc' | 'date_desc';

export const ISSUE_SORT_MODES: ReadonlyArray<{ value: IssueSortMode; label: string }> = [
    { value: 'number_asc', label: 'Number, low to high' },
    { value: 'number_desc', label: 'Number, high to low' },
    { value: 'date_asc', label: 'Release date, oldest first' },
    { value: 'date_desc', label: 'Release date, newest first' },
];

export const DEFAULT_ISSUE_SORT: IssueSortMode = 'number_asc';

/** The remembered preference's storage key (one choice for every series page, like the view mode). */
export const ISSUE_SORT_STORAGE_KEY = 'omnibus-series-sort';

export function parseIssueSortMode(raw: unknown): IssueSortMode | null {
    return ISSUE_SORT_MODES.some(m => m.value === raw) ? (raw as IssueSortMode) : null;
}

export interface SortableIssue {
    parsedNum?: number | null;
    isAnnual?: boolean | null;
    releaseDate?: string | null;
}

const num = (i: SortableIssue) => {
    const n = typeof i.parsedNum === 'number' ? i.parsedNum : Number(i.parsedNum);
    return Number.isFinite(n) ? n : 0;
};

/** The page's historical order: the run, then the annuals, by number within each. */
const domainThenNumber = (a: SortableIssue, b: SortableIssue) =>
    ((a.isAnnual ? 1 : 0) - (b.isAnnual ? 1 : 0)) || (num(a) - num(b));

const dateKey = (i: SortableIssue) => (typeof i.releaseDate === 'string' && i.releaseDate.trim()) ? i.releaseDate.trim() : null;

export function sortIssuesForDisplay<T extends SortableIssue>(issues: readonly T[], mode: IssueSortMode): T[] {
    const desc = mode.endsWith('_desc');
    const dir = desc ? -1 : 1;
    const out = [...issues];
    if (mode.startsWith('number')) {
        // The run stays ahead of the annuals in both directions — only the numbering flips.
        out.sort((a, b) => ((a.isAnnual ? 1 : 0) - (b.isAnnual ? 1 : 0)) || dir * (num(a) - num(b)));
        return out;
    }
    out.sort((a, b) => {
        const da = dateKey(a);
        const db = dateKey(b);
        if (da === null || db === null) {
            if (da === null && db === null) return dir * domainThenNumber(a, b);
            return da === null ? 1 : -1; // undated rows last, whichever way the sort runs
        }
        // ISO dates compare as strings; a shared date falls back to the page's own order.
        return dir * (da < db ? -1 : da > db ? 1 : domainThenNumber(a, b));
    });
    return out;
}

/** "The Amazing Spider-Man '96 · Annual", "Annual", "Issue" — the page appends " #N". */
export function laneLabel(issue: { isAnnual?: boolean | null; attachmentName?: string | null }): string {
    const domain = issue.isAnnual ? 'Annual' : 'Issue';
    const lane = (issue.attachmentName || '').trim();
    return lane ? `${lane} · ${domain}` : domain;
}
