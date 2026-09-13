// src/lib/utils/attachment-name.ts
//
// #203 name-anchored attachment (anacronismo, 2026-09-09): "The Amazing Spider-Man '96 #001
// (1996).cbz" sits in the Amazing Spider-Man folder. It carries no "Annual" token, so it parses as
// main-run #1 and collides with the 1963 #1 — while the attached volume it belongs to ("The Amazing
// Spider-Man '96", a one-off named like its parent) shows "0 of 1 owned". The filename is the only
// signal, and it is a good one: a file whose name STARTS WITH an attached volume's own name belongs
// to that volume.
//
// The rule, shared by the series page's file keying (this side) and the engine's lane claim
// (omnibus-engine/src/attached_volumes.rs attachment_for_filename — keep them identical):
//   - token-prefix match with the scanner's series-prefix rules (case, separators, glue guard);
//   - an attachment whose name is itself a token-prefix of the SERIES name (equal included) can
//     never match, or every main-run file would;
//   - among several matches the most specific name wins (most tokens, then longest);
//   - the number is parsed with the attachment's name as the series hint.
import { describeIssueFromFilename, stripSeriesPrefix } from '@/lib/utils/issue-parser';

export interface AttachmentNameRef { id: string; name?: string | null; kind?: string | null }
export interface AttachmentFileMatch { id: string; kind: string; number: string }

const tokenCount = (s: string) => (s.match(/[a-zA-Z0-9]+/g) || []).length;

export function attachmentForFilename(fileName: string, seriesName: string, attachments: AttachmentNameRef[]): AttachmentFileMatch | null {
    let best: AttachmentNameRef | null = null;
    let bestTokens = -1;
    let bestLength = -1;
    for (const a of attachments) {
        const name = (a.name || '').trim();
        if (!name) continue;
        // The parent's own name — or a shorter prefix of it — names the parent's files, not a lane's.
        if (stripSeriesPrefix(seriesName, name) !== null) continue;
        if (stripSeriesPrefix(fileName, name) === null) continue;
        const tokens = tokenCount(name);
        if (tokens > bestTokens || (tokens === bestTokens && name.length > bestLength)) {
            best = a; bestTokens = tokens; bestLength = name.length;
        }
    }
    if (!best) return null;
    const number = describeIssueFromFilename(fileName, (best.name as string).trim()).number;
    return { id: best.id, kind: (best.kind || 'ANNUAL').toUpperCase(), number };
}
