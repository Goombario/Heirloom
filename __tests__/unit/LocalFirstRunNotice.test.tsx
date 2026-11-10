/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));

import LocalFirstRunNotice from '@/app/components/LocalFirstRunNotice';

beforeEach(() => localStorage.clear());

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
});
