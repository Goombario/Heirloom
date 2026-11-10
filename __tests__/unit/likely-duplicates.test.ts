import { describe, it, expect } from 'vitest';
import { findLikelyDuplicates, type DuplicateCandidate } from '@/lib/likely-duplicates';

/** #822: the pairing rules, without a database. */
const p = (Id: number, FirstName: string, year: number | null, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
    Id, FirstName, LastName: 'Vale', Sex: null, year, parents: [], partners: [], linked: false, ...over,
});

describe('findLikelyDuplicates', () => {
    it('matches one insertion, deletion, substitution or swap on a given name of four or more letters', () => {
        const { pairs } = findLikelyDuplicates([
            p(1, 'Jasper', 1800), p(2, 'Jsaper', 1800), // swap
            p(3, 'Merrick', 1850), p(4, 'Merick', 1851), // deletion
            p(5, 'Hollis', 1900), p(6, 'Hollis Ellis', 1900), // different given names
        ]);
        expect(pairs).toEqual([[1, 2], [3, 4]]);
    });

    it('never pairs a person with their own parent, child or partner', () => {
        const { pairs } = findLikelyDuplicates([
            p(1, 'Silas', null, { linked: true, partners: [2] }),
            p(2, 'Silas', null, { linked: true, partners: [1] }),
            p(3, 'Tobias', 1800, { linked: true }),
            p(4, 'Tobias', 1801, { linked: true, parents: [3] }),
        ]);
        expect(pairs).toEqual([]);
    });

    it('lets an unknown year match through a shared partner', () => {
        const { pairs, groups } = findLikelyDuplicates([
            p(1, 'Willa', null, { linked: true, partners: [9] }),
            p(2, 'Willa', 1790, { linked: true, partners: [9] }),
            p(3, 'Willa', null, { linked: true, partners: [8] }),
        ]);
        expect(pairs).toEqual([[1, 2]]);
        expect(groups).toEqual([[2, 1]]);
    });
});
