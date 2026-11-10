'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { DATA_MODE, getDataClient } from '@/lib/data';

// Local-first static build is single-user with no auth/sharing. There is no
// `/api/users/me` to resolve an id from, so seed a stable non-null user id up
// front — the local data clients ignore the value (they resolve the real id via
// ensureLocalUser), it only needs to be non-null so user-gated read effects fire.
const LOCAL_OWNER_ID = 1;
const isLocal = DATA_MODE === 'local';

/** localStorage key persisting the active tree selection across sessions. */
const ACTIVE_TREE_STORAGE_KEY = 'heirloom.activeTree';

/** Synchronous read of the persisted selection (client only; null on SSR).
 *  Used as the useState initializer so the very first fetches already carry
 *  the restored tree — an async-only restore left a window where a fast
 *  write landed in the DEFAULT tree before validation finished. */
function readStoredTreeId(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_TREE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { treeId?: unknown };
    return typeof parsed?.treeId === 'number' && Number.isInteger(parsed.treeId) && parsed.treeId > 0
      ? parsed.treeId
      : null;
  } catch {
    return null;
  }
}

type TreePermission = 'owner' | 'edit' | 'contribute' | 'view';

export interface TreeSelection {
  treeId: number;
  permission: TreePermission;
  treeName?: string;
  ownerEmail?: string;
  ownerName?: string;
}

interface TreeContextType {
  /** Active tree, or null = "my default tree" (server resolves; mirrors old null = own tree). */
  activeTreeId: number | null;
  // The current user's permission level for the active tree
  activePermission: TreePermission | null;
  activeTreeName: string | null;
  activeOwnerEmail: string | null; // set only when viewing a shared tree
  activeOwnerName: string | null;
  // Current user's database ID
  currentUserId: number | null;
  // Switch to a specific tree (own non-default or shared)
  switchTree: (sel: TreeSelection) => void;
  // Switch back to the current user's default tree
  switchToDefaultTree: () => void;
}

const TreeContext = createContext<TreeContextType | undefined>(undefined);

interface TreeProviderProps {
  children: ReactNode;
}

