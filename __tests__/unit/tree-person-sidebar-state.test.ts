import { describe, it, expect } from 'vitest';
import {
  emptySidebarForm,
  personToForm,
  buildPersonUpdate,
  computeInitials,
  computeDisplayName,
  isFormDirty,
  applyDeceasedChange,
  type SidebarForm,
} from '@/app/components/tree/person-sidebar/state';
import type { PersonWithRelations } from '@/lib/db/schema';

// Characterization tests — lock the form-mapping / dirty / deceased-clear behavior
// currently inline in PersonSidebar before extracting it.

function person(partial: Partial<PersonWithRelations>): PersonWithRelations {
  return { Id: 1, FirstName: null, LastName: null, Sex: null, BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, IsDeceased: null, ...partial } as PersonWithRelations;
}

describe('personToForm', () => {
  it('coerces null string fields to empty strings and keeps IsDeceased', () => {
    const f = personToForm(person({ FirstName: 'Ada', IsDeceased: 1, DeathDate: '1852' }));
    expect(f).toEqual({
      FirstName: 'Ada', LastName: '', Sex: null,
      BirthDate: '', BirthPlace: '', DeathDate: '1852', DeathPlace: '',
      // No `Notes` key: the column is gone (#524 / ADR 0010) and the sidebar's
      // notes are first-class Note rows owned by OwnerNotesCard, not form state.
      IsDeceased: 1,
    });
  });
  it('maps Sex null through as null', () => {
    expect(personToForm(person({ Sex: 'F' })).Sex).toBe('F');
    expect(personToForm(person({ Sex: null })).Sex).toBeNull();
  });
});

describe('buildPersonUpdate', () => {
  it('coerces empty strings back to null, preserves Sex and IsDeceased', () => {
    const form: SidebarForm = { ...emptySidebarForm, FirstName: 'Ada', LastName: '', Sex: null, IsDeceased: 0 };
    const body = buildPersonUpdate(form);
    expect(body.FirstName).toBe('Ada');
    expect(body.LastName).toBeNull();
    expect(body.BirthDate).toBeNull();
    expect(body.Sex).toBeNull();
    expect(body.IsDeceased).toBe(0);
  });
});

describe('computeInitials', () => {
  it('takes the first character of each present name, uppercased', () => {
    expect(computeInitials('ada', 'lovelace')).toBe('AL');
    expect(computeInitials('ada', '')).toBe('A');
  });
  it('falls back to ? when no name', () => {
    expect(computeInitials('', '')).toBe('?');
    expect(computeInitials(null, null)).toBe('?');
  });
});

describe('computeDisplayName', () => {
  it('joins names or returns the fallback', () => {
    expect(computeDisplayName('Ada', 'Lovelace', 'Unknown')).toBe('Ada Lovelace');
    expect(computeDisplayName('', '', 'Unknown')).toBe('Unknown');
  });
});

describe('isFormDirty', () => {
  it('is false against an identical original and true after any change', () => {
    const orig: SidebarForm = { ...emptySidebarForm, FirstName: 'Ada' };
    expect(isFormDirty(orig, orig)).toBe(false);
    expect(isFormDirty({ ...orig, LastName: 'L' }, orig)).toBe(true);
  });
});

describe('applyDeceasedChange', () => {
  it('clears death fields when not deceased (value !== 1)', () => {
    const form: SidebarForm = { ...emptySidebarForm, IsDeceased: 1, DeathDate: '1852', DeathPlace: 'London' };
    const next = applyDeceasedChange(form, 0);
    expect(next.IsDeceased).toBe(0);
    expect(next.DeathDate).toBe('');
    expect(next.DeathPlace).toBe('');
  });
  it('keeps death fields when deceased (value === 1)', () => {
    const form: SidebarForm = { ...emptySidebarForm, IsDeceased: null, DeathDate: '1852', DeathPlace: 'London' };
    const next = applyDeceasedChange(form, 1);
    expect(next.IsDeceased).toBe(1);
    expect(next.DeathDate).toBe('1852');
    expect(next.DeathPlace).toBe('London');
  });
  it('clears death fields when set to unknown (null)', () => {
    const form: SidebarForm = { ...emptySidebarForm, IsDeceased: 1, DeathDate: '1852' };
    expect(applyDeceasedChange(form, null).DeathDate).toBe('');
  });
});
