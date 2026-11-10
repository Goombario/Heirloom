import { describe, it, expect } from 'vitest';
import {
  emptyForm,
  familyToFormState,
  buildFamilyBody,
  partnerLabel,
  partnersTitle,
} from '@/app/components/family-form/state';
import type { Family, PersonResult } from '@/lib/db/schema';

// Characterization tests — lock the behavior currently inline in FamilyForm.tsx
// (load→state mapping, submit body builder, partner label/title derivation) so the
// decomposition is provably behavior-preserving.

function fam(partial: Partial<Family>): Family {
  return { Id: 1, Type: 'Marriage', ...partial } as Family;
}

function person(partial: Partial<PersonResult>): PersonResult {
  return { Id: 1, FirstName: null, LastName: null, ...partial } as PersonResult;
}

describe('familyToFormState', () => {
  // Partnership endings moved from the EndedDate/EndedReason columns to timeline
  // events (Phase 2); the form now only carries Type + marriage anchor fields.
  it('defaults Type to Marriage and coerces null fields to empty strings', () => {
    const s = familyToFormState(fam({ Type: null as never, MarriageDate: null, MarriagePlace: null }));
    expect(s.Type).toBe('Marriage');
    expect(s.MarriageDate).toBe('');
    expect(s.MarriagePlace).toBe('');
  });

  it('passes through populated values', () => {
    const s = familyToFormState(fam({ Type: 'Civil union', MarriageDate: '2000-01-01', MarriagePlace: 'Paris' }));
    expect(s).toEqual({
      Type: 'Civil union',
      MarriageDate: '2000-01-01',
      MarriagePlace: 'Paris',
    });
  });
});

describe('buildFamilyBody', () => {
  it('builds the body from marriage fields and selected partners', () => {
    const body = buildFamilyBody(
      { ...emptyForm, MarriageDate: '1980', MarriagePlace: 'Rome' },
      5,
      6,
    );
    expect(body.MarriageDate).toBe('1980');
    expect(body.MarriagePlace).toBe('Rome');
    expect(body.Type).toBe('Marriage');
    expect(body.Partner1Id).toBe(5);
    expect(body.Partner2Id).toBe(6);
  });

  it('coerces empty strings to null', () => {
    const body = buildFamilyBody({ ...emptyForm, MarriageDate: '', MarriagePlace: '' }, null, null);
    expect(body.MarriageDate).toBeNull();
    expect(body.MarriagePlace).toBeNull();
    expect(body.Partner1Id).toBeNull();
    expect(body.Partner2Id).toBeNull();
  });
});

describe('partnerLabel', () => {
  it('returns empty string for null', () => {
    expect(partnerLabel(null)).toBe('');
  });
  it('joins first and last name, trimming', () => {
    expect(partnerLabel(person({ FirstName: 'Ada', LastName: 'Lovelace' }))).toBe('Ada Lovelace');
    expect(partnerLabel(person({ FirstName: 'Ada', LastName: null }))).toBe('Ada');
  });
});

describe('partnersTitle', () => {
  const fallback = 'Add a partnership';
  it('returns the fallback when both partners are null', () => {
    expect(partnersTitle(null, null, fallback)).toBe(fallback);
  });
  it('joins both names with a plus', () => {
    expect(partnersTitle(person({ FirstName: 'Ada', LastName: 'Lovelace' }), person({ FirstName: 'Charles', LastName: 'Babbage' }), fallback)).toBe('Ada Lovelace + Charles Babbage');
  });
  it('returns the single present name when one partner is missing', () => {
    expect(partnersTitle(person({ FirstName: 'Ada', LastName: 'Lovelace' }), null, fallback)).toBe('Ada Lovelace');
    expect(partnersTitle(null, person({ FirstName: 'Charles', LastName: 'Babbage' }), fallback)).toBe('Charles Babbage');
  });
});
