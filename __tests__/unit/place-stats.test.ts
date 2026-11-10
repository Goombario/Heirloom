import { describe, it, expect } from 'vitest';
import { decadeTicks, recordGroups, yearOf, yearSpan, yearStats } from '@/app/places/view/mobile/placeStats';
import type { PlaceFactLinkEntry } from '@/lib/data/types';

function link(over: Partial<PlaceFactLinkEntry>): PlaceFactLinkEntry {
  return {
    personId: 1, name: 'Anders Halvorsen', sex: 'M', primaryMediaId: null,
    focalX: null, focalY: null, focalRadius: null,
    kind: 'birth', eventType: null, date: null, placeName: 'Duluth', recordId: 1, placeId: 1,
    ...over,
  };
}

describe('yearOf', () => {
  it('reads the year from every stored date shape', () => {
    expect(yearOf('1890-03-04')).toBe(1890);
    expect(yearOf('14 JUN 1921')).toBe(1921);
    expect(yearOf('ABT 1876')).toBe(1876);
    expect(yearOf('BET 1877 AND 1880')).toBe(1877);
    expect(yearOf(null)).toBeNull();
    expect(yearOf('JUN')).toBeNull();
  });
});

describe('recordGroups', () => {
  it('groups by event type, busiest first, with who and the year span', () => {
    const groups = recordGroups([
      link({ kind: 'birth', date: '1890', name: 'Olav' }),
      link({ kind: 'event', eventType: 'RESI', date: '1900', name: 'Olav' }),
      link({ kind: 'event', eventType: 'RESI', date: '1920', name: 'Greta' }),
      link({ kind: 'event', eventType: 'RESI', date: null, name: 'Olav' }),
      link({ kind: 'marriage', date: '1912', name: 'Greta' }),
    ]);
    expect(groups.map((g) => g.type)).toEqual(['RESI', 'BIRT', 'MARR']);
    expect(groups[0]).toEqual({ type: 'RESI', count: 3, names: ['Olav', 'Greta'], first: 1900, last: 1920 });
  });
});

describe('yearSpan', () => {
  it('collapses one year and drops an undated type', () => {
    expect(yearSpan(1846, 1955)).toBe('1846–1955');
    expect(yearSpan(1890, 1890)).toBe('1890');
    expect(yearSpan(null, null)).toBe('');
  });
});

describe('yearStats', () => {
  it('fills empty decades and finds the first, busiest and last records', () => {
    const s = yearStats([
      link({ date: '1866', name: 'A' }),
      link({ date: '1891', name: 'B' }),
      link({ date: '1894', name: 'C' }),
      link({ date: null }),
    ]);
    expect(s.decades).toEqual([
      { decade: 1860, count: 1 }, { decade: 1870, count: 0 }, { decade: 1880, count: 0 }, { decade: 1890, count: 2 },
    ]);
    expect(s.busiest).toEqual({ decade: 1890, count: 2 });
    expect(s.first?.link.name).toBe('A');
    expect(s.last?.year).toBe(1894);
    expect(s.undated).toBe(1);
  });

  it('has nothing to chart with no dated record', () => {
    expect(yearStats([link({ date: null })])).toMatchObject({ decades: [], busiest: null, undated: 1 });
  });
});

describe('decadeTicks', () => {
  it('labels every 50 years, or the two ends of a short span', () => {
    expect(decadeTicks(1840, 1950)).toEqual([1850, 1900, 1950]);
    expect(decadeTicks(1910, 1930)).toEqual([1910, 1930]);
    expect(decadeTicks(1920, 1920)).toEqual([1920]);
  });
});
