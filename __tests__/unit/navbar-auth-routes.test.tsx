/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('@/app/components/nav/TopRail', () => ({ default: () => <nav aria-label="app nav" /> }));
vi.mock('@/app/components/nav/MobileDrawer', () => ({ default: () => null }));
vi.mock('@/app/components/ShareTreeButton', () => ({ default: () => null }));
vi.mock('@/app/components/backup/BackupModal', () => ({ default: () => null }));

import Navbar from '@/app/components/Navbar';

// FL-3: the sign-in and auth-error pages stand alone, without the signed-in nav.
describe('Navbar on auth routes', () => {
    it.each(['/auth/signin', '/auth/error', '/auth/signin/'])('renders nothing on %s', (path) => {
        pathname.current = path;
        render(<Navbar />);
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('renders the nav everywhere else', () => {
        pathname.current = '/people';
        render(<Navbar />);
        expect(screen.getByRole('navigation', { name: 'app nav' })).toBeInTheDocument();
    });
});
