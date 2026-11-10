'use client';

import { useEffect, useState } from 'react';
import { getDataClient } from '@/lib/data';
import type { RepositoryWithCount } from '@/lib/data/types';

/**
 * The tree's repositories, for the Sources panel's Repository group and the picked
 * repository's header (#1154). `null` until the first load lands; a failed load
 * leaves the last list (the panel just offers fewer filters). Bump `refreshKey`
 * after a repository is added, edited or deleted.
 */
export function useRepositoryList(treeId: number | null, enabled: boolean, refreshKey: number): RepositoryWithCount[] | null {
  const [state, setState] = useState<{ key: string; repos: RepositoryWithCount[] } | null>(null);
  const scopeKey = String(treeId ?? 'default');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await getDataClient();
        const repos = await client.repositories.list(treeId);
        if (!cancelled) setState({ key: scopeKey, repos });
      } catch {
        // The panel works without repositories; the Manage dialog shows its own error.
      }
    })();
    return () => { cancelled = true; };
  }, [treeId, enabled, refreshKey, scopeKey]);

  return state?.key === scopeKey ? state.repos : null;
}
