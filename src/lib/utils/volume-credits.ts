// src/lib/utils/volume-credits.ts
//
// Library-aware recommendations, Beta A (field report by robotshavehearts2): the provider's
// volume-level credits — every person and character on a ComicVine volume, each with the provider's
// appearance count — persisted to SeriesCredit on every volume sync.
//
// The volume call had been asking for `person_credits,character_credits` (ISSUE-resource field
// names), which the volume resource silently ignores; its fields are `people` and `characters`
// (confirmed live 2026-09-11: X-Men (2024) answered with 168 people / 88 characters, `count` as a
// string). So the credits arrive for a call every sync already makes — no new provider cost.
//
// EXACT twin of omnibus-engine/src/metadata.rs (parse_volume_credits / persist_series_credits):
// the engine runs the scheduled and targeted syncs, Node runs the request-time one, and both must
// leave identical rows. Keep the rules and the tests mirrored.
import { prisma } from '@/lib/db';

/** The volume-resource field names that carry credits. Appended to both twins' field_list. */
export const CV_VOLUME_CREDIT_FIELDS = 'people,characters';

export type VolumeCreditKind = 'PERSON' | 'CHARACTER';

export interface VolumeCredit {
    kind: VolumeCreditKind;
    providerId: string;
    name: string;
    count: number;
}

// Strict on purpose so the Rust twin can match it exactly: a number is floored (never negative),
// a string must be all digits; anything else is 0 / no id.
const toCount = (raw: unknown): number => {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const s = String(raw ?? '').trim();
    return /^\d+$/.test(s) ? parseInt(s, 10) : 0;
};

const toId = (raw: unknown): string | null => {
    if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? String(raw) : null;
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim();
    return null;
};

/**
 * Reads a ComicVine volume payload's `people` / `characters` into credit rows.
 *
 * Returns null when the payload carries NEITHER key — an older cached payload fetched before
 * the field names were fixed, or a field_list that didn't ask — so the caller leaves the
 * existing rows alone rather than wiping them. A key that is present but not an array (CV
 * sends null for an empty list) reads as empty for that kind. Entries without a numeric id or
 * a name are skipped; a duplicate (kind, id) keeps its first appearance.
 */
export function parseVolumeCredits(vol: any): VolumeCredit[] | null {
    if (!vol || typeof vol !== 'object') return null;
    const hasPeople = Object.prototype.hasOwnProperty.call(vol, 'people');
    const hasCharacters = Object.prototype.hasOwnProperty.call(vol, 'characters');
    if (!hasPeople && !hasCharacters) return null;

    const out: VolumeCredit[] = [];
    const seen = new Set<string>();
    const read = (kind: VolumeCreditKind, list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const entry of list) {
            if (!entry || typeof entry !== 'object') continue;
            const providerId = toId((entry as any).id);
            const name = typeof (entry as any).name === 'string' ? (entry as any).name.trim() : '';
            if (!providerId || !name) continue;
            const key = `${kind}:${providerId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ kind, providerId, name, count: toCount((entry as any).count) });
        }
    };
    read('PERSON', vol.people);
    read('CHARACTER', vol.characters);
    return out;
}

/**
 * Replaces the series' credit rows for one provider with the given set and stamps
 * Series.creditsSyncedAt — one transaction, so a reader never sees the half-written state.
 * Pass the result of parseVolumeCredits only when it is non-null.
 */
export async function persistSeriesCredits(seriesId: string, source: string, credits: VolumeCredit[]): Promise<void> {
    const now = new Date();
    await prisma.$transaction([
        prisma.seriesCredit.deleteMany({ where: { seriesId, source } }),
        ...(credits.length > 0
            ? [prisma.seriesCredit.createMany({
                data: credits.map(c => ({ seriesId, source, kind: c.kind, providerId: c.providerId, name: c.name, count: c.count })),
            })]
            : []),
        prisma.series.update({ where: { id: seriesId }, data: { creditsSyncedAt: now } }),
    ]);
}
