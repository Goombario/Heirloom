import { describe, test, expect } from 'vitest';
import { computeStandardLayout } from '@/lib/tree/layout/standardLayout';
import { PERSON_CARD_WIDTH, COUPLE_CARD_WIDTH, BAR_CARD_HEIGHT, COUPLE_BAR_HEIGHT, PARTNER_JOIN_SIZE } from '@/lib/tree/geometry';
import type { TreeNode, Spouse, LayoutOutput, FlowNode } from '@/app/components/tree/types';

const p = (id: number, extra: Partial<TreeNode> = {}): TreeNode =>
  ({ id, name: `P${id}`, photoMediaId: null, spouses: [], birthYear: 1800 + id, ...extra });
const sp = (id: number, hasChildren = true): Spouse => ({ id, name: `S${id}`, photoMediaId: null, hasChildren });
const node = (out: LayoutOutput, id: string) => {
  const n = out.nodes.find((m) => m.id === id);
  if (!n) throw new Error(`no node ${id}: ${out.nodes.map((m) => m.id).join(', ')}`);
  return n;
};
const width = (n: FlowNode) => (n.type === 'couple' ? COUPLE_CARD_WIDTH : n.type === 'partnerJoin' ? PARTNER_JOIN_SIZE : PERSON_CARD_WIDTH);

/** No two cards on a row overlap. */
function expectNoOverlap(out: LayoutOutput) {
  const cards = out.nodes.filter((n) => n.type !== 'partnerJoin');
  for (const y of new Set(cards.map((n) => n.position.y))) {
    const row = cards.filter((n) => n.position.y === y).sort((a, b) => a.position.x - b.position.x);
    for (let i = 1; i < row.length; i++) expect(row[i].position.x).toBeGreaterThanOrEqual(row[i - 1].position.x + width(row[i - 1]));
  }
}

// #248 Display › Partners › One couple card.
describe('one partner: a couple card', () => {
  // Karl and Maria have two children; their son Otto married Ida and has none.
  const tree = p(1, {
    spouses: [sp(2)],
    children: [p(3, { otherParentId: 2, spouses: [sp(5, false)] }), p(4, { otherParentId: 2 })],
  });
  const out = computeStandardLayout(tree, 'descendants', 'vertical', false, 'normal', 'compact', 'couple');

  test('the person and partner are one card, the partner its second half', () => {
    const c = node(out, 'person-1');
    expect(c.type).toBe('couple');
    expect(c.data.partner?.id).toBe(2);
    expect(out.nodes.some((n) => n.data.person.id === 2)).toBe(false);
    expect(out.edges.some((e) => e.type === 'spouse')).toBe(false);
    expect(node(out, 'person-3').type).toBe('couple');
  });

  test('the children drop from the couple card, centred under it', () => {
    const c = node(out, 'person-1');
    const lines = out.edges.filter((e) => e.target === 'person-3' || e.target === 'person-4');
    expect(lines.map((e) => e.source)).toEqual(['person-1', 'person-1']);
    const kidsMid = (node(out, 'person-3').position.x + COUPLE_CARD_WIDTH / 4 + node(out, 'person-4').position.x + PERSON_CARD_WIDTH / 2) / 2;
    expect(Math.abs(c.position.x + COUPLE_CARD_WIDTH / 2 - kidsMid)).toBeLessThan(COUPLE_CARD_WIDTH);
    expectNoOverlap(out);
  });

  test('Own cards is today\'s layout', () => {
    const own = computeStandardLayout(tree, 'descendants', 'vertical');
    const def = computeStandardLayout(tree, 'descendants', 'vertical', false, 'normal', 'compact', 'own');
    expect(def).toEqual(own);
    expect(own.nodes.find((n) => n.id === 'person-2-spouse0-of1')).toBeTruthy();
  });

  test('horizontal: a two-row couple bar', () => {
    const h = computeStandardLayout(tree, 'descendants', 'horizontal', false, 'normal', 'compact', 'couple');
    expect(node(h, 'person-1').type).toBe('coupleBar');
    const bars = h.nodes.filter((n) => n.position.x === node(h, 'person-3').position.x).sort((a, b) => a.position.y - b.position.y);
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      expect(bars[i].position.y).toBeGreaterThanOrEqual(prev.position.y + (prev.type === 'coupleBar' ? COUPLE_BAR_HEIGHT : BAR_CARD_HEIGHT));
    }
  });

  test('a repeat of the partner points at the couple card', () => {
    const t = p(1, { spouses: [sp(2)], children: [p(3, { otherParentId: 2, children: [p(2, { repeat: true })] })] });
    const o = computeStandardLayout(t, 'descendants', 'vertical', false, 'normal', 'compact', 'couple');
    const rep = o.nodes.find((n) => n.data.repeatOf);
    expect(rep?.data.repeatOf).toBe('person-1');
  });
});

describe('more than one partner: numbered joins', () => {
  // Peter married Anna (two children) and then Berta (one child).
  const tree = p(1, {
    spouses: [sp(2), sp(3)],
    children: [p(4, { otherParentId: 2 }), p(5, { otherParentId: 2 }), p(6, { otherParentId: 3 })],
  });
  const out = computeStandardLayout(tree, 'descendants', 'vertical', false, 'normal', 'compact', 'couple');

  test('partner 1 on the left, the person in the middle, partner 2 on the right', () => {
    const a = node(out, 'person-2-spouse0-of1').position.x;
    const me = node(out, 'person-1').position.x;
    const b = node(out, 'person-3-spouse1-of1').position.x;
    expect(a).toBeLessThan(me);
    expect(me).toBeLessThan(b);
    expectNoOverlap(out);
  });

  test('each marriage has a numbered join between the two, and its children drop from it', () => {
    const j1 = node(out, 'person-1-join1');
    const j2 = node(out, 'person-1-join2');
    expect([j1.data.joinNumber, j2.data.joinNumber]).toEqual([1, 2]);
    const j1Mid = j1.position.x + PARTNER_JOIN_SIZE / 2;
    expect(j1Mid).toBeGreaterThan(node(out, 'person-2-spouse0-of1').position.x + PERSON_CARD_WIDTH);
    expect(j1Mid).toBeLessThan(node(out, 'person-1').position.x);
    const from = (child: number) => out.edges.find((e) => e.target === `person-${child}`)!.source;
    expect([from(4), from(5), from(6)]).toEqual(['person-1-join1', 'person-1-join1', 'person-1-join2']);
  });

  test('horizontal keeps the joins between the stacked bars', () => {
    const h = computeStandardLayout(tree, 'descendants', 'horizontal', false, 'normal', 'compact', 'couple');
    const j = node(h, 'person-1-join1');
    expect(j.type).toBe('partnerJoin');
    const mid = j.position.y + PARTNER_JOIN_SIZE / 2;
    expect(mid).toBeGreaterThan(node(h, 'person-2-spouse0-of1').position.y + BAR_CARD_HEIGHT - 1);
    expect(mid).toBeLessThan(node(h, 'person-1').position.y + 1);
  });

  test('Even bands leave room for partner 1 on the left', () => {
    const t = p(9, { children: [p(10, { spouses: [sp(11), sp(12)] }), p(13, { spouses: [sp(14), sp(15)] })] });
    expectNoOverlap(computeStandardLayout(t, 'descendants', 'vertical', false, 'normal', 'even', 'couple'));
    expectNoOverlap(computeStandardLayout(t, 'descendants', 'vertical', false, 'tight', 'compact', 'couple'));
  });
});
