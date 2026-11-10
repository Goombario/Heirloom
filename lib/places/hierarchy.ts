import type { PlaceSummary, PlaceGazetteerNode, PlaceFace } from '@/lib/data/types';
import { foldForSearch } from '@/lib/utils/search-fold';

export type PinState = 'own' | 'inherited' | 'none';

/** True when a folded query is in the place's name or any of its other names (#1167). */
export function placeNameMatches(name: string, otherNames: string[] | undefined, foldedQuery: string): boolean {
  return [name, ...(otherNames ?? [])].some((n) => foldForSearch(n).includes(foldedQuery));
}

export interface PlaceTreeNode {
  id: number | null;
  name: string;
  /** The place's other names (#1167); search matches them too. */
  otherNames?: string[];
  parentId: number | null;
  ownCount: number;
  rolledCount: number;
  peopleCount: number;
  faces: PlaceFace[];
  latitude: number | null;
  longitude: number | null;
  pinSuppressed: boolean;
  pinState: PinState;
  children: PlaceTreeNode[];
}

export interface PlaceGroup {
  root: PlaceTreeNode;
  places: PlaceSummary[];
  rolledCount: number;
}

// Record count leads; a geocoded place then wins the TIEBREAK over an ungeocoded one of
// equal weight, before falling back to the name (#570). Deliberately not the primary key:
// promoting coordinates above records would put a one-record hamlet above a twelve-record
// country, and the count is what says which places the tree is actually about.
const geocoded = (n: PlaceTreeNode) => (n.latitude != null && n.longitude != null ? 0 : 1);
const bySort = (a: PlaceTreeNode, b: PlaceTreeNode) =>
  b.rolledCount - a.rolledCount || geocoded(a) - geocoded(b) || a.name.localeCompare(b.name);

/** Walk up parentId; return true if a cycle is detected (so the node is rooted). */
function inCycle(node: PlaceTreeNode, byId: Map<number, PlaceTreeNode>): boolean {
  if (node.id == null) return false;
  const seen = new Set<number>([node.id]);
  let pid = node.parentId;
  while (pid != null) {
    if (seen.has(pid)) return true;
    seen.add(pid);
    const parent = byId.get(pid);
    if (!parent) return false;
    pid = parent.parentId;
  }
  return false;
}

export function buildPlaceTree(places: PlaceSummary[], gazetteer: PlaceGazetteerNode[]): PlaceTreeNode[] {
  const byId = new Map<number, PlaceTreeNode>();
  for (const g of gazetteer) {
    byId.set(g.id, {
      id: g.id, name: g.name, otherNames: g.otherNames, parentId: g.parentId,
      ownCount: 0, rolledCount: 0, peopleCount: 0, faces: [],
      latitude: g.latitude, longitude: g.longitude,
      pinSuppressed: g.pinSuppressed, pinState: 'none', children: [],
    });
  }
  const looseRoots: PlaceTreeNode[] = [];
  for (const p of places) {
    if (p.id != null && byId.has(p.id)) {
      const n = byId.get(p.id)!;
      n.ownCount = p.count;
      n.peopleCount = p.peopleCount;
      n.faces = p.faces;
    } else {
      looseRoots.push({
        id: p.id ?? null, name: p.name, parentId: null,
        ownCount: p.count, rolledCount: 0, peopleCount: p.peopleCount, faces: p.faces,
        latitude: p.latitude ?? null, longitude: p.longitude ?? null,
        pinSuppressed: false, pinState: 'none', children: [],
      });
    }
  }
  const roots: PlaceTreeNode[] = [...looseRoots];
  for (const n of byId.values()) {
    if (n.parentId != null && byId.has(n.parentId) && !inCycle(n, byId)) {
      byId.get(n.parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  const rollUp = (n: PlaceTreeNode): number => {
    let sum = n.ownCount;
    for (const c of n.children) sum += rollUp(c);
    n.rolledCount = sum;
    return sum;
  };
  const assignPins = (n: PlaceTreeNode, ancestorHasCoords: boolean): void => {
    const own = n.latitude != null && n.longitude != null;
    n.pinState = own ? 'own' : n.pinSuppressed ? 'none' : ancestorHasCoords ? 'inherited' : 'none';
    for (const c of n.children) assignPins(c, ancestorHasCoords || own);
  };
  const sortRec = (n: PlaceTreeNode): void => { n.children.sort(bySort); n.children.forEach(sortRec); };
  roots.forEach(rollUp);
  roots.forEach((r) => assignPins(r, false));
  roots.forEach(sortRec);
  roots.sort(bySort);
  return roots;
}

export function groupByRoot(
  places: PlaceSummary[],
  gazetteer: PlaceGazetteerNode[],
): { groups: PlaceGroup[]; other: PlaceSummary[] } {
  const roots = buildPlaceTree(places, gazetteer);
  // By id where there is one: two places may share a name (#1186).
  const keyOf = (p: { id?: number | null; name: string }) => (p.id != null ? `#${p.id}` : p.name);
  const summaryByKey = new Map(places.map((p) => [keyOf(p), p]));
  const groups: PlaceGroup[] = [];
  const other: PlaceSummary[] = [];
  for (const root of roots) {
    if (root.children.length === 0) {
      // A childless root is a bare leaf → "Other places" bucket.
      const s = summaryByKey.get(keyOf(root));
      if (s) other.push(s);
      continue;
    }
    const factPlaces: PlaceSummary[] = [];
    const walk = (n: PlaceTreeNode) => {
      if (n.ownCount > 0) { const s = summaryByKey.get(keyOf(n)); if (s) factPlaces.push(s); }
      n.children.forEach(walk);
    };
    walk(root);
    factPlaces.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    groups.push({ root, places: factPlaces, rolledCount: root.rolledCount });
  }
  other.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { groups, other };
}

/**
 * Collapse fact-less pass-through jurisdictions when browsing: a non-root node with
 * `ownCount === 0` (nobody recorded there) that only exists to hold children is skipped —
 * its children are promoted to its parent. So `United States → New York(0 facts) → Brooklyn`
 * browses as `United States → Brooklyn`. Roots and leaves are always kept; roll-up counts
 * are unchanged (the sums already include the collapsed node's descendants).
 */
export function collapseEmptyIntermediaries(roots: PlaceTreeNode[]): PlaceTreeNode[] {
  const visit = (node: PlaceTreeNode): PlaceTreeNode => {
    const children = node.children.flatMap((child) => {
      const c = visit(child);
      return c.ownCount === 0 && c.children.length > 0 ? c.children : [c];
    });
    // Re-sorted, because promotion splices a node's children in at the position the NODE
    // held: a promoted row inherited its parent's rank and kept it. That is how an
    // ungeocoded town lifted out of a geocoded county came to sit above a geocoded town
    // of equal weight, against the rule in `bySort`. The browse order has to be decided
    // on the rows that end up in the level, so it is decided here, after collapsing.
    children.sort(bySort);
    return { ...node, children };
  };
  return roots.map(visit).sort(bySort);
}
