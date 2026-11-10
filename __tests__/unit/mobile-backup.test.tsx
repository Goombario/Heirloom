/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  useLocale: () => 'en',
}));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: (d: Date) => d.toISOString() }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/components/backup/useLocalHasData', () => ({ useLocalHasData: () => true }));
vi.mock('@/lib/data/drive/config', () => ({ DRIVE_ENABLED: false }));
const h = vi.hoisted(() => ({ toast: vi.fn(), dump: vi.fn() }));
vi.mock('@/lib/db/connection.pglite', () => ({
  dumpDatabaseLogical: h.dump, getDatabaseTotals: vi.fn(), inspectBackupLogical: vi.fn(), loadDatabase: vi.fn(),
}));
vi.mock('@/app/components/ui', async (orig) => ({ ...(await orig<object>()), showChangeToast: h.toast }));

import { FILE_BACKUP_KEY } from '@/lib/data/backup-status';
import BackupNudge from '@/app/components/backup/BackupNudge';
import { MobileBackupSheet } from '@/app/components/backup/MobileBackupSheet';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

beforeEach(() => { localStorage.clear(); });
afterEach(() => vi.clearAllMocks());

describe('phone backup reminder (#1130)', () => {
  it('counts the weeks, and Back up now opens the Backup sheet', () => {
    localStorage.setItem(FILE_BACKUP_KEY, daysAgo(43));
    render(<BackupNudge placement="page" />);
    expect(screen.getByRole('alert')).toHaveTextContent('nudge_weeks:{"count":6}');
    fireEvent.click(screen.getByRole('button', { name: 'chip_backup_now' }));
    expect(screen.getByRole('button', { name: 'download' })).toBeInTheDocument();
  });

  it('Not now hides it for a week', () => {
    render(<BackupNudge placement="page" />);
    expect(screen.getByRole('alert')).toHaveTextContent('nudge_never');
    fireEvent.click(screen.getByRole('button', { name: 'not_now' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(Number(localStorage.getItem('heirloom_backup_nudge_snoozed_until'))).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });
});

describe('MobileBackupSheet (#1130)', () => {
  it('shows the overdue status and offers restore and keeping the data', () => {
    localStorage.setItem(FILE_BACKUP_KEY, daysAgo(40));
    render(<MobileBackupSheet open onClose={vi.fn()} />);
    expect(screen.getByText('backup_overdue')).toBeInTheDocument();
    expect(screen.getByText('body_overdue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/ })).toBeInTheDocument();
    expect(screen.getByText('persist')).toBeInTheDocument();
  });

  it('downloads the snapshot, records it and toasts the file name', async () => {
    h.dump.mockResolvedValue(new Blob(['x']));
    URL.createObjectURL = vi.fn(() => 'blob:x');
    render(<MobileBackupSheet open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'download' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ message: 'saved_toast', detail: expect.stringMatching(/^heirloom-backup-.*\.hlbak$/) }));
    expect(localStorage.getItem(FILE_BACKUP_KEY)).not.toBeNull();
    expect(await screen.findByText('backed_up_today')).toBeInTheDocument();
  });
});
