/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
// Drive unavailable (hosted build / fork with no client ID).
vi.mock('@/lib/data/drive/config', () => ({ DRIVE_ENABLED: false }));
vi.mock('@/app/components/DriveBackupSection', () => ({ default: () => <div data-testid="drive-section" /> }));
vi.mock('@/app/components/backup/FileBackupSection', () => ({ default: () => <div data-testid="file-section" /> }));
vi.mock('@/app/components/backup/useBackupStatus', () => ({
  useBackupStatus: () => ({ lastBackup: null, ageDays: null, level: 'never', driveConnected: false }),
}));

import BackupPanel from '@/app/components/backup/BackupPanel';

describe('BackupPanel — Drive disabled', () => {
  it('omits the Drive section entirely, keeps the file section', () => {
    render(<BackupPanel />);
    expect(screen.queryByTestId('drive-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-section')).toBeInTheDocument();
  });
});
