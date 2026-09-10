// The one composite both request doors file under. These pin the series page's historical
// behaviour (extracted verbatim) so the Missing Issues view can never file a different string.
import { describe, it, expect } from 'vitest';
import { requestNameFor } from '@/lib/utils/request-name';

describe('requestNameFor', () => {
    it('files a plain issue as "Series #N"', () => {
        expect(requestNameFor({ seriesName: 'Batman', number: '12', parsedNum: 12 }))
            .toEqual({ composite: 'Batman #12', reqNum: '12' });
    });

    it('never says "#null" — the raw number is the fallback when parseFloat gave up (#200)', () => {
        expect(requestNameFor({ seriesName: 'Batman', number: '½', parsedNum: null }).composite).toBe('Batman #½');
        expect(requestNameFor({ seriesName: 'Batman', number: '0.5', parsedNum: 0.5 }).composite).toBe('Batman #0.5');
    });

    it('carries the annual domain in the composite (#203 Phase 0)', () => {
        expect(requestNameFor({ seriesName: 'Batman', number: '1', parsedNum: 1, isAnnual: true }).composite)
            .toBe('Batman Annual #1');
    });

    it('appends a real story title, adopts a title that already carries the number, drops a title equal to the series', () => {
        expect(requestNameFor({ seriesName: 'Batman', number: '1', parsedNum: 1, name: 'The Court of Owls' }).composite)
            .toBe('Batman #1: The Court of Owls');
        expect(requestNameFor({ seriesName: 'Batman', number: '1', parsedNum: 1, name: 'Batman #1: Knightfall' }).composite)
            .toBe('Batman #1: Knightfall');
        expect(requestNameFor({ seriesName: 'Batman', number: '1', parsedNum: 1, name: 'Batman' }).composite)
            .toBe('Batman #1');
    });

    it('files a collected edition by its own title, never as "{Series} #N" (#203 COLLECTED)', () => {
        expect(requestNameFor({ seriesName: 'X-Men', number: '1', parsedNum: 1, isCollected: true, name: 'X-Men: From the Ashes Vol. 1' }).composite)
            .toBe('X-Men: From the Ashes Vol. 1');
        // A title equal to the series name is no title: fall back to the collection, then to Vol. N.
        expect(requestNameFor({ seriesName: 'X-Men', number: '1', parsedNum: 1, isCollected: true, name: 'X-Men', collectionName: 'From the Ashes' }).composite)
            .toBe('From the Ashes');
        expect(requestNameFor({ seriesName: 'X-Men', number: '2', parsedNum: 2, isCollected: true }).composite)
            .toBe('X-Men Vol. 2');
        // Collected outranks annual: the attachment's kind is the explicit decision about the file.
        expect(requestNameFor({ seriesName: 'X-Men', number: '1', parsedNum: 1, isCollected: true, isAnnual: true, name: 'The Book' }).composite)
            .toBe('The Book');
    });
});
