'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DATA_MODE } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';

// Five parts of the app shell ask on every navigation, each with its own query
// (#1269). They share one check now, and a yes is kept until the next write:
// only a write can remove the last person, and a restore reloads the page. A
// no is never kept, so the first person or an import still shows up on the
// next navigation, as before.
let shared: { generation: number; result: Promise<boolean> } | null = null;

function checkHasData(): Promise<boolean> {
  const generation = dataCache.generation();
  if (shared && shared.generation === generation && !dataCache.writing()) return shared.result;
  const result = import('@/lib/db/connection.pglite').then((db) => db.hasBackupWorthyData());
  const entry = { generation, result };
  shared = entry;
  const forget = () => { if (shared === entry) shared = null; };
  // Overlapping callers share a pending check; once settled, only a yes stays.
  result.then((value) => { if (!value) forget(); }, forget);
  return result;
}

/** TEST ONLY: forget the shared check. */
export function __resetLocalHasData(): void {
  shared = null;
}

/**
 * Whether the local database holds a person yet (#938), or
 * `null` until the first check finishes. Re-checked on every navigation, which
 * is how the first person or an import shows up (each ends on another page).
 * Always `null` outside the local build. PGlite is imported on demand so the
 * hosted bundle, which mounts the same nav, never loads it.
 */
export function useLocalHasData(): boolean | null {
  const pathname = usePathname();
  const [hasData, setHasData] = useState<boolean | null>(null);

  useEffect(() => {
    if (DATA_MODE !== 'local') return;
    let cancelled = false;
    checkHasData()
      // A failed check keeps the warnings, as before #938, rather than hiding them.
      .then((value) => { if (!cancelled) setHasData(value); }, () => { if (!cancelled) setHasData(true); });
    return () => { cancelled = true; };
  }, [pathname]);

  return hasData;
}
