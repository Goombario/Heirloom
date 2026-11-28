import { describe, it, expect } from 'vitest';
import { snapParentDrops, SNAP_TOLERANCE } from '@/lib/tree/layout/snapDrops';
import type { FlowEdge, FlowNode, LayoutOutput } from '@/app/components/tree/types';
import { PERSON_CARD_WIDTH, BAR_CARD_HEIGHT } from '@/lib/tree/geometry';

const card = (id: string, x: number, y: number, type = 'person'): FlowNode =>
  ({ id, type, position: { x, y }, data: { person: { id: 1, name: id, photoMediaId: null, spouses: [] } } }) as FlowNode;
const line = (source: string, target: string, type = 'smoothstep'): FlowEdge => ({ id: `${source}>${target}`, source, target, type });
const layout = (nodes: FlowNode[], edges: FlowEdge[]): LayoutOutput => ({ nodes, edges, bounds: null, anchor: null });
const snapOf = (out: LayoutOutput) => out.edges.map((e) => e.data?.snapTo);

// #15: a child just off the parent's middle made two stalks side by side (a wiggle).
describe('snapParentDrops', () => {
  const mid = (x: number) => x + PERSON_CARD_WIDTH / 2;

  it('moves every line from the parent onto a child within the tolerance', () => {
    const out = snapParentDrops(layout(
      [card('p', 72, 0), card('a', -200, 228), card('b', 92, 228)],
      [line('p', 'a'), line('p', 'b')],
    ));
    expect(snapOf(out)).toEqual([mid(92), mid(92)]);
  });

  it('leaves a child already on the axis, or one farther than the tolerance, alone', () => {
    expect(snapOf(snapParentDrops(layout([card('p', 0, 0), card('c', 0, 228)], [line('p', 'c')])))).toEqual([undefined]);
    expect(snapOf(snapParentDrops(layout([card('p', 0, 0), card('c', SNAP_TOLERANCE + 1, 228)], [line('p', 'c')])))).toEqual([undefined]);
  });

  it('leaves spouse lines alone', () => {
    const out = snapParentDrops(layout(
      [card('p', 0, 0), card('s', 124, 0), card('c', 20, 228)],
      [{ ...line('p', 's'), type: 'spouse' }, line('p', 'c')],
    ));
    expect(snapOf(out)).toEqual([undefined, mid(20)]);
  });

  it('snaps on the y axis for horizontal bars', () => {
    const out = snapParentDrops(layout(
      [card('p', 0, 0, 'personBar'), card('c', 228, 11, 'personBar')],
      [line('p', 'c')],
    ));
    expect(snapOf(out)).toEqual([11 + BAR_CARD_HEIGHT / 2]);
  });

  it('never moves the drop out from under the parent card (a bar is only 44px tall)', () => {
    const out = snapParentDrops(layout(
      [card('p', 0, 0, 'personBar'), card('c', 228, 20, 'personBar')],
      [line('p', 'c')],
    ));
    expect(snapOf(out)).toEqual([undefined]);
  });
});
