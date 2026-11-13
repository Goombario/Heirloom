/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const state = vi.hoisted(() => ({
  treeId: 9 as number | null,
  recoveryEmpty: false,
  push: vi.fn(),
  client: {
    preflightExport: vi.fn(),
    exportGedcom: vi.fn(),
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    return `${key} ${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(' ')}`;
  },
  useFormatter: () => ({ dateTime: (value: number) => String(value) }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: state.treeId }),
}));
vi.mock('@/lib/data', () => ({
  DATA_MODE: 'http',
  getDataClient: vi.fn(async () => ({ gedcom: state.client })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Test tree' }));
vi.mock('@/app/import-export/MediaImportRecovery', () => ({
  // The real panel renders nothing when there are no import items.
  default: () => (state.recoveryEmpty ? null : <div data-testid="media-recovery-panel" tabIndex={-1}>recovery</div>),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import ImportExportPage from '@/app/import-export/page';

const cleanPreflight = {
  canExport: true,
  omittedTotal: 0,
  byReason: { pending: 0, missing: 0, failed: 0, backing_missing: 0, legacy_materialization_unknown: 0 },
};
const blockedPreflight = {
  canExport: false,
  omittedTotal: 3,
  byReason: { pending: 1, missing: 1, failed: 1, backing_missing: 0, legacy_materialization_unknown: 0 },
};

function artifact(filename = 'family_tree_export.zip') {
  return { blob: new Blob(['safe artifact']), filename };
}

beforeEach(() => {
  state.treeId = 9;
  state.recoveryEmpty = false;
  state.push.mockReset();
  state.client.preflightExport.mockReset();
  state.client.exportGedcom.mockReset();
  state.client.preflightExport.mockResolvedValue(cleanPreflight);
  state.client.exportGedcom.mockResolvedValue(artifact());
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test-export'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('import/export media export UI', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/import-export'); });

  it('preflights a clean media export, downloads the returned artifact, and revokes its object URL', async () => {
    render(<ImportExportPage />);

    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));

    await waitFor(() => expect(state.client.preflightExport).toHaveBeenCalledWith(9));
    await waitFor(() => expect(state.client.exportGedcom).toHaveBeenCalledWith({ includeMedia: true }, 9));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-export');
  });

  it('shows a busy Export button while the media preflight runs (BK-1)', async () => {
    let finish: (value: unknown) => void = () => {};
    state.client.preflightExport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<ImportExportPage />);

    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));

    const busy = await screen.findByRole('button', { name: 'preparing' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    finish(cleanPreflight);
    await screen.findByRole('button', { name: 'action_download' });
  });

  it('exports plain GEDCOM without media and propagates the active tree', async () => {
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_export' }));

    await waitFor(() => expect(state.client.exportGedcom).toHaveBeenCalledWith({ includeMedia: false }, 9));
    expect(state.client.preflightExport).not.toHaveBeenCalled();
  });

  it('shows only aggregate blocked-state categories and counts', async () => {
    state.client.preflightExport.mockResolvedValue(blockedPreflight);
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('media_export_blocked_total count=3')).toBeInTheDocument();
    expect(screen.getByText('media_export_reason_pending')).toBeInTheDocument();
    expect(screen.getByText('media_export_reason_missing')).toBeInTheDocument();
    expect(screen.getByText('media_export_reason_failed')).toBeInTheDocument();
    expect(screen.queryByText(/path|xref|Person|raw failure|media-123/i)).not.toBeInTheDocument();
    expect(state.client.exportGedcom).not.toHaveBeenCalled();
  });

  it('reviews unresolved media by closing and focusing the recovery panel', async () => {
    state.client.preflightExport.mockResolvedValue(blockedPreflight);
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'media_export_review' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'media_recovery_title' })));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('cancels the blocked dialog without exporting', async () => {
    state.client.preflightExport.mockResolvedValue(blockedPreflight);
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'media_export_cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.client.exportGedcom).not.toHaveBeenCalled();
  });

  it('allows an explicit exact omit-unresolved override for a blocked export', async () => {
    state.client.preflightExport.mockResolvedValue(blockedPreflight);
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'media_export_override' }));
    await waitFor(() => expect(state.client.exportGedcom).toHaveBeenCalledWith(
      { includeMedia: true, mediaPolicy: 'omit-unresolved' },
      9,
    ));
  });

  it('closes a stale preflight when the active tree changes before an override', async () => {
    state.client.preflightExport.mockResolvedValue(blockedPreflight);
    const view = render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));
    await screen.findByRole('dialog');

    state.treeId = 8;
    view.rerender(<ImportExportPage />);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.client.exportGedcom).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'media_export_override' }));

    await waitFor(() => expect(state.client.exportGedcom).toHaveBeenCalledWith(
      { includeMedia: true, mediaPolicy: 'omit-unresolved' },
      8,
    ));
  });

  it('passes null for the default tree and suppresses concurrent preflights', async () => {
    state.treeId = null;
    let resolvePreflight!: (value: typeof cleanPreflight) => void;
    state.client.preflightExport.mockReturnValue(new Promise((resolve) => { resolvePreflight = resolve; }));
    render(<ImportExportPage />);
    const button = screen.getByRole('button', { name: 'action_download' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(state.client.preflightExport).toHaveBeenCalledTimes(1));
    expect(state.client.preflightExport).toHaveBeenCalledWith(null);
    resolvePreflight(cleanPreflight);
    await waitFor(() => expect(state.client.exportGedcom).toHaveBeenCalledWith({ includeMedia: true }, null));
  });

  it('renders a generic translated failure without exposing the raw error', async () => {
    state.client.preflightExport.mockRejectedValue(new Error('secret path /private/family.jpg'));
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));

    expect(await screen.findByText('export_error_generic')).toBeInTheDocument();
    expect(screen.queryByText(/secret path|private|family\.jpg/i)).not.toBeInTheDocument();
  });

  it('sends a missing backing file to Library photos, which the recovery panel cannot list (#947)', async () => {
    state.recoveryEmpty = true;
    state.client.preflightExport.mockResolvedValue({
      canExport: false,
      omittedTotal: 1,
      byReason: { pending: 0, missing: 0, failed: 0, backing_missing: 1, legacy_materialization_unknown: 0 },
    });
    render(<ImportExportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'action_download' }));

    expect(await screen.findByText('media_export_backing_missing_hint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'media_export_review_library' }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/library?tab=photos'));
  });
});