export function TreeProvider({ children }: TreeProviderProps) {
  const { data: session } = useSession();
  const isDesktop = useDesktopMode();
  const [currentUserId, setCurrentUserId] = useState<number | null>(isLocal ? LOCAL_OWNER_ID : null);
  // null = "my default tree" in ALL modes (the server/services resolve it).
  // Seeded synchronously from localStorage — the validate effect below either
  // confirms it (fills name/permission) or clears it back to the default.
  const [activeTreeId, setActiveTreeId] = useState<number | null>(readStoredTreeId);
  const [activePermission, setActivePermission] = useState<TreePermission | null>(isLocal ? 'owner' : null);
  const [activeTreeName, setActiveTreeName] = useState<string | null>(null);
  const [activeOwnerEmail, setActiveOwnerEmail] = useState<string | null>(null);
  const [activeOwnerName, setActiveOwnerName] = useState<string | null>(null);

  // Resolve the current user's database ID when the session loads (or immediately
  // in desktop mode). Prefer the id seeded into the session token at sign-in (#12)
  // and fall back to /api/users/me for tokens minted before that change and for
  // desktop mode (which has no NextAuth session).
  useEffect(() => {
    const hasSession = !!session?.user?.email;
    if (!((hasSession || isDesktop) && currentUserId === null)) return;

    const sessionUserId = session?.user?.dbUserId;
    if (typeof sessionUserId === 'number') {
      // Fast path — no round-trip. (Synchronous state derivation from the session.)
      /* eslint-disable react-hooks/set-state-in-effect */
      setCurrentUserId(sessionUserId);
      setActivePermission('owner'); // default tree = own tree
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    fetch('/api/users/me')
      .then(res => res.json())
      .then(data => {
        if (data.user?.id) {
          setCurrentUserId(data.user.id);
          setActivePermission('owner'); // default tree = own tree
        }
      })
      .catch(err => console.error('Failed to fetch user:', err));
  }, [session, isDesktop, currentUserId]);

  // Validate the (synchronously seeded) persisted tree selection once the user
  // is resolved, via trees.get (works in both http and local modes); any
  // failure (deleted tree, revoked access, malformed JSON) clears the key AND
  // resets the optimistic seed back to the default tree. Ref-guarded so it
  // only ever attempts once per page load — and never re-writes localStorage
  // during restore.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (currentUserId === null || restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === 'undefined') return;

    const storedTreeId = readStoredTreeId();

    const clearSelection = () => {
      try { window.localStorage.removeItem(ACTIVE_TREE_STORAGE_KEY); } catch { /* storage unavailable */ }
      setActiveTreeId(null);
      setActivePermission('owner');
    };

    if (storedTreeId == null) {
      // Nothing valid persisted; also clears a malformed key.
      let raw: string | null = null;
      try { raw = window.localStorage.getItem(ACTIVE_TREE_STORAGE_KEY); } catch { /* storage unavailable */ }
      if (raw) clearSelection();
      return;
    }

    getDataClient()
      .then(client => client.trees.get(storedTreeId))
      .then(async ({ tree, permission }) => {
        // A restored SHARED tree needs the owner's identity for the banner
        // ("Viewing <owner>'s tree") — trees.get doesn't carry it, so hydrate
        // from the shared-with-me list. Best-effort: the banner falls back to
        // the tree name when this fails.
        let ownerEmail: string | null = null;
        let ownerName: string | null = null;
        if (permission !== 'owner' && !isLocal) {
          try {
            const res = await fetch('/api/sharing/with-me');
            if (res.ok) {
              const data = await res.json() as { shares?: Array<{ TreeId: number | null; owner: { Email: string; Name: string | null } | null }> };
              const share = (data.shares ?? []).find(s => s.TreeId === tree.Id);
              ownerEmail = share?.owner?.Email ?? null;
              ownerName = share?.owner?.Name ?? null;
            }
          } catch { /* keep nulls */ }
        }
        setActiveTreeId(tree.Id);
        setActivePermission(permission);
        setActiveTreeName(tree.Name);
        setActiveOwnerEmail(ownerEmail);
        setActiveOwnerName(ownerName);
      })
      .catch(clearSelection);
  }, [currentUserId]);

  const switchTree = useCallback((sel: TreeSelection) => {
    setActiveTreeId(sel.treeId);
    setActivePermission(sel.permission);
    setActiveTreeName(sel.treeName ?? null);
    setActiveOwnerEmail(sel.ownerEmail ?? null);
    setActiveOwnerName(sel.ownerName ?? null);
    try {
      window.localStorage.setItem(ACTIVE_TREE_STORAGE_KEY, JSON.stringify({ treeId: sel.treeId }));
    } catch { /* storage unavailable */ }
  }, []);

  const switchToDefaultTree = useCallback(() => {
    setActiveTreeId(null);
    setActivePermission('owner');
    setActiveTreeName(null);
    setActiveOwnerEmail(null);
    setActiveOwnerName(null);
    try {
      window.localStorage.removeItem(ACTIVE_TREE_STORAGE_KEY);
    } catch { /* storage unavailable */ }
  }, []);

  // Memoized so a TreeProvider re-render doesn't hand every consumer a new
  // context object (which would re-render all of them — e.g. every mounted
  // PersonNode reads this via useTree). Only rebuilds when a field changes.
  const value = useMemo<TreeContextType>(() => ({
    activeTreeId,
    activePermission,
    activeTreeName,
    activeOwnerEmail,
    activeOwnerName,
    currentUserId,
    switchTree,
    switchToDefaultTree,
  }), [activeTreeId, activePermission, activeTreeName, activeOwnerEmail, activeOwnerName, currentUserId, switchTree, switchToDefaultTree]);

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>;
}

/** The active tree's id, or null outside a TreeProvider, for a component that also renders on its own. */
export function useActiveTreeIdIfAny(): number | null {
  return useContext(TreeContext)?.activeTreeId ?? null;
}

export function useTree() {
  const context = useContext(TreeContext);
  if (context === undefined) {
    throw new Error('useTree must be used within a TreeProvider');
  }
  return context;
}
