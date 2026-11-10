'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { DATA_MODE } from '@/lib/data';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';

// Module-level cache shared by every menu (same idiom as useMyTrees): one
// /api/members/me per page load. A user change is a full page load here.
let cache: boolean | null = null;
let inFlight = false;
let listeners: Array<() => void> = [];

function subscribe(l: () => void) { listeners.push(l); return () => { listeners = listeners.filter(x => x !== l); }; }
function snapshot() { return cache; }
function serverSnapshot() { return null; }

function load() {
  if (cache !== null || inFlight) return;
  inFlight = true;
  fetch('/api/members/me')
    .then(res => (res.ok ? res.json() : { isAdmin: false }))
    .then((data: { isAdmin?: boolean }) => { cache = data.isAdmin === true; })
    .catch(() => { cache = false; })
    .finally(() => {
      inFlight = false;
      for (const l of listeners) l();
    });
}

/**
 * True when the signed-in person is an active admin of this hosted instance (ADR
 * 0029), so the menus offer Members. Always false in the static and desktop builds,
 * which have no membership. Only hides the way in: every members route re-checks.
 */
export function useMembersAdmin(): boolean {
  const { status } = useSession();
  const isDesktop = useDesktopMode();
  const hosted = DATA_MODE !== 'local' && !isDesktop;
  const signedIn = hosted && status === 'authenticated';
  useEffect(() => { if (signedIn) load(); }, [signedIn]);
  const isAdmin = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return signedIn && isAdmin === true;
}
