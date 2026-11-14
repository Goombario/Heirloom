import { describe, it, expect } from 'vitest';
import { kindFromDescendant, kindFromOwnForm, placeKindFromForms } from '@/lib/places/place-kind';

const FORM = 'City, County, State, Country';
const LEAF = 'Minneapolis, Hennepin, Minnesota, USA';

describe('place kind from PLAC.FORM (#45)', () => {
  it('reads the leaf from its own first title', () => {
    expect(kindFromOwnForm(LEAF, FORM)).toBe('City');
    expect(kindFromOwnForm('Baltimore, , Maryland, USA', FORM)).toBe('City');
  });

  it('ignores a FORM whose titles do not line up with the name', () => {
    expect(kindFromOwnForm('USA', FORM)).toBeNull();
    expect(kindFromOwnForm(LEAF, null)).toBeNull();
    expect(kindFromOwnForm('Somewhere, USA', ', Country')).toBeNull();
  });

  it('reads a parent from a descendant at its position', () => {
    const d = { name: LEAF, form: FORM };
    expect(kindFromDescendant('Minnesota, USA', d)).toBe('State');
    expect(kindFromDescendant('Hennepin, Minnesota, USA', d)).toBe('County');
    expect(kindFromDescendant('USA', d)).toBe('Country');
    expect(kindFromDescendant('Iowa, USA', d)).toBeNull();
    expect(kindFromDescendant(LEAF, d)).toBeNull();
  });

  it('prefers its own FORM, then the first descendant that names it', () => {
    expect(placeKindFromForms('Minnesota, USA', 'Region, Country', [{ name: LEAF, form: FORM }])).toBe('Region');
    expect(placeKindFromForms('Minnesota, USA', null, [
      { name: 'Duluth, Minnesota, USA', form: 'City, County' },
      { name: LEAF, form: FORM },
    ])).toBe('State');
    expect(placeKindFromForms('Minnesota, USA', null, [])).toBeNull();
  });
});
