import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * ADR 0012 — "Child linkage". `PEDI` is the standard pedigree-linkage tag, nested
 * under the child's own `1 FAMC` (CHILD_TO_FAMILY_LINK, ged551-2.txt:351-357), with
 * values `[ adopted | birth | foster | sealing ]` (ged551-3.txt:1000-1002). It maps
 * onto both partners' `FamilyPerson."Partner1Relationship"` / `"Partner2Relationship"`
 * (#982); FTM's per-parent `_FREL` / `_MREL` set one partner each.
 *
 * `sealing` is an LDS ordinance with no equivalent in this app and stays unmapped —
 * it falls back to the column default rather than inventing a value.
 *
 * This replaces the non-standard `2 _RELTYPE` under `FAM.CHIL` that previously
 * carried the same column, in both directions (maintainer decision, 2026-08-02).
 * Note the deliberate consequence covered at the bottom of this file: a GEDCOM this
 * app exported BEFORE that change re-imports with Adoption/Foster downgraded to
 * Birth, because `_RELTYPE` nests under `CHIL` — itself a handled level-1 tag — so
 * the #423 passthrough never captured it either.
 */

function ged(pedi: string | null): string {
    return [
        '0 HEAD',
        '0 @I1@ INDI',
        '1 NAME Kid /Doe/',
        '1 FAMC @F1@',
        ...(pedi ? [`2 PEDI ${pedi}`] : []),
        '0 @F1@ FAM',
        '1 CHIL @I1@',
        '0 TRLR',
    ].join('\n');
}

/** The type the importer would write for this child link; PEDI sets both partners alike. */
function importedRelType(gedcom: string): string {
    const { families } = parseGedcom(gedcom);
    const rel = families[0].chilRelationships['@I1@'];
    if (!rel) return 'Birth';
    expect(rel.partner2).toBe(rel.partner1);
    return rel.partner1;
}

describe('PEDI import (ADR 0012)', () => {
    it('maps adopted to Adoption', () => {
        expect(importedRelType(ged('adopted'))).toBe('Adoption');
    });

    it('maps birth to Birth', () => {
        expect(importedRelType(ged('birth'))).toBe('Birth');
    });

    it('maps foster to Foster', () => {
        expect(importedRelType(ged('foster'))).toBe('Foster');
    });

    it('leaves sealing unmapped, falling back to Birth', () => {
        expect(importedRelType(ged('sealing'))).toBe('Birth');
    });

    it('falls back to Birth for an unrecognised value', () => {
        expect(importedRelType(ged('stepchild'))).toBe('Birth');
    });

    it('accepts the capitalised spelling real exporters emit', () => {
        expect(importedRelType(ged('Adopted'))).toBe('Adoption');
    });

    it('defaults to Birth when no PEDI is present', () => {
        expect(importedRelType(ged(null))).toBe('Birth');
    });

    it('keeps an unmapped value on the link, as spelled, and counts it (#954)', () => {
        const { families, unmappedChildRelationships } = parseGedcom(ged('Step'));
        expect(families[0].chilFamcRaw['@I1@']).toBe('2 PEDI Step');
        expect(unmappedChildRelationships).toEqual({ count: 1, values: ['Step'] });
    });

    it('keeps nothing raw and counts nothing for a mapped value (#954)', () => {
        const { families, unmappedChildRelationships } = parseGedcom(ged('adopted'));
        expect(families[0].chilFamcRaw['@I1@']).toBeUndefined();
        expect(unmappedChildRelationships).toEqual({ count: 0, values: [] });
    });

    it('lists distinct unmapped values case-insensitively (#954)', () => {
        const { unmappedChildRelationships } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI', '1 FAMC @F1@', '2 PEDI step',
            '0 @I2@ INDI', '1 FAMC @F1@', '2 PEDI STEP',
            '0 @I3@ INDI', '1 FAMC @F1@', '2 PEDI sealing',
            '0 @F1@ FAM', '1 CHIL @I1@', '1 CHIL @I2@', '1 CHIL @I3@',
            '0 TRLR',
        ].join('\n'));
        expect(unmappedChildRelationships).toEqual({ count: 3, values: ['step', 'sealing'] });
    });

    it('ignores a PEDI nested under an ADOP event rather than a FAMC', () => {
        // `2 FAMC` inside an adoption event names the adopting family and is
        // already level-guarded; its PEDI must not leak onto the real child link.
        const { families } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME Kid /Doe/',
            '1 FAMC @F1@',
            '1 ADOP',
            '2 FAMC @F1@',
            '3 PEDI adopted',
            '0 @F1@ FAM',
            '1 CHIL @I1@',
            '0 TRLR',
        ].join('\n'));
        expect(families[0].chilRelationships['@I1@']).toBeUndefined();
    });
});

