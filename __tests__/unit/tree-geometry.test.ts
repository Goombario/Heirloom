import { describe, test, expect } from 'vitest';
import {
  DEFAULT_LAYOUT_GEOMETRY,
  PERSON_CARD_WIDTH,
  VERTICAL_SPACING,
  SPOUSE_GAP,
  MIN_SIBLING_GAP,
  MIN_BRANCH_GAP,
  BAR_CARD_WIDTH,
  BAR_CARD_HEIGHT,
  PERSON_CARD_HEIGHT,
  layoutGeometry,
  personCardHeight,
} from '@/lib/tree/geometry';
import { computeStandardLayout } from '@/lib/tree/layout/standardLayout';
import { computeFocusLayout } from '@/lib/tree/layout/focusLayout';
import type { TreeNode } from '@/app/components/tree/types';

describe('layout geometry', () => {
  test('default layout geometry equals the legacy portrait constants', () => {
    // Guards the geometry-injection refactor: default must reproduce today's
    // numbers exactly so existing layouts stay byte-identical.
    expect(DEFAULT_LAYOUT_GEOMETRY).toEqual({
      spreadExtent: PERSON_CARD_WIDTH,
      generationSpacing: VERTICAL_SPACING,
      spouseGap: SPOUSE_GAP,
      minSiblingGap: MIN_SIBLING_GAP,
      minBranchGap: MIN_BRANCH_GAP,
    });
  });

  test('horizontal bar geometry carries bar height on the spread axis', () => {
    for (const spacing of ['tight', 'normal', 'roomy'] as const) {
      const g = layoutGeometry({ horizontal: true, spacing });
      expect(g.spreadExtent).toBe(BAR_CARD_HEIGHT);
      // Generations must be spaced for at least the bar width so bars don't overlap.
      expect(g.generationSpacing).toBeGreaterThan(BAR_CARD_WIDTH);
    }
  });

  test('the 44px bar height satisfies the touch-target minimum', () => {
    expect(BAR_CARD_HEIGHT).toBeGreaterThanOrEqual(44);
  });
});

// The Display menu's "Second name" line (vertical cards only): off keeps today's
// cards; on grows every card 16px and moves generations 16px further apart, so the
// gap between rows is unchanged.
describe('second name line geometry', () => {
  const person = (id: number, children?: TreeNode[]): TreeNode =>
    ({ id, name: `P${id}`, photoMediaId: null, spouses: [], children });
  const tree = person(1, [person(2), person(3)]);
  const rowGap = (nodes: { position: { y: number } }[]) => {
    const ys = [...new Set(nodes.map((n) => n.position.y))].sort((a, b) => a - b);
    return ys[1] - ys[0];
  };

  test('off keeps the 152px card and the 228px generation step (#184)', () => {
    expect(personCardHeight(false)).toBe(PERSON_CARD_HEIGHT);
    const off = computeStandardLayout(tree, 'descendants', 'vertical');
    const offDefault = computeStandardLayout(tree, 'descendants', 'vertical', false);
    expect(offDefault).toEqual(off);
    expect(rowGap(off.nodes)).toBe(VERTICAL_SPACING);
  });

  test('on: 168px cards, 244px generations, the same gap between rows', () => {
    expect(personCardHeight(true)).toBe(168);
    expect(layoutGeometry({ horizontal: false, secondName: true }).generationSpacing).toBe(244);
    const on = computeStandardLayout(tree, 'descendants', 'vertical', true);
    expect(rowGap(on.nodes)).toBe(244);
    expect(244 - personCardHeight(true)).toBe(VERTICAL_SPACING - PERSON_CARD_HEIGHT);
    expect(on.bounds!.maxY - on.bounds!.minY).toBe(244 + 168);
  });

  test('horizontal bars ignore it', () => {
    expect(computeStandardLayout(tree, 'descendants', 'horizontal', true))
      .toEqual(computeStandardLayout(tree, 'descendants', 'horizontal'));
  });

  test('focus view spaces all three clusters by the taller rows', () => {
    const focus = computeFocusLayout({ stage: 'A', center: tree, focusPersonId: 1 }, true);
    expect(rowGap(focus.nodes)).toBe(244);
    expect(focus.bounds!.maxY - focus.bounds!.minY).toBe(244 + 168);
  });
});

