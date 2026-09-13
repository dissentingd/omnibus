// The name-anchoring rule (#203). EXACT twin of omnibus-engine/src/attached_volumes.rs
// attachment_for_filename tests — keep both in step.
import { describe, it, expect } from 'vitest';
import { attachmentForFilename } from '@/lib/utils/attachment-name';

const SERIES = 'The Amazing Spider-Man';
const att96 = { id: 'att96', name: "The Amazing Spider-Man '96", kind: 'ANNUAL' };
const attAnnual = { id: 'attAnn', name: 'The Amazing Spider-Man Annual', kind: 'ANNUAL' };
const attTrade = { id: 'attTpb', name: 'The Amazing Spider-Man: Coming Home', kind: 'COLLECTED' };

describe('attachmentForFilename', () => {
    it("claims the '96 one-off by name and parses its number under that name", () => {
        expect(attachmentForFilename("The Amazing Spider-Man '96 #001 (1996).cbz", SERIES, [attAnnual, att96]))
            .toEqual({ id: 'att96', kind: 'ANNUAL', number: '1' });
        // The filename that IS just the volume name is that volume's one-shot.
        expect(attachmentForFilename("The Amazing Spider-Man '96 (1996).cbz", SERIES, [att96]))
            .toEqual({ id: 'att96', kind: 'ANNUAL', number: '1' });
        // Case and separators are the scanner's rules, not the user's typing.
        expect(attachmentForFilename("the amazing spider-man '96 - 001.cbz", SERIES, [att96])?.number).toBe('1');
    });

    it("never hands the parent's own files to a lane: a main-run file matches nothing", () => {
        expect(attachmentForFilename('The Amazing Spider-Man #001 (1963).cbz', SERIES, [att96, attAnnual, attTrade])).toBeNull();
        // An attachment named exactly like the series (or a prefix of it) can never match.
        const twin = { id: 'same', name: 'The Amazing Spider-Man', kind: 'COLLECTED' };
        const shorter = { id: 'short', name: 'Amazing Spider-Man', kind: 'COLLECTED' };
        expect(attachmentForFilename('The Amazing Spider-Man #001 (1963).cbz', SERIES, [twin])).toBeNull();
        expect(attachmentForFilename('Amazing Spider-Man #001 (1963).cbz', 'Amazing Spider-Man Annual', [shorter])).toBeNull();
    });

    it('respects the glue guard and token boundaries', () => {
        // "'96" is a token; "1996" is a different token → not the '96 volume.
        expect(attachmentForFilename('The Amazing Spider-Man 1996 #001 (1996).cbz', SERIES, [att96])).toBeNull();
        // "Annuals" is not "Annual" (glue guard).
        expect(attachmentForFilename('The Amazing Spider-Man Annuals #001.cbz', SERIES, [attAnnual])).toBeNull();
    });

    it('the most specific name wins when several attachments match', () => {
        const xmen = 'X-Men';
        const annual = { id: 'a', name: 'X-Men Annual', kind: 'ANNUAL' };
        const annual95 = { id: 'a95', name: "X-Men Annual '95", kind: 'ANNUAL' };
        expect(attachmentForFilename("X-Men Annual '95 #001 (1995).cbz", xmen, [annual, annual95])?.id).toBe('a95');
        expect(attachmentForFilename('X-Men Annual #003 (1979).cbz', xmen, [annual95, annual])?.id).toBe('a');
    });

    it('carries the attachment kind (uppercased, ANNUAL by default) and skips nameless attachments', () => {
        expect(attachmentForFilename('The Amazing Spider-Man: Coming Home Vol. 1.cbz', SERIES, [attTrade]))
            .toEqual({ id: 'attTpb', kind: 'COLLECTED', number: '1' });
        expect(attachmentForFilename("The Amazing Spider-Man '96 #001.cbz", SERIES, [{ id: 'x', name: null }, { id: 'y', name: '' }, { id: 'z', name: "The Amazing Spider-Man '96", kind: null }]))
            .toEqual({ id: 'z', kind: 'ANNUAL', number: '1' });
    });
});
