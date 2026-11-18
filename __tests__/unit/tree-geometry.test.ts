import { describe, test, expect } from 'vitest';
import {
  DEFAULT_LAYOUT_GEOMETRY,
  HORIZONTAL_BAR_GEOMETRY,
  PERSON_CARD_WIDTH,
  VERTICAL_SPACING,
  SPOUSE_GAP,
  MIN_SIBLING_GAP,
  MIN_BRANCH_GAP,
  BAR_CARD_WIDTH,
  BAR_CARD_HEIGHT,
  PERSON_CARD_HEIGHT,
  SECOND_NAME_LAYOUT_GEOMETRY,
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
    expect(HORIZONTAL_BAR_GEOMETRY.spreadExtent).toBe(BAR_CARD_HEIGHT);
    // Generations must be spaced for at least the bar width so bars don't overlap.
    expect(HORIZONTAL_BAR_GEOMETRY.generationSpacing).toBeGreaterThanOrEqual(BAR_CARD_WIDTH);
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

  test('off keeps the 145px card and the 220px generation step', () => {
    expect(personCardHeight(false)).toBe(PERSON_CARD_HEIGHT);
    const off = computeStandardLayout(tree, 'descendants', 'vertical');
    const offDefault = computeStandardLayout(tree, 'descendants', 'vertical', false);
    expect(offDefault).toEqual(off);
    expect(rowGap(off.nodes)).toBe(VERTICAL_SPACING);
  });

  test('on: 161px cards, 236px generations, the same gap between rows', () => {
    expect(personCardHeight(true)).toBe(161);
    expect(SECOND_NAME_LAYOUT_GEOMETRY.generationSpacing).toBe(236);
    const on = computeStandardLayout(tree, 'descendants', 'vertical', true);
    expect(rowGap(on.nodes)).toBe(236);
    expect(236 - personCardHeight(true)).toBe(VERTICAL_SPACING - PERSON_CARD_HEIGHT);
    expect(on.bounds!.maxY - on.bounds!.minY).toBe(236 + 161);
  });

  test('horizontal bars ignore it', () => {
    expect(computeStandardLayout(tree, 'descendants', 'horizontal', true))
      .toEqual(computeStandardLayout(tree, 'descendants', 'horizontal'));
  });

  test('focus view spaces all three clusters by the taller rows', () => {
    const focus = computeFocusLayout({ stage: 'A', center: tree, focusPersonId: 1 }, true);
    expect(rowGap(focus.nodes)).toBe(236);
    expect(focus.bounds!.maxY - focus.bounds!.minY).toBe(236 + 161);
  });
});
