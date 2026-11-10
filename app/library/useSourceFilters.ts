'use client';

import { useCallback, useMemo, useState } from 'react';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';

/** The Show filter: every source, or only those no fact cites yet (#1154). */
export type SourceShow = 'all' | 'uncited';

interface SourceTabCounts {
  sources: number;
  uncited: number;
}

export interface UseSourceFiltersResult {
  search: string;
  setSearch: (value: string) => void;
  typeFilter: string | null;
  setTypeFilter: (value: string | null) => void;
  repoFilter: string | null;
  setRepoFilter: (value: string | null) => void;
  clearFilters: () => void;
  typeCounts: Map<string, number>;
  repositories: [string, number][];
  filteredSources: SourceWithCitationCount[];
  tabCounts: SourceTabCounts;
  activeFilterCount: number;
}

/**
 * Owns source search and source-specific filters. Photo search and URL/tab
 * navigation deliberately live in separate hooks so each view keeps its state.
 */
export function useSourceFilters(
  sources: SourceWithCitationCount[],
  show: SourceShow = 'all',
): UseSourceFiltersResult {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState<string | null>(null);

  const clearFilters = useCallback(() => {
    setSearch('');
    setTypeFilter(null);
    setRepoFilter(null);
  }, []);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const source of sources) {
      const type = source.Type ?? 'Other';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return counts;
  }, [sources]);

  const repositories = useMemo(() => {
    const counts = new Map<string, number>();

    for (const source of sources) {
      if (source.RepositoryName) {
        counts.set(source.RepositoryName, (counts.get(source.RepositoryName) ?? 0) + 1);
      }
    }

    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [sources]);

  const filteredSources = useMemo(() => {
    const tabSources = show === 'uncited'
      ? sources.filter(source => source.citationCount === 0)
      : sources;

    const query = search.trim().toLocaleLowerCase();

    return tabSources.filter(source => {
      if (typeFilter && (source.Type ?? 'Other') !== typeFilter) {
        return false;
      }

      if (repoFilter && source.RepositoryName !== repoFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [source.Title, source.Author, source.RepositoryName, source.Contents]
        .some(value => (value ?? '').toLocaleLowerCase().includes(query));
    });
  }, [show, repoFilter, search, sources, typeFilter]);

  const tabCounts: SourceTabCounts = {
    sources: sources.length,
    uncited: sources.filter(source => source.citationCount === 0).length,
  };

  const activeFilterCount = (search.trim() ? 1 : 0) + (typeFilter ? 1 : 0) + (repoFilter ? 1 : 0);

  return {
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
    repoFilter,
    setRepoFilter,
    clearFilters,
    typeCounts,
    repositories,
    filteredSources,
    tabCounts,
    activeFilterCount,
  };
}
