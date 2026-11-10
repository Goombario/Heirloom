import { describe, it, expect } from 'vitest';
import { groupFactLinks } from '@/app/places/explore/groupFactLinks';
import type { PlaceFactLinkEntry } from '@/lib/data/types';

function link(over: Partial<PlaceFactLinkEntry>): PlaceFactLinkEntry {
  return {
    personId: 1, name: 'Wilfred Ellis', sex: 'M', primaryMediaId: null,
    focalX: null, focalY: null, focalRadius: null,
    kind: 'birth', eventType: null, date: null, placeName: 'Dover', recordId: 1, placeId: 1,
    ...over,
  };
}

describe('groupFactLinks', () => {
  it("carries the person's photo and its focal crop onto the group", () => {
    // The group is what the row renders its avatar from. Dropping focal here
    // would centre-crop the whole photo into a 30px disc even once the query
    // supplies the crop — the exact defect the payload change fixes.
    const [group] = groupFactLinks([
      link({ primaryMediaId: 12, focalX: 42, focalY: 30, focalRadius: 25 }),
      link({ kind: 'death', primaryMediaId: 12, focalX: 42, focalY: 30, focalRadius: 25 }),
    ]);

    expect(group.primaryMediaId).toBe(12);
    expect(group.focalX).toBe(42);
    expect(group.focalY).toBe(30);
    expect(group.focalRadius).toBe(25);
  });

  it('collapses a person tied by several facts into one entry', () => {
    const groups = groupFactLinks([
      link({ kind: 'birth', date: '1888-02-02' }),
      link({ kind: 'marriage', date: '1921-06-14' }),
      link({ kind: 'death', date: '1974-10-11' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].personId).toBe(1);
    expect(groups[0].facts).toHaveLength(3);
  });

  it('orders a person\'s facts by date, undated last', () => {
    const groups = groupFactLinks([
      link({ kind: 'event', eventType: 'RESI', date: null }),
      link({ kind: 'death', date: '1974-10-11' }),
      link({ kind: 'birth', date: '1888-02-02' }),
    ]);

    expect(groups[0].facts.map((f) => f.kind)).toEqual(['birth', 'death', 'event']);
  });

  it('orders a raw GEDCOM event date against ISO dates by year', () => {
    // `Events."Date"` is stored raw from GEDCOM (the parser only runs parseDate on
    // BIRT/DEAT), so "14 JUN 1921" reaches this list verbatim. Compared as a plain
    // string it sorts BEFORE "1888-02-02" — and because only the first three
    // reasons render, a mis-sorted fact is dropped from the pane, not just moved.
    const groups = groupFactLinks([
      link({ kind: 'event', eventType: 'RESI', date: '14 JUN 1921' }),
      link({ kind: 'death', date: '1974-10-11' }),
      link({ kind: 'birth', date: '1888-02-02' }),
    ]);

    expect(groups[0].facts.map((f) => f.kind)).toEqual(['birth', 'event', 'death']);
  });

  it('sorts a qualified date by its year, not its prefix letter', () => {
    // 'A' > '1', so "ABT 1850" used to sort after every unqualified date.
    const groups = groupFactLinks([
      link({ kind: 'death', date: '1974-10-11' }),
      link({ kind: 'event', eventType: 'RESI', date: 'ABT 1850' }),
      link({ kind: 'marriage', date: '1921-06-14' }),
    ]);

    expect(groups[0].facts.map((f) => f.kind)).toEqual(['event', 'marriage', 'death']);
  });

  it('treats a date with no year like an undated fact', () => {
    const groups = groupFactLinks([
      link({ kind: 'event', eventType: 'RESI', date: 'sometime' }),
      link({ kind: 'birth', date: '1888-02-02' }),
    ]);

    expect(groups[0].facts.map((f) => f.kind)).toEqual(['birth', 'event']);
  });

  it('keeps people in first-appearance order', () => {
    const groups = groupFactLinks([
      link({ personId: 7, name: 'Ada Quinby' }),
      link({ personId: 2, name: 'Bob Rowe' }),
      link({ personId: 7, name: 'Ada Quinby', kind: 'death' }),
    ]);

    expect(groups.map((g) => g.personId)).toEqual([7, 2]);
  });

  it('carries the person fields onto the group', () => {
    const [group] = groupFactLinks([link({ sex: 'F', primaryMediaId: 42, name: 'Violet Lamb' })]);

    expect(group).toMatchObject({ name: 'Violet Lamb', sex: 'F', primaryMediaId: 42 });
  });

  it('returns an empty array for no links', () => {
    expect(groupFactLinks([])).toEqual([]);
  });

  it('keys on personId, not name: same name / different ids stay separate, same id / different name spellings merge', () => {
    const groups = groupFactLinks([
      link({ personId: 3, name: 'John Smith' }),
      link({ personId: 4, name: 'John Smith' }),
      link({ personId: 5, name: 'Jonathan Smith', kind: 'birth' }),
      link({ personId: 5, name: 'Jon Smith', kind: 'death' }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.personId)).toEqual([3, 4, 5]);
    const merged = groups.find((g) => g.personId === 5)!;
    expect(merged.facts).toHaveLength(2);
  });

  it('breaks ties between same-date facts by kind', () => {
    const groups = groupFactLinks([
      link({ kind: 'marriage', date: '1900-01-01' }),
      link({ kind: 'death', date: '1900-01-01' }),
    ]);

    expect(groups[0].facts.map((f) => f.kind)).toEqual(['death', 'marriage']);
  });
});
