/** @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
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
    xlsx: { file: null, onFile: vi.fn(), phase: 'idle', dryRun: null, result: null, error: null, onPreview: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), dateFormat: 'MDY' },
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
