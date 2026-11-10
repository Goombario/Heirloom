import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * #513: BIRT/DEAT (person) and MARR (family) are PROMOTED to columns. GEDCOM lets a
 * record carry several — a civil and a religious marriage, a baptismal and a
 * recorded birth — but a column holds exactly one, so the second used to overwrite
 * the first with no trace.
 *
 * The fix demotes repeats to record-level passthrough. The FIRST occurrence still
 * owns the column, so nothing about the common case moves; the second survives
 * verbatim and re-emits as a valid second block.
 */
describe('a second promoted person event is preserved, not overwritten (#513)', () => {
  const TWO_BIRT = [
    '0 @I1@ INDI',
    '1 NAME John /Doe/',
    '1 BIRT',
    '2 DATE 26 AUG 1819',
    '2 PLAC Paris',
    '1 BIRT',
    '2 DATE 3 MAR 1900',
    '2 PLAC Rome',
    '0 TRLR',
  ].join('\n');

  it('keeps the FIRST block in the promoted columns', () => {
    const p = parseGedcom(TWO_BIRT).people[0];
    expect(p.BirthDate).toBe('1819-08-26');
    expect(p.BirthPlace).toBe('Paris');
  });

  it('captures the whole second block verbatim, opening line included', () => {
    const p = parseGedcom(TWO_BIRT).people[0];
    expect(p.rawLines).toEqual(['1 BIRT', '2 DATE 3 MAR 1900', '2 PLAC Rome']);
  });

  it('does not leak the second block into the first block\'s sub-capture', () => {
    const p = parseGedcom(TWO_BIRT).people[0];
    // birthRawLines is for UNMODELED children of the FIRST BIRT. DATE/PLAC are
    // modeled, and the second block rides rawLines — so this stays empty.
    expect(p.birthRawLines).toEqual([]);
  });

  it('re-emits both blocks, and the round trip is a fixed point', () => {
    const first = parseGedcom(TWO_BIRT).people[0];
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      BirthDate: first.BirthDate, BirthPlace: first.BirthPlace,
      RawGedcom: first.rawLines.join('\n'),
      events: [],
    } as unknown as PersonWithRelations;

    const out = generateGedcom([person], []);
    expect(out.match(/^1 BIRT$/gm)).toHaveLength(2);
    expect(out).toContain('2 DATE 3 MAR 1900');

    // Reparsing must land in the same place — first block to columns, second to
    // rawLines — or the file would drift a little further on every round trip.
    const second = parseGedcom(out).people[0];
    expect(second.BirthDate).toBe('1819-08-26');
    expect(second.rawLines).toEqual(first.rawLines);
  });

  it('treats a second DEAT the same way and does not re-flip IsDeceased', () => {
    const ged = [
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 DEAT', '2 DATE 1950',
      '1 DEAT', '2 DATE 1960',
      '0 TRLR',
    ].join('\n');
    const p = parseGedcom(ged).people[0];
    expect(p.DeathDate).toBe('1950');
    expect(p.IsDeceased).toBe(1);
    expect(p.rawLines).toEqual(['1 DEAT', '2 DATE 1960']);
  });

  it('leaves a single promoted event completely unchanged', () => {
    const p = parseGedcom('0 @I1@ INDI\n1 NAME A /B/\n1 BIRT\n2 DATE 1819\n0 TRLR').people[0];
    expect(p.BirthDate).toBe('1819');
    expect(p.rawLines).toEqual([]);
  });

  it('counts occurrences per RECORD, not per file', () => {
    const ged = [
      '0 @I1@ INDI', '1 NAME A /B/', '1 BIRT', '2 DATE 1819',
      '0 @I2@ INDI', '1 NAME C /D/', '1 BIRT', '2 DATE 1830',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    // The second person's BIRT is their FIRST — it must own the column, not be
    // demoted because a different record already used the tag.
    expect(people[1].BirthDate).toBe('1830');
    expect(people[1].rawLines).toEqual([]);
  });
});

describe('a second promoted family event is preserved, not overwritten (#513)', () => {
  const TWO_MARR = [
    '0 @I1@ INDI', '1 NAME H /X/',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 MARR',
    '2 DATE 1 JAN 1900',
    '2 PLAC Mairie',
    '1 MARR',
    '2 DATE 2 JAN 1900',
    '2 PLAC Église',
    '0 TRLR',
  ].join('\n');

  it('keeps the civil marriage in the column and the religious one verbatim', () => {
    const f = parseGedcom(TWO_MARR).families[0];
    expect(f.MarriageDate).toBe('1900-01-01');
    expect(f.MarriagePlace).toBe('Mairie');
    expect(f.rawLines).toEqual(['1 MARR', '2 DATE 2 JAN 1900', '2 PLAC Église']);
  });

  it('re-emits two MARR blocks and neither date is lost', () => {
    const f = parseGedcom(TWO_MARR).families[0];
    const family = {
      Id: 1, MarriageDate: f.MarriageDate, MarriagePlace: f.MarriagePlace,
      RawGedcom: f.rawLines.join('\n'),
      children: [], events: [],
    } as unknown as FamilyWithRelations;

    const out = generateGedcom([], [family]);
    expect(out.match(/^1 MARR$/gm)).toHaveLength(2);
    expect(out).toContain('2 DATE 1 JAN 1900');
    expect(out).toContain('2 DATE 2 JAN 1900');
  });
});
