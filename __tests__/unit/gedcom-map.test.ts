import { describe, it, expect } from 'vitest';
import { gedcomLatLng, parseGedcomLat, parseGedcomLng } from '@/lib/gedcom/coords';
import { generateGedcom } from '@/lib/gedcom/generator';
import { parseGedcom } from '@/lib/gedcom/parser';
import type { PersonWithRelations } from '@/lib/db/schema';

describe('gedcom coordinate formatting', () => {
  it('formats decimal to GEDCOM signed hemisphere', () => {
    expect(gedcomLatLng(51.2802, 1.0789)).toEqual({ lati: 'N51.2802', long: 'E1.0789' });
    expect(gedcomLatLng(-33.8688, -70.6693)).toEqual({ lati: 'S33.8688', long: 'W70.6693' });
  });
  it('parses GEDCOM hemisphere strings to decimal', () => {
    expect(parseGedcomLat('N51.2802')).toBeCloseTo(51.2802, 4);
    expect(parseGedcomLat('S33.8688')).toBeCloseTo(-33.8688, 4);
    expect(parseGedcomLng('W70.6693')).toBeCloseTo(-70.6693, 4);
  });
  it('returns null for malformed input', () => {
    expect(parseGedcomLat('garbage')).toBeNull();
  });
});

describe('GEDCOM PLAC.MAP round-trip', () => {
  function makePerson(overrides: Partial<PersonWithRelations> = {}): PersonWithRelations {
    return {
      Id: 1,
      UserId: 1,
      FirstName: 'Agnes',
      LastName: 'Winterbottom',
      Sex: 'F',
      GedcomId: null,
      BirthDate: '1842-03-15',
      BirthPlace: 'Dunmow, Essex, England',
      DeathDate: null,
      DeathPlace: null,
      IsDeceased: null,
      UpdatedAt: null,
      EffectiveFirstName: null,
      Nickname: null,
      ...overrides,
    };
  }

  it('emits MAP block when coords provided for BirthPlace', () => {
    const person = makePerson();
    const coords = new Map<string, { lat: number; lng: number }>([
      ['Dunmow, Essex, England', { lat: 51.8713, lng: 0.3617 }],
    ]);

    const gedcom = generateGedcom([person], [], coords);
    const lines = gedcom.split('\n');

    const placIdx = lines.findIndex(l => l === '2 PLAC Dunmow, Essex, England');
    expect(placIdx).toBeGreaterThan(-1);
    expect(lines[placIdx + 1]).toBe('3 MAP');
    expect(lines[placIdx + 2]).toBe('4 LATI N51.8713');
    expect(lines[placIdx + 3]).toBe('4 LONG E0.3617');
  });

  it('does NOT emit MAP block when coords absent', () => {
    const person = makePerson();
    const gedcom = generateGedcom([person], []);
    expect(gedcom).not.toContain('MAP');
    expect(gedcom).not.toContain('LATI');
  });

  it('round-trips: parser extracts placeCoords from MAP block', () => {
    const person = makePerson();
    const coords = new Map<string, { lat: number; lng: number }>([
      ['Dunmow, Essex, England', { lat: 51.8713, lng: 0.3617 }],
    ]);

    const gedcom = generateGedcom([person], [], coords);
    const result = parseGedcom(gedcom);

    expect(result.placeCoords).toHaveLength(1);
    expect(result.placeCoords[0].name).toBe('Dunmow, Essex, England');
    expect(result.placeCoords[0].lat).toBeCloseTo(51.8713, 4);
    expect(result.placeCoords[0].lng).toBeCloseTo(0.3617, 4);
  });

  it('round-trip parses placeCoords from hand-crafted MAP block', () => {
    const gedcom = [
      '0 HEAD',
      '1 SOUR Test',
      '0 @I1@ INDI',
      '1 NAME Crispin /Blackwood/',
      '1 BIRT',
      '2 DATE 15 MAR 1901',
      '2 PLAC Glastonbury, Somerset, England',
      '3 MAP',
      '4 LATI N51.1449',
      '4 LONG W2.7166',
      '0 TRLR',
    ].join('\n');

    const result = parseGedcom(gedcom);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].BirthPlace).toBe('Glastonbury, Somerset, England');
    expect(result.placeCoords).toHaveLength(1);
    expect(result.placeCoords[0].name).toBe('Glastonbury, Somerset, England');
    expect(result.placeCoords[0].lat).toBeCloseTo(51.1449, 4);
    expect(result.placeCoords[0].lng).toBeCloseTo(-2.7166, 4);
  });
});

describe('coordinate range (#867)', () => {
  it('reads an impossible or malformed coordinate as none', () => {
    expect(parseGedcomLat('N95.0')).toBeNull();
    expect(parseGedcomLng('W181')).toBeNull();
    expect(parseGedcomLat('N1.2.3')).toBeNull();
    expect(parseGedcomLat('N90')).toBe(90);
    expect(parseGedcomLng('W180')).toBe(-180);
    expect(parseGedcomLat('S.5')).toBe(-0.5);
    expect(parseGedcomLat('N51.')).toBe(51);
  });
});
