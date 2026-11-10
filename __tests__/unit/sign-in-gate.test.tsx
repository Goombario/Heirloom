/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const h = vi.hoisted(() => ({
    replace: vi.fn(),
    status: 'unauthenticated' as 'unauthenticated' | 'authenticated' | 'loading',
    pathname: '/people',
    isDesktop: false,
    resolved: true,
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: h.status }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }), usePathname: () => h.pathname }));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => h.isDesktop, useDesktopModeResolved: () => h.resolved }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'remote' }));

import SignInGate from '@/app/components/SignInGate';

afterEach(() => {
    vi.clearAllMocks();
    Object.assign(h, { status: 'unauthenticated', pathname: '/people', isDesktop: false, resolved: true });
    window.history.replaceState(null, '', '/');
});

describe('SignInGate (#933)', () => {
    it('sends a signed-out visitor to sign in at any width, keeping the page to come back to', () => {
        window.history.replaceState(null, '', '/people?q=ada');
        render(<SignInGate />);
        expect(h.replace).toHaveBeenCalledWith(`/auth/signin?callbackUrl=${encodeURIComponent('/people?q=ada')}`);
    });

    it('sends Home without a callback', () => {
        h.pathname = '/';
        render(<SignInGate />);
        expect(h.replace).toHaveBeenCalledWith('/auth/signin');
    });

    it.each([
        ['signed in', { status: 'authenticated' }],
        ['session still loading', { status: 'loading' }],
        ['desktop mode', { isDesktop: true }],
        ['desktop detection pending', { resolved: false }],
        ['on the sign-in page', { pathname: '/auth/signin' }],
    ])('does nothing when %s', (_label, patch) => {
        Object.assign(h, patch);
        render(<SignInGate />);
        expect(h.replace).not.toHaveBeenCalled();
    });
});
