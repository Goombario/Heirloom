/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));
// The data check (#938) reads PGlite; each test says whether there's data.
const hasData = vi.hoisted(() => ({ value: true as boolean | null }));
vi.mock('@/app/components/backup/useLocalHasData', () => ({ useLocalHasData: () => hasData.value }));
vi.mock('@/app/components/backup/BackupModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="backup-modal" /> : null),
}));

import { FILE_BACKUP_KEY, DRIVE_BACKUP_KEY } from '@/lib/data/backup-status';
import BackupNudge from '@/app/components/backup/BackupNudge';

const NUDGE_SNOOZE = 'heirloom_backup_nudge_snoozed_until';
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => { localStorage.clear(); hasData.value = true; });
afterEach(() => vi.clearAllMocks());

describe('BackupNudge', () => {
  it('shows when a backup is overdue (stale)', () => {
    localStorage.setItem(FILE_BACKUP_KEY, daysAgoIso(30));
    render(<BackupNudge />);
    expect(screen.getByRole('alert')).toHaveTextContent('nudge_message');
  });

  it('shows when there has never been a backup', () => {
    render(<BackupNudge />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('stays hidden in an empty app that was never backed up (#938)', () => {
    hasData.value = false;
    render(<BackupNudge />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing until the data check has run (#938)', () => {
    hasData.value = null;
    render(<BackupNudge />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays hidden when the last backup is recent', () => {
    localStorage.setItem(DRIVE_BACKUP_KEY, daysAgoIso(1));
    render(<BackupNudge />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays hidden while snoozed', () => {
    localStorage.setItem(FILE_BACKUP_KEY, daysAgoIso(30));
    localStorage.setItem(NUDGE_SNOOZE, String(Date.now() + 60_000));
    render(<BackupNudge />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismiss hides the banner and writes a future snooze timestamp', () => {
    render(<BackupNudge />);
    fireEvent.click(screen.getByRole('button', { name: 'nudge_dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(NUDGE_SNOOZE))).toBeGreaterThan(Date.now());
  });

  it('"Back up now" opens the modal', () => {
    render(<BackupNudge />);
    fireEvent.click(screen.getByRole('button', { name: 'chip_backup_now' }));
    expect(screen.getByTestId('backup-modal')).toBeInTheDocument();
  });
});
