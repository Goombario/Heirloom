/** @vitest-environment happy-dom */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import JSZip from 'jszip';
import type { GedcomClient } from '@/lib/data/types';
import type { MediaImportItem } from '@/lib/db/schema';
import { UnsavedChangesProvider } from '@/app/components/UnsavedChangesProvider';
import { AccessError, NotFoundError, RateLimitError } from '@/lib/data/errors';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { group?: number; count?: number }) => {
    if (values?.group !== undefined) return `${key}_${values.group}`;
    return key;
  },
}));

vi.mock('@/app/components/ConfirmDialog', () => ({
  default: ({ open, title, body, confirmLabel, onConfirm, onCancel }: {
    open: boolean; title: string; body: React.ReactNode; confirmLabel: string;
    onConfirm: () => void; onCancel: () => void;
  }) => open ? <div role="dialog"><h2>{title}</h2><p>{body}</p><button onClick={onCancel}>cancel</button><button onClick={onConfirm}>{confirmLabel}</button></div> : null,
}));

const { getDataClient } = vi.hoisted(() => ({ getDataClient: vi.fn() }));
vi.mock('@/lib/data', () => ({
  DATA_MODE: 'http',
  getDataClient,
  // The hosted build runs a write batch with the ordinary client (#1259).
  withWriteBatch: async (run: (client: unknown) => Promise<unknown>) => run(await getDataClient()),
}));

import MediaImportRecovery from '@/app/import-export/MediaImportRecovery';

function item(overrides: Partial<MediaImportItem> = {}): MediaImportItem {
  return {
    id: 1, importId: 'import-1', documentMediaId: '@O1@', treeId: 7, mediaId: 101,
    archivePath: 'media/O1/portrait.jpg', originalFilename: 'portrait.jpg',
    status: 'pending', failureCode: null, skipFaceCapture: false, ...overrides,
  };
}

function client(overrides: Partial<Record<keyof GedcomClient, unknown>> = {}): GedcomClient {
  return {
    previewGedcom: vi.fn(), importGedcom: vi.fn(),
    listUnresolvedImportMedia: vi.fn().mockResolvedValue([]),
    markImportMediaMissing: vi.fn().mockResolvedValue([]),
    materializeImportMedia: vi.fn().mockResolvedValue({ outcome: 'ready', item: item({ status: 'ready' }), failureCode: null, retryable: false }),
    removeUnresolvedImportMedia: vi.fn().mockResolvedValue(undefined),
    removeUnresolvedImportMediaBatch: vi.fn().mockImplementation(async (ids: number[]) => ids),
    previewSpreadsheet: vi.fn(), importSpreadsheet: vi.fn(), reset: vi.fn(),
    ...overrides,
  } as unknown as GedcomClient;
}

const result = {
  mode: 'merge', peopleCount: 12, familiesCount: 4, sourcesCount: 3,
  libraryMediaCount: 1, tagsCount: 0, zipWarnings: [],
};

async function zipWith(...paths: string[]): Promise<File> {
  const zip = new JSZip();
  for (const path of paths) zip.file(path, new Blob(['image']));
  return new File([await zip.generateAsync({ type: 'blob' })], 'retry.zip', { type: 'application/zip' });
}

