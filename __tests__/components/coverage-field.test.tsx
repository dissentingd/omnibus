// @vitest-environment jsdom
// #203 COLLECTED coverage: the collected panel's Covers field. What a book covers is curation, so
// the field saves through the issue PATCH (which validates and canonicalises), shows the server's
// answer rather than what was typed, refuses nothing silently, and never lets a click leak to the
// card behind it (the card opens the book's panel).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, err, stubFetchRouter } from '../helpers/fetch';

const toast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

import { CoverageField } from '@/components/coverage-field';

describe('CoverageField', () => {
    let patches: any[];
    let fetchMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        patches = [];
        fetchMock = stubFetchRouter([
            ['/api/library/issue', (_u: string, init?: any) => {
                const body = JSON.parse(init.body);
                patches.push({ method: init.method, body });
                if (body.coversIssues.trim() === 'abc') return err(400, { error: 'Coverage must be issue numbers or ranges, like "1-6, 8".' });
                const canon = body.coversIssues.trim() === '' ? null : body.coversIssues.replace(/\s+/g, '').replace(/,/g, ', ');
                return ok({ success: true, changed: true, wroteToFile: false, coversIssues: canon });
            }],
        ]);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('reads as plain text for everyone, and as nothing at all when blank and not editable', () => {
        const { container, rerender } = render(<CoverageField issueId="b1" bookLabel="Vol. 1: The Zoo" value="1-6" canEdit={false} onSaved={vi.fn()} />);
        expect(screen.getByText('Covers #1-6')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();

        rerender(<CoverageField issueId="b1" bookLabel="Vol. 1: The Zoo" value={null} canEdit={false} onSaved={vi.fn()} />);
        expect(container.textContent).toBe('');
    });

    it('saves what was typed through the PATCH and shows the canonical answer', async () => {
        const onSaved = vi.fn();
        render(<CoverageField issueId="b1" bookLabel="Vol. 1: The Zoo" value="1-6" canEdit onSaved={onSaved} />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit the issues Vol. 1: The Zoo covers' }));
        const input = screen.getByLabelText('Issues Vol. 1: The Zoo covers') as HTMLInputElement;
        expect(input.value).toBe('1-6');
        fireEvent.change(input, { target: { value: ' 1-7 , 9 ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toEqual({ method: 'PATCH', body: { issueId: 'b1', coversIssues: ' 1-7 , 9 ' } });
        expect(await screen.findByText('Covers #1-7, 9')).toBeTruthy();
        expect(onSaved).toHaveBeenCalledWith('1-7, 9');
        expect(screen.queryByLabelText('Issues Vol. 1: The Zoo covers')).toBeNull();
    });

    it('keeps the field open and says why when the server refuses', async () => {
        const onSaved = vi.fn();
        render(<CoverageField issueId="b1" bookLabel="Vol. 1: The Zoo" value="1-6" canEdit onSaved={onSaved} />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit the issues Vol. 1: The Zoo covers' }));
        const input = screen.getByLabelText('Issues Vol. 1: The Zoo covers');
        fireEvent.change(input, { target: { value: 'abc' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
            variant: 'destructive', description: 'Coverage must be issue numbers or ranges, like "1-6, 8".',
        })));
        expect(screen.getByLabelText('Issues Vol. 1: The Zoo covers')).toBeTruthy();
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('cancels on Escape without a save, and clears to nothing on an empty save', async () => {
        const onSaved = vi.fn();
        render(<CoverageField issueId="b1" bookLabel="Vol. 1: The Zoo" value="1-6" canEdit onSaved={onSaved} />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit the issues Vol. 1: The Zoo covers' }));
        fireEvent.change(screen.getByLabelText('Issues Vol. 1: The Zoo covers'), { target: { value: '99' } });
        fireEvent.keyDown(screen.getByLabelText('Issues Vol. 1: The Zoo covers'), { key: 'Escape' });
        expect(patches).toHaveLength(0);
        expect(screen.getByText('Covers #1-6')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Edit the issues Vol. 1: The Zoo covers' }));
        fireEvent.change(screen.getByLabelText('Issues Vol. 1: The Zoo covers'), { target: { value: '' } });
        fireEvent.keyDown(screen.getByLabelText('Issues Vol. 1: The Zoo covers'), { key: 'Enter' });
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null));
        expect(patches[0].body.coversIssues).toBe('');
        // Blank and editable: an invitation, not silence.
        expect(screen.getByRole('button', { name: 'Edit the issues Vol. 1: The Zoo covers' }).textContent).toContain('Set coverage');
    });

    it('saves on blur too, and never lets a click reach the card behind it', async () => {
        const cardClick = vi.fn();
        render(<div onClick={cardClick}><CoverageField issueId="b1" bookLabel="Vol. 1: The Zoo" value={null} canEdit onSaved={vi.fn()} /></div>);

        fireEvent.click(screen.getByRole('button', { name: 'Edit the issues Vol. 1: The Zoo covers' }));
        const input = screen.getByLabelText('Issues Vol. 1: The Zoo covers');
        fireEvent.click(input);
        fireEvent.change(input, { target: { value: '1-6' } });
        fireEvent.blur(input);

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(await screen.findByText('Covers #1-6')).toBeTruthy();
        expect(cardClick).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
