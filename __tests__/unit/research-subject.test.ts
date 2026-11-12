import { describe, expect, it } from 'vitest';
import { familyResearchSubject, leadResearchSubject, personResearchSubject } from '@/lib/research/subject';

const person = {
    FirstName: 'Edith May',
    LastName: 'Hollis',
    Sex: 'F',
    BirthDate: 'ABT 1868',
    BirthPlace: 'Maidstone, Kent, England',
    DeathDate: '14 FEB 1931',
    DeathPlace: 'Buffalo, Erie, New York, USA',
    IsDeceased: 1,
};
const walter = { FirstName: 'Walter', LastName: 'Ashby' };
const family = { Id: 40, MarriageDate: '3 JUN 1890', MarriagePlace: 'Toronto, York, Ontario, Canada' };
const personPage = {
    ...person,
    events: [
        { Id: 9, Type: 'CENS', Date: '1901', Place: 'Buffalo, Erie, New York, USA' },
        { Id: 10, Type: 'OCCU', Date: null, Place: null },
    ],
    spouses: [{ person: walter, family }],
};
const variants = [{ Type: 'Married', Name: 'Edith Ashby', FromDate: '1890' }];

describe('personResearchSubject', () => {
    it('reads the birth and death facts from the person', () => {
        const birth = personResearchSubject(personPage, variants, 'PersonBirth', 1, 2026)!;
        expect(birth.input.fact).toEqual({ kind: 'birth', date: 'ABT 1868', place: 'Maidstone, Kent, England' });
        const death = personResearchSubject(personPage, variants, 'PersonDeath', 1, 2026)!;
        expect(death.input.fact).toEqual({ kind: 'death', date: '14 FEB 1931', place: 'Buffalo, Erie, New York, USA' });
        expect(death.input.marriages).toEqual([{ date: '3 JUN 1890', spouse: walter }]);
        expect(death.input.nameVariants).toBe(variants);
    });

    it('treats the name facts as a name search', () => {
        for (const table of ['PersonName', 'NameVariant', 'People']) {
            expect(personResearchSubject(personPage, variants, table, 1, 2026)!.input.fact.kind).toBe('name');
        }
    });

    it('maps an event by its type, and returns null for an event the page lacks', () => {
        expect(personResearchSubject(personPage, variants, 'Events', 9, 2026)!.input.fact)
            .toEqual({ kind: 'census', date: '1901', place: 'Buffalo, Erie, New York, USA' });
        expect(personResearchSubject(personPage, variants, 'Events', 10, 2026)!.input.fact.kind).toBe('other');
        expect(personResearchSubject(personPage, variants, 'Events', 99, 2026)).toBeNull();
    });

    it('takes a marriage from the family it belongs to', () => {
        const marriage = personResearchSubject(personPage, variants, 'FamilyMarriage', 40, 2026)!;
        expect(marriage.input.fact).toEqual({
            kind: 'marriage', date: '3 JUN 1890', place: 'Toronto, York, Ontario, Canada',
            marriage: { date: '3 JUN 1890', spouse: walter },
        });
        expect(personResearchSubject(personPage, variants, 'FamilyMarriage', 41, 2026)).toBeNull();
    });

    it('returns null for a fact that is not about the person', () => {
        expect(personResearchSubject(personPage, variants, 'Cases', 1, 2026)).toBeNull();
    });

    it('carries the first name and the living check', () => {
        const deceased = personResearchSubject(personPage, variants, 'PersonBirth', 1, 2026)!;
        expect(deceased.firstName).toBe('Edith');
        expect(deceased.mayBeLiving).toBe(false);
        const unknown = personResearchSubject({ ...personPage, IsDeceased: null, DeathDate: null, BirthDate: '1950' }, [], 'PersonBirth', 1, 2026)!;
        expect(unknown.mayBeLiving).toBe(true);
        const undated = personResearchSubject({ ...personPage, IsDeceased: null, DeathDate: null, BirthDate: null }, [], 'PersonBirth', 1, 2026)!;
        expect(undated.mayBeLiving).toBe(true);
    });
});

describe('familyResearchSubject', () => {
    const husband = { ...person, FirstName: 'Walter', LastName: 'Ashby', Sex: 'M' };
    const detail = {
        family,
        husband,
        wife: person,
        events: [{ Id: 5, Type: 'MARR', Date: '1890', Place: 'Toronto' }, { Id: 6, Type: 'DIV', Date: '1910', Place: null }],
    };

    it('searches the marriage under the wife, with the husband as the spouse', () => {
        const subject = familyResearchSubject(detail, 'FamilyMarriage', 40, 2026)!;
        expect(subject.input.person).toBe(person);
        expect(subject.input.fact).toEqual({
            kind: 'marriage', date: '3 JUN 1890', place: 'Toronto, York, Ontario, Canada',
            marriage: { date: '3 JUN 1890', spouse: husband },
        });
        expect(familyResearchSubject(detail, 'Families', 40, 2026)!.input.fact.kind).toBe('marriage');
    });

    it('takes the first partner when neither is a woman, and null with no partner', () => {
        const pair = { family, husband, wife: { ...person, Sex: 'M' } };
        expect(familyResearchSubject(pair, 'FamilyMarriage', 40, 2026)!.input.person).toBe(husband);
        expect(familyResearchSubject({ family, husband: null, wife: null }, 'FamilyMarriage', 40, 2026)).toBeNull();
    });

    it('maps a family event, keeping the spouse on a marriage event', () => {
        expect(familyResearchSubject(detail, 'Events', 5, 2026)!.input.fact)
            .toEqual({ kind: 'marriage', date: '1890', place: 'Toronto', marriage: { date: '1890', spouse: husband } });
        expect(familyResearchSubject(detail, 'Events', 6, 2026)!.input.fact).toEqual({ kind: 'other', date: '1910', place: null });
        expect(familyResearchSubject(detail, 'Events', 7, 2026)).toBeNull();
    });
});

describe('leadResearchSubject (#58)', () => {
    it('searches the lead years and the case place as a residence', () => {
        const s = leadResearchSubject(personPage, { fromYear: 1890, toYear: 1900, place: 'Toronto' }, 2026);
        expect(s.input.fact).toEqual({ kind: 'residence', date: 'BET 1890 AND 1900', place: 'Toronto' });
        expect(s.input.marriages).toEqual([{ date: '3 JUN 1890', spouse: walter }]);
        expect(s.firstName).toBe('Edith');
    });

    it('takes one year, or one open end', () => {
        expect(leadResearchSubject(person, { fromYear: 1901, toYear: 1901, place: null }, 2026).input.fact.date).toBe('1901');
        expect(leadResearchSubject(person, { fromYear: 1901, toYear: null, place: null }, 2026).input.fact.date).toBe('AFT 1901');
        expect(leadResearchSubject(person, { fromYear: null, toYear: 1901, place: null }, 2026).input.fact.date).toBe('BEF 1901');
    });

    it('searches the name with no years and no place', () => {
        expect(leadResearchSubject(person, { fromYear: null, toYear: null, place: null }, 2026).input.fact).toEqual({ kind: 'name', date: null, place: null });
    });
});
