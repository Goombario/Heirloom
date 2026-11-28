import { describe, it, expect } from 'vitest';
import { chipsFromQuery, isChipOnly, setChip } from '@/app/people/advanced/chipQuery';
import type { SearchQuery } from '@/lib/search/people-query';

// #247 (P1): the People chips are rows in the first "match all" group.
describe('people chips as advanced-search rows', () => {
    it('adds, replaces and removes a chip\'s row', () => {
        let q: SearchQuery = { groups: [] };
        q = setChip(q, 'sex', 'F');
        q = setChip(q, 'living', 'no');
        expect(q).toEqual({ groups: [{ match: 'all', conds: [{ field: 'sex', op: 'is', v: 'F' }, { field: 'living', op: 'is', v: 'deceased' }] }] });
        q = setChip(q, 'living', 'yes');
        expect(q.groups[0].conds[1]).toEqual({ field: 'living', op: 'is_not', v: 'deceased' });
        expect(chipsFromQuery(q)).toMatchObject({ sex: 'F', living: 'yes', parents: 'off', surname: null });
        q = setChip(setChip(q, 'sex', null), 'living', 'off');
        expect(q).toEqual({ groups: [] });
    });

    it('reads a row the panel made as its chip, and leaves other rows alone', () => {
        const q: SearchQuery = { groups: [
            { match: 'any', conds: [{ field: 'surname', op: 'is', v: 'Kowalski' }] },
            { match: 'all', conds: [{ field: 'death_date', op: 'before', v: '1900' }, { field: 'media', op: 'has_none' }] },
        ] };
        // The chips belong to the first "all" group, not the "any" one.
        expect(chipsFromQuery(q)).toMatchObject({ surname: null, photo: 'no' });
        const next = setChip(q, 'photo', 'off');
        expect(next.groups[1].conds).toEqual([{ field: 'death_date', op: 'before', v: '1900' }]);
        expect(next.groups[0]).toEqual(q.groups[0]);
        expect(isChipOnly(q)).toBe(false);
        expect(isChipOnly({ groups: [{ match: 'all', conds: [{ field: 'parents', op: 'has' }] }] })).toBe(true);
    });
});
