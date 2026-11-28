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
import type { TreeSpacing, TreeArrangement, TreePartners } from '@/lib/tree/geometry';
import { computeStandardLayout } from './standardLayout';
import { computeFocusLayout } from './focusLayout';
import { snapParentDrops } from './snapDrops';

export interface TreeLayoutInput {
  /** Single-hierarchy input (descendants / ancestors). */
  tree?: TreeNode | null;
  /** Three-subtree input (focus mode). */
  focusTrees?: FocusTrees | null;
  /** Card orientation. Applies to descendants/ancestors; focus ignores it. */
  orientation?: 'vertical' | 'horizontal';
  /** Portrait cards carry the Display menu's second name line (taller cards,
   *  generations further apart). Vertical cards only; bars ignore it. */
  secondName?: boolean;
  /** The Display menu's Spacing (#249); Normal (today's gaps) when left out. */
  spacing?: TreeSpacing;
  /** The Display menu's Arrangement (#250); focus view has none of its own. */
  arrangement?: TreeArrangement;
  /** The Display menu's Partners (#248); focus view keeps its own cards. */
  partners?: TreePartners;
}

export interface TreeLayoutMode {
  id: string;
  compute(input: TreeLayoutInput): LayoutOutput;
}

const MODES: Record<string, TreeLayoutMode> = {
  descendants: {
    id: 'descendants',
    compute: ({ tree, orientation, secondName, spacing, arrangement, partners }) => computeStandardLayout(tree ?? null, 'descendants', orientation, secondName, spacing, arrangement, partners),
  },
  ancestors: {
    id: 'ancestors',
    compute: ({ tree, orientation, secondName, spacing, arrangement, partners }) => computeStandardLayout(tree ?? null, 'ancestors', orientation, secondName, spacing, arrangement, partners),
  },
  focus: {
    id: 'focus',
    // Focus is vertical-only (Phase 1) — it ignores `orientation`. Focus without
    // focusTrees (shouldn't happen — the API populates them for mode=focus)
    // falls back to a descendants layout of whatever tree we have.
    compute: ({ tree, focusTrees, secondName, spacing }) =>
      focusTrees ? computeFocusLayout(focusTrees, secondName, spacing) : computeStandardLayout(tree ?? null, 'descendants', 'vertical', secondName, spacing),
  },
};

/** Resolve a layout mode; unknown IDs fall back to descendants. Every mode's
 *  output gets the near-child drop snap (#15). */
export function getLayoutMode(id: string): TreeLayoutMode {
  const mode = MODES[id] ?? MODES.descendants;
  return { id: mode.id, compute: (input) => snapParentDrops(mode.compute(input)) };
}
