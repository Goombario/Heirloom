/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// next-intl → return the key verbatim (namespace ignored).
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

// Feature enabled for these behaviour tests.
vi.mock('@/lib/data/drive/config', () => ({ DRIVE_ENABLED: true }));

const INSPECTED = vi.hoisted(() => new Blob(['inspected datadir']));

// Mock the drive modules so no real GIS / PGlite is imported.
vi.mock('@/lib/data/drive/auth', () => ({
  isDriveConnected: vi.fn(() => false),
  connectDrive: vi.fn(() => Promise.resolve()),
  disconnectDrive: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/data/drive/backup', () => ({
  backupToDrive: vi.fn(() =>
    Promise.resolve({ id: 'new', name: 'heirloom-backup-new.tar', modifiedTime: '2026-07-01T00:00:00Z' }),
  ),
  listDriveBackups: vi.fn(() => Promise.resolve([])),
  inspectDriveBackup: vi.fn(() => Promise.resolve({ datadir: INSPECTED, totals: { trees: 2, people: 4824, families: 1500, media: 12 } })),
}));
vi.mock('@/lib/db/connection.pglite', () => ({
  getDatabaseTotals: vi.fn(() => Promise.resolve({ trees: 1, people: 37, families: 9, media: 3 })),
  loadDatabase: vi.fn(() => Promise.resolve()),
}));

import * as auth from '@/lib/data/drive/auth';
import * as backup from '@/lib/data/drive/backup';
import * as conn from '@/lib/db/connection.pglite';
import DriveBackupSection from '@/app/components/DriveBackupSection';

const reloadSpy = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('alert', vi.fn());
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
  // Default: not connected. Individual tests override.
  vi.mocked(auth.isDriveConnected).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DriveBackupSection — disconnected', () => {
  it('shows only the Connect button when not connected', () => {
    render(<DriveBackupSection />);
    expect(screen.getByRole('button', { name: 'drive_connect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'drive_backup_button' })).not.toBeInTheDocument();
  });

  it('connecting reveals backup / restore / disconnect actions', async () => {
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_connect' }));
    expect(auth.connectDrive).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'drive_backup_button' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'drive_restore_button' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'drive_disconnect' })).toBeInTheDocument();
  });

  it('surfaces an error if connect fails', async () => {
    vi.mocked(auth.connectDrive).mockRejectedValueOnce(new Error('nope'));
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('drive_error');
  });
});

describe('DriveBackupSection — connected', () => {
  beforeEach(() => {
    vi.mocked(auth.isDriveConnected).mockReturnValue(true);
  });

  it('renders the connected action set', () => {
    render(<DriveBackupSection />);
    expect(screen.getByRole('button', { name: 'drive_backup_button' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'drive_connect' })).not.toBeInTheDocument();
  });

  it('backup calls the orchestration and records a timestamp', async () => {
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_backup_button' }));
    await waitFor(() => expect(backup.backupToDrive).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('heirloom_last_drive_backup')).toBeTruthy();
  });

  it('restore lists backups, then confirming restores the inspected one without a second download', async () => {
    vi.mocked(backup.listDriveBackups).mockResolvedValueOnce([
      { id: 'b1', name: 'heirloom-backup-1.tar', modifiedTime: '2026-06-30T00:00:00Z' },
    ]);
    render(<DriveBackupSection />);

    fireEvent.click(screen.getByRole('button', { name: 'drive_restore_button' }));
    // Backup row appears
    const row = await screen.findByText('heirloom-backup-1.tar');
    fireEvent.click(row);

    // Destructive confirm dialog → confirm
    const confirm = await screen.findByRole('button', { name: 'restore_confirm' });
    expect(backup.inspectDriveBackup).toHaveBeenCalledWith('b1');
    expect(conn.loadDatabase).not.toHaveBeenCalled();
    fireEvent.click(confirm);

    await waitFor(() => expect(conn.loadDatabase).toHaveBeenCalledWith(INSPECTED));
    expect(backup.inspectDriveBackup).toHaveBeenCalledTimes(1);
    // A successful restore records a backup marker (the restored file's date) so a
    // fresh browser doesn't show "no backup yet" / fire the stale nudge (§7 fix).
    await waitFor(() =>
      expect(localStorage.getItem('heirloom_last_drive_backup')).toBe('2026-06-30T00:00:00Z'),
    );
  });

  it('does NOT write a backup marker when the restore fails', async () => {
    vi.mocked(backup.listDriveBackups).mockResolvedValueOnce([
      { id: 'b1', name: 'heirloom-backup-1.tar', modifiedTime: '2026-06-30T00:00:00Z' },
    ]);
    vi.mocked(conn.loadDatabase).mockRejectedValueOnce(new Error('load failed'));
    render(<DriveBackupSection />);

    fireEvent.click(screen.getByRole('button', { name: 'drive_restore_button' }));
    fireEvent.click(await screen.findByText('heirloom-backup-1.tar'));
    fireEvent.click(await screen.findByRole('button', { name: 'restore_confirm' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('restore_failed'));
    expect(localStorage.getItem('heirloom_last_drive_backup')).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('shows the backup\'s date and counts beside this browser\'s before confirming (BK-1)', async () => {
    vi.mocked(backup.listDriveBackups).mockResolvedValueOnce([
      { id: 'b1', name: 'heirloom-backup-1.tar', modifiedTime: '2026-06-30T00:00:00Z' },
    ]);
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_restore_button' }));
    fireEvent.click(await screen.findByText('heirloom-backup-1.tar'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('restore_column_current')).toBeInTheDocument();
    expect(within(dialog).getByText(/restore_column_backup/)).toBeInTheDocument();
    const people = within(dialog).getByRole('row', { name: /restore_count_people/ });
    expect(people).toHaveTextContent('37');
    expect(people).toHaveTextContent((4824).toLocaleString());
  });

  it('rejects an unreadable backup before the confirmation opens', async () => {
    vi.mocked(backup.listDriveBackups).mockResolvedValueOnce([
      { id: 'bad', name: 'broken.hlbak', modifiedTime: '2026-06-30T00:00:00Z' },
    ]);
    vi.mocked(backup.inspectDriveBackup).mockRejectedValueOnce(new Error('not a backup'));
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_restore_button' }));
    fireEvent.click(await screen.findByText('broken.hlbak'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('restore_failed'));
    expect(screen.queryByRole('button', { name: 'restore_confirm' })).not.toBeInTheDocument();
    expect(conn.loadDatabase).not.toHaveBeenCalled();
  });

  it('Cancel restores nothing', async () => {
    vi.mocked(backup.listDriveBackups).mockResolvedValueOnce([
      { id: 'b1', name: 'heirloom-backup-1.tar', modifiedTime: '2026-06-30T00:00:00Z' },
    ]);
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_restore_button' }));
    fireEvent.click(await screen.findByText('heirloom-backup-1.tar'));
    fireEvent.click(await screen.findByRole('button', { name: 'restore_cancel' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'restore_confirm' })).not.toBeInTheDocument());
    expect(conn.loadDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('heirloom_last_drive_backup')).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('shows an empty state when Drive has no backups', async () => {
    vi.mocked(backup.listDriveBackups).mockResolvedValueOnce([]);
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_restore_button' }));
    expect(await screen.findByText('drive_restore_empty')).toBeInTheDocument();
  });

  it('disconnect reverts to the Connect button', async () => {
    render(<DriveBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'drive_disconnect' }));
    expect(auth.disconnectDrive).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'drive_connect' })).toBeInTheDocument();
  });
});
