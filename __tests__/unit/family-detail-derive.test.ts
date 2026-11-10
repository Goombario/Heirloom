import { describe, it, expect } from 'vitest';
import {
  yearOnly, calcAgeAtDeath, computeEndedYear, earlierDeathPartner,
  partnershipYears, hasOtherPartnerships, endFromEvents, endEventOf, endReasonOf, unionEndNoteParts,
  derivedEndPrecedesStart, formatUnionRange,
} from '@/app/families/view/derive';
import type { Person } from '@/lib/db/schema';

// Characterization tests — lock the date/lifespan/partnership-derivation behavior
// currently inline in FamilyDetailView before extracting it.

function p(partial: Partial<Person>): Person {
  return { Id: 1, FirstName: null, LastName: null, BirthDate: null, DeathDate: null, BirthPlace: null, DeathPlace: null, Sex: null, ...partial } as Person;
}

describe('yearOnly', () => {
  it('extracts the first 4-digit year', () => {
    expect(yearOnly('1985-03-02')).toBe('1985');
    expect(yearOnly('about 1900')).toBe('1900');
  });
  it('returns empty string for null or yearless input', () => {
    expect(yearOnly(null)).toBe('');
    expect(yearOnly('spring')).toBe('');
  });
});

describe('calcAgeAtDeath', () => {
  it('returns the year difference', () => {
    expect(calcAgeAtDeath('1900', '1917')).toBe(17);
  });
  it('returns null when either date is missing or yearless', () => {
    expect(calcAgeAtDeath(null, '1917')).toBeNull();
    expect(calcAgeAtDeath('1900', null)).toBeNull();
    expect(calcAgeAtDeath('foo', '1917')).toBeNull();
  });
  it('returns a real number for an approximate/qualified birth or death date', () => {
    expect(calcAgeAtDeath('ABT 1900', '1917')).toBe(17);
    expect(calcAgeAtDeath('1900', 'ABT 1917')).toBe(17);
    expect(calcAgeAtDeath('ABT 1900', 'ABT 1917')).toBe(17);
  });
});

describe('computeEndedYear', () => {
  it('returns the earlier of two partner death years', () => {
    expect(computeEndedYear(p({ DeathDate: '1980' }), p({ DeathDate: '1975' }))).toBe('1975');
  });
  it('falls back to whichever partner has a death date', () => {
    expect(computeEndedYear(p({ DeathDate: '1980' }), p({}))).toBe('1980');
    expect(computeEndedYear(p({}), p({ DeathDate: '1990' }))).toBe('1990');
  });
  it('returns empty string when neither died', () => {
    expect(computeEndedYear(p({}), p({}))).toBe('');
    expect(computeEndedYear(null, null)).toBe('');
  });
  it('picks the earlier of two qualified partner death years', () => {
    expect(computeEndedYear(p({ DeathDate: 'ABT 1980' }), p({ DeathDate: 'ABT 1975' }))).toBe('1975');
  });
});

describe('computeEndedYear with an explicit end-event', () => {
  // #486: a divorced couple who both outlived the divorce used to show the
  // earlier DEATH year, or "m. 1901" with no range at all.
  it('prefers the explicit end date over both partner deaths', () => {
    expect(computeEndedYear(p({ DeathDate: '1958' }), p({ DeathDate: '1962' }), '1931')).toBe('1931');
  });
  it('uses the explicit end date when neither partner has died', () => {
    expect(computeEndedYear(p({}), p({}), '1931')).toBe('1931');
  });
  it('keeps the qualifier marker on a fuzzy end date', () => {
    expect(computeEndedYear(p({}), p({}), 'ABT 1931')).toBe('~1931');
  });
  it('falls back to the death derivation when the end date is absent', () => {
    expect(computeEndedYear(p({ DeathDate: '1958' }), p({}), null)).toBe('1958');
    expect(computeEndedYear(p({ DeathDate: '1958' }), p({}), '')).toBe('1958');
  });
});

describe('endEventOf', () => {
  it('returns the row endFromEvents reads, earliest dated first', () => {
    const sep = { Id: 2, Type: 'SEPA', Date: '1929' };
    expect(endEventOf([{ Id: 1, Type: 'DIV', Date: '1931' }, sep, { Id: 3, Type: 'ENGA', Date: '1920' }])).toBe(sep);
  });
  it('is null without an end event', () => {
    expect(endEventOf([{ Id: 3, Type: 'ENGA', Date: '1920' }])).toBeNull();
    expect(endReasonOf('ENGA')).toBeNull();
    expect(endReasonOf('DIVF')).toBe('Divorce');
  });
});

describe('endFromEvents', () => {
  it('finds a divorce and maps it to the Divorce reason', () => {
    expect(endFromEvents([{ Type: 'DIV', Date: '1931' }])).toEqual({ date: '1931', reason: 'Divorce' });
  });
  it('maps DIVF, ANUL and SEPA to their reasons', () => {
    expect(endFromEvents([{ Type: 'DIVF', Date: '1931' }])?.reason).toBe('Divorce');
    expect(endFromEvents([{ Type: 'ANUL', Date: '1931' }])?.reason).toBe('Annulment');
    expect(endFromEvents([{ Type: 'SEPA', Date: '1931' }])?.reason).toBe('Separation');
  });
  it('ignores events that do not end the partnership', () => {
    expect(endFromEvents([{ Type: 'ENGA', Date: '1899' }, { Type: 'CENS', Date: '1910' }])).toBeNull();
  });
  // A separation followed by a divorce: the union ended at the separation.
  it('takes the earliest end-event when there is more than one', () => {
    expect(endFromEvents([{ Type: 'DIV', Date: '1935' }, { Type: 'SEPA', Date: '1931' }]))
      .toEqual({ date: '1931', reason: 'Separation' });
  });
  it('still reports an undated end-event so its reason survives', () => {
    expect(endFromEvents([{ Type: 'DIV', Date: null }])).toEqual({ date: null, reason: 'Divorce' });
  });
  it('returns null for no events at all', () => {
    expect(endFromEvents(null)).toBeNull();
    expect(endFromEvents(undefined)).toBeNull();
    expect(endFromEvents([])).toBeNull();
  });
});

