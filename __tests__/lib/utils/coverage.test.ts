// #203 COLLECTED coverage — EXACT twin of omnibus-engine/src/coverage.rs tests. Keep both in step.
import { describe, it, expect } from 'vitest';
import { expandCoverage, normalizeCoverage, isCovered, coverageFromDescription } from '@/lib/utils/coverage';

describe('coverage', () => {
    it('expands ranges and singles, in order, without duplicates', () => {
        expect(expandCoverage('1-6, 8')).toEqual(['1', '2', '3', '4', '5', '6', '8']);
        expect(expandCoverage('#1-#3; #5')).toEqual(['1', '2', '3', '5']);
        expect(expandCoverage('001, 002, 2')).toEqual(['1', '2']);
        expect(expandCoverage('½, 2, 12a')).toEqual(['0.5', '2', '12a']);
        expect(expandCoverage('3-3')).toEqual(['3']);
    });

    it('skips what it cannot read rather than guessing', () => {
        expect(expandCoverage('6-1')).toEqual([]);          // reversed
        expect(expandCoverage('1-9999')).toEqual([]);       // a typo, not a collection
        expect(expandCoverage('abc, 1-x, , 4')).toEqual(['4']);
        expect(expandCoverage('')).toEqual([]);
        expect(expandCoverage(null)).toEqual([]);
    });

    it('normalizes to the canonical form, or null when nothing is valid', () => {
        expect(normalizeCoverage(' 1 - 6 ,8 ')).toBe('1-6, 8');
        expect(normalizeCoverage('#4; #5; 4-4')).toBe('4, 5');
        expect(normalizeCoverage('½')).toBe('0.5');
        expect(normalizeCoverage('abc')).toBeNull();
        expect(normalizeCoverage('')).toBeNull();
    });

    it('answers membership the way issue numbers compare', () => {
        const set = expandCoverage('1-6, ½');
        expect(isCovered('3', set)).toBe(true);
        expect(isCovered('003', set)).toBe(true);
        expect(isCovered('0.5', set)).toBe(true);
        expect(isCovered('7', set)).toBe(false);
        expect(isCovered('', set)).toBe(false);
        expect(isCovered('3', [])).toBe(false);
    });

    it("reads the provider's own 'Collects …' text, conservatively", () => {
        expect(coverageFromDescription('Collects Batman (2011) #1-7.')).toBe('1-7');
        expect(coverageFromDescription('<p>Collecting <a href="x">Amazing Spider-Man</a> #1-6, 8 and Annual #1.</p> Plus extras #99.')).toBe('1-6, 8');
        expect(coverageFromDescription('Reprints #4, #5 & #6')).toBe('4, 5, 6');
        expect(coverageFromDescription('This volume collects issues #12 - #18 of the 2008-2010 run.')).toBe('12-18');
        // No collect/reprint word, or numbers without a "#", or only a year: nothing.
        expect(coverageFromDescription('The story of 1963.')).toBeNull();
        expect(coverageFromDescription('Collects issues 1-6')).toBeNull();
        expect(coverageFromDescription('Collects the 2011 series.')).toBeNull();
        expect(coverageFromDescription(null)).toBeNull();
    });
});
