'use client';

import { useEffect } from 'react';
import { DATA_MODE } from '@/lib/data';

/**
 * Static/local-first build only. Kicks off PGlite's worker+WASM+schema-init
 * boot as soon as the app shell mounts, instead of waiting for the first
 * page's own data-fetch effect to trigger it — moving a ~2.6-2.8s one-time
 * cost (measured on a fresh browser profile) to run in parallel with shell
 * render/hydration rather than after it.
 *
 * Dynamic import (not a static one) so the PGlite/WASM-adjacent module never
 * enters the hosted build's bundle graph at all — this component is mounted
 * unconditionally in the shared root layout, so a static top-level import
 * here would ship to hosted too.
 */
export default function DbWarmup() {
  useEffect(() => {
    if (DATA_MODE !== 'local') return;
    // Warming is an optimization: if the chunk fails to load, the real data path
    // still boots the DB on demand, so swallow rather than surface an unhandled
    // rejection.
    import('@/lib/db/connection.pglite')
      .then((mod) => mod.warmDb())
      .catch(() => {});
  }, []);
  return null;
}
