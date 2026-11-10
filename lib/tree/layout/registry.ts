/**
 * Layout-mode registry: one entry per display mode, each a pure function from
 * tree data to a LayoutOutput. The renderer dispatches through this table and
 * carries NO per-mode branching, so adding a layout mode (horizontal, fan
 * chart, …) means adding one entry here + its compute module under
 * lib/tree/layout/ — no changes to TreeVisualization.
 *
 * A new mode also needs the server to offer it (`suggestedMode` in
 * lib/services/tree.ts) and the mode pickers in app/tree/TreeHeader.tsx /
 * TreeLeftRail.tsx to list it — both are data/UI concerns, not layout ones.
 */
import type { TreeNode, FocusTrees, LayoutOutput } from '@/app/components/tree/types';
import { computeStandardLayout } from './standardLayout';
import { computeFocusLayout } from './focusLayout';

export interface TreeLayoutInput {
  /** Single-hierarchy input (descendants / ancestors). */
  tree?: TreeNode | null;
  /** Three-subtree input (focus mode). */
  focusTrees?: FocusTrees | null;
  /** Card orientation. Applies to descendants/ancestors; focus ignores it. */
  orientation?: 'vertical' | 'horizontal';
}

export interface TreeLayoutMode {
  id: string;
  compute(input: TreeLayoutInput): LayoutOutput;
}

const MODES: Record<string, TreeLayoutMode> = {
  descendants: {
    id: 'descendants',
    compute: ({ tree, orientation }) => computeStandardLayout(tree ?? null, 'descendants', orientation),
  },
  ancestors: {
    id: 'ancestors',
    compute: ({ tree, orientation }) => computeStandardLayout(tree ?? null, 'ancestors', orientation),
  },
  focus: {
    id: 'focus',
    // Focus is vertical-only (Phase 1) — it ignores `orientation`. Focus without
    // focusTrees (shouldn't happen — the API populates them for mode=focus)
    // falls back to a descendants layout of whatever tree we have.
    compute: ({ tree, focusTrees }) =>
      focusTrees ? computeFocusLayout(focusTrees) : computeStandardLayout(tree ?? null, 'descendants'),
  },
};

/** Resolve a layout mode; unknown IDs fall back to descendants. */
export function getLayoutMode(id: string): TreeLayoutMode {
  return MODES[id] ?? MODES.descendants;
}