/** A person who is a child of family 1, plus that family carrying the link type for both partners. */
function childOfFamily(relType: string | null, famcRawGedcom: string | null = null): {
    people: PersonWithRelations[];
    families: FamilyWithRelations[];
} {
    const family = { Id: 1, Partner1Id: null, Partner2Id: null } as unknown as FamilyWithRelations;
    return {
        people: [{
            Id: 5, FirstName: 'Kid', LastName: 'Doe', Sex: 'M',
            familiesAsChild: [family],
        } as unknown as PersonWithRelations],
        families: [{
            ...family,
            children: [{ Id: 5, Partner1Relationship: relType, Partner2Relationship: relType, FamcRawGedcom: famcRawGedcom }],
        } as unknown as FamilyWithRelations],
    };
}

describe('PEDI export (ADR 0012)', () => {
    it('emits adopted under the FAMC link', () => {
        const { people, families } = childOfFamily('Adoption');
        const out = generateGedcom(people, families);
        expect(out).toContain('1 FAMC @F1@');
        expect(out).toContain('2 PEDI adopted');
    });

    it('emits foster under the FAMC link', () => {
        const { people, families } = childOfFamily('Foster');
        expect(generateGedcom(people, families)).toContain('2 PEDI foster');
    });

    it('omits PEDI for the Birth default, keeping output clean', () => {
        const { people, families } = childOfFamily('Birth');
        expect(generateGedcom(people, families)).not.toContain('PEDI');
    });

    it('omits PEDI when the link type is null', () => {
        const { people, families } = childOfFamily(null);
        expect(generateGedcom(people, families)).not.toContain('PEDI');
    });

    it('nests PEDI under FAMC, not at record level', () => {
        const { people, families } = childOfFamily('Adoption');
        const lines = generateGedcom(people, families).split('\n').map((l) => l.trim());
        const famcIdx = lines.indexOf('1 FAMC @F1@');
        expect(famcIdx).toBeGreaterThan(-1);
        expect(lines[famcIdx + 1]).toBe('2 PEDI adopted');
    });

    it('no longer emits the non-standard _RELTYPE', () => {
        const { people, families } = childOfFamily('Adoption');
        expect(generateGedcom(people, families)).not.toContain('_RELTYPE');
    });
});

describe('PEDI round trip (ADR 0012)', () => {
    it('preserves Adoption across export → import', () => {
        const { people, families } = childOfFamily('Adoption');
        const out = generateGedcom(people, families);
        const reparsed = parseGedcom(out);
        const childRef = reparsed.people[0].gedcomId;
        expect(reparsed.families[0].chilRelationships[childRef]).toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
    });

    it('writes an unmapped PEDI back under its own FAMC (#954)', () => {
        const { people, families } = childOfFamily('Birth', '2 PEDI sealing\n2 STAT proven');
        const lines = generateGedcom(people, families).split('\n').map((l) => l.trim());
        const famcIdx = lines.indexOf('1 FAMC @F1@');
        expect(lines.slice(famcIdx + 1, famcIdx + 3)).toEqual(['2 PEDI sealing', '2 STAT proven']);
        const reparsed = parseGedcom(lines.join('\n'));
        const childRef = reparsed.people[0].gedcomId;
        expect(reparsed.families[0].chilRelationships[childRef]).toBeUndefined();
        expect(reparsed.families[0].chilFamcRaw[childRef]).toBe('2 PEDI sealing\n2 STAT proven');
    });
});

describe('_RELTYPE retirement (maintainer decision 2026-08-02)', () => {
    it('no longer reads _RELTYPE, downgrading pre-change exports to Birth', () => {
        // Deliberate, accepted data loss. Recorded so the behaviour is a decision
        // with a test, not a silent regression someone later "fixes" by accident.
        const { families } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME Kid /Doe/',
            '1 FAMC @F1@',
            '0 @F1@ FAM',
            '1 CHIL @I1@',
            '2 _RELTYPE Adoption',
            '0 TRLR',
        ].join('\n'));
        expect(families[0].chilRelationships['@I1@']).toBeUndefined();
    });
});