describe('unionEndNoteParts', () => {
  it('names the reason for each explicit end kind', () => {
    expect(unionEndNoteParts({ date: '1931', reason: 'Divorce' })).toEqual({ reasonKey: 'hero_ended_divorce' });
    expect(unionEndNoteParts({ date: '1931', reason: 'Annulment' })).toEqual({ reasonKey: 'hero_ended_annulment' });
    expect(unionEndNoteParts({ date: '1931', reason: 'Separation' })).toEqual({ reasonKey: 'hero_ended_separation' });
  });
  // A death-ended union renders a bare range: the timeline already states the
  // death in full, so repeating it under every widowed couple's dates is noise.
  it('says nothing for a death-ended or unknown-ended union', () => {
    expect(unionEndNoteParts({ date: '1958', reason: 'Death' })).toBeNull();
    expect(unionEndNoteParts({ date: null, reason: 'Unknown' })).toBeNull();
    expect(unionEndNoteParts(null)).toBeNull();
  });
});

describe('partnershipYears', () => {
  it('returns marriage year and earlier-death end year', () => {
    expect(partnershipYears(p({ DeathDate: '1899' }), p({ DeathDate: '1911' }), '1850'))
      .toEqual({ began: '1850', ended: '1899' });
  });
  it('leaves ended empty when neither partner has died', () => {
    expect(partnershipYears(p({}), p({}), '1850')).toEqual({ began: '1850', ended: '' });
  });
  it('leaves began empty when no marriage date', () => {
    expect(partnershipYears(p({}), p({}), null)).toEqual({ began: '', ended: '' });
  });
  it('threads an explicit end date through to ended', () => {
    expect(partnershipYears(p({ DeathDate: '1958' }), p({}), '1901', '1931'))
      .toEqual({ began: '1901', ended: '1931' });
  });
});

// Task audit ED-6 / §11: Mary Ellen Byrne, born 1813, died 27 Jan 1814, in a
// partnership estimated 1842. Her death is a bad date, not the partnership's end.
describe('a derived end before the start (#826)', () => {
  const mary = () => p({ BirthDate: '1813', DeathDate: '27 JAN 1814' });
  const patrick = () => p({ BirthDate: '1810', DeathDate: '1871' });

  it('shows only the start, never "~1842–1814"', () => {
    const { began, ended } = partnershipYears(mary(), patrick(), 'EST 1842');
    expect(began).toBe('~1842');
    expect(ended).toBe('');
    expect(formatUnionRange(began, ended)).toBe('');
  });
  it('still shows a normal range', () => {
    const { began, ended } = partnershipYears(p({ DeathDate: '1871' }), p({ DeathDate: '1880' }), '1842');
    expect(formatUnionRange(began, ended)).toBe('1842–1871');
  });
  it('keeps an explicit end event, which the data checks report instead', () => {
    expect(partnershipYears(mary(), patrick(), 'EST 1842', '1830').ended).toBe('1830');
  });
  it('keeps a death in the start year', () => {
    expect(computeEndedYear(p({ DeathDate: '1842' }), p({}), null, '1842')).toBe('1842');
  });
  it('compares by year only, and needs both dates', () => {
    expect(derivedEndPrecedesStart('27 JAN 1814', 'EST 1842')).toBe(true);
    expect(derivedEndPrecedesStart('1842', 'DEC 1842')).toBe(false);
    expect(derivedEndPrecedesStart(null, '1842')).toBe(false);
    expect(derivedEndPrecedesStart('1814', null)).toBe(false);
  });
});

describe('hasOtherPartnerships', () => {
  const pf = (ids: number[]) => ({ person: p({ Id: 9 }), spouses: ids.map(id => ({ family: { Id: id } })) } as unknown as import('@/app/families/view/useFamilyDetail').PartnerFamilies);
  it('is true when a spouse family differs from the current one', () => {
    expect(hasOtherPartnerships(pf([1, 2]), 1)).toBe(true);
  });
  it('is false when the only family is the current one', () => {
    expect(hasOtherPartnerships(pf([1]), 1)).toBe(false);
  });
  it('is false for null', () => {
    expect(hasOtherPartnerships(null, 1)).toBe(false);
  });
});

describe('earlierDeathPartner', () => {
  it('returns the partner who died first', () => {
    const a = p({ FirstName: 'A', DeathDate: '1970' });
    const b = p({ FirstName: 'B', DeathDate: '1980' });
    expect(earlierDeathPartner(a, b)).toBe(a);
    expect(earlierDeathPartner(b, a)).toBe(a);
  });
  it('returns whichever partner has a death date', () => {
    const a = p({ DeathDate: '1970' });
    expect(earlierDeathPartner(a, p({}))).toBe(a);
  });
  it('returns null when neither died', () => {
    expect(earlierDeathPartner(p({}), p({}))).toBeNull();
    expect(earlierDeathPartner(null, null)).toBeNull();
  });
  it('returns the partner who died first among two qualified death dates', () => {
    const a = p({ FirstName: 'A', DeathDate: 'ABT 1970' });
    const b = p({ FirstName: 'B', DeathDate: 'ABT 1980' });
    expect(earlierDeathPartner(a, b)).toBe(a);
    expect(earlierDeathPartner(b, a)).toBe(a);
  });
});
