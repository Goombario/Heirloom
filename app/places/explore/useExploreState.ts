'use client';

// Owns the Explore view's navigation: current jurisdiction + selection, breadcrumb,
// children, and ID-based URL sync (?node=<id>&sel=<id>) via history.pushState —
// NOT router.push (same-path ?query changes no-op in the prod build after a hard load).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';

export interface ExploreState {
  /** Jurisdiction whose children the drill lists (null = root / "All places"). */
  currentNode: PlaceTreeNode | null;
  /** The place shown in the detail surface (null = empty "select a place" state). */
  selected: PlaceTreeNode | null;
  /** root → currentNode ancestor chain, for the breadcrumb. */
  crumbs: PlaceTreeNode[];
  /** currentNode's children, or the roots when currentNode is null. */
  children: PlaceTreeNode[];
  /** The whole tree, for global search. */
  roots: PlaceTreeNode[];
  /** Click a place: select it + (if it has children) drill into it + pushState. */
  select(node: PlaceTreeNode): void;
  /** Breadcrumb / back navigation to a node id (null = root). */
  goTo(nodeId: number | null): void;
  /** Pick a place from outside the list (the overview's quick picks): select it and
   *  open the list at its level, so its row shows as picked among its siblings. */
  reveal(node: PlaceTreeNode): void;
}

/** Depth-first lookup of a node by id (null id → null). */
export function findNodeById(roots: PlaceTreeNode[], id: number | null): PlaceTreeNode | null {
  if (id == null) return null;
  for (const r of roots) {
    if (r.id === id) return r;
    const found = findNodeById(r.children, id);
    if (found) return found;
  }
  return null;
}

/** The root→node path (inclusive) for the breadcrumb; empty for null / not found. */
export function ancestorsOf(roots: PlaceTreeNode[], id: number | null): PlaceTreeNode[] {
  if (id == null) return [];
  const path: PlaceTreeNode[] = [];
  const dfs = (nodes: PlaceTreeNode[]): boolean => {
    for (const node of nodes) {
      path.push(node);
      if (node.id === id) return true;
      if (dfs(node.children)) return true;
      path.pop();
    }
    return false;
  };
  dfs(roots);
  return path;
}

/** Pure select reducer: a parent drills in (currentNode = it); a leaf keeps the
 *  current level so its siblings stay listed. */
export function selectResult(
  node: PlaceTreeNode,
  prevCurrentId: number | null,
): { currentNodeId: number | null; selectedId: number | null } {
  return {
    selectedId: node.id,
    currentNodeId: node.children.length > 0 ? node.id : prevCurrentId,
  };
}

/** Where the list opens to show `id` picked: inside it when it has places within,
 *  otherwise at its parent's level (the root for a top-level place). */
export function levelFor(roots: PlaceTreeNode[], id: number | null): number | null {
  const path = ancestorsOf(roots, id);
  const node = path[path.length - 1];
  if (!node) return null;
  if (node.children.length > 0) return node.id;
  return path.length > 1 ? path[path.length - 2]!.id : null;
}

function readUrl(): { node: number | null; sel: number | null } {
  const p = new URLSearchParams(window.location.search);
  const num = (v: string | null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return { node: num(p.get('node')), sel: num(p.get('sel')) };
}

function pushUrl(nodeId: number | null, selId: number | null): void {
  const p = new URLSearchParams(window.location.search);
  if (nodeId != null) p.set('node', String(nodeId)); else p.delete('node');
  if (selId != null) p.set('sel', String(selId)); else p.delete('sel');
  const qs = p.toString();
  window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
}

export function useExploreState(roots: PlaceTreeNode[]): ExploreState {
  // Init from the URL via a lazy initializer (client-only — avoids the useSearchParams
  // Suspense requirement + the static-export CSR bailout). Hydration-safe: the Explore
  // content only renders after the client-side data fetch, so the server never paints a
  // param-driven state.
  // A link that names only the selection (the place page's "Full map": ?sel=<id>) opens
  // the list at that place's level, so its row shows as picked.
  const [currentNodeId, setCurrentNodeId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const { node, sel } = readUrl();
    return node ?? levelFor(roots, sel);
  });
  const [selectedId, setSelectedId] = useState<number | null>(
    () => (typeof window === 'undefined' ? null : readUrl().sel),
  );
  // Latest committed currentNodeId, for the `select` click handler (a leaf keeps the
  // current level). Synced in an effect — never written during render.
  const currentRef = useRef<number | null>(null);
  useEffect(() => { currentRef.current = currentNodeId; }, [currentNodeId]);

  // Restore on browser back/forward.
  useEffect(() => {
    const onPop = () => {
      const { node, sel } = readUrl();
      setCurrentNodeId(node);
      setSelectedId(sel);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const select = useCallback((node: PlaceTreeNode) => {
    const { currentNodeId: nextCur, selectedId: nextSel } = selectResult(node, currentRef.current);
    setSelectedId(nextSel);
    setCurrentNodeId(nextCur);
    pushUrl(nextCur, nextSel);
  }, []);

  const goTo = useCallback((nodeId: number | null) => {
    setCurrentNodeId(nodeId);
    setSelectedId(nodeId);
    pushUrl(nodeId, nodeId);
  }, []);

  const reveal = useCallback((node: PlaceTreeNode) => {
    const nextCur = levelFor(roots, node.id);
    setSelectedId(node.id);
    setCurrentNodeId(nextCur);
    pushUrl(nextCur, node.id);
  }, [roots]);

  const currentNode = useMemo(() => findNodeById(roots, currentNodeId), [roots, currentNodeId]);
  const selected = useMemo(() => findNodeById(roots, selectedId), [roots, selectedId]);
  const crumbs = useMemo(() => ancestorsOf(roots, currentNodeId), [roots, currentNodeId]);
  const children = currentNode ? currentNode.children : roots;

  return { currentNode, selected, crumbs, children, roots, select, goTo, reveal };
}
