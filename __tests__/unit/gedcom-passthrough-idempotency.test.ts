import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * GED-8 (4.4): pointer-bearing subtrees the parser does not model (e.g. `1 ASSO
 * @I2@` associations) are captured verbatim into RawGedcom and re-emitted on
 * export. This verifies the round-trip is idempotent — the raw block survives a
 * second parse → generate unchanged and the `@I2@` pointer is never mangled by
 * the `@@`→`@` unescape.
 */
describe('passthrough idempotency (GED-8 / 4.4)', () => {
  const GED = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME John /Doe/',
    '1 ASSO @I2@',
    '2 RELA Godfather',
    '0 @I2@ INDI',
    '1 NAME Gus /Doe/',
    '0 TRLR',
  ].join('\n');

  it('captures the unmodeled pointer-bearing subtree verbatim', () => {
    const { people } = parseGedcom(GED);
    expect(people[0].rawLines).toContain('1 ASSO @I2@');
    expect(people[0].rawLines).toContain('2 RELA Godfather');
  });

  it('re-emits and re-captures the raw subtree identically across a round-trip', () => {
    const first = parseGedcom(GED).people[0];

    // The import stores the pointer as the record's id (#979).
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M', GedcomId: '@I1@',
      RawGedcom: first.rawLines.join('\n').replace('@I2@', '@~I:2@'),
      events: [],
    } as unknown as PersonWithRelations;
    const godfather = { Id: 2, FirstName: 'Gus', LastName: 'Doe', Sex: 'M', GedcomId: '@I2@', events: [] } as unknown as PersonWithRelations;

    const out1 = generateGedcom([person, godfather], []);
    expect(out1).toContain('1 ASSO @I2@');
    expect(out1).toContain('2 RELA Godfather');

    // Second round-trip must yield the same raw lines (idempotent, pointer intact).
    const second = parseGedcom(out1).people[0];
    expect(second.rawLines).toEqual(first.rawLines);
    expect(second.rawLines).toContain('1 ASSO @I2@');
  });
});

describe('structured death cause', () => {
  it('promotes CAUS under DEAT while leaving other unknown tags in deathRawLines', () => {
    const { people } = parseGedcom([
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 DEAT',
      '2 DATE 1970',
      '2 CAUS Heart failure',
      '2 AGNC County archive',
      '0 TRLR',
    ].join('\n'));

    expect(people[0]).toMatchObject({ DeathCause: 'Heart failure' });
    expect(people[0].deathRawLines).toEqual(['2 AGNC County archive']);
  });

  it('emits DeathCause as CAUS below DEAT', () => {
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      BirthDate: null, BirthPlace: null, DeathDate: '1970', DeathPlace: null,
      DeathCause: 'Heart failure', IsDeceased: 1, events: [],
    } as unknown as PersonWithRelations;
    const ged = generateGedcom([person], []);
    const lines = ged.split('\n');
    expect(lines.indexOf('2 CAUS Heart failure')).toBeGreaterThan(lines.indexOf('1 DEAT'));
  });
});

/**
 * #423: Events (and the BIRT/DEAT/MARR columns that stand in for an Events row)
 * had no passthrough net at all — an unmodeled sub-tag under any of them was read
 * on import and never re-emitted. This is real data loss, not a fidelity gap,
 * because unlike People/Families/Sources these have (or, for BIRT/DEAT/MARR, share)
 * no RawGedcom safety net for their own children.
 */
