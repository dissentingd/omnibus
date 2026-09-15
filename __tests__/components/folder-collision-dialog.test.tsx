// @vitest-environment jsdom
// The folder-collision dialog (field report by robotshavehearts2): when a match would land in a
// folder another series already owns, the admin chooses — put the volume under that series as a
// collected edition, or give it a folder name of its own — and nothing happens until they do.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { FolderCollisionDialog } from '@/components/folder-collision-dialog';

// Radix Dialog polyfills for jsdom (the same set the Discover grid tests install).
(global as any).ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));
(window as any).PointerEvent = class PointerEvent extends Event {} as any;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const collision = {
    seriesId: 's1', seriesName: 'Saga', year: 2012, publisher: 'Image', metadataSource: 'COMICVINE', metadataId: '49976',
    folderPath: '/comics/Image/Saga (2012)', suggestedFolderName: 'Saga (2012) (2)', volumeName: 'Saga', volumeYear: 2012,
};

describe('FolderCollisionDialog', () => {
    it('says who owns the folder and offers both ways out', () => {
        render(<FolderCollisionDialog open collision={collision} onCancel={vi.fn()} onResolve={vi.fn()} busy={false} />);
        expect(screen.getByText(/which already belongs to/)).toBeTruthy();
        expect(screen.getAllByText(/Saga \(2012\)/).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /Add it to Saga as a collected edition/ })).toBeTruthy();
        expect((screen.getByLabelText('Folder name') as HTMLInputElement).value).toBe('Saga (2012) (2)');
    });

    it('resolves as an attach, or as a rename with the typed name, and never with a blank one', () => {
        const onResolve = vi.fn();
        render(<FolderCollisionDialog open collision={collision} onCancel={vi.fn()} onResolve={onResolve} busy={false} />);

        fireEvent.click(screen.getByRole('button', { name: /Add it to Saga as a collected edition/ }));
        expect(onResolve).toHaveBeenLastCalledWith({ mode: 'attach' });

        const input = screen.getByLabelText('Folder name');
        fireEvent.change(input, { target: { value: '  Saga (2012) (TPB)  ' } });
        fireEvent.click(screen.getByRole('button', { name: /Use this folder name/ }));
        expect(onResolve).toHaveBeenLastCalledWith({ mode: 'rename', folderName: 'Saga (2012) (TPB)' });

        fireEvent.change(input, { target: { value: '   ' } });
        expect((screen.getByRole('button', { name: /Use this folder name/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('cancels without resolving, and locks both actions while one is in flight', () => {
        const onCancel = vi.fn();
        const onResolve = vi.fn();
        const { rerender } = render(<FolderCollisionDialog open collision={collision} onCancel={onCancel} onResolve={onResolve} busy={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalled();
        expect(onResolve).not.toHaveBeenCalled();

        rerender(<FolderCollisionDialog open collision={collision} onCancel={onCancel} onResolve={onResolve} busy />);
        expect((screen.getByRole('button', { name: /Add it to Saga as a collected edition/ }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: /Use this folder name/ }) as HTMLButtonElement).disabled).toBe(true);
    });
});
