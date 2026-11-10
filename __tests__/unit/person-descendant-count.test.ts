import { describe, it, expect } from 'vitest';
import { countTreeDescendants, type DescendantsTreeNode } from '@/app/people/view/derive';

/** Root → 2 children → 3 grandchildren = 5 descendants. */
const threeGenerations: DescendantsTreeNode = {
    id: 1,
    name: 'Root',
    children: [
        { id: 2, name: 'Child A', children: [{ id: 4, name: 'Grandchild A1' }, { id: 5, name: 'Grandchild A2' }] },
        { id: 3, name: 'Child B', children: [{ id: 6, name: 'Grandchild B1' }] },
    ],
};

describe('countTreeDescendants', () => {
    it('counts every generation, not just direct children', () => {
        expect(countTreeDescendants(threeGenerations)).toBe(5);
    });

    it('counts a leaf as having no descendants', () => {
        expect(countTreeDescendants({ id: 1, name: 'Only' })).toBe(0);
        expect(countTreeDescendants({ id: 1, name: 'Only', children: [] })).toBe(0);
    });

    it('counts each person once when they appear under two parents', () => {
        const shared: DescendantsTreeNode = {
            id: 1,
            name: 'Root',
            children: [
                { id: 2, name: 'Child A', children: [{ id: 9, name: 'Shared' }] },
                { id: 3, name: 'Child B', children: [{ id: 9, name: 'Shared' }] },
            ],
        };
        expect(countTreeDescendants(shared)).toBe(3);
    });

    // A malformed tree pointing back at an ancestor would otherwise recurse until
    // the page hangs.
    it('terminates on a cycle', () => {
        const a: DescendantsTreeNode = { id: 1, name: 'A', children: [] };
        const b: DescendantsTreeNode = { id: 2, name: 'B', children: [a] };
        a.children = [b];
        expect(countTreeDescendants(a)).toBe(1);
    });
});
