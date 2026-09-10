// @vitest-environment jsdom
// Requesting from the library-wide Missing Issues view (field report by robotshavehearts2: "see
// them all and either have it search, or me manually"). The per-card Request files the SAME
// payload the series page does — through the shared composite — and the bulk action confirms the
// exact count before queueing anything.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ok, stubFetchRouter } from '../../helpers/fetch';

const toast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: auth.session }) }));

const nav = vi.hoisted(() => ({ params: new URLSearchParams('status=WANTED'), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
    usePathname: () => '/library/issues',
    useSearchParams: () => nav.params,
}));

import LibraryIssuesPage from '@/app/library/issues/page';

const wanted = (id: string, over: any = {}) => ({
    id, number: '12', name: null, cover: null, releaseDate: '2024-06-01', onDisk: false,
    seriesName: 'Batman', seriesPath: '/comics/Batman', publisher: 'DC Comics', year: 2016,
    isAnnual: false, isCollected: false, collectionName: null,
    seriesMetadataId: '42821', metadataSource: 'COMICVINE', requestable: true,
    ...over,
});

describe('/library/issues — requesting from the Missing Issues view', () => {
    let requests: any[];

    beforeEach(() => {
        vi.clearAllMocks();
        requests = [];
        auth.session = { user: { id: 'u1', role: 'USER', canRequest: true } };
        vi.stubGlobal('scrollTo', vi.fn());
        vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    const setup = (issues: any[]) => stubFetchRouter([
        ['/api/library/issues', () => ok({ issues, nextCursor: null, hasMore: false, publishers: [] })],
        ['/api/request', (_u: string, init?: any) => { requests.push(JSON.parse(init.body)); return ok({ success: true }); }],
    ]);

    it("files one issue with the series page's exact payload, then shows it as requested", async () => {
        setup([wanted('i1', { name: 'The Court of Owls', cover: '/api/library/cover?path=x' })]);
        render(<LibraryIssuesPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Request Batman #12' }));

        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0]).toEqual({
            type: 'issue', cvId: '42821', name: 'Batman #12: The Court of Owls', year: '2016',
            publisher: 'DC Comics', image: '/api/library/cover?path=x', issueNumber: '12', metadataSource: 'COMICVINE',
        });
        // The button turns into a receipt and can't fire twice.
        const done = await screen.findByRole('button', { name: 'Request Batman #12' });
        await waitFor(() => expect(done.textContent).toMatch(/Requested/));
        expect((done as HTMLButtonElement).disabled).toBe(true);
    });

    it('files an annual and a collected edition under their own composites', async () => {
        setup([
            wanted('ann', { number: '1', isAnnual: true }),
            wanted('tpb', { number: '1', name: 'Volume 01', isCollected: true, collectionName: 'From the Ashes', seriesName: 'X-Men' }),
        ]);
        render(<LibraryIssuesPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Request Batman #1' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Request X-Men #1' }));

        await waitFor(() => expect(requests).toHaveLength(2));
        expect(requests.map(r => r.name).sort()).toEqual(['Batman Annual #1', 'Volume 01']);
    });

    it('offers Request only where the API says a request can resolve, and only to users who may', async () => {
        setup([
            wanted('ok'),
            wanted('owned', { onDisk: true, requestable: false }),
            wanted('unmatched', { seriesMetadataId: 'unmatched_x', requestable: false }),
        ]);
        const { unmount } = render(<LibraryIssuesPage />);
        await screen.findByRole('button', { name: 'Request Batman #12' });
        expect(screen.getAllByRole('button', { name: /^Request Batman/ })).toHaveLength(1);
        unmount();

        auth.session = { user: { id: 'u2', role: 'USER', canRequest: false } };
        setup([wanted('ok')]);
        render(<LibraryIssuesPage />);
        await screen.findAllByText('Batman');
        expect(screen.queryByRole('button', { name: /^Request/ })).toBeNull();
    });

    it('"Request all shown" names the exact count, confirms first, then files each one', async () => {
        setup([wanted('a'), wanted('b', { number: '13' }), wanted('owned', { onDisk: true, requestable: false })]);
        render(<LibraryIssuesPage />);

        const bulk = await screen.findByRole('button', { name: 'Request every missing issue shown on this page' });
        expect(bulk.textContent).toContain('Request all shown (2)');
        fireEvent.click(bulk);

        // Nothing is filed until the confirmation is accepted.
        expect(await screen.findByText('Request 2 missing issues?')).toBeTruthy();
        expect(requests).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: 'Request them' }));
        // Two requests 300ms apart is ~700ms on an idle worker; the margin is for a loaded full-suite run.
        await waitFor(() => expect(requests).toHaveLength(2), { timeout: 8000 });
        expect(requests.map(r => r.name)).toEqual(['Batman #12', 'Batman #13']);
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Requests queued', description: '2 of 2 issues requested.' })));
        // Both are receipts now, so the bulk action has nothing left and withdraws itself.
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Request every missing issue shown on this page' })).toBeNull(), { timeout: 8000 });
    });
});
