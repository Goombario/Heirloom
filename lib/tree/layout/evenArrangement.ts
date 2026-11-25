/**
 * The Display menu's Arrangement: Even (#250). Two placements that replace d3's
 * tidy-tree packing, both in the engine's pre-mirror frame (x = the centre of a
 * card's main card along the spread axis, y = depth × generation pitch):
 *
 * - Descendants, "bands": each subtree keeps its own column band, side by side,
 *   with every parent centred over its children. Nothing is tucked into a
 *   neighbour's space, so a childless child never sits above a sibling's
 *   children and reads as their parent. About a quarter wider than Compact.
 * - Ancestors, "pedigree": every ancestor has a fixed slot, the classic printed
 *   chart. Generation g has 2^g slots; father's line takes the first slot of a
 *   pair, mother's the second. A known person's unknown parent leaves a gap,
 *   returned as `gaps` for the engine to draw as a faint dashed slot.
 *
 * Pure; the engine calls one of these instead of `tree()(root)`.
 */
import type { HierarchyNode } from 'd3-hierarchy';
import type { LayoutGeometry } from '@/lib/tree/geometry';

/** The node fields the placements read (the engine's ExtendedTreeNode has them). */
interface Placeable {
  id: number;
  sex?: string | null;
  repeat?: true;
  /** Main card plus partner cards along the spread axis. */
  _width?: number;
  /** How far its cards reach left of the main card's usual left edge (#248). */
  _lead?: number;
  children?: unknown[];
}

type Node<T extends Placeable> = HierarchyNode<T>;

/**
 * Bands: returns nothing, sets x and y on every node. A band is as wide as its
 * own cards or its children's bands, whichever is wider; bands of two leaves sit
 * a sibling gap apart, any other pair a cousin gap apart (their children will be
 * cousins).
 */
export function placeBands<T extends Placeable>(root: Node<T>, geometry: LayoutGeometry): void {
  const ext = geometry.spreadExtent;
  // Per node: band width and the main card's centre, measured from the band's left edge.
  const band = new Map<Node<T>, { width: number; centre: number; childLeft: number[] }>();
  const measure = (n: Node<T>): void => {
    const own = n.data._width || ext;
    const lead = n.data._lead ?? 0;
    const kids = n.children ?? [];
    kids.forEach(measure);
    if (kids.length === 0) {
      band.set(n, { width: own, centre: lead + ext / 2, childLeft: [] });
      return;
    }
    const childLeft: number[] = [];
    let cursor = 0;
    kids.forEach((c, i) => {
      if (i > 0) {
        const bothLeaves = !kids[i - 1].children?.length && !c.children?.length;
        cursor += bothLeaves ? geometry.minSiblingGap : geometry.minBranchGap;
      }
      childLeft.push(cursor);
      cursor += band.get(c)!.width;
    });
    const firstCentre = childLeft[0] + band.get(kids[0])!.centre;
    const lastCentre = childLeft[kids.length - 1] + band.get(kids[kids.length - 1])!.centre;
    let centre = (firstCentre + lastCentre) / 2;
    // The parent's own cards (main card, then partners to its right) may reach past
    // the children's band on either side: widen the band, shifting the children.
    const ownLeft = centre - ext / 2 - lead;
    const shift = ownLeft < 0 ? -ownLeft : 0;
    centre += shift;
    const width = Math.max(cursor + shift, centre - ext / 2 - lead + own);
    band.set(n, { width, centre, childLeft: childLeft.map((l) => l + shift) });
  };
  measure(root);
  const place = (n: Node<T>, left: number): void => {
    const b = band.get(n)!;
    n.x = left + b.centre;
    n.y = n.depth * geometry.generationSpacing;
    (n.children ?? []).forEach((c, i) => place(c, left + b.childLeft[i]));
  };
  place(root, 0);
}

/** An empty pedigree slot: the unknown `slot` (0 father, 1 mother) of `childId`. */
export interface PedigreeGap {
  childId: number;
  slot: 0 | 1;
  x: number;
  depth: number;
}

/**
 * Pedigree slots: sets x and y on every node and returns the empty slots, or null
 * when some person has more than two parents shown (two parent families), which
 * no fixed chart can hold; the caller then keeps Compact.
 */
export function placePedigree<T extends Placeable>(root: Node<T>, geometry: LayoutGeometry): PedigreeGap[] | null {
  let deepest = 0;
  let fits = true;
  root.each((n) => {
    deepest = Math.max(deepest, n.depth);
    if ((n.children?.length ?? 0) > 2) fits = false;
  });
  if (!fits) return null;
  const pitch = geometry.spreadExtent + geometry.minSiblingGap;
  const span = 2 ** deepest * pitch;
  const centreOf = (depth: number, index: number) => (index + 0.5) * span / 2 ** depth;
  const gaps: PedigreeGap[] = [];

  const slotsOf = (n: Node<T>): (Node<T> | null)[] => {
    const parents = n.children ?? [];
    // The parents' order as the record lists them (partner 1, then partner 2),
    // before the engine sorted them by birth year.
    const listed = (n.data.children ?? []) as T[];
    const order = (p: Node<T>) => listed.indexOf(p.data);
    if (parents.length === 1) return parents[0].data.sex === 'F' ? [null, parents[0]] : [parents[0], null];
    if (parents.length === 2) {
      const [a, b] = [...parents].sort((x, y) => order(x) - order(y));
      const motherFirst = a.data.sex === 'F' && b.data.sex !== 'F';
      return motherFirst ? [b, a] : [a, b];
    }
    return [null, null];
  };

  const place = (n: Node<T>, index: number): void => {
    n.x = centreOf(n.depth, index);
    n.y = n.depth * geometry.generationSpacing;
    const slots = slotsOf(n);
    slots.forEach((p, j) => {
      const childIndex = index * 2 + j;
      if (p) place(p, childIndex);
      // A known person's unknown parent leaves a dashed gap, but only inside the
      // chart's depth, and never behind a repeat (their parents are drawn elsewhere).
      else if (n.depth < deepest && !n.data.repeat) {
        gaps.push({ childId: n.data.id, slot: j as 0 | 1, x: centreOf(n.depth + 1, childIndex), depth: n.depth + 1 });
      }
    });
  };
  place(root, 0);
  return gaps;
}
