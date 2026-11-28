/** @vitest-environment happy-dom */
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Position, type EdgeProps } from 'reactflow';
import BranchEdge from '@/app/components/tree/BranchEdge';
import { BAR_CARD_HEIGHT, PERSON_CARD_WIDTH, TREE_SPACINGS, layoutGeometry, personCardHeight, BAR_CARD_WIDTH } from '@/lib/tree/geometry';
import type { BranchEdgeData } from '@/app/components/tree/types';

/** The parent→child path's points along the generation axis, in drawing order. */
function stalkAxis(props: Partial<EdgeProps<BranchEdgeData>>, horizontal: boolean): number[] {
  const { container } = render(
    <svg>
      <BranchEdge {...(props as EdgeProps<BranchEdgeData>)} id="e" />
    </svg>,
  );
  const d = container.querySelector('path')!.getAttribute('d')!;
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push(horizontal ? nums[i] : nums[i + 1]);
  return out;
}

const nonDecreasing = (xs: number[]) => xs.every((v, i) => i === 0 || v >= xs[i - 1] - 1e-9);

// Tight spacing leaves under 40px between rows, less than React Flow's two 20px
// stalks; the line used to double back and jog sideways at the parents' midpoint.
describe('parent→child line', () => {
  for (const spacing of TREE_SPACINGS) {
    test(`never doubles back at ${spacing} spacing, vertical`, () => {
      const g = layoutGeometry({ horizontal: false, spacing });
      const gap = g.generationSpacing - personCardHeight(false);
      const ys = stalkAxis({
        sourceX: 0, sourceY: 0, targetX: PERSON_CARD_WIDTH * 2, targetY: gap,
        sourcePosition: Position.Bottom, targetPosition: Position.Top,
      }, false);
      expect(nonDecreasing(ys)).toBe(true);
    });

    test(`never doubles back at ${spacing} spacing, horizontal`, () => {
      const g = layoutGeometry({ horizontal: true, spacing });
      const gap = g.generationSpacing - BAR_CARD_WIDTH;
      const xs = stalkAxis({
        sourceX: 0, sourceY: 0, targetX: gap, targetY: BAR_CARD_HEIGHT * 3,
        sourcePosition: Position.Right, targetPosition: Position.Left,
      }, true);
      expect(nonDecreasing(xs)).toBe(true);
    });
  }

  test('the bus between siblings stays at the middle of the gap', () => {
    const gap = layoutGeometry({ horizontal: false, spacing: 'tight' }).generationSpacing - personCardHeight(false);
    const ys = stalkAxis({
      sourceX: 0, sourceY: 0, targetX: 300, targetY: gap,
      sourcePosition: Position.Bottom, targetPosition: Position.Top,
    }, false);
    expect(ys).toContain(gap / 2);
  });
});
