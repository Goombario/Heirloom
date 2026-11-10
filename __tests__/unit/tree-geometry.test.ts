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
} from '@/lib/tree/geometry';

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
