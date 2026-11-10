/**
 * The name every user's first tree is created with. It is stored in English
 * (server provisioning and PGlite init both write it), so readers see it
 * through `useTreeDisplayName`, which shows it in their language (#704).
 */
export const DEFAULT_TREE_NAME = 'My Tree';

/** The stored name, or `defaultLabel` when it is still the untouched default. */
export function treeDisplayName(name: string, defaultLabel: string): string;
export function treeDisplayName(name: string | null | undefined, defaultLabel: string): string | null;
export function treeDisplayName(name: string | null | undefined, defaultLabel: string): string | null {
  if (name == null) return null;
  return name === DEFAULT_TREE_NAME ? defaultLabel : name;
}
