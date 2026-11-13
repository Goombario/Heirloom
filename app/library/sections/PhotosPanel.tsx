'use client';

import { useTranslations } from 'next-intl';
import type { MediaTypeFilter, PhotoFilterCounts, PhotoTagFilter } from '@/app/library/usePhotoFilters';
import LibraryPanel, { LibraryPanelGroup, LibraryPanelRow } from './LibraryPanel';
import MediaStorageCard, { type MediaStorageCardProps } from './MediaStorageCard';

/**
 * The Media tab's floating panel (#1155): Show (All, Tagged, Untagged with counts,
 * Untagged in amber), Type (Photos, Documents; #510), then the Media storage
 * meter with Review largest files.
 */
export default function PhotosPanel({
  tagFilter,
  setTagFilter,
  typeFilter,
  setTypeFilter,
  photoCounts,
  storage,
}: {
  tagFilter: PhotoTagFilter;
  setTagFilter: (filter: PhotoTagFilter) => void;
  typeFilter: MediaTypeFilter;
  setTypeFilter: (filter: MediaTypeFilter) => void;
  photoCounts: PhotoFilterCounts;
  storage: MediaStorageCardProps;
}) {
  const t = useTranslations('library');
  return (
    <LibraryPanel label={t('filter_photos_title')} testId="library-photos-panel">
      <LibraryPanelGroup title={t('show_label')}>
        <LibraryPanelRow label={t('show_all_photos')} count={photoCounts.total} active={tagFilter === 'all'} onClick={() => setTagFilter('all')} />
        <LibraryPanelRow
          label={t('photo_filter_tagged')}
          count={photoCounts.tagged}
          active={tagFilter === 'tagged'}
          onClick={() => setTagFilter(tagFilter === 'tagged' ? 'all' : 'tagged')}
        />
        <LibraryPanelRow
          label={t('photo_filter_untagged')}
          count={photoCounts.untagged}
          warn
          active={tagFilter === 'untagged'}
          onClick={() => setTagFilter(tagFilter === 'untagged' ? 'all' : 'untagged')}
        />
      </LibraryPanelGroup>
      <LibraryPanelGroup title={t('filter_type')}>
        <LibraryPanelRow
          label={t('media_type_photos')}
          count={photoCounts.photos}
          active={typeFilter === 'photos'}
          onClick={() => setTypeFilter(typeFilter === 'photos' ? 'all' : 'photos')}
        />
        <LibraryPanelRow
          label={t('media_type_documents')}
          count={photoCounts.documents}
          active={typeFilter === 'documents'}
          onClick={() => setTypeFilter(typeFilter === 'documents' ? 'all' : 'documents')}
        />
      </LibraryPanelGroup>
      <div className="mt-3 border-t border-border px-2 pt-3">
        <MediaStorageCard {...storage} />
      </div>
    </LibraryPanel>
  );
}
