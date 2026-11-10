/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MediaWithPerson } from '@/lib/db/schema';
import { usePhotoFilters } from '@/app/library/usePhotoFilters';

function makePhoto(overrides: Partial<MediaWithPerson> = {}): MediaWithPerson {
  return {
    Id: 1,
    UserId: 7,
    Title: 'Family photo',
    FilePath: 'uploads/family.jpg',
    Format: 'jpeg',
    ContentType: 'image/jpeg',
    PersonFirstName: null,
    PersonLastName: null,
    TaggedPersonNames: [],
    ...overrides,
  };
}

const PHOTOS: MediaWithPerson[] = [
  makePhoto({ Id: 10, Title: 'Portrait', PersonFirstName: 'Jane', PersonLastName: 'Doe' }),
  makePhoto({ Id: 11, Title: 'Wedding', TaggedPersonNames: ['Clara Thornbury'] }),
  makePhoto({ Id: 12, Title: 'Garden', TaggedPersonNames: ['Bob Smith'] }),
];

describe('usePhotoFilters search derivation', () => {
  it('returns every photo for an empty search', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([12, 11, 10]);
  });

  it('searches photo titles', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, 'portrait'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([10]);
  });

  it('searches the joined legacy owner name', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, 'jane doe'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([10]);
  });

  it('searches names in TaggedPersonNames', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, 'clara thornbury'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([11]);
  });
});

describe('usePhotoFilters tag membership', () => {
  it('includes all photos for the All tag filter', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => result.current.setTagFilter('all'));

    expect(result.current.visiblePhotos).toHaveLength(3);
  });

  it('includes only photos with tagged people for Tagged', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => result.current.setTagFilter('tagged'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([12, 11]);
  });

  it('includes only photos without tagged people for Untagged', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => result.current.setTagFilter('untagged'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([10]);
  });

  it('does not treat a legacy owner name as a tag', () => {
    const photos = [makePhoto({ Id: 20, PersonFirstName: 'Owner', PersonLastName: 'Name' })];
    const { result } = renderHook(() => usePhotoFilters(photos, ''));

    act(() => result.current.setTagFilter('tagged'));

    expect(result.current.visiblePhotos).toEqual([]);
  });
});

