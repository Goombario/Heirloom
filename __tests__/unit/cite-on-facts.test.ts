import { describe, expect, it } from 'vitest';
import { citeOnPersonFrom, preselectedKeys, sourceYear } from '@/app/library/source-modal/citeOnFacts';
import type { PersonWithRelations } from '@/lib/db/schema';

const person = (over: Partial<PersonWithRelations>): PersonWithRelations =>
    ({ Id: 1, FirstName: 'Tom', LastName: 'Bracken', BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, events: [], ...over }) as PersonWithRelations;
const event = (Id: number, Type: string, Date: string | null) => ({ Id, Type, Date, Place: null }) as NonNullable<PersonWithRelations['events']>[number];

describe('Cite on… facts (#799)', () => {
    it('reads the year a source title names', () => {
        expect(sourceYear('1901 Census of Asteria, Brackwater, household 12')).toBe(1901);
        expect(sourceYear('Parish register of St Ives')).toBeNull();
        expect(sourceYear(null)).toBeNull();
    });

    it("lists a person's facts in timeline order, as their page shows them", () => {
        const p = citeOnPersonFrom(person({
            BirthDate: '12 MAR 1859', DeathDate: '1920',
            events: [event(5, 'RESI', '1901'), event(6, 'OCCU', null), event(4, 'RESI', '1881')],
        }));
        expect(p.name).toBe('Tom Bracken');
        // Dated rows by year, then the undated occupation last.
        expect(p.facts.map(f => f.key)).toEqual(['PersonBirth:1', 'Events:4', 'Events:5', 'PersonDeath:1', 'Events:6']);
    });

    it("offers no birth row when there's no birth, or when a BIRT event carries it", () => {
        expect(citeOnPersonFrom(person({})).facts).toEqual([]);
        const withEvent = citeOnPersonFrom(person({ BirthDate: '1859', events: [event(9, 'BIRT', '1859')] }));
        expect(withEvent.facts.map(f => f.key)).toEqual(['Events:9']);
    });

    it("ticks the uncited facts dated in the source's year", () => {
        const p = citeOnPersonFrom(person({ BirthDate: '1901', events: [event(5, 'RESI', 'ABT 1901'), event(7, 'RESI', '1911')] }));
        expect(preselectedKeys(p, 1901, new Set(['PersonBirth:1']))).toEqual(['Events:5']);
        expect(preselectedKeys(p, null, new Set())).toEqual([]);
    });
});
