import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations } from '@/lib/db/schema';

/**
 * #963: citations the #810 vendor run lost without a word — on name variants, on
 * NOTE records, and inline `SOUR <text>` with no source record.
 */
const ged = (...body: string[]) => ['0 HEAD', '1 SOUR RootsMagic', ...body, '0 @S1@ SOUR', '1 TITL S', '0 TRLR'].join('\n');

describe('name-variant citations (#963)', () => {
    it.each(['NICK', '_AKA'])('binds a 2 SOUR under 1 %s to that variant', (tag) => {
        const { people } = parseGedcom(ged('0 @I1@ INDI', '1 NAME Ann /Lee/', `1 ${tag} Nan`, '2 SOUR @S1@', '3 PAGE p. 4'));
        expect(people[0].nameVariants).toEqual([
            expect.objectContaining({ Name: 'Nan', citations: [expect.objectContaining({ sourceXref: '@S1@', page: 'p. 4' })] }),
        ]);
        expect(people[0].citations).toEqual([]);
    });

    it('emits a variant citation under its own line', () => {
        const person = { Id: 1, FirstName: 'Ann', LastName: 'Lee' } as unknown as PersonWithRelations;
        const out = generateGedcom([person], [], undefined, {
            sources: [{ Id: 7, Title: 'S' }] as never,
            citations: [{ FactTable: 'NameVariant', FactId: 3, SourceId: 7, Page: 'p. 4' }] as never,
            nameVariants: [{ Id: 3, PersonId: 1, Type: 'Alias', Name: 'Nan' }],
        });
        const lines = out.split('\n').map((l) => l.trim());
        const aka = lines.indexOf('1 _AKA Nan');
        expect(lines.slice(aka + 1, aka + 3)).toEqual(['2 SOUR @S1@', '3 PAGE p. 4']);
    });
});

describe('inline SOUR (#963)', () => {
    it('keeps a person-level inline SOUR as passthrough and counts it', () => {
        const { people, inlineCitationsKept, citationsUnplaced } = parseGedcom(ged('0 @I1@ INDI', '1 NAME Ann /Lee/', '1 SOUR Inline Source 1', '2 TEXT seen'));
        expect(people[0].rawLines).toEqual(['1 SOUR Inline Source 1', '2 TEXT seen']);
        expect({ inlineCitationsKept, citationsUnplaced }).toEqual({ inlineCitationsKept: 1, citationsUnplaced: 0 });
    });

    it('keeps an inline SOUR under BIRT and under an event with that fact', () => {
        const { people, inlineCitationsKept } = parseGedcom(ged(
            '0 @I1@ INDI', '1 BIRT', '2 DATE 1900', '2 SOUR Parish book', '1 OCCU Baker', '2 SOUR Census',
        ));
        expect(people[0].birthRawLines).toEqual(['2 SOUR Parish book']);
        expect(people[0].events[0].rawLines).toEqual(['2 SOUR Census']);
        expect(inlineCitationsKept).toBe(2);
    });

    it('keeps an inline SOUR under the primary NAME on its passthrough (#964)', () => {
        const { people, inlineCitationsKept, citationsUnplaced } = parseGedcom(ged('0 @I1@ INDI', '1 NAME Ann /Lee/', '2 SOUR Family Bible'));
        expect(people[0].nameRawLines).toEqual(['2 SOUR Family Bible']);
        expect({ inlineCitationsKept, citationsUnplaced }).toEqual({ inlineCitationsKept: 1, citationsUnplaced: 0 });
    });

    it('counts an inline SOUR nothing can hold', () => {
        const { citationsUnplaced } = parseGedcom(ged('0 @I1@ INDI', '1 NAME Ann /Lee/', '1 SEX F', '2 SOUR Family Bible'));
        expect(citationsUnplaced).toBe(1);
    });
});

describe('citations with no home (#963)', () => {
    it('counts a citation on a NOTE record, but not the header SOUR', () => {
        const { citationsUnplaced, inlineCitationsKept } = parseGedcom(ged('0 @N1@ NOTE A note', '1 SOUR @S1@', '2 PAGE 3'));
        expect({ citationsUnplaced, inlineCitationsKept }).toEqual({ citationsUnplaced: 1, inlineCitationsKept: 0 });
    });

    // ADR 0024: citations on NOTE and OBJE records are counted, not kept (#981).
    it('counts a citation on an OBJE record', () => {
        const { citationsUnplaced } = parseGedcom(ged('0 @O1@ OBJE', '1 FILE a.jpg', '1 SOUR @S1@', '2 PAGE 3'));
        expect(citationsUnplaced).toBe(1);
    });
});
