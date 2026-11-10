/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';
import { useSourceFilters } from '@/app/library/useSourceFilters';

function makeSource(overrides: Partial<SourceWithCitationCount> = {}): SourceWithCitationCount {
  return {
    Id: 1,
    OwnerId: 99,
    Title: 'A Source',
    Author: null,
    PublicationInfo: null,
    RepositoryName: null,
    CallNumber: null,
    Text: null,
    Type: 'Census',
    Contents: null,
    Num: null,
    citationCount: 1,
    citedByPeople: [],
    ...overrides,
  };
}

const SOURCES: SourceWithCitationCount[] = [
  makeSource({ Id: 1, Type: 'Census', Title: 'Census 1880', citationCount: 2, RepositoryName: 'State Archive' }),
  makeSource({ Id: 2, Type: 'Census', Title: 'Census 1900', citationCount: 0, RepositoryName: 'County Archive' }),
  makeSource({ Id: 3, Type: 'Document', Title: 'Birth Certificate', citationCount: 1, Author: 'Registry Office', RepositoryName: 'State Archive' }),
  makeSource({ Id: 4, Type: 'Church', Title: 'Baptism Record', citationCount: 3 }),
  makeSource({ Id: 5, Type: 'Oral', Title: 'Family Story', citationCount: 0, Author: 'Grandmother' }),
];

describe('useSourceFilters type counts', () => {
  it('tallies sources by Type', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    expect(result.current.typeCounts).toEqual(new Map([
      ['Census', 2],
      ['Document', 1],
      ['Church', 1],
      ['Oral', 1],
    ]));
  });

  it('assigns null Type to the Other bucket', () => {
    const { result } = renderHook(() => useSourceFilters([makeSource({ Type: null })]));

    expect(result.current.typeCounts.get('Other')).toBe(1);
  });

  it('returns an empty map for an empty source list', () => {
    const { result } = renderHook(() => useSourceFilters([]));

    expect(result.current.typeCounts.size).toBe(0);
  });
});

describe('useSourceFilters repository counts', () => {
  it('derives unique repositories with source counts sorted alphabetically', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    expect(result.current.repositories).toEqual([
      ['County Archive', 1],
      ['State Archive', 2],
    ]);
  });

  it('excludes sources without a repository name', () => {
    const { result } = renderHook(() => useSourceFilters([
      makeSource({ RepositoryName: null }),
      makeSource({ Id: 2, RepositoryName: 'Archive A' }),
    ]));

    expect(result.current.repositories).toEqual([['Archive A', 1]]);
  });

  it('returns no repositories for an empty source list', () => {
    const { result } = renderHook(() => useSourceFilters([]));

    expect(result.current.repositories).toEqual([]);
  });
});

describe('useSourceFilters Show filter', () => {
  it('returns all sources when showing all', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES, 'all'));

    expect(result.current.filteredSources).toHaveLength(5);
  });

  it('returns only uncited sources when showing Uncited', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES, 'uncited'));

    expect(result.current.filteredSources.map(source => source.Id)).toEqual([2, 5]);
  });
});

describe('useSourceFilters source filters', () => {
  it('filters by source type', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    act(() => result.current.setTypeFilter('Document'));

    expect(result.current.filteredSources.map(source => source.Id)).toEqual([3]);
  });

  it('filters by repository', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    act(() => result.current.setRepoFilter('State Archive'));

    expect(result.current.filteredSources.map(source => source.Id)).toEqual([1, 3]);
  });

  it('searches title, author, repository, and contents', () => {
    const sources = [
      makeSource({ Id: 1, Title: 'Title match' }),
      makeSource({ Id: 2, Author: 'Author match' }),
      makeSource({ Id: 3, RepositoryName: 'Repository match' }),
      makeSource({ Id: 4, Contents: 'Contents match' }),
    ];
    const { result } = renderHook(() => useSourceFilters(sources));

    act(() => result.current.setSearch('match'));

    expect(result.current.filteredSources.map(source => source.Id)).toEqual([1, 2, 3, 4]);
  });

  it('combines Show, type, repository, and search filters', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES, 'uncited'));

    act(() => {
      result.current.setTypeFilter('Census');
      result.current.setRepoFilter('County Archive');
      result.current.setSearch('1900');
    });

    expect(result.current.filteredSources.map(source => source.Id)).toEqual([2]);
  });

  it('matches search case-insensitively', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    act(() => result.current.setSearch('CENSUS'));

    expect(result.current.filteredSources.map(source => source.Id)).toEqual([1, 2]);
  });
});

describe('useSourceFilters counts and clearing', () => {
  it('reports source and uncited counts', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    expect(result.current.tabCounts).toEqual({ sources: 5, uncited: 2 });
  });

  it('counts active source search and filters', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES));

    act(() => {
      result.current.setTypeFilter('Census');
      result.current.setRepoFilter('State Archive');
      result.current.setSearch('1880');
    });

    expect(result.current.activeFilterCount).toBe(3);
  });

  it('clearFilters restores source defaults', () => {
    const { result } = renderHook(() => useSourceFilters(SOURCES, 'uncited'));

    act(() => {
      result.current.setTypeFilter('Census');
      result.current.setRepoFilter('State Archive');
      result.current.setSearch('test');
      result.current.clearFilters();
    });

    expect(result.current.search).toBe('');
    expect(result.current.typeFilter).toBeNull();
    expect(result.current.repoFilter).toBeNull();
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.filteredSources.map(source => source.Id)).toEqual([2, 5]);
  });
});
