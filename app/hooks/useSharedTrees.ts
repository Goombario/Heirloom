'use client';

import { useSyncExternalStore } from 'react';
import { DATA_MODE } from '@/lib/data';

/** One row per shared TREE (per-tree sharing) — mirrors GET /api/sharing/with-me. */
export interface SharedTree {
  Id: number;
  OwnerId: number;
  SharedWithId: number;
  /** The shared tree. Null only for pre-backfill legacy rows. */
  TreeId: number | null;
  Permission: 'view' | 'contribute' | 'edit';
  CreatedAt: string;
  TreeName: string | null;
  owner: { Id: number; Email: string; Name: string | null } | null;
}

let cache: SharedTree[] | null = null;
let cacheKey: string | null = null; // the user the cache belongs to
let inFlight = false;
let listeners: Array<() => void> = [];
const EMPTY: SharedTree[] = [];

function subscribe(l: () => void) { listeners.push(l); return () => { listeners = listeners.filter(x => x !== l); }; }
function notify() { for (const l of listeners) l(); }
function snapshot() { return cache ?? EMPTY; }
function serverSnapshot() { return EMPTY; }

function start(userKey: string | null) {
  if (typeof window === 'undefined' || DATA_MODE === 'local' || !userKey) return;
  // Already loaded or loading for this user — nothing to do.
  if (cacheKey === userKey && (cache !== null || inFlight)) return;
  // User changed (sign-out → sign-in as someone else in the same tab):
  // drop the previous user's data so we never serve it across identities.
  cacheKey = userKey;
  cache = null;
  inFlight = true;
  fetch('/api/sharing/with-me')
    .then(r => r.ok ? r.json() : { shares: [] })
    .then(d => { cache = d.shares || []; inFlight = false; notify(); })
    .catch(() => { cache = []; inFlight = false; notify(); });
}

/**
 * Returns shared trees (cached module-wide) for the given user.
 * Pass a stable per-user key (email/id) so the cache resets when the
 * signed-in user changes. Empty array in local/static build or when signed out.
 */
export function useSharedTrees(userKey?: string | null): SharedTree[] {
  start(userKey ?? null);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
