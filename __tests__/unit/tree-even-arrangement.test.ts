import { describe, test, expect } from 'vitest';
import { computeStandardLayout } from '@/lib/tree/layout/standardLayout';
import { PERSON_CARD_WIDTH } from '@/lib/tree/geometry';
import type { TreeNode, LayoutOutput } from '@/app/components/tree/types';

const p = (id: number, extra: Partial<TreeNode> = {}): TreeNode =>
  ({ id, name: `P${id}`, photoMediaId: null, spouses: [], birthYear: 1800 + id, ...extra });
const centre = (out: LayoutOutput, id: string) => out.nodes.find((n) => n.id === id)!.position.x + PERSON_CARD_WIDTH / 2;
const x = (out: LayoutOutput, id: string) => out.nodes.find((n) => n.id === id)!.position.x;

// #250 Descendants, Even ("bands"): no subtree is tucked into a neighbour's space.
describe('Even descendants (bands)', () => {
  // Karl has three children; Marta has none; Paul has one. Compact tucks Marta
  // over Karl's children; bands keep her clear of them.
  const tree = p(1, { children: [
    p(2, { children: [p(5), p(6), p(7)] }),
    p(3),
    p(4, { children: [p(8)] }),
  ] });

  test('a childless child sits clear of a sibling\'s children', () => {
    const compact = computeStandardLayout(tree, 'descendants', 'vertical');
    const even = computeStandardLayout(tree, 'descendants', 'vertical', false, 'normal', 'even');
    const rightOfKarlsKids = (out: LayoutOutput) => x(out, 'person-3') - (x(out, 'person-7') + PERSON_CARD_WIDTH);
    expect(rightOfKarlsKids(even)).toBeGreaterThan(0);
    expect(rightOfKarlsKids(even)).toBeGreaterThan(rightOfKarlsKids(compact));
  });

  test('every parent stays centred over their children, and no cards overlap', () => {
    const even = computeStandardLayout(tree, 'descendants', 'vertical', false, 'normal', 'even');
    expect(centre(even, 'person-2')).toBe((centre(even, 'person-5') + centre(even, 'person-7')) / 2);
    expect(centre(even, 'person-1')).toBe((centre(even, 'person-2') + centre(even, 'person-4')) / 2);
    const row = (y: number) => even.nodes.filter((n) => n.position.y === y).map((n) => n.position.x).sort((a, b) => a - b);
    for (const y of new Set(even.nodes.map((n) => n.position.y))) {
      const xs = row(y);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(PERSON_CARD_WIDTH);
    }
  });
});

// #250 Ancestors, Even: the classic pedigree chart with fixed slots.
describe('Even ancestors (pedigree slots)', () => {
  // Root's father has both parents known; root's mother has only her mother known.
  const tree = p(1, { children: [
    p(3, { sex: 'F', birthYear: 1770, children: [p(7, { sex: 'F' })] }),
    p(2, { sex: 'M', birthYear: 1780, children: [p(4, { sex: 'M' }), p(5, { sex: 'F' })] }),
  ] });
  const even = computeStandardLayout(tree, 'ancestors', 'vertical', false, 'normal', 'even');

  test('father\'s line takes the first slot even when the mother is older', () => {
    expect(centre(even, 'person-2')).toBeLessThan(centre(even, 'person-3'));
    expect(centre(even, 'person-4')).toBeLessThan(centre(even, 'person-5'));
  });

  test('each generation has evenly spaced fixed slots', () => {
    const slots = ['person-4', 'person-5', 'gap-3-0', 'person-7'].map((id) => centre(even, id));
    const pitch = slots[1] - slots[0];
    expect(slots[2] - slots[1]).toBe(pitch);
    expect(slots[3] - slots[2]).toBe(pitch);
    expect(centre(even, 'person-2')).toBe((slots[0] + slots[1]) / 2);
    expect(centre(even, 'person-3')).toBe((slots[2] + slots[3]) / 2);
  });

  test('an unknown parent of a known person is an empty slot with no line; nothing past the chart', () => {
    const gap = even.nodes.find((n) => n.id === 'gap-3-0')!;
    expect(gap.type).toBe('pedigreeGap');
    expect(gap.data.placeholder).toBe(true);
    expect(even.edges.some((e) => e.source === gap.id || e.target === gap.id)).toBe(false);
    // The deepest generation gets no empty slots above it.
    expect(even.nodes.filter((n) => n.data.placeholder).map((n) => n.id)).toEqual(['gap-3-0']);
  });

  test('horizontal keeps the slots as bar gaps', () => {
    const bars = computeStandardLayout(tree, 'ancestors', 'horizontal', false, 'normal', 'even');
    expect(bars.nodes.find((n) => n.id === 'gap-3-0')!.type).toBe('pedigreeGapBar');
  });

  test('a person shown with more than two parents keeps Compact', () => {
    const three = p(1, { children: [p(2, { sex: 'M' }), p(3, { sex: 'F' }), p(4, { sex: 'F' })] });
    expect(computeStandardLayout(three, 'ancestors', 'vertical', false, 'normal', 'even'))
      .toEqual(computeStandardLayout(three, 'ancestors', 'vertical'));
  });
});