// The Display menu's Spacing (#249): Normal is today's numbers; Tight and Roomy
// are the locked horizontal values, and vertical the same steps from its own.
describe('spacing presets', () => {
  test('Normal is exactly today\'s geometry in both orientations', () => {
    expect(layoutGeometry({ horizontal: false })).toEqual(DEFAULT_LAYOUT_GEOMETRY);
    expect(layoutGeometry({ horizontal: true })).toEqual({ spreadExtent: BAR_CARD_HEIGHT, generationSpacing: 260, spouseGap: 12, minSiblingGap: 34, minBranchGap: 84 });
  });

  test('horizontal Tight and Roomy use the locked numbers', () => {
    const pick = (spacing: 'tight' | 'roomy') => {
      const g = layoutGeometry({ horizontal: true, spacing });
      return [g.generationSpacing, g.minSiblingGap, g.minBranchGap, g.spouseGap];
    };
    expect(pick('tight')).toEqual([224, 20, 52, 8]);
    expect(pick('roomy')).toEqual([300, 50, 120, 18]);
  });

  test('every gap grows from Tight to Normal to Roomy, vertical too', () => {
    for (const horizontal of [false, true]) {
      const [t, n, r] = (['tight', 'normal', 'roomy'] as const).map((spacing) => layoutGeometry({ horizontal, spacing }));
      for (const k of ['generationSpacing', 'spouseGap', 'minSiblingGap', 'minBranchGap'] as const) {
        expect(t[k]).toBeLessThan(n[k]);
        expect(n[k]).toBeLessThan(r[k]);
      }
    }
  });

  test('a layout spreads further at Roomy than at Tight', () => {
    const person = (id: number, children?: TreeNode[]): TreeNode => ({ id, name: `P${id}`, photoMediaId: null, spouses: [], children });
    const tree = person(1, [person(2, [person(4), person(5)]), person(3, [person(6)])]);
    const width = (spacing: 'tight' | 'roomy') => {
      const b = computeStandardLayout(tree, 'descendants', 'vertical', false, spacing).bounds!;
      return [b.maxX - b.minX, b.maxY - b.minY];
    };
    const [tw, th] = width('tight');
    const [rw, rh] = width('roomy');
    expect(rw).toBeGreaterThan(tw);
    expect(rh).toBeGreaterThan(th);
  });
});

// #249: the start person's partners each sit over their own children, instead of
// all stacked tight around the start person.
describe('room for the start person\'s partners', () => {
  const kid = (id: number, otherParentId: number, children?: TreeNode[]): TreeNode =>
    ({ id, name: `P${id}`, photoMediaId: null, spouses: [], otherParentId, birthYear: 1900 + id, children });
  const wife = (id: number, hasChildren = true) => ({ id, name: `W${id}`, photoMediaId: null, hasChildren });
  // Wife 2's child has a wide family of its own, so the two families sit far apart.
  const root: TreeNode = {
    id: 1, name: 'Emil', photoMediaId: null,
    spouses: [wife(2), wife(3), wife(9, false)],
    children: [kid(10, 2, [kid(20, 0), kid(21, 0), kid(22, 0), kid(23, 0)]), kid(11, 3)],
  };
  const centre = (out: ReturnType<typeof computeStandardLayout>, id: string) => out.nodes.find((n) => n.id === id)!.position.x + PERSON_CARD_WIDTH / 2;

  test('each partner with children centres over them; the start person sits just before the first', () => {
    const out = computeStandardLayout(root, 'descendants', 'vertical');
    expect(centre(out, 'person-2-spouse0-of1')).toBe(centre(out, 'person-10'));
    expect(centre(out, 'person-3-spouse1-of1')).toBe(centre(out, 'person-11'));
    expect(centre(out, 'person-1')).toBe(centre(out, 'person-2-spouse0-of1') - PERSON_CARD_WIDTH - 2 * SPOUSE_GAP);
    // The childless partner follows the last one, a partner gap away.
    expect(centre(out, 'person-9-spouse2-of1')).toBe(centre(out, 'person-3-spouse1-of1') + PERSON_CARD_WIDTH + SPOUSE_GAP);
  });

  test('a start person with one partner keeps today\'s stack', () => {
    const one: TreeNode = { ...root, spouses: [wife(2)], children: [kid(10, 2), kid(11, 2)] };
    const out = computeStandardLayout(one, 'descendants', 'vertical');
    expect(centre(out, 'person-2-spouse0-of1') - centre(out, 'person-1')).toBe(PERSON_CARD_WIDTH + SPOUSE_GAP);
  });
});
