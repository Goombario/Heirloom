export type TreeMode = 'descendants' | 'ancestors' | 'focus';

export interface TreePersonInfo {
    id: number;
    name: string;
    allNames?: string | null;
    isRoot: boolean;
    isLeaf: boolean;
    hasAncestors: boolean;
    hasDescendants: boolean;
    isIsolated: boolean;
}

/**
 * Token-AND search over a person's name + name variants. Empty query matches all.
 * Mirrors the inline filter the tree search box used.
 */
export function filterTreePeople<T extends { name: string; allNames?: string | null }>(
    people: T[],
    query: string,
): T[] {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return people.filter((p) => {
        const haystack = `${p.name} ${p.allNames ?? ''}`.toLowerCase();
        return tokens.length === 0 || tokens.every((token) => haystack.includes(token));
    });
}

/**
 * Best view mode for a target person: focus whenever they have ancestors — both
 * for the two-directional case and for a leaf (ancestors but no descendants),
 * whose focus view still renders usefully because the side clusters are rooted at
 * the grandparents. Only a person with no ancestors at all falls back to
 * descendants.
 */
export function bestModeFor(info: { hasAncestors?: boolean; hasDescendants?: boolean } | undefined): TreeMode {
    const canAnc = info?.hasAncestors ?? false;
    return canAnc ? 'focus' : 'descendants';
}
