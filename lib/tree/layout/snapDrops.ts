/**
 * Snap a parent's drop onto a near child (#15).
 *
 * A parent line leaves the middle of the parent's card, runs along the bracket
 * and drops into each child. When a child sits just off the parent's middle (in
 * the synthetic tree, Hazel Bracken 20px right of her mother's drop), the two
 * vertical stalks sit side by side and the line reads as a wiggle. Cards are not
 * moved, which would change sibling spacing; instead the parent's drop moves
 * onto that child's axis, as long as it still leaves from under the parent's card.
 * Every line from the parent takes the same drop, so the bracket stays one line.
 *
 * Pure, over a finished LayoutOutput; the edge renderer reads `data.snapTo`.
 */
import type { FlowEdge, FlowNode, LayoutOutput } from '@/app/components/tree/types';
import { BAR_CARD_HEIGHT, PERSON_CARD_WIDTH, COUPLE_BAR_HEIGHT, COUPLE_CARD_WIDTH } from '@/lib/tree/geometry';

/** A child this close to the parent's middle gets the drop. */
export const SNAP_TOLERANCE = 24;
/** The drop stays at least this far inside the parent's card edge. */
const CARD_INSET = 6;

const isParentLine = (e: FlowEdge) => e.type !== 'spouse';

export function snapParentDrops(out: LayoutOutput): LayoutOutput {
  if (out.nodes.length === 0) return out;
  const byId = new Map<string, FlowNode>(out.nodes.map((n) => [n.id, n]));
  // The cross axis is the one the bracket runs along: x for portrait cards,
  // y for horizontal bars.
  const bar = (n: FlowNode) => n.type === 'personBar' || n.type === 'coupleBar';
  const span = (n: FlowNode): [number, number] => {
    const { x, y } = n.position;
    if (n.type === 'coupleBar') return [y, y + COUPLE_BAR_HEIGHT];
    if (n.type === 'personBar') return [y, y + BAR_CARD_HEIGHT];
    return [x, x + (n.type === 'couple' ? COUPLE_CARD_WIDTH : PERSON_CARD_WIDTH)];
  };
  const mid = (n: FlowNode) => { const [a, b] = span(n); return (a + b) / 2; };
  // A line lands on a couple card's blood relative, its first half (#248).
  const landing = (n: FlowNode) => {
    if (n.type !== 'couple' && n.type !== 'coupleBar') return mid(n);
    const [a, b] = span(n);
    return a + (b - a) / 4;
  };

  const bySource = new Map<string, FlowEdge[]>();
  for (const e of out.edges) if (isParentLine(e)) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);

  const snapTo = new Map<string, number>();
  for (const [sourceId, lines] of bySource) {
    const source = byId.get(sourceId);
    // A partner join (#248) is a point, not a card to stay under.
    if (!source || source.type === 'partnerJoin') continue;
    const s = mid(source);
    const [lo, hi] = span(source);
    let best: number | null = null;
    for (const e of lines) {
      const target = byId.get(e.target);
      if (!target || bar(target) !== bar(source)) continue;
      const t = landing(target);
      const d = Math.abs(t - s);
      if (d < 0.5 || d > SNAP_TOLERANCE || t < lo + CARD_INSET || t > hi - CARD_INSET) continue;
      if (best === null || d < Math.abs(best - s)) best = t;
    }
    if (best !== null) snapTo.set(sourceId, best);
  }
  if (snapTo.size === 0) return out;

  return {
    ...out,
    edges: out.edges.map((e) => {
      const at = isParentLine(e) ? snapTo.get(e.source) : undefined;
      return at === undefined ? e : { ...e, data: { ...(e.data ?? {}), snapTo: at } };
    }),
  };
}
