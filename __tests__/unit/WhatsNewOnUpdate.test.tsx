/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const h = vi.hoisted(() => ({
  userId: 1 as number | null,
  seen: null as string | null,
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ currentUserId: h.userId }) }));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({ account: { getLastSeenVersion: h.get, setLastSeenVersion: h.set } }),
}));
vi.mock('@/lib/whats-new/changelog.json', () => ({
  default: [
    { version: '1.2.0', items: [{ en: 'Twelve' }] },
    { version: '1.1.0', items: [{ en: 'Eleven' }] },
  ],
}));

import WhatsNewOnUpdate from '@/app/components/whats-new/WhatsNewOnUpdate';

function renderIt() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WhatsNewOnUpdate />
    </NextIntlClientProvider>,
  );
}

describe("What's new on first load after an update (#35)", () => {
  beforeEach(() => {
    h.userId = 1;
    h.get.mockImplementation(async () => h.seen);
    h.set.mockResolvedValue(undefined);
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.0');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('shows the releases since the one last seen, then records the running one', async () => {
    h.seen = '1.0.0';
    renderIt();
    expect(await screen.findByRole('dialog', { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Version 1.2.0' })).toBeInTheDocument();
    expect(screen.getByText('Eleven')).toBeInTheDocument();
    expect(h.set).toHaveBeenCalledWith('1.2.0');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('records silently on a first run', async () => {
    h.seen = null;
    renderIt();
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('1.2.0'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does nothing when the running version was already seen', async () => {
    h.seen = '1.2.0';
    renderIt();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(h.set).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits for a signed-in user', async () => {
    h.userId = null;
    renderIt();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.get).not.toHaveBeenCalled();
  });
});
