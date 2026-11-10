/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const h = vi.hoisted(() => ({ mode: 'http' as 'http' | 'local', tauri: false }));

vi.mock('@/lib/data', () => ({ get DATA_MODE() { return h.mode; } }));
vi.mock('@/lib/desktop', () => ({ isDesktopApp: () => h.tauri, isWebUrl: () => true, openInSystemBrowser: vi.fn() }));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => false }));
vi.mock('@/app/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('@/app/components/ui/MobileListKit', () => ({ MobileListHeader: () => null }));

import AboutPage from '@/app/about/page';

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AboutPage />
    </NextIntlClientProvider>,
  );
}

/** The value next to a row's label. */
function row(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

describe('About page (#1256)', () => {
  beforeEach(() => {
    h.mode = 'http';
    h.tauri = false;
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.22.1');
    vi.stubEnv('NEXT_PUBLIC_BUILD_COMMIT', '3f9a2c1');
    vi.stubEnv('NEXT_PUBLIC_BUILD_DATE', '2026-11-07');
    vi.stubEnv('NEXT_PUBLIC_SOURCE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HOSTED', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('shows version, build, licence, privacy note and credits', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'About Heirloom' })).toBeInTheDocument();
    expect(row('Version')).toHaveTextContent('0.22.1');
    expect(row('Build')).toHaveTextContent('3f9a2c1 · Nov 7, 2026');
    expect(within(row('Licence')).getByRole('button', { name: 'GNU AGPL-3.0-or-later' })).toBeInTheDocument();
    expect(row('Your data')).toHaveTextContent(en.about.data_server);
    expect(screen.getByRole('button', { name: en.about.credits_link })).toBeInTheDocument();
  });

  it('hides the source row while SOURCE_URL is unset', () => {
    renderPage();
    expect(screen.queryByText('Source code', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('links the source from SOURCE_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_SOURCE_URL', 'https://example.org/fork');
    renderPage();
    expect(within(row('Source code')).getByRole('link', { name: 'Get the source' })).toHaveAttribute('href', 'https://example.org/fork');
  });

  it.each([
    ['hosted server', 'http', false, 'true', 'Hosted server', en.about.data_server],
    ['self-hosted server', 'http', false, '', 'Self-hosted server', en.about.data_server],
    ['static build', 'local', false, '', 'In this browser', en.about.data_browser],
    ['desktop app', 'local', true, '', 'Desktop app', en.about.data_desktop],
  ] as const)('says what it is running as: %s', (_name, mode, tauri, hosted, label, data) => {
    h.mode = mode;
    h.tauri = tauri;
    vi.stubEnv('NEXT_PUBLIC_HOSTED', hosted);
    renderPage();
    expect(row('Running as')).toHaveTextContent(label);
    expect(row('Your data')).toHaveTextContent(data);
  });

  it('leaves the build row out when the build recorded neither commit nor date', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_COMMIT', '');
    vi.stubEnv('NEXT_PUBLIC_BUILD_DATE', '');
    renderPage();
    expect(screen.queryByText('Build', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('opens the bundled licence text in a dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('GNU AFFERO GENERAL PUBLIC LICENSE') });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'GNU AGPL-3.0-or-later' }));
    expect(await screen.findByText('GNU AFFERO GENERAL PUBLIC LICENSE')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/licenses/agpl-3.0.txt');
  });

  it('says so when a file cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: en.about.credits_link }));
    expect(await screen.findByText(en.about.file_error)).toBeInTheDocument();
  });
});
