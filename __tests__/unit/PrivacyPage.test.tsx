/** @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import ru from '@/messages/ru.json';

const h = vi.hoisted(() => ({ mode: 'http' as 'http' | 'local', tauri: false }));

vi.mock('@/lib/data', () => ({ get DATA_MODE() { return h.mode; } }));
vi.mock('@/lib/desktop', () => ({ isDesktopApp: () => h.tauri, isWebUrl: () => true, openInSystemBrowser: vi.fn() }));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => false }));
vi.mock('@/app/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('@/app/components/ui/MobileListKit', () => ({ MobileListHeader: () => null }));
vi.mock('@/app/components/GuardedLink', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import PrivacyPage from '@/app/privacy/page';

function renderPage(locale = 'en', messages: Record<string, unknown> = en) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PrivacyPage />
    </NextIntlClientProvider>,
  );
}

describe('Privacy page (#170)', () => {
  beforeEach(() => { h.mode = 'http'; h.tauri = false; vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.0'); vi.stubEnv('NEXT_PUBLIC_HOSTED', ''); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('has the In short box, the seven sections and the version it applies to', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getAllByText('How Heirloom handles your data. Applies to version 1.2.0.').length).toBeGreaterThan(0);
    expect(screen.getByText('No analytics, tracking or ads.')).toBeInTheDocument();
    for (const title of ['Your family tree', 'Signing in with Google', 'Backing up to Google Drive', 'Maps and place search',
      "Google's own pages", 'What Heirloom never does', 'Removing your data']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /About Heirloom/ })).toHaveAttribute('href', '/about');
  });

  it('tags the build in use and says what server admins can see', () => {
    renderPage();
    expect(screen.getByText('You are using: Self-hosted server')).toBeInTheDocument();
    expect(screen.getByText(/how much media storage each member's trees use/)).toBeInTheDocument();
  });

  it('tags the in-browser build', () => {
    h.mode = 'local';
    renderPage();
    expect(screen.getByText('You are using: In this browser')).toBeInTheDocument();
  });

  it.each([['fr', fr], ['ru', ru]] as const)('renders in %s with no missing keys', (locale, messages) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage(locale, messages as Record<string, unknown>);
    expect(screen.queryByText(/privacy\./)).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
