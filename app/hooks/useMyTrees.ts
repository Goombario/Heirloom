'use client';

import { useSyncExternalStore } from 'react';
import { getDataClient } from '@/lib/data';
import { useTree } from '@/app/contexts/TreeContext';
import type { Tree } from '@/lib/db/schema';

// Module-level cache shared by every subscriber (same idiom as useSharedTrees),
// backed by data.trees.list() so it works in both http and local modes. The
// list is per-signed-in-user but the cache key is a constant: a user change is
// a full page load in this app (sign-out navigates away), so the cache dies
// with the page.
let cache: Tree[] | null = null;
let inFlight: Promise<void> | null = null;
let listeners: Array<() => void> = [];
const EMPTY: Tree[] = [];

function subscribe(l: () => void) { listeners.push(l); return () => { listeners = listeners.filter(x => x !== l); }; }
function notify() { for (const l of listeners) l(); }
function snapshot() { return cache ?? EMPTY; }
function serverSnapshot() { return EMPTY; }

function load(): Promise<void> {
  const p: Promise<void> = (async () => {
    try {
      const client = await getDataClient();
      const res = await client.trees.list();
      cache = res.trees;
    } catch {
      // Keep any previously loaded list; only settle to empty on first failure.
      if (cache === null) cache = [];
    }
  })().finally(() => {
    if (inFlight === p) inFlight = null;
    notify();
  });
  inFlight = p;
  return p;
}

function start() {
  if (typeof window === 'undefined') return;
  if (cache !== null || inFlight) return;
  load();
}

/**
 * Force-refetches the tree list and notifies every subscribed component.
 * Call after trees.create/rename/remove so all mounted useMyTrees consumers
 * update. Safe to call outside React.
 */
function refreshMyTrees(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return load();
}

/**
 * Returns the current user's trees (cached module-wide). Works in local mode
 * too — the local client lists the single local user's trees. Pass
 * `enabled: false` to defer the initial fetch (e.g. until a menu opens).
 */
export function useMyTrees(enabled: boolean = true): { trees: Tree[]; refresh: () => Promise<void> } {
  // Signed out there is no user to list trees for, and the request would only
  // answer 401 (#933). TreeContext knows the user once there is a session, in
  // desktop mode, or locally.
  const { currentUserId } = useTree();
  if (enabled && currentUserId !== null) start();
  const trees = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { trees, refresh: refreshMyTrees };
}