describe('FAMC sub-tag passthrough (#954)', () => {
    // ADR 0013 accepted dropping FAMC's unmodeled sub-tags (e.g. `2 STAT`,
    // CHILD_LINKAGE_STATUS) until a dedicated per-FAMC raw column existed, rather
    // than sweeping them into whichever event scope happened to be open.
    // `FamilyPerson."FamcRawGedcom"` is that column: they now ride the link.
    it('keeps an unmodeled FAMC sub-tag on its link, not on a prior event', () => {
        const { people, families } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME Kid /Doe/',
            '1 DEAT',
            '2 DATE 1900',
            '1 FAMC @F1@',
            '2 STAT proven',
            '0 @F1@ FAM',
            '1 CHIL @I1@',
            '0 TRLR',
        ].join('\n'));
        const p = people[0];
        expect(p.deathRawLines).not.toContain('2 STAT proven');
        expect(p.rawLines).not.toContain('2 STAT proven');
        expect(families[0].chilFamcRaw['@I1@']).toBe('2 STAT proven');
    });

    it('still captures PEDI on a FAMC that follows a DEAT', () => {
        const { families } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME Kid /Doe/',
            '1 DEAT',
            '2 DATE 1900',
            '1 FAMC @F1@',
            '2 PEDI adopted',
            '0 @F1@ FAM',
            '1 CHIL @I1@',
            '0 TRLR',
        ].join('\n'));
        expect(families[0].chilRelationships['@I1@']).toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
    });

    it('does not let a FAMC sub-tag pollute the death passthrough', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME Kid /Doe/',
            '1 DEAT',
            '2 CAUS Fever',
            '1 FAMC @F1@',
            '2 PEDI adopted',
            '0 TRLR',
        ].join('\n'));
        // CAUS is modeled as DeathCause; PEDI does not follow it into the
        // structured death scope.
        expect(people[0].DeathCause).toBe('Fever');
        expect(people[0].deathRawLines).not.toContain('2 CAUS Fever');
        expect(people[0].deathRawLines).not.toContain('2 PEDI adopted');
    });
});

