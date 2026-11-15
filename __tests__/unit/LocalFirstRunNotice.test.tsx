/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));
// The database open, controlled per test: by default an existing database.
const setup = vi.hoisted(() => ({ firstSetup: false, ready: Promise.resolve() as Promise<void> }));
vi.mock('@/lib/db/connection.pglite', () => ({ databaseSetup: async () => ({ ...setup }) }));

import LocalFirstRunNotice from '@/app/components/LocalFirstRunNotice';

beforeEach(() => {
  localStorage.clear();
  setup.firstSetup = false;
  setup.ready = Promise.resolve();
});

describe('LocalFirstRunNotice (#731)', () => {
  it('is a labelled modal dialog with focus inside it', async () => {
    render(<LocalFirstRunNotice />);
    const dialog = await screen.findByRole('dialog', { name: 'first_run_title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'first_run_ok' })).toHaveFocus();
  });

  it('Esc dismisses it and records it as seen', async () => {
    render(<LocalFirstRunNotice />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('heirloom_local_first_run_seen')).toBe('1');
  });

  it('stays hidden once seen', () => {
    localStorage.setItem('heirloom_local_first_run_seen', '1');
    render(<LocalFirstRunNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never shows in the desktop app (#61)', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      render(<LocalFirstRunNotice />);
      await Promise.resolve();
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('says it is setting up on a first visit, then that it is ready', async () => {
    let finish!: () => void;
    setup.firstSetup = true;
    setup.ready = new Promise<void>((resolve) => { finish = resolve; });
    render(<LocalFirstRunNotice />);
    expect(await screen.findByRole('status')).toHaveTextContent('first_run_setting_up');
    finish();
    expect(await screen.findByText('first_run_set_up')).toBeInTheDocument();
  });

  it('says nothing about setup when the database already exists', async () => {
    render(<LocalFirstRunNotice />);
    await screen.findByRole('dialog');
    await Promise.resolve();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
