import { describe, it, expect } from 'vitest';
import { buildEntityLabel, computeFieldDiff } from '@/lib/db/queries/audit-capture';

describe('buildEntityLabel', () => {
  it('returns full name for person with both names', () => {
    expect(buildEntityLabel('person', { Id: 1, FirstName: 'John', LastName: 'Doe' }))
      .toBe('John Doe');
  });

  it('returns first name only when LastName is missing', () => {
    expect(buildEntityLabel('person', { Id: 1, FirstName: 'John', LastName: null }))
      .toBe('John');
  });

  it('returns fallback for person with no name', () => {
    expect(buildEntityLabel('person', { Id: 42, FirstName: null, LastName: null }))
      .toBe('Person #42');
  });

  it('returns family label with both partners', () => {
    expect(buildEntityLabel('family', { Id: 1, Partner1Id: 10, Partner2Id: 20 }))
      .toBe('Family: Partner1 #10 & Partner2 #20');
  });

  it('returns family label with partner1 only', () => {
    expect(buildEntityLabel('family', { Id: 1, Partner1Id: 10, Partner2Id: null }))
      .toBe('Family: Partner1 #10');
  });

  it('returns fallback for family with no partners', () => {
    expect(buildEntityLabel('family', { Id: 5, Partner1Id: null, Partner2Id: null }))
      .toBe('Family #5');
  });

  it('returns event label with person', () => {
    expect(buildEntityLabel('event', { Id: 1, Type: 'Birth', PersonId: 7, FamilyId: null }))
      .toBe('Birth for Person #7');
  });

  it('returns event label with family when no person', () => {
    expect(buildEntityLabel('event', { Id: 1, Type: 'Marriage', PersonId: null, FamilyId: 3 }))
      .toBe('Marriage for Family #3');
  });

  it('returns event fallback when no person or family', () => {
    expect(buildEntityLabel('event', { Id: 1, Type: 'Event', PersonId: null, FamilyId: null }))
      .toBe('Event #1');
  });

  it('returns media title', () => {
    expect(buildEntityLabel('media', { Id: 1, Title: 'Wedding Photo' }))
      .toBe('Wedding Photo');
  });

  it('returns media fallback when no title', () => {
    expect(buildEntityLabel('media', { Id: 3, Title: null }))
      .toBe('Media #3');
  });

  it('returns story title', () => {
    expect(buildEntityLabel('story', { Id: 1, Title: 'The Great Adventure' }))
      .toBe('The Great Adventure');
  });

  it('returns story fallback when no title', () => {
    expect(buildEntityLabel('story', { Id: 9, Title: null }))
      .toBe('Story #9');
  });
});

describe('computeFieldDiff', () => {
  const allowedFields = new Set(['FirstName', 'LastName', 'Notes']);

  it('returns empty diff when nothing changed', () => {
    const diff = computeFieldDiff(
      { FirstName: 'Alice', LastName: 'Smith', Notes: null },
      { FirstName: 'Alice', LastName: 'Smith', Notes: null },
      allowedFields
    );
    expect(diff).toEqual({});
  });

  it('captures changed fields', () => {
    const diff = computeFieldDiff(
      { FirstName: 'Alice', LastName: 'Smith' },
      { FirstName: 'Alice', LastName: 'Jones' },
      allowedFields
    );
    expect(diff).toEqual({ LastName: { old: 'Smith', new: 'Jones' } });
  });

  it('treats undefined and null as equal (no spurious diff)', () => {
    const diff = computeFieldDiff(
      { FirstName: 'Alice', Notes: undefined },
      { FirstName: 'Alice', Notes: null },
      allowedFields
    );
    expect(diff).toEqual({});
  });

  it('ignores fields not in allowedFields', () => {
    const diff = computeFieldDiff(
      { FirstName: 'Alice', UserId: 1, Secret: 'old' },
      { FirstName: 'Alice', UserId: 99, Secret: 'new' },
      allowedFields
    );
    expect(diff).toEqual({});
  });

  it('captures null → value change', () => {
    const diff = computeFieldDiff(
      { FirstName: null, LastName: 'Smith' },
      { FirstName: 'Alice', LastName: 'Smith' },
      allowedFields
    );
    expect(diff).toEqual({ FirstName: { old: null, new: 'Alice' } });
  });
});
