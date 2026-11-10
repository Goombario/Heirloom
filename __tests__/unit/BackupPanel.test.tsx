/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/data/drive/config', () => ({ DRIVE_ENABLED: true }));
vi.mock('@/app/components/DriveBackupSection', () => ({ default: () => <div data-testid="drive-section" /> }));
vi.mock('@/app/components/backup/FileBackupSection', () => ({ default: () => <div data-testid="file-section" /> }));
vi.mock('@/app/components/backup/useBackupStatus', () => ({ useBackupStatus: vi.fn() }));

import { useBackupStatus } from '@/app/components/backup/useBackupStatus';
import BackupPanel from '@/app/components/backup/BackupPanel';

const mockStatus = vi.mocked(useBackupStatus);

beforeEach(() => vi.clearAllMocks());

describe('BackupPanel', () => {
  it('always renders the file section, and the Drive section when enabled', () => {
    mockStatus.mockReturnValue({ lastBackup: new Date(), ageDays: 0, level: 'fresh', driveConnected: true });
    render(<BackupPanel />);
    expect(screen.getByTestId('file-section')).toBeInTheDocument();
    expect(screen.getByTestId('drive-section')).toBeInTheDocument();
  });

  it('shows the "never backed up" banner as an alert', () => {
    mockStatus.mockReturnValue({ lastBackup: null, ageDays: null, level: 'never', driveConnected: false });
    render(<BackupPanel />);
    expect(screen.getByText('backup_status_none')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('backup_status_warn');
  });

  it('shows a calm last-backup banner (no alert) when fresh', () => {
    mockStatus.mockReturnValue({ lastBackup: new Date(), ageDays: 1, level: 'fresh', driveConnected: false });
    render(<BackupPanel />);
    expect(screen.getByText('backup_last')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a stale backup as an alert-level warning', () => {
    mockStatus.mockReturnValue({ lastBackup: new Date(), ageDays: 30, level: 'stale', driveConnected: false });
    render(<BackupPanel />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
