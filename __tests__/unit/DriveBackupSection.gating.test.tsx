/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

// Feature DISABLED — the gating case (no client ID / hosted build).
vi.mock('@/lib/data/drive/config', () => ({ DRIVE_ENABLED: false }));

// Still mock the drive modules so importing the component pulls no real GIS/PGlite.
vi.mock('@/lib/data/drive/auth', () => ({
  isDriveConnected: vi.fn(() => false),
  connectDrive: vi.fn(),
  disconnectDrive: vi.fn(),
}));
vi.mock('@/lib/data/drive/backup', () => ({
  backupToDrive: vi.fn(),
  listDriveBackups: vi.fn(),
  inspectDriveBackup: vi.fn(),
}));

import DriveBackupSection from '@/app/components/DriveBackupSection';

describe('DriveBackupSection — gating', () => {
  it('renders nothing when DRIVE_ENABLED is false', () => {
    const { container } = render(<DriveBackupSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
