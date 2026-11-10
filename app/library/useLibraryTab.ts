'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const LIBRARY_TABS = ['sources', 'photos', 'repositories', 'uncited', 'faces'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

/** The desktop Library's three tabs. Repositories and Uncited are Sources filters
 *  there (#1154), so their old `?tab=` values land on Sources; phones still give
 *  Manage repositories its own page. */
export type LibraryView = 'sources' | 'photos' | 'faces';

export function libraryView(tab: LibraryTab): LibraryView {
  return tab === 'repositories' || tab === 'uncited' ? 'sources' : tab;
}

export function useLibraryTab(): { tab: LibraryTab; setTab: (tab: LibraryTab) => void } {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = useMemo<LibraryTab>(() => {
    const value = searchParams.get('tab');
    // Photos is the tab people use most, so a bare /library opens it (#1157).
    return LIBRARY_TABS.includes(value as LibraryTab) ? (value as LibraryTab) : 'photos';
  }, [searchParams]);
  const setTab = useCallback((next: LibraryTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'photos') params.delete('tab');
    else params.set('tab', next);
    const query = params.toString();
    router.push(query ? `/library?${query}` : '/library', { scroll: false });
  }, [router, searchParams]);

  return { tab: tabFromUrl, setTab };
}
