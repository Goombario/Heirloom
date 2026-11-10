/**
 * Pure helpers for the tree page's stale-while-revalidate cache and mode
 * persistence. Extracted from `app/tree/page.tsx` so the key format and the
 * stored-mode validation are unit-testable in isolation (both are easy to drift
 * because they're repeated at several call sites).
 */

export type TreeMode = 'descendants' | 'ancestors' | 'focus';

/**
 * Cache key for a rendered tree. Owner is part of the key so switching shared
 * trees (same root/mode, different owner) doesn't read another owner's tree.
 * Owner may be null before it resolves; it's included verbatim so the null and
 * resolved keys stay distinct.
 */
export function buildTreeCacheKey(
  treeId: number | null,
  rootId: number,
  mode: TreeMode,
): string {
  return `tree:tree=${treeId ?? 'default'}:root=${rootId}:mode=${mode}`;
}

/**
 * Narrow an untrusted string (URL query param or localStorage value) to a
 * `TreeMode`, returning undefined for anything unrecognized. Case-sensitive:
 * only the exact lowercase mode names are accepted.
 */
export function parseTreeMode(value: string | null | undefined): TreeMode | undefined {
  return value === 'descendants' || value === 'ancestors' || value === 'focus'
    ? value
    : undefined;
}
