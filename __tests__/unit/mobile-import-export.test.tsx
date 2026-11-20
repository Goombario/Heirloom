/** @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v?.when ? `${key}:${v.when}` : key),
  useFormatter: () => ({ relativeTime: (at: number, now: Date) => `${Math.round((now.getTime() - at) / 86_400_000)}d` }),
  useNow: () => new Date('2026-11-20T12:00:00Z'),
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/import-export/MediaImportRecovery', () => ({ default: () => null }));
vi.mock('@/app/components/PersonPickerSheet', () => ({ PersonPickerSheet: () => null }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));

import { MobileImportExport, type MobileImportExportProps } from '@/app/import-export/MobileImportExport';

function props(over: Partial<MobileImportExportProps>): MobileImportExportProps {
  return {
    treeName: 'Arbor', permission: 'owner', treeEmpty: false, liveCounts: null, countsText: () => '', activeTreeId: 1,
    file: null, onFile: vi.fn(), onStartJob: vi.fn(), previewing: false, loading: false, checkingTree: false,
    importStep: null, importProgress: null, preview: null, previewSidecars: null, error: null,
    onPreview: vi.fn(), onBackToForm: vi.fn(), onImport: vi.fn(), result: null, recoverySeed: null,
    checksCount: null, duplicatesCount: null, onFinish: vi.fn(), confirmOpen: false, existingCounts: null,
    onConfirm: vi.fn(), onCancelConfirm: vi.fn(), exportBusy: false, exportError: null, onExport: vi.fn().mockResolvedValue(true),
    preflight: null, onPreflightClose: vi.fn(), onExportOmit: vi.fn(),
    xlsx: { file: null, onFile: vi.fn(), phase: 'idle', dryRun: null, result: null, error: null, onPreview: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), onDownloadTemplate: vi.fn(), dateFormat: 'MDY' },
    onSkipLog: vi.fn(),
    ...over,
  };
}

const row = (name: string) => screen.queryByRole('button', { name: new RegExp(name) });

describe('MobileImportExport hub (#1120)', () => {
  it('gives an owner every job', () => {
    render(<MobileImportExport {...props({})} />);
    expect(row('download_backup')).toBeInTheDocument();
    expect(row('add_from_file')).toBeInTheDocument();
    expect(row('add_from_spreadsheet')).toBeInTheDocument();
    expect(row('restore')).toBeInTheDocument();
  });

  it('keeps Restore from a contributor, as the server refuses it', () => {
    render(<MobileImportExport {...props({ permission: 'contribute' })} />);
    expect(row('add_from_file')).toBeInTheDocument();
    expect(row('restore')).not.toBeInTheDocument();
  });

  it('lets a viewer only export', () => {
    render(<MobileImportExport {...props({ permission: 'view' })} />);
    expect(row('download_backup')).toBeInTheDocument();
    expect(row('send_gedcom')).toBeInTheDocument();
    expect(row('add_from_file')).not.toBeInTheDocument();
    expect(row('restore')).not.toBeInTheDocument();
  });

  it('hides Restore on an empty tree', () => {
    render(<MobileImportExport {...props({ treeEmpty: true })} />);
    expect(row('restore')).not.toBeInTheDocument();
  });
});

describe('Restore backup age (#193)', () => {
  const NOW = Date.parse('2026-11-20T12:00:00Z');
  const DAY = 86_400_000;
  const file = new File(['0 HEAD'], 'tree.ged');
  const openRestore = async (lastBackupAt: number | null) => {
    window.localStorage.clear();
    if (lastBackupAt != null) window.localStorage.setItem('heirloom.lastBackup.1', String(lastBackupAt));
    render(<MobileImportExport {...props({ file })} />);
    row('restore')!.click();
    await screen.findByText('step_backup');
  };

  it('a recent backup on this device: says how old, no warning', async () => {
    await openRestore(NOW - 3 * DAY);
    expect(screen.getByText('backup_age_recent:3d')).toBeInTheDocument();
    expect(screen.queryByText('no_backup_yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/backup_age_old/)).not.toBeInTheDocument();
  });

  it('an old backup: warns with its age', async () => {
    await openRestore(NOW - 90 * DAY);
    expect(screen.getByText('backup_age_old:90d')).toBeInTheDocument();
  });

  it('no backup on this device: the plain warning', async () => {
    await openRestore(null);
    expect(screen.getByText('no_backup_yet')).toBeInTheDocument();
  });
});
