'use client';

import { useEffect } from 'react';
import { DATA_MODE } from '@/lib/data';
import { isDesktopApp } from '@/lib/desktop';

declare global {
  interface Window {
    serwist?: { register: () => Promise<unknown> | void };
  }
}

/**
 * Static/local-first build only. Registers the precache service worker
 * manually (register: false in next.config.ts) so it can be skipped inside
 * the Tauri desktop build, which already loads the static export as bundled
 * local assets and doesn't need — or want — a competing cache layer.
 *
 * Scope: this only precaches the JS/CSS/HTML app shell (via serwist's
 * generated manifest in public/sw.js). PGlite's actual data lives in
 * IndexedDB, persisted separately (see DbWarmup.tsx, Task 2) — this
 * component has no bearing on that data layer.
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (DATA_MODE !== 'local') return;
    if (isDesktopApp()) return;
    if ('serviceWorker' in navigator && window.serwist !== undefined) {
      // Precaching is an optimization: a failed registration (unsupported
      // browser, insecure context, blocked chunk) must not surface as an
      // unhandled rejection. `register()` is an injected global typed as
      // possibly-void, so cover a synchronous throw as well as a rejection.
      try {
        Promise.resolve(window.serwist.register()).catch(() => {});
      } catch {
        /* registration unavailable — the app still works, just uncached */
      }
    }
  }, []);
  return null;
}
