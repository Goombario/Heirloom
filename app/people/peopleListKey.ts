/** The read-through cache key for a tree's people list, shared by the people page and Add family's suggestions. */
export const peopleListKey = (treeId: number | null) => `people:list:tree=${treeId ?? 'default'}`;
