/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(' ')}` : key,
}));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));
vi.mock('@/app/components/backup/useBackupStatus', () => ({ useBackupOverdue: vi.fn() }));
vi.mock('@/app/components/backup/BackupModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="backup-modal" /> : null),
}));

import en from '@/messages/en.json';
import { useBackupOverdue } from '@/app/components/backup/useBackupStatus';
import BackupStatusChip from '@/app/components/backup/BackupStatusChip';

const mockStatus = vi.mocked(useBackupOverdue);
beforeEach(() => vi.clearAllMocks());

describe('BackupStatusChip', () => {
  it('shows the calm label when backups are fresh', () => {
    mockStatus.mockReturnValue({ lastBackup: new Date(), ageDays: 1, level: 'fresh', driveConnected: true , overdue: false });
    render(<BackupStatusChip />);
    expect(screen.getByRole('button')).toHaveTextContent('chip_backed_up');
  });

  it('stays neutral with no data to lose, even if never backed up (#938)', () => {
    mockStatus.mockReturnValue({ lastBackup: null, ageDays: null, level: 'never', driveConnected: false, overdue: false });
    render(<BackupStatusChip />);
    expect(screen.getByRole('button')).toHaveTextContent('chip_backed_up');
  });

  it('shows the warning label when stale or never', () => {
    mockStatus.mockReturnValue({ lastBackup: null, ageDays: null, level: 'never', driveConnected: false , overdue: true });
    render(<BackupStatusChip />);
    expect(screen.getByRole('button')).toHaveTextContent('chip_backup_now');
  });

  it('starts its accessible name with the visible label (WCAG 2.5.3, BK-1)', () => {
    mockStatus.mockReturnValue({ lastBackup: null, ageDays: null, level: 'never', driveConnected: false , overdue: true });
    render(<BackupStatusChip />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toMatch(/^chip_aria/);
    expect(button.getAttribute('aria-label')).toContain('chip_backup_now');
    // And the shipped copy puts the status first.
    expect(en.options.chip_aria.startsWith('{status}')).toBe(true);
  });

  it('opens the backup modal on click', () => {
    mockStatus.mockReturnValue({ lastBackup: new Date(), ageDays: 1, level: 'fresh', driveConnected: false , overdue: false });
    render(<BackupStatusChip />);
    expect(screen.queryByTestId('backup-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('backup-modal')).toBeInTheDocument();
  });
});
