import { describe, it, expect } from 'vitest';
import { evaluatePeopleSearch, type PeopleSearchIndex } from '@/lib/search/evaluate-people';
import { decodeQuery, encodeQuery, normalizeQuery, type SearchCondition, type SearchQuery } from '@/lib/search/people-query';
import type { SearchPersonRow } from '@/lib/db/queries/advanced-search';

// #247: the advanced-search evaluator, on a small made-up family.
const person = (Id: number, FirstName: string, LastName: string, extra: Partial<SearchPersonRow> = {}): SearchPersonRow => ({
    Id, FirstName, LastName, Sex: null, BirthDate: null, DeathDate: null, BirthPlace: null, DeathPlace: null,
    BirthPlaceId: null, DeathPlaceId: null, IsDeceased: null, CreatedAt: null, UpdatedAt: null, HasPhoto: false, ...extra,
});

// James (1) and Agnes (2) have Clara (3) and Everett (4); Everett and Mary (5) have Ruth (6).
// Zofia (7) is no relation.
const index: PeopleSearchIndex = {
    people: [
        person(1, 'James', 'Smith', { Sex: 'M', BirthDate: '1868', DeathDate: '1939-05-02', DeathPlace: 'London, England', DeathPlaceId: 11 }),
        person(2, 'Agnes', 'Whitfield', { Sex: 'F', BirthDate: '1871', DeathDate: 'ABT 1940', DeathPlace: 'Bath, England', HasPhoto: true }),
        person(3, 'Clara', 'Smith', { Sex: 'F', BirthDate: '1899', IsDeceased: 0 }),
        person(4, 'Everett', 'Smith', { Sex: 'M', BirthDate: '1901', DeathDate: '1944', DeathPlace: 'Warsaw', DeathPlaceId: 21 }),
        person(5, 'Mary', 'Hart', { Sex: 'F' }),
        person(6, 'Ruth', 'Smith', { Sex: 'F', BirthDate: '1930' }),
        person(7, 'Zofia', 'Kowalska', { Sex: 'F', BirthDate: '1902', DeathDate: 'BET 1938 AND 1941', DeathPlaceId: 22 }),
    ],
    families: [
        { Id: 100, Partner1Id: 1, Partner2Id: 2, MarriageDate: '1895' },
        { Id: 101, Partner1Id: 4, Partner2Id: 5, MarriageDate: null },
    ],
    children: [{ FamilyId: 100, ChildId: 3 }, { FamilyId: 100, ChildId: 4 }, { FamilyId: 101, ChildId: 6 }],
    places: [
        { Id: 11, Name: 'London', ParentId: 10 }, { Id: 10, Name: 'England', ParentId: null },
        { Id: 21, Name: 'Warsaw', ParentId: 20 }, { Id: 22, Name: 'Kraków', ParentId: 20 }, { Id: 20, Name: 'Poland', ParentId: null },
    ],
    names: new Map([[3, ['Clara Jones']]]),
};

type G = SearchCondition[] | { match: 'any'; conds: SearchCondition[] };
const toQuery = (groups: G[]) => ({ groups: groups.map((g) => (Array.isArray(g) ? { match: 'all' as const, conds: g } : g)) });
const run = (...groups: G[]) => evaluatePeopleSearch(index, toQuery(groups));
const explain = (...groups: G[]) => evaluatePeopleSearch(index, toQuery(groups), true);
const ids = (r: { ids: number[] | null }) => [...(r.ids ?? [])].sort((a, b) => a - b);

