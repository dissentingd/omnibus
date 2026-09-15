// @vitest-environment jsdom
// #203 COLLECTED coverage on the series page: the singles an owned collection reprints are not
// missing, and they are not downloaded either — they get their own shelf, each naming the book that
// covers it, with a deliberate Request still possible.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CoveredIssuesSection } from '@/components/covered-issues-section';

const covered = (id: string, num: number, over: any = {}) => ({
    id, number: String(num), parsedNum: num, name: `The Straw Man, Part ${num - 18}`, coverUrl: null, isAnnual: false,
    coveredBy: { id: 'book3', number: '3', name: "Vol. 3: Devil's Workshop", collectionName: 'Absolute Batman' },
    ...over,
});

const base = {
    seriesName: 'Absolute Batman',
    seriesCover: null,
    canRequest: true,
    requestingIds: new Set<string>(),
    requestedIds: new Set<string>(),
    onRequest: vi.fn(),
    onSelect: vi.fn(),
};

describe('CoveredIssuesSection', () => {
    it('renders nothing when nothing is covered', () => {
        const { container } = render(<CoveredIssuesSection {...base} issues={[]} />);
        expect(container.textContent).toBe('');
    });

    it('names the count and, on every card, the book that covers it', () => {
        render(<CoveredIssuesSection {...base} issues={[covered('i21', 21), covered('i22', 22)]} />);
        expect(screen.getByRole('heading', { name: /Covered by Collected Editions \(2\)/ })).toBeTruthy();
        expect(screen.getByText('The Straw Man, Part 3')).toBeTruthy();
        expect(screen.getByText('Issue #21')).toBeTruthy();
        expect(screen.getAllByText("Covered by Vol. 3: Devil's Workshop")).toHaveLength(2);
    });

    it('opens the issue on a card click, and files a request without opening it', () => {
        const onRequest = vi.fn();
        const onSelect = vi.fn();
        const issue = covered('i21', 21);
        render(<CoveredIssuesSection {...base} issues={[issue]} onRequest={onRequest} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: 'Request Absolute Batman #21' }));
        expect(onRequest).toHaveBeenCalledWith(issue);
        expect(onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('The Straw Man, Part 3'));
        expect(onSelect).toHaveBeenCalledWith(issue);
    });

    it('shows a receipt once requested, and no Request at all to someone who may not ask', () => {
        const { rerender } = render(<CoveredIssuesSection {...base} issues={[covered('i21', 21)]} requestedIds={new Set(['i21'])} />);
        const receipt = screen.getByRole('button', { name: 'Request Absolute Batman #21' }) as HTMLButtonElement;
        expect(receipt.textContent).toMatch(/Queued/);
        expect(receipt.disabled).toBe(true);

        rerender(<CoveredIssuesSection {...base} issues={[covered('i21', 21)]} canRequest={false} />);
        expect(screen.queryByRole('button', { name: /^Request/ })).toBeNull();
    });
});
