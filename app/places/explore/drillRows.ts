// Row models for the Explore drill list. Pure and separately tested — the region
// derivation is the interesting part and it should not need a render to verify
// (same split as `groupFactLinks.ts`).

import { placeNameMatches, type PlaceTreeNode } from '@/lib/places/hierarchy';

/** First jurisdiction segment of a place string — "Buckland Cemetary, Dover" → "Buckland Cemetary". */
export const label = (name: string) => name.split(',')[0]?.trim() ?? name;

/** Everything AFTER the first segment — "Buckland Cemetary, Dover" → "Dover". */
export const regionFromName = (name: string) =>
  name.includes(',') ? name.slice(name.indexOf(',') + 1).trim() : '';

export interface DrillRowData {
  node: PlaceTreeNode;
  /** Secondary text beside the name — where this place sits. May be empty. */
  region: string;
}

/**
 * Flatten the whole tree for global search, giving each row its **gazetteer**
 * ancestry as region text, nearest parent first ("Dover, United Kingdom").
 *
 * #417: the region used to be re-parsed out of the place STRING, so two places
 * both recorded as a bare `Dover` in different countries rendered as identical
 * rows. The parented tree is already in hand here — `walk` descended through
 * every ancestor and threw them away — so no query or API change is needed.
 *
 * Falls back to the name-derived region when a place has **no parent** in the
 * gazetteer. Two unparented bare `Dover` roots therefore still render alike:
 * the ancestry does not exist to show, and that residue belongs to the
 * PlaceId-FK normalization gap (#151), not here.
 */
export function flattenWithAncestry(nodes: PlaceTreeNode[]): DrillRowData[] {
  const out: DrillRowData[] = [];
  const walk = (ns: PlaceTreeNode[], trail: string[]) => {
    for (const n of ns) {
      out.push({ node: n, region: trail.length > 0 ? trail.join(', ') : regionFromName(n.name) });
      // Nearest parent first, so the trail reads the way a place string does.
      walk(n.children, [label(n.name), ...trail]);
    }
  };
  walk(nodes, []);
  return out;
}

/**
 * Rows for one drill level. Region stays name-derived here **on purpose**: every
 * row is a child of the jurisdiction you are standing in, the breadcrumb already
 * names it, and substituting the ancestry would print the same parent on every
 * row. Unchanged behaviour from before #417.
 */
export function levelRows(children: PlaceTreeNode[]): DrillRowData[] {
  return children.map((node) => ({ node, region: regionFromName(node.name) }));
}

/**
 * A level renders at most this many rows until "Show all" (#4). On a 4× throttled
 * phone, ~600 root rows made each filter keystroke take 300–400 ms; a big imported
 * tree that hasn't been grouped has every one-part place at the root.
 */
export const DRILL_ROW_CAP = 200;

/** The rows to draw and how many wait behind "Show all". Search results are never capped. */
export function capDrillRows<T>(rows: readonly T[], showAll: boolean, searching: boolean): { shown: readonly T[]; hidden: number } {
  if (showAll || searching || rows.length <= DRILL_ROW_CAP) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, DRILL_ROW_CAP), hidden: rows.length - DRILL_ROW_CAP };
}

/** Case-insensitive name match, used by the global search path. */
export function matchesQuery(row: DrillRowData, query: string): boolean {
  return placeNameMatches(row.node.name, row.node.otherNames, query);
}
