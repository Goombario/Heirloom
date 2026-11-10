'use client';

import { useCallback, useMemo, useState } from 'react';
import type { MediaWithPerson } from '@/lib/db/schema';
import { isPdfMedia } from '@/lib/media/allowed-extensions';

export type PhotoTagFilter = 'all' | 'tagged' | 'untagged';
/** Photos and PDF documents share the Media tab (#510); Type narrows it to one. */
export type MediaTypeFilter = 'all' | 'photos' | 'documents';
export type PhotoSort = 'recent' | 'title-asc' | 'title-desc' | 'size-desc';

interface UsePhotoFiltersResult {
  tagFilter: PhotoTagFilter;
  setTagFilter: (filter: PhotoTagFilter) => void;
  sort: PhotoSort;
  setSort: (sort: PhotoSort) => void;
  visiblePhotos: MediaWithPerson[];
  /** Pure presentation counts for the contextual photo filter rail. */
  photoCounts: PhotoFilterCounts;
  activeFilterCount: number;
  clearPhotoFilters: () => void;
  typeFilter: MediaTypeFilter;
  setTypeFilter: (filter: MediaTypeFilter) => void;
}

export interface PhotoFilterCounts {
  total: number;
  visible: number;
  tagged: number;
  untagged: number;
  photos: number;
  documents: number;
}

/** A photo is tagged when it names a face; a document, which has none, when it is linked to someone. */
function isTagged(photo: MediaWithPerson): boolean {
  if (isPdfMedia(photo)) return (photo.LinkedPersonCount ?? 0) > 0;
  return (photo.TaggedPersonNames?.length ?? 0) > 0;
}

function matchesSearch(photo: MediaWithPerson, query: string): boolean {
  if (!query) {
    return true;
  }

  const ownerName = `${photo.PersonFirstName ?? ''} ${photo.PersonLastName ?? ''}`;
  const searchableValues = [photo.Title ?? '', ownerName, ...(photo.TaggedPersonNames ?? []), ...(photo.LinkedPersonNames ?? [])];

  return searchableValues.some(value => value.toLocaleLowerCase().includes(query));
}

export function usePhotoFilters(
  photos: MediaWithPerson[],
  search: string,
): UsePhotoFiltersResult {
  const [tagFilter, setTagFilter] = useState<PhotoTagFilter>('all');
  const [sort, setSort] = useState<PhotoSort>('recent');
  const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>('all');

  const visiblePhotos = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    let visible = photos.filter(photo => matchesSearch(photo, query));

    if (typeFilter !== 'all') {
      visible = visible.filter(photo => isPdfMedia(photo) === (typeFilter === 'documents'));
    }

    if (tagFilter !== 'all') {
      visible = visible.filter(photo => tagFilter === 'tagged' ? isTagged(photo) : !isTagged(photo));
    }

    return [...visible].sort((left, right) => {
      if (sort === 'recent') {
        return right.Id - left.Id;
      }

      if (sort === 'size-desc') {
        const leftSize = left.FileSize != null && left.FileSize > 0 ? left.FileSize : null;
        const rightSize = right.FileSize != null && right.FileSize > 0 ? right.FileSize : null;
        if (leftSize === null && rightSize !== null) return 1;
        if (leftSize !== null && rightSize === null) return -1;
        if (leftSize !== null && rightSize !== null && leftSize !== rightSize) {
          return rightSize - leftSize;
        }
        return right.Id - left.Id;
      }

      const titleComparison = (left.Title ?? '').localeCompare(right.Title ?? '');
      if (titleComparison !== 0) {
        return sort === 'title-desc' ? -titleComparison : titleComparison;
      }

      return right.Id - left.Id;
    });
  }, [photos, search, sort, tagFilter, typeFilter]);

  const photoCounts = useMemo<PhotoFilterCounts>(() => {
    const tagged = photos.reduce((count, photo) => count + (isTagged(photo) ? 1 : 0), 0);
    const documents = photos.reduce((count, photo) => count + (isPdfMedia(photo) ? 1 : 0), 0);
    return {
      total: photos.length,
      visible: visiblePhotos.length,
      tagged,
      untagged: photos.length - tagged,
      photos: photos.length - documents,
      documents,
    };
  }, [photos, visiblePhotos]);

  const clearPhotoFilters = useCallback(() => {
    setTagFilter('all');
    setTypeFilter('all');
  }, []);

  const activeFilterCount = (tagFilter === 'all' ? 0 : 1) + (typeFilter === 'all' ? 0 : 1);

  return {
    tagFilter,
    setTagFilter,
    sort,
    setSort,
    visiblePhotos,
    photoCounts,
    activeFilterCount,
    clearPhotoFilters,
    typeFilter,
    setTypeFilter,
  };
}
