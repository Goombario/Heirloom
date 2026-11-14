import { describe, it, expect } from 'vitest';
import { citedByLabel } from '@/lib/library/cited-by-label';
import type { CitedByRow } from '@/lib/db/queries/citations';

// ---------------------------------------------------------------------------
// Helpers — build minimal CitedByRow fixtures for each fact kind
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<CitedByRow> & Pick<CitedByRow, 'factTable' | 'factId'>): CitedByRow {
    return {
        citationId: 1,
        personName: null,
        eventType: null,
        eventDate: null,
        variantType: null,
        variantName: null,
        caseTitle: null,
        personId: null,
        caseId: null,
        personSex: null,
        personMediaId: null,
        familyId: null,
        familyPartner1Name: null,
        familyPartner1Sex: null,
        familyPartner1MediaId: null,
        familyPartner2Name: null,
        familyPartner2Sex: null,
        familyPartner2MediaId: null,
        page: null, quay: null, dataText: null, factDate: null, factPlace: null, sortableYear: null, fileMediaId: null, fileTitle: null, fileContentType: null,
        ...overrides,
    };
}

const person = { personId: 10, personName: 'Alice Smith' };

describe('citedByLabel – person-keyed facts name the person', () => {
    it.each([
        ['PersonBirth', 'birth'],
        ['PersonDeath', 'death'],
        ['PersonName', 'name'],
        ['People', 'person'],
    ] as const)('%s → kind "%s"', (factTable, kind) => {
        expect(citedByLabel(makeRow({ factTable, factId: 10, ...person }))).toEqual({
            kind, subject: 'Alice Smith', detail: '', date: '', href: '/people/view?id=10',
        });
    });

    it('uses "?" for a missing person name', () => {
        expect(citedByLabel(makeRow({ factTable: 'PersonBirth', factId: 10 })).subject).toBe('?');
    });
});

// #755: an event row names whose event it is and keeps its date apart for
// formatting; the caller labels it from the type, never the raw GEDCOM tag.
describe('citedByLabel – Events', () => {
    it('names the person on a person event', () => {
        const result = citedByLabel(makeRow({ factTable: 'Events', factId: 20, ...person, eventType: 'EDUC', eventDate: '1910-05-10' }));
        expect(result).toEqual({ kind: 'event', subject: 'Alice Smith', detail: '', date: '1910-05-10', href: '/people/view?id=10' });
        expect(Object.values(result)).not.toContain('EDUC');
    });

    it('names both partners on a family event and links the family', () => {
        const result = citedByLabel(makeRow({
            factTable: 'Events', factId: 21, familyId: 5, eventType: 'DIV', eventDate: '1950',
            familyPartner1Name: 'Aster Bracken', familyPartner2Name: 'Briar Bracken',
        }));
        expect(result).toEqual({ kind: 'event', subject: 'Aster Bracken & Briar Bracken', detail: '', date: '1950', href: '/families/view?id=5' });
    });

    it('has no href and a "?" subject when the event has no owner', () => {
        expect(citedByLabel(makeRow({ factTable: 'Events', factId: 22 }))).toMatchObject({ subject: '?', href: '' });
    });
});

describe('citedByLabel – NameVariant', () => {
    it('names the person and keeps the alias as detail', () => {
        expect(citedByLabel(makeRow({ factTable: 'NameVariant', factId: 30, ...person, variantType: 'Nickname', variantName: 'Ally' })))
            .toEqual({ kind: 'namevariant', subject: 'Alice Smith', detail: 'Ally', date: '', href: '/people/view?id=10' });
    });
});

describe('citedByLabel – Cases', () => {
    it('uses the case title and links the case', () => {
        expect(citedByLabel(makeRow({ factTable: 'Cases', factId: 7, caseId: 7, caseTitle: 'Who were her parents?' })))
            .toEqual({ kind: 'case', subject: 'Who were her parents?', detail: '', date: '', href: '/cases/view?id=7' });
        expect(citedByLabel(makeRow({ factTable: 'Cases', factId: 7 })).subject).toBe('?');
    });
    it('files a journal entry under its case', () => {
        expect(citedByLabel(makeRow({ factTable: 'CaseComments', factId: 21, caseId: 7, caseTitle: 'Who were her parents?' })))
            .toEqual({ kind: 'case', subject: 'Who were her parents?', detail: '', date: '', href: '/cases/view?id=7' });
    });
});

describe('citedByLabel – Families', () => {
    const row = makeRow({ factTable: 'Families', factId: 42, familyId: 42, familyPartner1Name: 'Ann Lee', familyPartner2Name: 'Bo Lee' });

    it('names the partnership by both partners and links the family', () => {
        expect(citedByLabel(row)).toEqual({ kind: 'family', subject: 'Ann Lee & Bo Lee', detail: '', date: '', href: '/families/view?id=42' });
    });
    it('reads as just the one partner when only one is recorded', () => {
        expect(citedByLabel({ ...row, familyPartner2Name: null }).subject).toBe('Ann Lee');
    });
    it('falls back to "?" when neither partner is recorded', () => {
        expect(citedByLabel({ ...row, familyPartner1Name: null, familyPartner2Name: '  ' }).subject).toBe('?');
    });
    it('has no href when the family id is missing', () => {
        expect(citedByLabel({ ...row, familyId: null }).href).toBe('');
    });
});

describe('citedByLabel – unknown fallback', () => {
    it('returns kind "unknown" with no href', () => {
        const result = citedByLabel(makeRow({ factTable: 'Mystery' as CitedByRow['factTable'], factId: 99 }));
        expect(result).toMatchObject({ kind: 'unknown', subject: 'Mystery 99', href: '' });
    });
});
