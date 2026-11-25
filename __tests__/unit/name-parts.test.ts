import { describe, it, expect } from 'vitest';
import { gedcomNameText, liftNameParts } from '@/lib/gedcom/name-parts';
import { headingNameWithParts } from '@/app/people/view/derive';

// #37 (ADR 0053): a person's name prefix, surname prefix and suffix.
describe('liftNameParts', () => {
  it('lifts the first NPFX, SPFX and NSFX and leaves the rest', () => {
    const out = liftNameParts(['2 NPFX Dr', '2 TYPE birth', '2 SPFX von', '2 NSFX PhD', '2 NSFX MD'], { FirstName: 'Johann', LastName: 'Habsburg' });
    expect(out).toEqual({ NamePrefix: 'Dr', SurnamePrefix: 'von', NameSuffix: 'PhD', FirstName: 'Johann', LastName: 'Habsburg', rest: ['2 TYPE birth', '2 NSFX MD'] });
  });

  it('takes the pieces off a name that repeats them', () => {
    const out = liftNameParts(['2 NPFX Dr', '2 SPFX von', '2 NSFX PhD'], { FirstName: 'Dr Johann', LastName: 'von Habsburg' });
    expect(out).toMatchObject({ FirstName: 'Johann', LastName: 'Habsburg' });
    // "Name text Dr Johann /von Habsburg/ PhD": the suffix is after the slashes, so it isn't in either.
    expect(liftNameParts(['2 NSFX Jr.'], { FirstName: 'Tom Jr.', LastName: null })).toMatchObject({ FirstName: 'Tom', NameSuffix: 'Jr.' });
  });

  it('keeps a line that has lines under it, or no value, as passthrough', () => {
    const out = liftNameParts(['2 NPFX Dr', '3 SOUR @S1@', '2 SPFX'], { FirstName: 'A', LastName: 'B' });
    expect(out).toMatchObject({ NamePrefix: null, SurnamePrefix: null, rest: ['2 NPFX Dr', '3 SOUR @S1@', '2 SPFX'] });
  });

  it("doesn't take a word that only starts the same", () => {
    expect(liftNameParts(['2 SPFX de'], { FirstName: 'A', LastName: 'Dekker' })).toMatchObject({ SurnamePrefix: 'de', LastName: 'Dekker' });
    // A name that is only the piece stays.
    expect(liftNameParts(['2 NPFX Dr'], { FirstName: 'Dr', LastName: null })).toMatchObject({ FirstName: 'Dr' });
  });
});

describe('the NAME text and the page header', () => {
  it('writes every piece into the NAME text', () => {
    expect(gedcomNameText({ NamePrefix: 'Dr', FirstName: 'Johann', SurnamePrefix: 'von', LastName: 'Habsburg', NameSuffix: 'PhD' })).toBe('Dr Johann /von Habsburg/ PhD');
    expect(gedcomNameText({ SurnamePrefix: 'van', LastName: 'Dijk' })).toBe('/van Dijk/');
  });

  it('heads the page with every piece, unless a starred name replaces it', () => {
    const p = { FirstName: 'Johann', LastName: 'Habsburg', NamePrefix: 'Dr', SurnamePrefix: 'von', NameSuffix: 'PhD' };
    expect(headingNameWithParts(p)).toBe('Dr Johann von Habsburg PhD');
    expect(headingNameWithParts(p, [{ IsPrimary: 1, Type: 'Alias', Name: 'Hans' }] as never)).toBe('Hans');
    expect(headingNameWithParts({ FirstName: null, LastName: null }, null, 'Unknown')).toBe('Unknown');
  });
});
