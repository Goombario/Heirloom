'use client';

import { useEffect, useState } from 'react';
import { DATA_MODE } from '@/lib/data';

/**
 * `setting-up` while this browser's database is being created on a first visit,
 * then `ready`. `null` otherwise: the hosted build, the desktop app's later
 * launches, and every visit after the first, which open an existing database fast.
 */
export type DatabaseSetup = 'setting-up' | 'ready' | null;

export function useDatabaseSetup(): DatabaseSetup {
  const [state, setState] = useState<DatabaseSetup>(null);
  useEffect(() => {
    if (DATA_MODE !== 'local') return;
    let live = true;
    // Dynamic import, as in DbWarmup, keeps the PGlite module out of the hosted bundle.
    import('@/lib/db/connection.pglite')
      .then((mod) => mod.databaseSetup())
      .then(({ firstSetup, ready }) => {
        if (!live || !firstSetup) return;
        setState('setting-up');
        // A failed open is reported where the data is read; this only stops saying "setting up".
        ready.then(() => { if (live) setState('ready'); }, () => { if (live) setState(null); });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return state;
}
