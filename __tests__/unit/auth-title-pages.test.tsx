/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const h = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), signIn: vi.fn() }));

vi.mock('next-intl', () => {
    const all = en as unknown as Record<string, Record<string, string>>;
    return {
        useTranslations: (ns = 'auth') => {
            const auth = all[ns];
            const t = (key: string, values?: Record<string, string>) =>
                (auth[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => values?.[k] ?? '');
            // Enough of t.rich for the <b> tag the error lines use.
            t.rich = (key: string, tags: { b: (chunks: string) => unknown }) => {
                const m = /^<b>(.*)<\/b>(.*)$/.exec(auth[key] ?? key);
                return m ? [tags.b(m[1]), m[2]] : auth[key];
            };
            return t;
        },
    };
});
vi.mock('next/navigation', () => ({ useSearchParams: () => h.params, useRouter: () => ({ push: h.push }) }));
vi.mock('next-auth/react', () => ({ signIn: h.signIn }));
vi.mock('@/app/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));

import SignInPage from '@/app/auth/signin/page';
import AuthErrorPage from '@/app/auth/error/page';

describe('sign-in title page (#1129)', () => {
    beforeEach(() => { h.params = new URLSearchParams(); vi.clearAllMocks(); });

    it('reads like a title page and signs in with Google to the callback', () => {
        h.params = new URLSearchParams('callbackUrl=/people');
        render(<SignInPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Heirloom' })).toBeInTheDocument();
        expect(screen.getByText('A family history')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
        expect(h.signIn).toHaveBeenCalledWith('google', { callbackUrl: '/people' });
    });

    it('says an error in plain words under the sentence', () => {
        h.params = new URLSearchParams('error=OAuthAccountNotLinked');
        render(<SignInPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('That account is already set up another way. Sign in the way you did the first time.');
    });

    it('ends with the version and licence, and the source once SOURCE_URL is set (#1256)', () => {
        vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.22.1');
        vi.stubEnv('NEXT_PUBLIC_SOURCE_URL', '');
        const { unmount } = render(<SignInPage />);
        expect(screen.getByText('Heirloom v0.22.1')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'AGPL-3.0' })).toHaveAttribute('href', '/licenses/agpl-3.0.txt');
        expect(screen.queryByRole('link', { name: 'Source code' })).not.toBeInTheDocument();
        unmount();
        vi.stubEnv('NEXT_PUBLIC_SOURCE_URL', 'https://example.org/fork');
        render(<SignInPage />);
        expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://example.org/fork');
        vi.unstubAllEnvs();
    });

    it('falls back to a general line for an unknown code', () => {
        h.params = new URLSearchParams('error=Whatever');
        render(<SignInPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
    });

    it('the error page explains and offers Try again', () => {
        h.params = new URLSearchParams('error=Verification');
        render(<AuthErrorPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Couldn’t sign you in' })).toBeInTheDocument();
        expect(screen.getByText(/sign-in link has expired/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(h.push).toHaveBeenCalledWith('/auth/signin');
    });
});
