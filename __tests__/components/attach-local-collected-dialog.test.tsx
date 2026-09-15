// @vitest-environment jsdom
// The Smart Matcher's door for a trade ComicVine has no volume for (field report by
// robotshavehearts2): pick the series it collects, name it, and it goes under that series as a
// LOCAL collected edition — its files move in under their own names, no provider lane.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, stubFetchRouter } from '../helpers/fetch';

const toast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

import { AttachLocalCollectedDialog, localNameFromItem } from '@/components/attach-local-collected-dialog';

(global as any).ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));
(window as any).PointerEvent = class PointerEvent extends Event {} as any;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const item = { id: 'u1', name: 'Saga Compendium One (2019)', folderPath: '/unmatched/Saga Compendium One (2019)', isRawFile: false };

describe('localNameFromItem', () => {
    it('offers the folder or file name without its extension or trailing year', () => {
        expect(localNameFromItem({ name: 'Saga Compendium One (2019)' })).toBe('Saga Compendium One');
        expect(localNameFromItem({ name: 'Saga Compendium One.cbz', isRawFile: true })).toBe('Saga Compendium One');
        expect(localNameFromItem({ name: '  ' })).toBe('');
    });
});

describe('AttachLocalCollectedDialog', () => {
    let posts: any[];
    beforeEach(() => {
        vi.clearAllMocks();
        posts = [];
        stubFetchRouter([
            ['/api/library?', () => ok({ series: [{ id: 's1', name: 'Saga', year: 2012 }, { id: 's2', name: 'Saga: Compendium', year: 2019 }] })],
            ['/api/library/series/attachments', (_u: string, init?: any) => { posts.push(JSON.parse(init.body)); return ok({ success: true, local: true, attachmentId: 'attL', name: 'Saga Compendium One', moved: 1, absorbed: 1, claimed: 0, conflicts: 0 }); }],
        ]);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('names the edition from the item, finds the series, and files the local attachment with the source path', async () => {
        const onDone = vi.fn();
        render(<AttachLocalCollectedDialog open item={item} onClose={vi.fn()} onDone={onDone} />);

        expect((screen.getByLabelText('Name of the collected edition') as HTMLInputElement).value).toBe('Saga Compendium One');
        // Nothing can be sent until a series is picked.
        expect((screen.getByRole('button', { name: 'Attach as a collected edition' }) as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(screen.getByLabelText('Search your library for the series it collects'), { target: { value: 'Saga' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Saga (2012)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Attach as a collected edition' }));

        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toEqual({
            seriesId: 's1', metadataSource: 'LOCAL', kind: 'COLLECTED', name: 'Saga Compendium One',
            sourcePath: '/unmatched/Saga Compendium One (2019)',
        });
        await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: 'attL', moved: 1 })));
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Attached Saga Compendium One' }));
    });

    it('refuses a blank name', async () => {
        render(<AttachLocalCollectedDialog open item={item} onClose={vi.fn()} onDone={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Search your library for the series it collects'), { target: { value: 'Saga' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Saga (2012)' }));
        fireEvent.change(screen.getByLabelText('Name of the collected edition'), { target: { value: '   ' } });
        expect((screen.getByRole('button', { name: 'Attach as a collected edition' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
