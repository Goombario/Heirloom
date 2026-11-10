/** @vitest-environment happy-dom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

const harness = vi.hoisted(() => ({
  permission: 'owner',
  treeId: 7,
  tab: 'photos',
  mobile: false,
  photos: [
    { Id: 12, UserId: 42, Title: 'Zoe', FilePath: 'zoe.jpg', Format: 'jpg', ContentType: 'image/jpeg', TaggedPersonNames: ['Zoe Person'] },
    { Id: 3, UserId: 42, Title: 'Ada', FilePath: 'ada.jpg', Format: 'jpg', ContentType: 'image/jpeg' },
  ],
  refetch: vi.fn().mockResolvedValue(undefined),
  removeMany: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: harness.push }),
  useSearchParams: () => new URLSearchParams(`tab=${harness.tab}`),
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace?: string) => (key: string, values?: { count?: number; title?: string }) => {
    const messages: Record<string, string> = {
      title: 'Library',
      evidence_subtitle: 'Sources, photos, and evidence',
      tab_sources_label: 'Sources', tab_photos_label: 'Photos', tab_repositories_label: 'Repositories',
      tab_uncited_label: 'Uncited', queue_tab: 'Faces', search_sources_placeholder: 'Search sources',
      search_photos_placeholder: 'Search photos', add_source_fab_label: 'Add source', upload_photo: 'Upload',
      repo_add: 'Add repository', filter_sources_title: 'Filter sources', filter_button_label: 'Filter sources',
      clear_all: 'Clear all', filter_type: 'Type', filter_all_types: 'All types', filter_repository: 'Repository',
      filter_all_repositories: 'All repositories', filter_apply: 'Show 0 sources', active_filter_remove: 'Remove filter',
      empty_no_match: 'No match', empty_uncited: 'No uncited', filter_photos_title: 'Filter photos',
      filter_apply_photos: 'Show 0 photos', photo_filters_title: 'Photo filters', photo_tag_label: 'Tag status',
      photo_filter_all: 'All', photo_filter_tagged: 'Tagged', photo_filter_untagged: 'Untagged',
      photo_sort_label: 'Photo order', photo_sort_recent: 'Recently added', photo_sort_title_asc: 'Title A-Z',
      photo_sort_title_desc: 'Title Z-A', photo_sort_recent_hint: 'Uses library insertion order', photo_filters_reset: 'Reset photo filters',
      empty_no_photos: 'No photos', photo_alt: 'Photo', photo_select: `Select ${values?.title ?? 'photo'}`,
      photo_deselect: `Deselect ${values?.title ?? 'photo'}`, photo_delete_failed: 'Deletion failed',
      select: 'Select', done: 'Done', selected_count: `${values?.count ?? 0} selected`,
      select_all_results: `Select all ${values?.count ?? 0} results`, clear_selection: 'Clear selection',
      delete_selected: `Delete ${values?.count ?? 0} selected`, delete_selected_title: 'Delete selected photos?',
      delete_selected_body: `This will permanently delete ${values?.count ?? 0} photos.`,
      delete_selected_confirm: 'Delete photos', deleting_selected: 'Deleting…',
      delete_failed_item: `Could not delete ${values?.title ?? 'photo'}.`, retry_failed: 'Retry failed',
      cleanup_warning: `Deleted successfully, but ${values?.count ?? 0} files could not be cleaned up.`,
      delete_request_failed: 'Could not delete the selected photos. Please try again.',
    };
    if (namespace === 'common') return (key === 'cancel' ? 'Cancel' : key);
    return messages[key] ?? key;
  },
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: harness.treeId, activePermission: harness.permission, currentUserId: 42 }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => harness.mobile }));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/app/library/useLibrarySources', () => ({ useLibrarySources: () => ({ sources: [], photos: harness.photos, loading: false, refetch: harness.refetch }) }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn().mockResolvedValue({ media: { listFaceQueue: vi.fn(() => new Promise(() => {})), removeMany: (...args: unknown[]) => harness.removeMany(...args) } }) }));
vi.mock('@/app/components/MediaImg', () => ({ default: ({ alt }: { alt: string }) => (
  // eslint-disable-next-line @next/next/no-img-element -- lightweight test double
  <img src="photo.jpg" alt={alt} />
) }));
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({ default: () => <div data-testid="lightbox" /> }));
vi.mock('@/app/library/faces/FacesPanel', () => ({ default: () => <div>Faces panel</div> }));
vi.mock('@/app/library/RepositoryModal', () => ({ default: () => null }));
vi.mock('@/app/library/SourceModal', () => ({ default: () => null }));
vi.mock('@/app/components/UploadModal', () => ({ default: () => null }));
vi.mock('@/app/library/sections/RepositoriesList', () => ({ default: () => <div>Repositories list</div> }));
vi.mock('@/app/components/ConfirmDialog', () => ({ default: (props: { open: boolean; title: string; body: React.ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) => props.open ? (
  <div role="dialog"><h2>{props.title}</h2><div>{props.body}</div><button onClick={props.onCancel}>Cancel</button><button disabled={props.busy} onClick={props.onConfirm}>{props.confirmLabel}</button></div>
) : null }));

import LibraryPage from '@/app/library/page';

const success = (ids: number[], cleanupWarningCount = 0) => ({
  results: ids.map((id) => ({ id, status: 'deleted' as const, cleanupWarning: cleanupWarningCount ? 'storage_cleanup_failed' as const : null })),
  deletedCount: ids.length,
  skippedCount: 0,
  failedCount: 0,
  cleanupWarningCount,
});

describe('Library photo bulk deletion flow', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    harness.permission = 'owner';
    harness.treeId = 7;
    harness.tab = 'photos';
    harness.mobile = false;
    harness.photos = [
      { Id: 12, UserId: 42, Title: 'Zoe', FilePath: 'zoe.jpg', Format: 'jpg', ContentType: 'image/jpeg', TaggedPersonNames: ['Zoe Person'] },
      { Id: 3, UserId: 42, Title: 'Ada', FilePath: 'ada.jpg', Format: 'jpg', ContentType: 'image/jpeg' },
    ];
    harness.refetch.mockClear();
    harness.removeMany.mockReset();
    harness.removeMany.mockResolvedValue(success([3, 12]));
  });

  it('does not expose selection to a contribute collaborator', async () => {
    harness.permission = 'contribute';
    render(<LibraryPage />);
    await screen.findByRole('tab', { name: /Photos/ });
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });

  it('selects only current search results while preserving the filtered sort order', async () => {
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search photos' }), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 1 results' }));
    expect(screen.getByRole('button', { name: 'Deselect Ada' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Deselect Zoe' })).not.toBeInTheDocument();
  });

  it('preserves selection membership when the photo sort changes', async () => {
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Zoe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Photo order Recently added' }));
    fireEvent.click(screen.getByRole('option', { name: 'Title A-Z' }));
    expect(screen.getByRole('button', { name: 'Deselect Zoe' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears selection when leaving Photos or changing the active tree', async () => {
    const { rerender } = render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));

    harness.tab = 'sources';
    act(() => rerender(<LibraryPage />));
    await screen.findByRole('tab', { name: /Sources/ });
    harness.tab = 'photos';
    act(() => rerender(<LibraryPage />));
    await screen.findByRole('button', { name: 'Select' });
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    harness.treeId = 8;
    act(() => rerender(<LibraryPage />));
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('sorts IDs, refetches once, and exits after a wholly successful delete', async () => {
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(harness.removeMany).toHaveBeenCalledWith([3, 12], 7));
    await waitFor(() => expect(harness.refetch).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete 2 selected' })).not.toBeInTheDocument();
  });

  it('deletes large selections in sorted chunks and aggregates them with one refetch', async () => {
    harness.photos = Array.from({ length: 205 }, (_, index) => ({
      Id: 205 - index, UserId: 42, Title: `Photo ${205 - index}`, FilePath: `${index}.jpg`, Format: 'jpg', ContentType: 'image/jpeg',
    }));
    harness.removeMany.mockImplementation(async (ids: number[]) => success(ids));
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 205 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 205 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(harness.removeMany).toHaveBeenCalledTimes(3));
    expect(harness.removeMany.mock.calls.map(([ids]) => ids)).toEqual([
      Array.from({ length: 100 }, (_, i) => i + 1),
      Array.from({ length: 100 }, (_, i) => i + 101),
      Array.from({ length: 5 }, (_, i) => i + 201),
    ]);
    expect(harness.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('retains only the failed and unattempted chunks after a request-wide chunk failure', async () => {
    harness.photos = Array.from({ length: 205 }, (_, index) => ({
      Id: 205 - index, UserId: 42, Title: `Photo ${205 - index}`, FilePath: `${index}.jpg`, Format: 'jpg', ContentType: 'image/jpeg',
    }));
    harness.removeMany.mockImplementationOnce(async (ids: number[]) => success(ids));
    harness.removeMany.mockRejectedValueOnce(new Error('request failed'));
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 205 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 205 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(screen.getByText('Could not delete the selected photos. Please try again.')).toBeInTheDocument());
    expect(harness.removeMany).toHaveBeenCalledTimes(2);
    expect(harness.refetch).toHaveBeenCalledOnce();
    expect(screen.getByText('105 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry failed' })).toBeInTheDocument();
  });

  it('retains only retryable failures and retries only those IDs', async () => {
    harness.removeMany.mockResolvedValueOnce({
      results: [
        { id: 3, status: 'deleted', cleanupWarning: null },
        { id: 12, status: 'failed', code: 'delete_failed', retryable: true },
      ], deletedCount: 1, skippedCount: 0, failedCount: 1, cleanupWarningCount: 0,
    });
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry failed' })).toBeInTheDocument());
    expect(screen.getByText('Could not delete Zoe.')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(harness.removeMany).toHaveBeenLastCalledWith([12], 7));
  });

  it('drops a failed outcome when its photo is filtered out', async () => {
    harness.removeMany.mockResolvedValueOnce({
      results: [
        { id: 3, status: 'deleted', cleanupWarning: null },
        { id: 12, status: 'failed', code: 'delete_failed', retryable: true },
      ], deletedCount: 1, skippedCount: 0, failedCount: 1, cleanupWarningCount: 0,
    });
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await screen.findByRole('button', { name: 'Retry failed' });

    fireEvent.click(screen.getByRole('button', { name: /^Untagged/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry failed' })).not.toBeInTheDocument());
    expect(screen.queryByTestId('photo-failure-12')).not.toBeInTheDocument();
  });

  it('ignores a mixed result that resolves after leaving Photos for another tab/tree', async () => {
    let resolveDelete!: (result: unknown) => void;
    harness.removeMany.mockReturnValueOnce(new Promise((resolve) => { resolveDelete = resolve; }));
    const { rerender } = render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(harness.removeMany).toHaveBeenCalledOnce());

    harness.tab = 'sources';
    act(() => rerender(<LibraryPage />));
    await screen.findByRole('tab', { name: /Sources/ });
    harness.treeId = 8;
    act(() => rerender(<LibraryPage />));
    harness.tab = 'photos';
    act(() => rerender(<LibraryPage />));
    await screen.findByRole('button', { name: 'Select' });
    resolveDelete({
      results: [
        { id: 3, status: 'deleted', cleanupWarning: null },
        { id: 12, status: 'failed', code: 'delete_failed', retryable: true },
      ], deletedCount: 1, skippedCount: 0, failedCount: 1, cleanupWarningCount: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: 'Retry failed' })).not.toBeInTheDocument();
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deleting…' })).not.toBeInTheDocument();
  });

  it('applies authoritative outcomes when the post-delete refetch rejects', async () => {
    harness.refetch.mockRejectedValueOnce(new Error('refresh failed'));
    harness.removeMany.mockResolvedValueOnce(success([3, 12]));
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(harness.refetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument());
    expect(screen.queryByText('refresh failed')).not.toBeInTheDocument();
  });

  it('keeps the selection and shows a translated general error on request failure', async () => {
    harness.removeMany.mockRejectedValueOnce(new Error('server detail must not render'));
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(screen.getByText('Could not delete the selected photos. Please try again.')).toBeInTheDocument());
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.queryByText('server detail must not render')).not.toBeInTheDocument();
  });

  it('does not let Done or Clear race a pending retry into browse state', async () => {
    let resolveRetry!: (result: unknown) => void;
    harness.removeMany.mockResolvedValueOnce({
      results: [{ id: 3, status: 'failed', code: 'delete_failed', retryable: true }],
      deletedCount: 0, skippedCount: 0, failedCount: 1, cleanupWarningCount: 0,
    });
    harness.removeMany.mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await screen.findByRole('button', { name: 'Retry failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(harness.removeMany).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    resolveRetry({
      results: [{ id: 3, status: 'deleted', cleanupWarning: null }],
      deletedCount: 1, skippedCount: 0, failedCount: 0, cleanupWarningCount: 0,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument());
  });

  it('treats cleanup warnings as success and does not retain the deleted tile', async () => {
    harness.removeMany.mockResolvedValueOnce(success([3, 12], 2));
    render(<LibraryPage />);
    await screen.findByRole('button', { name: 'Select' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    await waitFor(() => expect(screen.getByText('Deleted successfully, but 2 files could not be cleaned up.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });
});