describe('usePhotoFilters sorting', () => {
  it('sorts Recent by descending Id', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([12, 11, 10]);
  });

  it('sorts titles ascending with locale-aware comparison', () => {
    const photos = [makePhoto({ Id: 1, Title: 'Éclair' }), makePhoto({ Id: 2, Title: 'Apple' })];
    const { result } = renderHook(() => usePhotoFilters(photos, ''));

    act(() => result.current.setSort('title-asc'));

    const expected = [...photos]
      .sort((a, b) => (a.Title ?? '').localeCompare(b.Title ?? ''))
      .map(photo => photo.Id);
    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual(expected);
  });

  it('sorts titles descending with locale-aware comparison', () => {
    const photos = [makePhoto({ Id: 1, Title: 'Alpha' }), makePhoto({ Id: 2, Title: 'Zulu' })];
    const { result } = renderHook(() => usePhotoFilters(photos, ''));

    act(() => result.current.setSort('title-desc'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([2, 1]);
  });

  it('sorts largest first, puts unknown sizes last, and breaks size ties by Id', () => {
    const photos = [
      makePhoto({ Id: 4, FileSize: 1024 }),
      makePhoto({ Id: 9, FileSize: 1024 }),
      makePhoto({ Id: 2, FileSize: 2048 }),
      makePhoto({ Id: 7, FileSize: 0 }),
      makePhoto({ Id: 8, FileSize: undefined }),
    ];
    const { result } = renderHook(() => usePhotoFilters(photos, ''));

    act(() => result.current.setSort('size-desc'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([2, 9, 4, 8, 7]);
  });

  it('uses Id as a deterministic title tie-breaker', () => {
    const photos = [makePhoto({ Id: 4, Title: 'Same' }), makePhoto({ Id: 9, Title: 'Same' })];
    const { result } = renderHook(() => usePhotoFilters(photos, ''));

    act(() => result.current.setSort('title-asc'));

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([9, 4]);
  });

  it('filters membership before sorting the visible rows', () => {
    const photos = [
      makePhoto({ Id: 1, Title: 'Zulu', TaggedPersonNames: [] }),
      makePhoto({ Id: 8, Title: 'Alpha', TaggedPersonNames: ['Tagged'] }),
      makePhoto({ Id: 3, Title: 'Beta', TaggedPersonNames: ['Tagged'] }),
    ];
    const { result } = renderHook(() => usePhotoFilters(photos, ''));

    act(() => {
      result.current.setTagFilter('tagged');
      result.current.setSort('title-asc');
    });

    expect(result.current.visiblePhotos.map(photo => photo.Id)).toEqual([8, 3]);
  });

  it('does not mutate the input array while deriving results', () => {
    const photos = [makePhoto({ Id: 2 }), makePhoto({ Id: 1 })];
    const original = [...photos];

    renderHook(() => usePhotoFilters(photos, ''));

    expect(photos).toEqual(original);
  });
});

describe('usePhotoFilters active filter state', () => {
  it('derives total, visible, tagged, and untagged presentation counts', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    expect(result.current.photoCounts).toEqual({ total: 3, visible: 3, tagged: 2, untagged: 1, photos: 3, documents: 0 });

    act(() => result.current.setTagFilter('tagged'));
    expect(result.current.photoCounts).toEqual({ total: 3, visible: 2, tagged: 2, untagged: 1, photos: 3, documents: 0 });
  });

  it('narrows to documents, which count as tagged when linked to someone (#510)', () => {
    const docs = [
      ...PHOTOS,
      makePhoto({ Id: 20, Title: 'Birth register', ContentType: 'application/pdf', LinkedPersonCount: 1, LinkedPersonNames: ['Ann Arbor'] }),
      makePhoto({ Id: 21, Title: 'Will', ContentType: 'application/pdf', LinkedPersonCount: 0 }),
    ];
    const { result } = renderHook(() => usePhotoFilters(docs, 'arbor'));
    // Search reaches the people a document is linked to.
    expect(result.current.visiblePhotos.map((p) => p.Id)).toEqual([20]);

    const all = renderHook(() => usePhotoFilters(docs, ''));
    expect(all.result.current.photoCounts).toMatchObject({ photos: 3, documents: 2, tagged: 3, untagged: 2 });
    act(() => all.result.current.setTypeFilter('documents'));
    expect(all.result.current.visiblePhotos.map((p) => p.Id)).toEqual([21, 20]);
    act(() => all.result.current.setTagFilter('untagged'));
    expect(all.result.current.visiblePhotos.map((p) => p.Id)).toEqual([21]);
    expect(all.result.current.activeFilterCount).toBe(2);
    act(() => all.result.current.clearPhotoFilters());
    expect(all.result.current.typeFilter).toBe('all');
  });

  it('excludes text search from activeFilterCount', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, 'portrait'));

    expect(result.current.activeFilterCount).toBe(0);
  });

  it('counts a non-default tag filter', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => result.current.setTagFilter('untagged'));

    expect(result.current.activeFilterCount).toBe(1);
  });

  it('does not count a non-default sort as an active filter', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => result.current.setSort('title-desc'));

    expect(result.current.activeFilterCount).toBe(0);
  });

  it('counts only the non-default tag when tag and sort are both changed', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => {
      result.current.setTagFilter('tagged');
      result.current.setSort('title-asc');
    });

    expect(result.current.activeFilterCount).toBe(1);
  });

  it('clearPhotoFilters restores the tag filter without resetting sort', () => {
    const { result } = renderHook(() => usePhotoFilters(PHOTOS, ''));

    act(() => {
      result.current.setTagFilter('tagged');
      result.current.setSort('title-desc');
      result.current.clearPhotoFilters();
    });

    expect(result.current.tagFilter).toBe('all');
    expect(result.current.sort).toBe('title-desc');
    expect(result.current.activeFilterCount).toBe(0);
  });
});
