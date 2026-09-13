// @vitest-environment jsdom
// #204 (de6oliveira-droid): a dead page after a day away — the cookie had lapsed, the refetch came
// back EMPTY with no flag, nothing redirected, and the next click surfaced the middleware's 401 as
// "Unauthorized Access" in a dialog. The guard treats an empty-after-signed-in session like the
// inactivity flag, catches a 401 from our own /api while a user was present, and bounces to
// /login with a return path — once, never on a public page.
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    useSession: vi.fn(),
    signOut: vi.fn(),
    pathname: '/admin/smart-match',
    toast: vi.fn(),
}));
vi.mock('next-auth/react', () => ({
    useSession: mocks.useSession,
    signOut: mocks.signOut,
    SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { SessionExpiryGuard } from '@/components/AuthProvider';
import { nav, __resetExpiryForTests, SESSION_EXPIRED_TOAST } from '@/lib/session-expiry-client';

const signedIn = () => ({ data: { user: { id: 'u1', role: 'ADMIN' } }, status: 'authenticated', update: vi.fn() });
const signedOut = () => ({ data: null, status: 'unauthenticated', update: vi.fn() });
const flagged = () => ({ data: { error: 'SessionExpired' }, status: 'authenticated', update: vi.fn() });

describe('SessionExpiryGuard', () => {
    let go: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.clearAllMocks();
        __resetExpiryForTests();
        mocks.pathname = '/admin/smart-match';
        mocks.signOut.mockResolvedValue(undefined);
        go = vi.spyOn(nav, 'go').mockImplementation(() => {});
        window.history.replaceState({}, '', '/admin/smart-match?tab=unmatched');
    });
    afterEach(() => { go.mockRestore(); vi.unstubAllGlobals(); });

    it('a session that turns EMPTY after the user was signed in bounces to /login with the return path', async () => {
        mocks.useSession.mockReturnValue(signedIn());
        const { rerender } = render(<SessionExpiryGuard />);
        expect(go).not.toHaveBeenCalled();

        mocks.useSession.mockReturnValue(signedOut());
        rerender(<SessionExpiryGuard />);

        await waitFor(() => expect(go).toHaveBeenCalledWith('/login?callbackUrl=' + encodeURIComponent('/admin/smart-match?tab=unmatched')));
        expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: SESSION_EXPIRED_TOAST.title, variant: 'destructive' }));
    });

    it('the inactivity flag still bounces, exactly as the header used to', async () => {
        mocks.useSession.mockReturnValue(flagged());
        render(<SessionExpiryGuard />);
        await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
        expect(go.mock.calls[0][0]).toMatch(/^\/login\?callbackUrl=/);
    });

    it('an anonymous visitor is not an expiry, and a public page never bounces', async () => {
        mocks.useSession.mockReturnValue(signedOut());
        render(<SessionExpiryGuard />);
        await new Promise(r => setTimeout(r, 20));
        expect(go).not.toHaveBeenCalled();

        mocks.pathname = '/login';
        window.history.replaceState({}, '', '/login');
        mocks.useSession.mockReturnValue(signedIn());
        const { rerender } = render(<SessionExpiryGuard />);
        mocks.useSession.mockReturnValue(signedOut());
        rerender(<SessionExpiryGuard />);
        await new Promise(r => setTimeout(r, 20));
        expect(go).not.toHaveBeenCalled();
    });

    it("a 401 from our own /api while signed in bounces; NextAuth's 401s and pre-sign-in 401s do not", async () => {
        const responses: Record<string, number> = { '/api/library/series': 401, '/api/auth/callback/credentials': 401, '/api/setup/check': 401 };
        const original = vi.fn(async (input: any) => ({ status: responses[typeof input === 'string' ? input : input.url] ?? 200 } as Response));
        vi.stubGlobal('fetch', original);

        // Before any user: a 401 is not an expiry.
        mocks.useSession.mockReturnValue(signedOut());
        const first = render(<SessionExpiryGuard />);
        await act(async () => { await window.fetch('/api/setup/check'); });
        expect(go).not.toHaveBeenCalled();
        first.unmount();

        mocks.useSession.mockReturnValue(signedIn());
        render(<SessionExpiryGuard />);
        await act(async () => { await window.fetch('/api/auth/callback/credentials'); });
        expect(go).not.toHaveBeenCalled();                       // NextAuth's own 401 (a wrong password)

        let res: Response | undefined;
        await act(async () => { res = await window.fetch('/api/library/series'); });
        expect(res?.status).toBe(401);                            // the caller still gets its response
        await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
        expect(go.mock.calls[0][0]).toBe('/login?callbackUrl=' + encodeURIComponent('/admin/smart-match?tab=unmatched'));

        // Once per page life: a second 401 does not fire again.
        await act(async () => { await window.fetch('/api/library/series'); });
        expect(go).toHaveBeenCalledTimes(1);
    });
});
