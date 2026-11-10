import type { TreeNode, FocusTrees } from '@/app/components/tree/types';

/**
 * Generation depth of a hierarchy measured over `children` links.
 * A lone node (no children) is depth 0; root + one generation is depth 1, etc.
 * Spouses and root siblings do not add depth — only the `children` chain does.
 */
export function treeDepth(node: TreeNode | null | undefined): number {
  if (!node || !node.children || node.children.length === 0) return 0;
  let max = 0;
  for (const child of node.children) {
    const d = treeDepth(child);
    if (d > max) max = d;
  }
  return 1 + max;
}

/**
 * Return `node` with its `children` chain truncated to `maxDepth` generations
 * (root = depth 0, so `maxDepth` = number of generations kept *below* the root).
 *
 * - `maxDepth < 0` → no pruning; the original node is returned **by identity**
 *   (so a `useMemo` keyed on the tree does not invalidate when "show all").
 * - When a subtree is already within `maxDepth`, its original references are
 *   preserved — only branches that are actually cut allocate new objects.
 */
export function pruneTreeDepth(node: TreeNode, maxDepth: number): TreeNode {
  if (maxDepth < 0) return node;
  if (!node.children || node.children.length === 0) return node;
  if (maxDepth === 0) return { ...node, children: [] };

  let changed = false;
  const nextChildren = node.children.map((child) => {
    const pruned = pruneTreeDepth(child, maxDepth - 1);
    if (pruned !== child) changed = true;
    return pruned;
  });
  return changed ? { ...node, children: nextChildren } : node;
}

/**
 * Path of nodes from `node` down to the node with id `targetId` (inclusive),
 * or null if the target isn't in this subtree.
 */
function pathTo(node: TreeNode, targetId: number): TreeNode[] | null {
  if (node.id === targetId) return [node];
  for (const child of node.children ?? []) {
    const sub = pathTo(child, targetId);
    if (sub) return [node, ...sub];
  }
  return null;
}

/**
 * How many generations *above the focus person* an ancestor chain spans.
 * The chain is rooted at the oldest ancestor and terminates at `leafId`
 * (the focus person's parent = 1 generation up), so the count is the length of
 * the root→leaf path.
 */
function ancestorGens(chain: TreeNode | null, leafId: number | null): number {
  if (!chain || leafId == null) return 0;
  const path = pathTo(chain, leafId);
  return path ? path.length : treeDepth(chain) + 1;
}

/**
 * Keep the `gens` ancestor generations **nearest the focus person** — i.e. the
 * leaf (`leafId`, the focus's parent) end of a chain rooted at the oldest
 * ancestor. Re-roots the chain so exactly `gens` levels remain (the naïve
 * root-anchored prune would instead trim the generations closest to the focus).
 * `gens <= 0` drops the chain entirely.
 */
function pruneAncestorChain(chain: TreeNode, leafId: number | null, gens: number): TreeNode | null {
  if (gens <= 0) return null;
  const path = leafId == null ? null : pathTo(chain, leafId);
  if (!path) return pruneTreeDepth(chain, gens - 1); // fallback: leaf not on a path
  const startIdx = Math.max(0, path.length - gens);
  const newRoot = path[startIdx];
  const keepDepth = path.length - 1 - startIdx; // levels from newRoot down to the leaf
  return pruneTreeDepth(newRoot, keepDepth);
}

/**
 * Deepest generation of a focus view **measured from the focus person** — the
 * max of the paternal generations up, the maternal generations up, and the
 * descendant generations down. Drives the depth slider's maximum.
 */
export function focusMaxDepth(ft: FocusTrees): number {
  // center is rooted at the focus's parent, so the focus sits at depth 1 and
  // descendant generations below the focus = center depth − 1. Stage A has no
  // ancestor chains and the center is rooted at the focus person itself.
  if (ft.stage === 'A') return treeDepth(ft.center);
  const descGens = Math.max(0, treeDepth(ft.center) - 1);
  return Math.max(ancestorGens(ft.left, ft.leftParentId), ancestorGens(ft.right, ft.rightParentId), descGens);
}

/**
 * Prune a focus view to `depth` generations **from the focus person** in both
 * directions: `depth` ancestor generations up each chain and `depth` descendant
 * generations down. Identity is preserved when nothing is cut (memo-friendly).
 */
export function pruneFocusDepth(ft: FocusTrees, depth: number): FocusTrees {
  if (depth < 0) return ft;
  if (ft.stage === 'A') {
    const center = pruneTreeDepth(ft.center, depth); // center rooted at focus → depth = gens below
    return center === ft.center ? ft : { ...ft, center };
  }
  const left = ft.left ? pruneAncestorChain(ft.left, ft.leftParentId, depth) : ft.left;
  const right = ft.right ? pruneAncestorChain(ft.right, ft.rightParentId, depth) : ft.right;
  const center = pruneTreeDepth(ft.center, depth + 1); // +1: focus is one level below the center root
  if (left === ft.left && right === ft.right && center === ft.center) return ft;
  return { ...ft, left, right, center };
}
