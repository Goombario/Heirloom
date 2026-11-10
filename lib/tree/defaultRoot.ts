/**
 * The person the tree opens at when no root is requested or remembered (#1055):
 * the ancestor (no recorded parents) with the most generations of descendants,
 * because the deepest line makes the best first impression. A tie goes to the
 * first one in the file, i.e. the lowest id, since import assigns ids in file order.
 *
 * Pure: no DB, no DOM.
 */

interface RootFamily {
    Id: number;
    Partner1Id: number | null;
    Partner2Id: number | null;
}

export function pickDefaultRoot(
    personIds: Iterable<number>,
    families: RootFamily[],
    childrenByFamilyId: Map<number, number[]>,
): number | undefined {
    const childIds = new Set<number>();
    const childrenOf = new Map<number, number[]>();
    for (const fam of families) {
        const kids = childrenByFamilyId.get(fam.Id) ?? [];
        for (const kid of kids) childIds.add(kid);
        for (const partner of [fam.Partner1Id, fam.Partner2Id]) {
            if (partner == null || kids.length === 0) continue;
            let list = childrenOf.get(partner);
            if (!list) childrenOf.set(partner, list = []);
            list.push(...kids);
        }
    }

    // Generations from a person down to their deepest descendant, counting the
    // person (1 = no children). Iterative so a deep line can't overflow the stack;
    // a person met again on their own line (a data loop) counts as a leaf there.
    const depth = new Map<number, number>();
    function generations(start: number): number {
        const onPath = new Set<number>();
        const stack: { id: number; next: number }[] = [{ id: start, next: 0 }];
        onPath.add(start);
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            const kids = childrenOf.get(top.id) ?? [];
            if (top.next < kids.length) {
                const kid = kids[top.next++];
                if (!depth.has(kid) && !onPath.has(kid)) {
                    onPath.add(kid);
                    stack.push({ id: kid, next: 0 });
                }
                continue;
            }
            let best = 0;
            for (const kid of kids) best = Math.max(best, depth.get(kid) ?? 0);
            depth.set(top.id, best + 1);
            onPath.delete(top.id);
            stack.pop();
        }
        return depth.get(start)!;
    }

    let root: number | undefined;
    let rootDepth = 0;
    for (const id of [...personIds].sort((a, b) => a - b)) {
        if (childIds.has(id)) continue;
        const d = generations(id);
        if (d > rootDepth) { root = id; rootDepth = d; }
    }
    return root;
}
