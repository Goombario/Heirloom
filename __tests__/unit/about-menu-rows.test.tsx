/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const h = vi.hoisted(() => ({
  mode: 'http' as 'http' | 'local',
  session: { data: { user: { name: 'Ada Example', email: 'ada@example.org' } }, status: 'authenticated' } as {
    data: { user: { name: string; email: string } } | null; status: string;
  },
}));

vi.mock('@/lib/data', () => ({ get DATA_MODE() { return h.mode; } }));
vi.mock('next-auth/react', () => ({ useSession: () => h.session, signOut: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/people' }));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => false, useDesktopModeResolved: () => true }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/hooks/useMembersAdmin', () => ({ useMembersAdmin: () => false }));
vi.mock('@/app/components/ShareTreeButton', () => ({ default: () => null }));
vi.mock('@/app/components/nav/TreeSwitcher', () => ({ default: () => null }));
vi.mock('@/app/components/backup/useBackupStatus', () => ({ useBackupOverdue: () => ({ overdue: false, lastBackup: null }) }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, onNavigate: _n, children, ...rest }: { href: string; onNavigate?: () => void; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Drawer: {
      Root: Pass,
      Portal: Pass,
      Overlay: () => null,
      Title: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
      Content: ({ children }: { children?: ReactNode }) => <div data-testid="drawer">{children}</div>,
    },
  };
});

import UserMenu from '@/app/components/UserMenu';
import MobileDrawer from '@/app/components/nav/MobileDrawer';

function withIntl(node: ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>);
}

describe('About Heirloom menu rows (#1256)', () => {
  beforeEach(() => {
    h.mode = 'http';
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.22.1');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('ends the desktop account menu, after Sign out', () => {
    withIntl(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: en.userMenu.menu_label }));
    const items = screen.getAllByRole('menuitem');
    const last = items[items.length - 1];
    expect(last).toHaveTextContent('About Heirloomv0.22.1');
    expect(last).toHaveAttribute('href', '/about');
    expect(items[items.length - 2]).toHaveTextContent(en.userMenu.sign_out);
  });

  it('is the last line of the phone drawer, under the account row', () => {
    withIntl(<MobileDrawer open onClose={() => {}} onManageSharing={() => {}} onOpenBackup={() => {}} />);
    const links = screen.getByTestId('drawer').querySelectorAll('a, button');
    const last = links[links.length - 1];
    expect(last).toHaveAttribute('href', '/about');
    expect(last).toHaveTextContent('About Heirloomv0.22.1');
    expect(links[links.length - 2]).toHaveTextContent(en.userMenu.sign_out);
  });

  it('follows Options in the phone drawer when there are no accounts', () => {
    h.mode = 'local';
    withIntl(<MobileDrawer open onClose={() => {}} onManageSharing={() => {}} onOpenBackup={() => {}} />);
    const links = screen.getByTestId('drawer').querySelectorAll('a, button');
    expect(links[links.length - 1]).toHaveAttribute('href', '/about');
    expect(links[links.length - 2]).toHaveAttribute('href', '/options');
  });
});