describe('sub-event passthrough (#423)', () => {
  it('promotes CAUS under a bare DEAT into DeathCause, not the raw passthrough fields', () => {
    const GED = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 DEAT',
      '2 DATE 12 MAR 1950',
      '2 CAUS Heart failure',
      '0 TRLR',
    ].join('\n');

    const person = parseGedcom(GED).people[0];
    expect(person.DeathCause).toBe('Heart failure');
    expect(person.deathRawLines).not.toContain('2 CAUS Heart failure');
    // Must not land in the general record-level capture — that's emitted at the
    // end of the record and would misattach it to whatever tag came last.
    expect(person.rawLines).not.toContain('2 CAUS Heart failure');
    expect(person.DeathDate).toBeTruthy();
  });

  it('re-emits CAUS nested under DEAT, not dangling at the end of the record', () => {
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      DeathDate: '1950-03-12', DeathCause: 'Heart failure',
      events: [],
    } as unknown as PersonWithRelations;

    const out = generateGedcom([person], []);
    const lines = out.split('\n');
    const deatIndex = lines.findIndex((l) => l === '1 DEAT');
    const causIndex = lines.findIndex((l) => l === '2 CAUS Heart failure');
    expect(deatIndex).toBeGreaterThanOrEqual(0);
    expect(causIndex).toBeGreaterThan(deatIndex);
    // Nothing else at level 1 may separate DEAT from its own CAUS child.
    for (let i = deatIndex + 1; i < causIndex; i++) {
      expect(lines[i].startsWith('1 ')).toBe(false);
    }
  });

  it('captures an unmodeled sub-tag of a custom person event (Events-backed) onto that event, and re-emits it nested under the same event', () => {
    const GED = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Farmer',
      '2 AGNC Union Local 55',
      '0 TRLR',
    ].join('\n');

    const parsed = parseGedcom(GED).people[0];
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].rawLines).toContain('2 AGNC Union Local 55');

    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      events: [{ Id: 1, Type: 'OCCU', Description: 'Farmer', Date: null, Place: null, RawGedcom: '2 AGNC Union Local 55' }],
    } as unknown as PersonWithRelations;

    const out = generateGedcom([person], []);
    const lines = out.split('\n');
    const occuIndex = lines.findIndex((l) => l === '1 OCCU Farmer');
    const agncIndex = lines.findIndex((l) => l === '2 AGNC Union Local 55');
    expect(occuIndex).toBeGreaterThanOrEqual(0);
    expect(agncIndex).toBeGreaterThan(occuIndex);
  });

  it('does not re-capture tags the event/BIRT/DEAT scope already models (DATE, PLAC, SOUR, NOTE, OBJE)', () => {
    const GED = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 DEAT',
      '2 DATE 12 MAR 1950',
      '2 PLAC Boston, Massachusetts',
      '2 CAUS Heart failure',
      '0 TRLR',
    ].join('\n');

    const person = parseGedcom(GED).people[0];
    expect(person.DeathCause).toBe('Heart failure');
    expect(person.deathRawLines).toEqual([]);
    expect(person.DeathDate).toBeTruthy();
    expect(person.DeathPlace).toBe('Boston, Massachusetts');
  });

  it('captures an unmodeled sub-tag of MARR into marriageRawLines and re-emits it nested under MARR', () => {
    const GED = [
      '0 HEAD',
      '0 @F1@ FAM',
      '1 MARR',
      '2 DATE 4 JUL 1900',
      '2 AGNC Church of Scotland',
      '0 TRLR',
    ].join('\n');

    const parsed = parseGedcom(GED).families[0];
    expect(parsed.marriageRawLines).toContain('2 AGNC Church of Scotland');

    const family = {
      Id: 1, MarriageDate: '1900-07-04', MarriageRawGedcom: '2 AGNC Church of Scotland',
      events: [],
    } as unknown as FamilyWithRelations;

    const out = generateGedcom([], [family]);
    const lines = out.split('\n');
    const marrIndex = lines.findIndex((l) => l === '1 MARR');
    const agncIndex = lines.findIndex((l) => l === '2 AGNC Church of Scotland');
    expect(marrIndex).toBeGreaterThanOrEqual(0);
    expect(agncIndex).toBeGreaterThan(marrIndex);
  });

  it('round-trips CAUS-under-DEAT idempotently across a second parse → generate pass', () => {
    const GED = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 DEAT',
      '2 DATE 12 MAR 1950',
      '2 CAUS Heart failure',
      '0 TRLR',
    ].join('\n');

    const first = parseGedcom(GED).people[0];
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      DeathDate: first.DeathDate, DeathCause: first.DeathCause,
      events: [],
    } as unknown as PersonWithRelations;

    const out1 = generateGedcom([person], []);
    const second = parseGedcom(out1).people[0];
    expect(second.deathRawLines).toEqual(first.deathRawLines);
    expect(second.DeathCause).toBe('Heart failure');
  });
});
