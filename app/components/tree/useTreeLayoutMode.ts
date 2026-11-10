import { useMemo } from 'react';
import { LayoutOutput } from './types';
import { getLayoutMode, type TreeLayoutInput } from '@/lib/tree/layout/registry';

/**
 * The one React adapter for tree layout: dispatches to the layout-mode
 * registry (`lib/tree/layout/registry.ts`) and memoizes the pure result.
 * Replaces the former per-mode hooks (useTreeLayout / useFocusTreeLayout) so
 * the renderer carries no per-mode branching.
 *
 * Interaction state (sidebar selection, click callbacks, display prefs) is
 * intentionally NOT a layout input — it is decorated onto the nodes by
 * `TreeVisualization` after layout, so selecting a card never re-runs d3.
 */
export function useTreeLayoutMode(modeId: string, input: TreeLayoutInput): LayoutOutput {
  const tree = input.tree ?? null;
  const focusTrees = input.focusTrees ?? null;
  const orientation = input.orientation ?? 'vertical';
  return useMemo(
    () => getLayoutMode(modeId).compute({ tree, focusTrees, orientation }),
    [modeId, tree, focusTrees, orientation],
  );
}