describe('advanced search (#247)', () => {
    it('matches approximate dates by range: died between 1939 and 1945', () => {
        expect(ids(run([{ field: 'death_date', op: 'between', v: '1939', v2: '1945' }]))).toEqual([1, 2, 4, 7]);
        expect(ids(run([{ field: 'death_date', op: 'before', v: '1940' }]))).toEqual([1, 2, 7]);
        expect(ids(run([{ field: 'death_date', op: 'unknown' }]))).toEqual([3, 5, 6]);
    });

    it('finds a place and everything inside it', () => {
        expect(ids(run([{ field: 'death_place', op: 'is_in', v: 'poland' }]))).toEqual([4, 7]);
        // Text with no place record still matches by its parts.
        expect(ids(run([{ field: 'death_place', op: 'is_in', v: 'England' }]))).toEqual([1, 2]);
    });

    it('ORs groups and ANDs inside one: the issue\'s example', () => {
        const r = run(
            [{ field: 'death_date', op: 'between', v: '1939', v2: '1945' }, { field: 'death_place', op: 'is_in', v: 'Poland' }],
            [{ field: 'relationship', op: 'related', id: 1, rel: 'related', marriage: true, steps: 6 }, { field: 'sex', op: 'is', v: 'F' }],
        );
        expect(ids(r)).toEqual([2, 3, 4, 5, 6, 7]);
    });

    it('counts relatives by blood only when asked, within the steps', () => {
        const rel = (extra: Partial<SearchCondition>) => ids(run([{ field: 'relationship', op: 'related', id: 3, rel: 'related', marriage: true, steps: 6, ...extra }]));
        expect(rel({})).toEqual([1, 2, 4, 5, 6]);
        // Mary is Clara's sister-in-law: not blood.
        expect(rel({ marriage: false })).toEqual([1, 2, 4, 6]);
        expect(rel({ marriage: false, steps: 2 })).toEqual([1, 2, 4]);
        expect(rel({ rel: 'ancestor' })).toEqual([1, 2]);
        expect(ids(run([{ field: 'relationship', op: 'related', id: 1, rel: 'descendant', steps: 1 }]))).toEqual([3, 4]);
        expect(ids(run([{ field: 'relationship', op: 'related', id: 4, rel: 'close' }]))).toEqual([3, 5, 6]);
    });

    it('reads names, other names and the chips\' fields', () => {
        expect(ids(run([{ field: 'anyname', op: 'contains', v: 'jones' }]))).toEqual([3]);
        expect(ids(run([{ field: 'anyname', op: 'is', v: 'clara jones' }]))).toEqual([3]);
        expect(ids(run([{ field: 'surname', op: 'starts_with', v: 'Smi' }]))).toEqual([1, 3, 4, 6]);
        expect(ids(run([{ field: 'parents', op: 'has_none' }, { field: 'children', op: 'has' }]))).toEqual([1, 2, 5]);
        expect(ids(run([{ field: 'media', op: 'has' }]))).toEqual([2]);
        expect(ids(run([{ field: 'living', op: 'is_not', v: 'deceased' }]))).toEqual([3, 5, 6]);
        expect(ids(run([{ field: 'age_at_death', op: 'less', v: '50' }]))).toEqual([4, 7]);
    });

    it('says how many each removal would bring back when nothing matches', () => {
        const r = explain([{ field: 'death_place', op: 'is_in', v: 'Poland' }, { field: 'media', op: 'has' }]);
        expect(r.ids).toEqual([]);
        expect(r.without).toEqual([1, 2]);
    });

    it('treats an empty query as everyone, and skips an unfinished condition', () => {
        expect(run().ids).toBeNull();
        expect(run([{ field: 'surname', op: 'is' }]).ids).toBeNull();
    });
});

describe('the query in the address', () => {
    it('round-trips, and drops what it can\'t read', () => {
        const q: SearchQuery = { groups: [{ match: 'any', conds: [{ field: 'given', op: 'contains', v: 'Zoë' }, { field: 'relationship', op: 'related', id: 4, rel: 'blood' as never, steps: 99 }] }] };
        const back = decodeQuery(encodeQuery(q));
        expect(back.groups[0].conds[0]).toEqual({ field: 'given', op: 'contains', v: 'Zoë' });
        expect(back.groups[0].conds[1]).toMatchObject({ rel: 'related', marriage: true, steps: 20 });
        expect(decodeQuery('not-base64!')).toEqual({ groups: [] });
        expect(normalizeQuery({ groups: [{ conds: [{ field: 'sex', op: 'contains' }, { field: 'nope', op: 'is' }] }] })).toEqual({ groups: [] });
    });
});
