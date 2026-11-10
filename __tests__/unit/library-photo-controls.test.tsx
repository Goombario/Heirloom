/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import type { MediaTypeFilter, PhotoTagFilter } from '@/app/library/usePhotoFilters';
import type { SourceShow } from '@/app/library/useSourceFilters';
import LibraryPhotoSort from '@/app/library/sections/LibraryPhotoSort';
import PhotosPanel from '@/app/library/sections/PhotosPanel';
import SourcesPanel from '@/app/library/sections/SourcesPanel';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const text = ({
      photo_filters_title: 'Photo filters',
      photo_tag_label: 'Tag status',
      photo_filter_all: 'All',
      photo_filter_tagged: 'Tagged',
      photo_filter_untagged: 'Untagged',
      photo_sort_label: 'Photo order',
      photo_sort_trigger: 'Sort photos by {order}',
      photo_sort_recent: 'Recently added',
      photo_sort_title_asc: 'Title A-Z',
      photo_sort_title_desc: 'Title Z-A',
      photo_sort_largest: 'Largest first',
      photo_filters_reset: 'Reset photo filters',
      photo_filters_reset_short: 'Reset',
      filter_photos_title: 'Filter photos',
      filter_apply_photos: 'Show {count} photos',
      clear_all: 'Clear all',
      filter_type: 'Type',
      filter_all_types: 'All types',
      filter_repository: 'Repository',
      filter_all_repositories: 'All repositories',
      filter_sources_title: 'Filter sources',
      show_label: 'Show',
      show_all_sources: 'All sources',
      show_uncited: 'Uncited',
      show_all_photos: 'All media',
      media_type_photos: 'Photos',
      media_type_documents: 'Documents',
      repo_add: 'Add repository',
      manage_repositories: 'Manage repositories',
      photo_storage_title: 'Media storage',
      photo_storage_device: 'Storage managed by this device.',
      photo_storage_review_largest: 'Review largest files',
      type_Census: 'Census',
      type_Oral: 'Oral',
    }[key] ?? key);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  },
}));
describe('LibraryPhotoSort', () => {
  it('exposes all four sort choices through the top-level control', () => {
    const setSort = vi.fn();
    render(<LibraryPhotoSort sort="recent" setSort={setSort} />);

    const trigger = screen.getByRole('button', { name: 'Photo order Recently added' });
    expect(trigger).not.toHaveClass('min-h-11');
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox', { name: 'Photo order' })).toBeInTheDocument();
    for (const label of ['Recently added', 'Title A-Z', 'Title Z-A', 'Largest first']) {
      expect(screen.getByRole('option', { name: label })).toHaveClass('min-h-11');
    }

    fireEvent.click(screen.getByRole('option', { name: 'Largest first' }));
    expect(setSort).toHaveBeenCalledWith('size-desc');
  });

  it('uses a compact accessible trigger on mobile', () => {
    render(<LibraryPhotoSort sort="size-desc" setSort={vi.fn()} isMobile />);

    const trigger = screen.getByRole('button', { name: /Sort photos by Largest first/ });
    expect(trigger).toHaveClass('w-11', 'h-11');
  });
});

const storage = {
  summary: { usedBytes: 1024, limitBytes: null, remainingBytes: null, percentUsed: null, quotaMode: 'device' as const },
  loading: false,
  error: null,
  onRetry: vi.fn(),
  onReviewLargest: vi.fn(),
};

function ControlledPhotosPanel() {
  const [tagFilter, setTagFilter] = React.useState<PhotoTagFilter>('all');
  const [typeFilter, setTypeFilter] = React.useState<MediaTypeFilter>('all');
  return (
    <PhotosPanel
      tagFilter={tagFilter}
      setTagFilter={setTagFilter}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
      photoCounts={{ total: 146, visible: 146, tagged: 42, untagged: 104, photos: 140, documents: 6 }}
      storage={storage}
    />
  );
}

describe('PhotosPanel (#1155)', () => {
  it('shows All, Tagged and Untagged with counts, Untagged in amber, then media storage', () => {
    render(<ControlledPhotosPanel />);

    const panel = screen.getByRole('complementary', { name: 'Filter photos' });
    expect(panel).toHaveClass('sticky', 'rounded-panel', 'bg-card');
    expect(screen.getByRole('button', { name: 'All media 146' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('104')).toHaveClass('text-evidence');
    expect(screen.queryByText('Photo order')).not.toBeInTheDocument();

    const untagged = screen.getByRole('button', { name: 'Untagged 104' });
    fireEvent.click(untagged);
    expect(untagged).toHaveAttribute('aria-pressed', 'true');
    // Picking the active row again clears it.
    fireEvent.click(untagged);
    expect(screen.getByRole('button', { name: 'All media 146' })).toHaveAttribute('aria-pressed', 'true');

    const show = screen.getByRole('group', { name: 'Show' });
    const meter = screen.getByTestId('library-storage-card');
    expect(show.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('narrows the Media tab to photos or documents with the Type group (#510)', () => {
    render(<ControlledPhotosPanel />);

    const type = screen.getByRole('group', { name: 'Type' });
    expect(type).toHaveTextContent('Photos140Documents6');
    const documents = screen.getByRole('button', { name: 'Documents 6' });
    fireEvent.click(documents);
    expect(documents).toHaveAttribute('aria-pressed', 'true');
    // The Type group sits apart from Show, so a tag filter still combines with it.
    expect(screen.getByRole('button', { name: 'All media 146' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(documents);
    expect(documents).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SourcesPanel (#1154)', () => {
  function renderPanel(overrides: Partial<React.ComponentProps<typeof SourcesPanel>> = {}) {
    const props: React.ComponentProps<typeof SourcesPanel> = {
      totalCount: 5,
      uncitedCount: 2,
      show: 'all' as SourceShow,
      setShow: vi.fn(),
      typeCounts: new Map([['Census', 3], ['Oral', 2]]),
      typeFilter: null,
      setTypeFilter: vi.fn(),
      repositories: [{ id: 4, name: 'State Archive', count: 3 }],
      repoId: null,
      setRepoId: vi.fn(),
      canEdit: true,
      onAddRepository: vi.fn(),
      onManageRepositories: vi.fn(),
      ...overrides,
    };
    render(<SourcesPanel {...props} />);
    return props;
  }

  it('offers Show, Type and Repository groups, listing only types in use', () => {
    renderPanel();

    expect(screen.getByRole('group', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uncited 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Census 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^type_Vital/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'State Archive 3' })).toBeInTheDocument();
  });

  it('toggles each filter and reaches the repository actions at its foot', () => {
    const props = renderPanel({ show: 'uncited', typeFilter: 'Census', repoId: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Uncited 2' }));
    expect(props.setShow).toHaveBeenCalledWith('all');
    fireEvent.click(screen.getByRole('button', { name: 'Census 3' }));
    expect(props.setTypeFilter).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'State Archive 3' }));
    expect(props.setRepoId).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    expect(props.onAddRepository).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Manage repositories' }));
    expect(props.onManageRepositories).toHaveBeenCalledOnce();
  });

  it('hides Add repository from viewers but keeps Manage repositories', () => {
    renderPanel({ canEdit: false });

    expect(screen.queryByRole('button', { name: 'Add repository' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage repositories' })).toBeInTheDocument();
  });
});
