import { describe, it, expect } from 'vitest';
import { pickDefaultRoot } from '@/lib/tree/defaultRoot';

const fam = (Id: number, Partner1Id: number | null, Partner2Id: number | null) => ({ Id, Partner1Id, Partner2Id });

// #1055: with no root asked for, the tree opens at the ancestor with the most
// generations of descendants; a tie goes to the first in the file (lowest id).
describe('pickDefaultRoot', () => {
    it('picks the parentless person with the deepest line, not the first one', () => {
        // 1 → 2 (two generations); 3 → 4 → 5 (three generations).
        const families = [fam(10, 1, null), fam(11, 3, null), fam(12, 4, null)];
        const kids = new Map([[10, [2]], [11, [4]], [12, [5]]]);
        expect(pickDefaultRoot([1, 2, 3, 4, 5], families, kids)).toBe(3);
    });

    it('breaks a tie by file order', () => {
        const families = [fam(10, 7, null), fam(11, 3, null)];
        const kids = new Map([[10, [8]], [11, [4]]]);
        expect(pickDefaultRoot([7, 8, 3, 4], families, kids)).toBe(3);
    });

    it('counts either partner, and a childless couple adds no generation', () => {
        // 1 and 2 are a couple with child 3; 4 married 3 with no children.
        const families = [fam(10, 1, 2), fam(11, 3, 4)];
        const kids = new Map([[10, [3]]]);
        expect(pickDefaultRoot([1, 2, 3, 4], families, kids)).toBe(1);
    });

    it('falls back to the first parentless person when nobody has children', () => {
        expect(pickDefaultRoot([5, 2, 9], [], new Map())).toBe(2);
    });

    it('survives a data loop', () => {
        // 1 → 2 → 3 → 2 (bad data); 1 is the only parentless person.
        const families = [fam(10, 1, null), fam(11, 2, null), fam(12, 3, null)];
        const kids = new Map([[10, [2]], [11, [3]], [12, [2]]]);
        expect(pickDefaultRoot([1, 2, 3], families, kids)).toBe(1);
    });

    it('returns undefined for an empty tree', () => {
        expect(pickDefaultRoot([], [], new Map())).toBeUndefined();
    });
});
