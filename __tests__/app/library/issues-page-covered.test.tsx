// @vitest-environment jsdom
// #203 COLLECTED coverage in the Missing Issues view (field report by robotshavehearts2: "this
// collection covers these issues"). An issue an OWNED trade reprints is not missing: it leaves the
// list by default, comes back behind a toggle wearing a Covered badge that names the book, and the
// bulk "Request all shown" never counts it — while its own Request button stays, for the
// deliberate ask. The toggle rides the URL like every other filter.
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
const coveredBy = { name: "Vol. 3: Devil's Workshop", number: '3', collectionName: 'Absolute Batman' };

describe('/library/issues — covered issues', () => {
    let issueFetches: string[];
    let requests: any[];

    beforeEach(() => {
        vi.clearAllMocks();
        issueFetches = [];
        requests = [];
        nav.params = new URLSearchParams('status=WANTED');
        auth.session = { user: { id: 'u1', role: 'USER', canRequest: true } };
        vi.stubGlobal('scrollTo', vi.fn());
        vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    const setup = (issues: any[]) => stubFetchRouter([
        ['/api/library/issues', (url: string) => { issueFetches.push(url); return ok({ issues, nextCursor: null, hasMore: false, publishers: [] }); }],
        ['/api/request', (_u: string, init?: any) => { requests.push(JSON.parse(init.body)); return ok({ success: true }); }],
    ]);

    it('hides a covered issue by default and reveals it behind a toggle that names the book, without a refetch', async () => {
        setup([wanted('a'), wanted('c', { number: '21', name: 'The Straw Man: Part 3', coveredBy })]);
        render(<LibraryIssuesPage />);

        // The page asks the API for covered rows too, so the toggle can be honest on first paint.
        await screen.findByLabelText('Batman #12');
        expect(issueFetches).toHaveLength(1);
        expect(issueFetches[0]).toContain('status=WANTED');
        expect(issueFetches[0]).toContain('includeCovered=1');
        expect(screen.queryByLabelText('Batman #21')).toBeNull();

        const toggle = screen.getByRole('button', { name: 'Show covered issues' });
        expect(toggle.textContent).toContain('Show covered (1)');
        fireEvent.click(toggle);

        expect(await screen.findByLabelText('Batman #21')).toBeTruthy();
        expect(screen.getByText('Covered')).toBeTruthy();
        expect(screen.getByText("Covered by Vol. 3: Devil's Workshop")).toBeTruthy();
        // A client-side reveal: the rows were already here.
        expect(issueFetches).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Hide covered issues' }).textContent).toContain('Hide covered (1)');
        await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/library/issues?status=WANTED&covered=1', { scroll: false }));
    });

    it('lands a ?covered=1 deep link with covered issues already shown', async () => {
        nav.params = new URLSearchParams('status=WANTED&covered=1');
        setup([wanted('a'), wanted('c', { number: '21', coveredBy })]);
        render(<LibraryIssuesPage />);

        expect(await screen.findByLabelText('Batman #21')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Hide covered issues' })).toBeTruthy();
        await waitFor(() => expect(issueFetches).toHaveLength(1));
        expect(nav.replace).not.toHaveBeenCalled();
    });

    it('offers no toggle when nothing loaded is covered', async () => {
        setup([wanted('a')]);
        render(<LibraryIssuesPage />);
        await screen.findByLabelText('Batman #12');
        expect(screen.queryByRole('button', { name: /covered issues/ })).toBeNull();
    });

    it('never counts a covered issue in "Request all shown", but still files it on its own Request', async () => {
        setup([wanted('a'), wanted('c', { number: '21', coveredBy })]);
        render(<LibraryIssuesPage />);

        const bulk = await screen.findByRole('button', { name: 'Request every missing issue shown on this page' });
        expect(bulk.textContent).toContain('Request all shown (1)');

        fireEvent.click(screen.getByRole('button', { name: 'Show covered issues' }));
        await screen.findByLabelText('Batman #21');
        // Shown is not the same as missing: the count holds.
        expect(screen.getByRole('button', { name: 'Request every missing issue shown on this page' }).textContent).toContain('Request all shown (1)');

        fireEvent.click(screen.getByRole('button', { name: 'Request Batman #21' }));
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].name).toBe('Batman #21');
    });
});