describe("FTM's _FREL / _MREL under CHIL (#961, #982)", () => {
    function ftm(frel: string, mrel: string, pedi: string | null = null): string {
        return [
            '0 HEAD',
            '0 @F2@ INDI', '1 NAME Dad /Doe/', '0 @M2@ INDI', '1 NAME Mum /Doe/',
            '0 @I1@ INDI', '1 NAME Kid /Doe/', '1 FAMC @F1@', ...(pedi ? [`2 PEDI ${pedi}`] : []),
            '0 @F1@ FAM', '1 HUSB @F2@', '1 WIFE @M2@', '1 CHIL @I1@', `2 _FREL ${frel}`, `2 _MREL ${mrel}`, '2 _PREF Y',
            '0 TRLR',
        ].join('\n');
    }

    it('sets each partner from its own line, and takes them off the passthrough', () => {
        const { families, unmappedChildRelationships } = parseGedcom(ftm('Step', 'Guardian'));
        expect(families[0].chilRelationships['@I1@']).toEqual({ partner1: 'Step', partner2: 'Guardian' });
        expect(families[0].chilRawLines['@I1@']).toEqual(['2 _PREF Y']);
        expect(unmappedChildRelationships).toEqual({ count: 0, values: [] });
    });

    it('keeps a blended family apart: Natural to one partner, Step to the other', () => {
        const { families } = parseGedcom(ftm('Natural', 'Step'));
        expect(families[0].chilRelationships['@I1@']).toEqual({ partner1: 'Birth', partner2: 'Step' });
    });

    it('keeps two different types, one per partner', () => {
        const { families } = parseGedcom(ftm('Adopted', 'Foster'));
        expect(families[0].chilRelationships['@I1@']).toEqual({ partner1: 'Adoption', partner2: 'Foster' });
    });

    it('lets _FREL / _MREL win over a standard PEDI, partner by partner', () => {
        expect(parseGedcom(ftm('Adopted', 'Adopted', 'birth')).families[0].chilRelationships['@I1@'])
            .toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
        expect(parseGedcom(ftm('Natural', 'Step', 'adopted')).families[0].chilRelationships['@I1@'])
            .toEqual({ partner1: 'Birth', partner2: 'Step' });
    });

    it('keeps a value with no type raw and counts it; PEDI still sets that partner', () => {
        const { families, unmappedChildRelationships } = parseGedcom(ftm('Private', 'Natural', 'adopted'));
        expect(families[0].chilRelationships['@I1@']).toEqual({ partner1: 'Adoption', partner2: 'Birth' });
        expect(families[0].chilRawLines['@I1@']).toEqual(['2 _FREL Private', '2 _PREF Y']);
        expect(unmappedChildRelationships).toEqual({ count: 1, values: ['Private'] });
    });

    /** Family 1 with both partners, and its child's relationship to each. */
    function blended(partner1: string, partner2: string, chilRaw: string | null = null, partners: 1 | 2 = 2) {
        const family = { Id: 1, Partner1Id: 1, Partner2Id: partners === 2 ? 2 : null } as unknown as FamilyWithRelations;
        const person = (Id: number, FirstName: string, extra: object = {}) =>
            ({ Id, FirstName, LastName: 'Doe', Sex: 'U', ...extra } as unknown as PersonWithRelations);
        return {
            people: [
                person(1, 'Dad', { familiesAsSpouse: [family] }),
                ...(partners === 2 ? [person(2, 'Mum', { familiesAsSpouse: [family] })] : []),
                person(5, 'Kid', { familiesAsChild: [family] }),
            ],
            families: [{
                ...family,
                children: [{ Id: 5, Partner1Relationship: partner1, Partner2Relationship: partner2, ChilRawGedcom: chilRaw }],
            } as unknown as FamilyWithRelations],
        };
    }
    const afterChil = (out: string) => {
        const lines = out.split('\n').map((l) => l.trim());
        const chil = lines.findIndex((l) => l.startsWith('1 CHIL '));
        const end = lines.findIndex((l, i) => i > chil && l.startsWith('1 '));
        return lines.slice(chil + 1, end === -1 ? undefined : end).filter((l) => l.startsWith('2 '));
    };

    it('writes _FREL and _MREL, and no PEDI, when the partners differ', () => {
        const { people, families } = blended('Birth', 'Step');
        const out = generateGedcom(people, families);
        expect(afterChil(out)).toEqual(['2 _FREL Natural', '2 _MREL Step']);
        expect(out).not.toContain('PEDI');
    });

    it('writes a shared PEDI value as PEDI only', () => {
        const { people, families } = blended('Foster', 'Foster');
        const out = generateGedcom(people, families);
        expect(afterChil(out)).toEqual([]);
        expect(out).toContain('2 PEDI foster');
    });

    it('writes a shared value PEDI has no word for as _FREL / _MREL', () => {
        const { people, families } = blended('Guardian', 'Guardian');
        expect(afterChil(generateGedcom(people, families))).toEqual(['2 _FREL Guardian', '2 _MREL Guardian']);
    });

    it('writes only the present partner\'s tag in a one-parent family', () => {
        const { people, families } = blended('Step', 'Birth', null, 1);
        expect(afterChil(generateGedcom(people, families))).toEqual(['2 _FREL Step']);
    });

    it("keeps a raw value with no type, and writes the other partner's tag beside it", () => {
        const { people, families } = blended('Birth', 'Birth', '2 _FREL Private\n2 _PREF Y');
        expect(afterChil(generateGedcom(people, families))).toEqual(['2 _MREL Natural', '2 _FREL Private', '2 _PREF Y']);
    });

    it('round-trips a blended family', () => {
        const { people, families } = blended('Birth', 'Step');
        const reparsed = parseGedcom(generateGedcom(people, families));
        const kid = reparsed.people.find((p) => p.FirstName === 'Kid')!;
        expect(reparsed.families[0].chilRelationships[kid.gedcomId]).toEqual({ partner1: 'Birth', partner2: 'Step' });
    });

    it('emits one PEDI when the file had its own and _FREL set the type', () => {
        const { families } = parseGedcom(ftm('Adopted', 'Adopted', 'step'));
        expect(families[0].chilRelationships['@I1@']).toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
        const exp = childOfFamily('Adoption', families[0].chilFamcRaw['@I1@']);
        const out = generateGedcom(exp.people, exp.families);
        expect(out.match(/2 PEDI/g)).toEqual(['2 PEDI']);
        expect(out).toContain('2 PEDI step');
    });

    it("writes a shared type per partner when the file's own PEDI holds the FAMC", () => {
        const { people, families } = blended('Adoption', 'Adoption');
        (families[0].children![0] as { FamcRawGedcom?: string }).FamcRawGedcom = '2 PEDI step';
        const out = generateGedcom(people, families);
        expect(out.match(/2 PEDI .*/g)).toEqual(['2 PEDI step']);
        expect(afterChil(out)).toEqual(['2 _FREL Adopted', '2 _MREL Adopted']);
        const kid = parseGedcom(out).families[0];
        expect(Object.values(kid.chilRelationships)).toEqual([{ partner1: 'Adoption', partner2: 'Adoption' }]);
    });
});

describe('child-link passthrough review fixes (#954, #961)', () => {
    it('survives pointer text that names an Object member', () => {
        const parse = () => parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI', '1 FAMC constructor', '2 _X a', '1 FAMC __proto__', '2 PEDI step',
            '0 @F1@ FAM', '1 CHIL toString', '2 _FREL Step',
            '0 TRLR',
        ].join('\n'));
        expect(parse).not.toThrow();
    });

    it('does not bind a 2 SOUR under 1 FAMC to a preceding BIRT', () => {
        const { people } = parseGedcom([
            '0 HEAD', '0 @I1@ INDI', '1 BIRT', '2 DATE 1900', '1 FAMC @F1@', '2 SOUR @S1@',
            '0 @F1@ FAM', '1 CHIL @I1@', '0 @S1@ SOUR', '0 TRLR',
        ].join('\n'));
        expect(people[0].citations.map((c) => c.factTable)).toEqual(['People']);
    });
});
