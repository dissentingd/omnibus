// src/lib/utils/coverage.ts
//
// #203 COLLECTED coverage (field report by robotshavehearts2: "just to be able to say, this thing
// covers these issues is huge"). A collected book's `coversIssues` names the MAIN-RUN issue numbers
// it reprints — "1-6, 8" — and an OWNED book's coverage takes those issues out of "missing".
//
// EXACT twin of omnibus-engine/src/coverage.rs (the engine prefills coverage at lane-sync time and
// carries it through series.json; Node does the missing-issue math and validates edits). Keep the
// rules and the tests mirrored.
import { isSameIssue, normalizeFractionNumbers } from '@/lib/utils/issue-parser';

/** The widest range one token may span — "1-9999" is a typo, not a collection. */
export const MAX_RANGE_SPAN = 500;

const RANGE = /^(\d{1,4})\s*[-–—]\s*#?(\d{1,4})$/;
const SINGLE = /^\d{1,4}(?:\.\d+)?[a-zA-Z]?$/;

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');

/**
 * Expands a coverage expression into the issue numbers it names, in order, without duplicates.
 * Tokens are comma- or semicolon-separated; a token is "a-b" (a ≤ b, span ≤ MAX_RANGE_SPAN) or a
 * single number ("8", "12a", "½" → "0.5", "001" → "1"). Anything else is skipped, never guessed.
 */
export function expandCoverage(expr: string | null | undefined): string[] {
    if (!expr) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (n: string) => { if (!seen.has(n)) { seen.add(n); out.push(n); } };
    for (const raw of expr.split(/[,;]+/)) {
        const token = normalizeFractionNumbers(raw.trim().replace(/^#\s*/, ''));
        if (!token) continue;
        const range = RANGE.exec(token);
        if (range) {
            const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
            if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > MAX_RANGE_SPAN) continue;
            for (let n = a; n <= b; n++) push(String(n));
            continue;
        }
        if (SINGLE.test(token)) push(stripZeros(token));
    }
    return out;
}

/**
 * The canonical form of an expression — ranges as "a-b", singles as themselves, joined by ", " —
 * or null when nothing in it is a valid token (the edit is refused, not silently emptied).
 */
export function normalizeCoverage(expr: string | null | undefined): string | null {
    if (!expr) return null;
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const raw of expr.split(/[,;]+/)) {
        const token = normalizeFractionNumbers(raw.trim().replace(/^#\s*/, ''));
        if (!token) continue;
        const range = RANGE.exec(token);
        let canon: string | null = null;
        if (range) {
            const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
            if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= MAX_RANGE_SPAN) canon = a === b ? String(a) : `${a}-${b}`;
        } else if (SINGLE.test(token)) {
            canon = stripZeros(token);
        }
        if (canon && !seen.has(canon)) { seen.add(canon); parts.push(canon); }
    }
    return parts.length > 0 ? parts.join(', ') : null;
}

/** Whether `number` is one of the expanded coverage numbers (½ and 0.5 agree, 001 and 1 agree). */
export function isCovered(number: string, expanded: string[]): boolean {
    if (!number || expanded.length === 0) return false;
    return expanded.some(t => isSameIssue(t, number));
}

const KEYWORD = /\b(?:collect(?:s|ing|ed)?|reprint(?:s|ing|ed)?)\b/i;
const FIRST = /#\s*(\d{1,4})(?:\s*[-–—]\s*#?(\d{1,4}))?/;
const NEXT = /^\s*(?:,|&|and)\s*#?(\d{1,4})(?:\s*[-–—]\s*#?(\d{1,4}))?/i;
const isYear = (n: number) => n >= 1900 && n <= 2099;

/**
 * The coverage a provider's own text states — "Collects Batman (2011) #1-7." → "1-7" — used ONCE
 * to prefill a blank. Conservative on purpose: the numbers must follow a collect/reprint word in
 * the same sentence, the first must carry a "#", years and "Annual #N" are ignored, and anything
 * unclear yields null rather than a guess.
 */
export function coverageFromDescription(text: string | null | undefined): string | null {
    if (!text) return null;
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const kw = KEYWORD.exec(plain);
    if (!kw) return null;
    let fragment = plain.slice(kw.index + kw[0].length);
    const stop = fragment.search(/\.(?:\s|$)/);
    if (stop >= 0) fragment = fragment.slice(0, stop);
    fragment = fragment.slice(0, 250)
        .replace(/\(\d{4}(?:\s*[-–—]\s*\d{4})?\)/g, ' ')      // "(2011)" / "(2008-2010)"
        .replace(/\bannuals?\s*#?\s*\d{1,4}(?:\s*[-–—]\s*#?\d{1,4})?/gi, ' '); // "Annual #1"
    const first = FIRST.exec(fragment);
    if (!first) return null;
    const tokens: string[] = [];
    const take = (a: string, b: string | undefined) => {
        const x = parseInt(a, 10), y = b !== undefined ? parseInt(b, 10) : undefined;
        if (isYear(x) || (y !== undefined && isYear(y))) return;
        tokens.push(y !== undefined ? `${x}-${y}` : String(x));
    };
    take(first[1], first[2]);
    let rest = fragment.slice(first.index + first[0].length);
    for (;;) {
        const m = NEXT.exec(rest);
        if (!m) break;
        take(m[1], m[2]);
        rest = rest.slice(m[0].length);
    }
    return normalizeCoverage(tokens.join(', '));
}