describe('MediaImportRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers unresolved items on mount and shows only safe original basenames', async () => {
    const unresolved = item({ originalFilename: 'grandma.jpg' });
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([unresolved]) });
    getDataClient.mockResolvedValue({ gedcom: api });

    render(<MediaImportRecovery treeId={7} />);

    await waitFor(() => expect(screen.getByText('grandma.jpg')).toBeInTheDocument());
    expect(screen.queryByText(/media\/O1/)).not.toBeInTheDocument();
    expect(api.listUnresolvedImportMedia).toHaveBeenCalledWith(7);
  });

  it('recovers an initial archive when null tree scope resolves the default tree', async () => {
    const unresolved = item({ id: 7, importId: 'default-import', treeId: 42 });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([]),
      materializeImportMedia: vi.fn().mockResolvedValue({
        outcome: 'ready', item: { ...unresolved, status: 'ready' }, failureCode: null, retryable: false,
      }),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    const archive = await zipWith('media/O1/portrait.jpg');

    render(<MediaImportRecovery treeId={null} initialItems={[unresolved]} initialArchive={archive} />);

    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalledWith(7, 'media/O1/portrait.jpg', expect.any(File), null));
  });

  it('shows a truthful processing phase, guards navigation, then announces completion', async () => {
    const unresolved = item();
    const ready = { ...unresolved, status: 'ready' as const };
    let finish!: (value: unknown) => void;
    const materialized = new Promise((resolve) => { finish = resolve; });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([]),
      materializeImportMedia: vi.fn().mockReturnValue(materialized),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    const archive = await zipWith('media/O1/portrait.jpg');

    render(
      <UnsavedChangesProvider>
        <MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[unresolved]} initialArchive={archive} result={result} />
      </UnsavedChangesProvider>,
    );

    expect(screen.getByText('media_lifecycle_title_processing')).toBeInTheDocument();
    expect(screen.queryByText('success_title')).not.toBeInTheDocument();
    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalled());
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    finish({ outcome: 'ready', item: ready, failureCode: null, retryable: false });
    await waitFor(() => expect(screen.getByText('media_lifecycle_title_complete')).toBeInTheDocument());
    await waitFor(() => {
      const cleanUnload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(cleanUnload);
      expect(cleanUnload.defaultPrevented).toBe(false);
    });
  });

  it('does not flash a false 0/0 completion when a mounted panel receives a new import result', async () => {
    const pending = item();
    const materialized = new Promise(() => {});
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([]),
      materializeImportMedia: vi.fn().mockReturnValue(materialized),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    const archive = await zipWith('media/O1/portrait.jpg');
    const { rerender } = render(
      <UnsavedChangesProvider>
        <MediaImportRecovery treeId={7} />
      </UnsavedChangesProvider>,
    );

    rerender(
      <UnsavedChangesProvider>
        <MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[pending]} initialArchive={archive} result={result} />
      </UnsavedChangesProvider>,
    );

    expect(screen.getByText('media_lifecycle_title_processing')).toBeInTheDocument();
    expect(screen.queryByText('media_lifecycle_title_complete')).not.toBeInTheDocument();
    expect(screen.getByText('0 / 1')).toBeInTheDocument();
    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalled());
  });

  it('keeps a mixed failed and pending batch guarded while recovery is active', async () => {
    const pending = item();
    const failed = item({
      id: 2,
      documentMediaId: '@O2@',
      mediaId: 102,
      archivePath: 'media/O2/broken.jpg',
      originalFilename: 'broken.jpg',
      status: 'failed',
      failureCode: 'decode_failed',
    });
    const materialized = new Promise(() => {});
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([]),
      materializeImportMedia: vi.fn().mockReturnValue(materialized),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    const archive = await zipWith('media/O1/portrait.jpg', 'media/O2/broken.jpg');

    render(
      <UnsavedChangesProvider>
        <MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[pending, failed]} initialArchive={archive} result={result} />
      </UnsavedChangesProvider>,
    );

    expect(screen.getByText('media_lifecycle_title_processing')).toBeInTheDocument();
    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalled());
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('shows an attention outcome with the archive retry control for failed photos', async () => {
    const failed = item({ status: 'failed', failureCode: 'decode_failed' });
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([failed]) });
    getDataClient.mockResolvedValue({ gedcom: api });

    render(<MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[failed]} result={result} />);

    expect(screen.getByText('media_lifecycle_title_attention')).toBeInTheDocument();
    expect(screen.getByText('media_recovery_failure_decode_failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'media_recovery_choose_archive_for_group_1' })).toBeInTheDocument();
  });

  it('asks for an archive when a plain GEDCOM leaves referenced photos pending', async () => {
    const pending = item({ status: 'pending' });
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([pending]) });
    getDataClient.mockResolvedValue({ gedcom: api });

    render(<MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[pending]} result={result} />);

    expect(screen.getByText('media_lifecycle_title_attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'media_recovery_choose_archive_for_group_1' })).toBeInTheDocument();
  });

  it('treats a records-only import as complete without inventing pending media', async () => {
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([]) });
    getDataClient.mockResolvedValue({ gedcom: api });

    render(<MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[]} result={result} />);

    expect(screen.getByText('media_lifecycle_title_complete')).toBeInTheDocument();
    // No media in the file: no "Photos ready 0 / 0" and no photo copy (FR-3).
    expect(screen.queryByText('0 / 0')).toBeNull();
    expect(screen.queryByText('media_lifecycle_photos_ready')).toBeNull();
    expect(screen.getByText('media_lifecycle_description_complete_records')).toBeInTheDocument();
  });

  it('matches reselected archives by exact normalized path, batches misses, and keeps mixed outcomes visible', async () => {
    const ready = item({ id: 1, archivePath: 'media/O1/portrait.jpg', originalFilename: 'portrait.jpg' });
    const missing = item({ id: 2, documentMediaId: '@O2@', mediaId: 102, archivePath: 'media/O2/missing.jpg', originalFilename: 'missing.jpg' });
    const failed = item({ id: 3, documentMediaId: '@O3@', mediaId: 103, archivePath: 'media/O3/bad.jpg', originalFilename: 'bad.jpg', status: 'failed', failureCode: 'decode_failed' });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([ready, missing, failed]),
      markImportMediaMissing: vi.fn().mockResolvedValue([{ ...missing, status: 'missing', failureCode: 'archive_file_missing' }]),
      materializeImportMedia: vi.fn(async (id: number) => id === 3
        ? { outcome: 'failed', item: failed, failureCode: 'decode_failed', retryable: true }
        : { outcome: 'ready', item: { ...ready, status: 'ready' }, failureCode: null, retryable: false }),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);

    const archive = await zipWith('media/O1/portrait.jpg', 'media/O3/bad.jpg');
    await waitFor(() => expect(screen.getByTestId('media-recovery-archive-0')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('media-recovery-archive-0'), { target: { files: [archive] } });

    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalledWith(1, 'media/O1/portrait.jpg', expect.any(File), 7));
    expect(api.markImportMediaMissing).toHaveBeenCalledWith([2], 7);
    expect(api.materializeImportMedia).toHaveBeenCalledWith(3, 'media/O3/bad.jpg', expect.any(File), 7);
    await waitFor(() => expect(screen.getByText('media_recovery_failure_archive_file_missing')).toBeInTheDocument());
    expect(screen.getByText('media_recovery_failure_decode_failed')).toBeInTheDocument();
  });

  it('retries only the selected import and never mutates another import', async () => {
    const importA = item({ id: 1, importId: 'import-a', archivePath: 'media/A/missing.jpg', originalFilename: 'a.jpg' });
    const importB = item({ id: 2, importId: 'import-b', archivePath: 'media/B/other.jpg', originalFilename: 'b.jpg' });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([importA, importB]),
      markImportMediaMissing: vi.fn().mockResolvedValue([{ ...importA, status: 'missing', failureCode: 'archive_file_missing' }]),
      materializeImportMedia: vi.fn().mockResolvedValue({ outcome: 'ready', item: { ...importB, status: 'ready' }, failureCode: null, retryable: false }),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);

    const archive = await zipWith('media/B/other.jpg');
    await waitFor(() => expect(screen.getByTestId('media-recovery-archive-0')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('media-recovery-archive-0'), { target: { files: [archive] } });

    await waitFor(() => expect(api.markImportMediaMissing).toHaveBeenCalledWith([1], 7));
    expect(api.materializeImportMedia).not.toHaveBeenCalled();
    expect(api.markImportMediaMissing).not.toHaveBeenCalledWith([2], 7);
  });

  it('associates each archive selector with its privacy-safe import group', async () => {
    const first = item({ id: 1, importId: 'import-a', originalFilename: 'a.jpg' });
    const second = item({ id: 2, importId: 'import-b', archivePath: 'media/B/other.jpg', originalFilename: 'b.jpg' });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([first, second]),
      materializeImportMedia: vi.fn().mockResolvedValue({ outcome: 'ready', item: { ...second, status: 'ready' }, failureCode: null, retryable: false }),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);

    await waitFor(() => expect(screen.getByTestId('media-recovery-archive-1')).toBeInTheDocument());
    expect(screen.getByTestId('media-recovery-archive-0')).toHaveAccessibleName('media_recovery_choose_archive_for_group_1');
    expect(screen.getByTestId('media-recovery-archive-1')).toHaveAccessibleName('media_recovery_choose_archive_for_group_2');
    expect(screen.getByRole('heading', { name: 'media_recovery_group_heading_1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'media_recovery_group_heading_2' })).toBeInTheDocument();
    expect(screen.queryByText('import-a')).not.toBeInTheDocument();
    expect(screen.queryByText('import-b')).not.toBeInTheDocument();

    const archive = await zipWith('media/B/other.jpg');
    fireEvent.change(screen.getByTestId('media-recovery-archive-1'), { target: { files: [archive] } });
    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalledWith(2, 'media/B/other.jpg', expect.any(File), 7));
    expect(api.markImportMediaMissing).not.toHaveBeenCalledWith([1], 7);
  });

  it('rejects duplicate normalized archive paths before mutation', async () => {
    const unresolved = item({ archivePath: 'media/O1/portrait.jpg' });
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([unresolved]) });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);
    const archive = await zipWith('media/O1/portrait.jpg', 'media\\O1\\portrait.jpg');
    await waitFor(() => expect(screen.getByTestId('media-recovery-archive-0')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('media-recovery-archive-0'), { target: { files: [archive] } });
    await waitFor(() => expect(screen.getByText('media_recovery_ambiguous_archive')).toBeInTheDocument());
    expect(api.markImportMediaMissing).not.toHaveBeenCalled();
    expect(api.materializeImportMedia).not.toHaveBeenCalled();
  });

  it('classifies a present unsupported TIFF through materialization instead of as missing', async () => {
    const unsupported = item({ archivePath: 'media/O1/scan.tiff', originalFilename: 'scan.tiff' });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([unsupported]),
      materializeImportMedia: vi.fn().mockResolvedValue({
        outcome: 'failed',
        item: { ...unsupported, status: 'failed', failureCode: 'unsupported_media_type' },
        failureCode: 'unsupported_media_type',
        retryable: true,
      }),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);

    const archive = await zipWith('media/O1/scan.tiff');
    await waitFor(() => expect(screen.getByTestId('media-recovery-archive-0')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('media-recovery-archive-0'), { target: { files: [archive] } });

    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalledWith(
      unsupported.id,
      unsupported.archivePath,
      expect.any(File),
      7,
    ));
    expect(api.markImportMediaMissing).not.toHaveBeenCalled();
  });

  it('cancels stale discovery when the active tree changes', async () => {
    let resolveOld!: (value: MediaImportItem[]) => void;
    const oldDiscovery = new Promise<MediaImportItem[]>((resolve) => { resolveOld = resolve; });
    const oldItem = item({ treeId: 7, originalFilename: 'old-tree.jpg' });
    const newItem = item({ id: 2, treeId: 8, originalFilename: 'new-tree.jpg' });
    const list = vi.fn()
      .mockImplementationOnce(() => oldDiscovery)
      .mockResolvedValueOnce([newItem]);
    const api = client({ listUnresolvedImportMedia: list });
    getDataClient.mockResolvedValue({ gedcom: api });
    const view = render(<MediaImportRecovery treeId={7} />);
    view.rerender(<MediaImportRecovery treeId={8} />);
    await waitFor(() => expect(screen.getByText('new-tree.jpg')).toBeInTheDocument());
    resolveOld([oldItem]);
    await Promise.resolve();
    expect(screen.queryByText('old-tree.jpg')).not.toBeInTheDocument();
  });

  it('clears seeds from a previously selected tree when switching to the default tree', async () => {
    const oldTreeItem = item({ treeId: 7, originalFilename: 'old-tree-seed.jpg' });
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([]) });
    getDataClient.mockResolvedValue({ gedcom: api });
    const view = render(<MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[oldTreeItem]} />);

    expect(screen.getByText('old-tree-seed.jpg')).toBeInTheDocument();
    view.rerender(<MediaImportRecovery treeId={null} initialTreeId={7} initialItems={[oldTreeItem]} />);

    await waitFor(() => expect(screen.queryByText('old-tree-seed.jpg')).not.toBeInTheDocument());
    expect(api.listUnresolvedImportMedia).toHaveBeenLastCalledWith(null);
  });

  it('keeps the ready outcome when stale discovery resolves after recovery', async () => {
    let resolveStaleDiscovery!: (value: MediaImportItem[]) => void;
    const staleDiscovery = new Promise<MediaImportItem[]>((resolve) => { resolveStaleDiscovery = resolve; });
    const unresolved = item({ originalFilename: 'race.jpg' });
    const ready = { ...unresolved, status: 'ready' as const };
    const api = client({
      listUnresolvedImportMedia: vi.fn()
        .mockImplementationOnce(() => staleDiscovery)
        .mockResolvedValue([ready]),
      materializeImportMedia: vi.fn().mockResolvedValue({
        outcome: 'ready', item: ready, failureCode: null, retryable: false,
      }),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    const archive = await zipWith('media/O1/portrait.jpg');

    render(<MediaImportRecovery treeId={7} initialTreeId={7} initialItems={[unresolved]} initialArchive={archive} />);
    await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalledWith(1, 'media/O1/portrait.jpg', expect.any(File), 7));
    await waitFor(() => expect(api.listUnresolvedImportMedia).toHaveBeenCalledTimes(3));

    resolveStaleDiscovery([unresolved]);
    await waitFor(() => expect(screen.getAllByText('media_recovery_status_ready').length).toBeGreaterThan(0));
    expect(screen.queryByText('media_recovery_status_pending')).not.toBeInTheDocument();
  });

  it('requires confirmation before removing an unresolved item', async () => {
    const unresolved = item({ originalFilename: 'remove-me.jpg' });
    const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValue([unresolved]) });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);
    await waitFor(() => expect(screen.getByText('remove-me.jpg')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'media_recovery_remove' }));
    expect(api.removeUnresolvedImportMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'media_recovery_confirm_remove' }));
    await waitFor(() => expect(api.removeUnresolvedImportMedia).toHaveBeenCalledWith(1, 7));
  });

  it('renders only the translated remove error when removal is rejected', async () => {
    const unresolved = item({ originalFilename: 'remove-failure.jpg' });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([unresolved]),
      removeUnresolvedImportMedia: vi.fn().mockRejectedValue(new Error('RAW SECRET remove failure')),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);
    await waitFor(() => expect(screen.getByText('remove-failure.jpg')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'media_recovery_remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'media_recovery_confirm_remove' }));
    // The archive has nothing to do with a failed remove, so the message doesn't send the user to it (#859).
    await waitFor(() => expect(screen.getByText('media_recovery_remove_error')).toBeInTheDocument());
    expect(screen.queryByText(/RAW SECRET|remove failure/)).not.toBeInTheDocument();
  });

  it('does not render raw server errors and retains unrelated failures after a successful retry', async () => {
    const unresolved = item({ status: 'failed', failureCode: 'materialization_failed', originalFilename: 'retry.jpg' });
    const api = client({
      listUnresolvedImportMedia: vi.fn().mockResolvedValue([unresolved]),
      materializeImportMedia: vi.fn().mockRejectedValue(new Error('RAW SECRET archive/path/@O1@')),
    });
    getDataClient.mockResolvedValue({ gedcom: api });
    render(<MediaImportRecovery treeId={7} />);
    await waitFor(() => expect(screen.getByText('retry.jpg')).toBeInTheDocument());
    expect(screen.getByText('media_recovery_failure_materialization_failed')).toBeInTheDocument();
    const archive = await zipWith('media/O1/portrait.jpg');
    fireEvent.change(screen.getByTestId('media-recovery-archive-0'), { target: { files: [archive] } });
    await waitFor(() => expect(screen.getByText('media_recovery_generic_error')).toBeInTheDocument());
    expect(screen.queryByText(/RAW SECRET|archive\/path|@O1@/)).not.toBeInTheDocument();
    expect(screen.getByText('media_recovery_failure_materialization_failed')).toBeInTheDocument();
  });

  describe('remove failures and bulk remove (#859)', () => {
    async function removeOne(api: GedcomClient, name: string) {
      getDataClient.mockResolvedValue({ gedcom: api });
      render(<MediaImportRecovery treeId={7} />);
      await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'media_recovery_remove' }));
      fireEvent.click(screen.getByRole('button', { name: 'media_recovery_confirm_remove' }));
    }

    it('drops a row the server already resolved instead of showing an error', async () => {
      const stale = item({ originalFilename: 'stale.jpg' });
      const api = client({
        listUnresolvedImportMedia: vi.fn().mockResolvedValueOnce([stale]).mockResolvedValue([]),
        removeUnresolvedImportMedia: vi.fn().mockRejectedValue(new NotFoundError('Media import item not found')),
      });
      await removeOne(api, 'stale.jpg');
      await waitFor(() => expect(screen.queryByText('stale.jpg')).not.toBeInTheDocument());
      expect(screen.queryByText(/media_recovery_remove_error|media_recovery_generic_error/)).not.toBeInTheDocument();
    });

    it.each([
      [new AccessError('no'), 'media_recovery_remove_forbidden'],
      [new RateLimitError('slow down'), 'media_recovery_remove_rate_limited'],
    ])('says why a remove failed (%s)', async (failure, message) => {
      const row = item({ originalFilename: 'keep.jpg' });
      const api = client({
        listUnresolvedImportMedia: vi.fn().mockResolvedValue([row]),
        removeUnresolvedImportMedia: vi.fn().mockRejectedValue(failure),
      });
      await removeOne(api, 'keep.jpg');
      await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
      expect(screen.getByText('keep.jpg')).toBeInTheDocument();
    });

    it('does not report a remove that worked when the follow-up refresh fails', async () => {
      const row = item({ originalFilename: 'gone.jpg' });
      const api = client({
        listUnresolvedImportMedia: vi.fn().mockResolvedValueOnce([row]).mockRejectedValue(new Error('offline')),
      });
      await removeOne(api, 'gone.jpg');
      await waitFor(() => expect(screen.queryByText('gone.jpg')).not.toBeInTheDocument());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/media_recovery_remove_error/)).not.toBeInTheDocument();
    });

    it('selects a whole group and removes it in one confirmed batch', async () => {
      const rows = [
        item({ id: 1, originalFilename: 'a.jpg', status: 'failed', failureCode: 'storage_capacity' }),
        item({ id: 2, originalFilename: 'b.jpg', status: 'failed', failureCode: 'storage_capacity' }),
        item({ id: 3, originalFilename: 'c.jpg', importId: 'import-2' }),
      ];
      const api = client({ listUnresolvedImportMedia: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([rows[2]]) });
      getDataClient.mockResolvedValue({ gedcom: api });
      render(<MediaImportRecovery treeId={7} />);
      await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('checkbox', { name: 'media_recovery_select_all' }));
      fireEvent.click(screen.getByRole('button', { name: 'media_recovery_remove_selected' }));
      expect(api.removeUnresolvedImportMediaBatch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'media_recovery_confirm_remove_many' }));

      await waitFor(() => expect(api.removeUnresolvedImportMediaBatch).toHaveBeenCalledWith([1, 2], 7));
      await waitFor(() => expect(screen.queryByText('a.jpg')).not.toBeInTheDocument());
      expect(screen.queryByText('b.jpg')).not.toBeInTheDocument();
      expect(screen.getByText('c.jpg')).toBeInTheDocument();
      expect(api.removeUnresolvedImportMedia).not.toHaveBeenCalled();
    });

    it('stops uploading when the panel unmounts mid-recovery', async () => {
      const rows = [item({ id: 1, archivePath: 'media/O1/one.jpg' }), item({ id: 2, archivePath: 'media/O2/two.jpg', documentMediaId: '@O2@' })];
      let finish!: (value: unknown) => void;
      const first = new Promise((resolve) => { finish = resolve; });
      const api = client({ materializeImportMedia: vi.fn().mockReturnValueOnce(first).mockResolvedValue({ outcome: 'ready', item: null, failureCode: null, retryable: false }) });
      getDataClient.mockResolvedValue({ gedcom: api });
      const archive = await zipWith('media/O1/one.jpg', 'media/O2/two.jpg');

      const view = render(<MediaImportRecovery treeId={7} initialTreeId={7} initialItems={rows} initialArchive={archive} result={result} />);
      await waitFor(() => expect(api.materializeImportMedia).toHaveBeenCalledTimes(1));
      view.unmount();
      finish({ outcome: 'ready', item: { ...rows[0], status: 'ready' }, failureCode: null, retryable: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(api.materializeImportMedia).toHaveBeenCalledTimes(1);
    });
  });
});
