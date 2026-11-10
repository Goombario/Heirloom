import { describe, it, expect } from 'vitest';
import {
  dateInterval, definitelyBefore, daysFromCivil, civilFromDays, addMonths, addYears, APPROXIMATE_YEARS,
} from '@/lib/date-intervals';

const day = (y: number, m: number, d: number) => daysFromCivil(y, m, d);
const span = (a: [number, number, number], b: [number, number, number]) => ({ earliest: day(...a), latest: day(...b) });
const overlaps = (x: string, y: string) => {
  const a = dateInterval(x)!;
  const b = dateInterval(y)!;
  return !definitelyBefore(a, b) && !definitelyBefore(b, a);
};

describe('day arithmetic', () => {
  it('counts from 1970-01-01', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(1969, 12, 31)).toBe(-1);
    expect(daysFromCivil(2000, 3, 1) - daysFromCivil(2000, 2, 28)).toBe(2); // 2000 is a leap year
    expect(daysFromCivil(1900, 3, 1) - daysFromCivil(1900, 2, 28)).toBe(1); // 1900 is not
  });
  it('round-trips through civilFromDays, including years below 100', () => {
    for (const [y, m, d] of [[1814, 1, 27], [850, 6, 30], [45, 12, 31], [2024, 2, 29]] as const) {
      expect(civilFromDays(daysFromCivil(y, m, d))).toEqual({ y, m, d });
    }
  });
  it('adds calendar years, landing 29 Feb on 28 Feb', () => {
    expect(civilFromDays(addYears(day(1814, 1, 27), 5))).toEqual({ y: 1819, m: 1, d: 27 });
    expect(civilFromDays(addYears(day(2024, 2, 29), 1))).toEqual({ y: 2025, m: 2, d: 28 });
    expect(addYears(Infinity, 5)).toBe(Infinity);
  });
  it('adds months across a year end, clamping to a shorter month', () => {
    expect(civilFromDays(addMonths(day(1814, 3, 31), 10))).toEqual({ y: 1815, m: 1, d: 31 });
    expect(civilFromDays(addMonths(day(1815, 1, 31), 1))).toEqual({ y: 1815, m: 2, d: 28 });
    expect(civilFromDays(addMonths(day(1815, 1, 15), -2))).toEqual({ y: 1814, m: 11, d: 15 });
  });
});

describe('dateInterval', () => {
  it('reads an exact day as that day, in ISO and GEDCOM forms', () => {
    expect(dateInterval('1814-01-27')).toEqual(span([1814, 1, 27], [1814, 1, 27]));
    expect(dateInterval('27 JAN 1814')).toEqual(span([1814, 1, 27], [1814, 1, 27]));
  });
  it('reads a month as the whole month', () => {
    expect(dateInterval('1814-02')).toEqual(span([1814, 2, 1], [1814, 2, 28]));
    expect(dateInterval('FEB 1816')).toEqual(span([1816, 2, 1], [1816, 2, 29]));
  });
  it('reads a bare year as 1 Jan to 31 Dec', () => {
    expect(dateInterval('1814')).toEqual(span([1814, 1, 1], [1814, 12, 31]));
    expect(dateInterval('850')).toEqual(span([850, 1, 1], [850, 12, 31]));
  });
  it('widens ABT by ±5 years', () => {
    expect(APPROXIMATE_YEARS).toBe(5);
    expect(dateInterval('ABT 1814')).toEqual(span([1809, 1, 1], [1819, 12, 31]));
  });
  it('widens EST by ±5 years', () => {
    expect(dateInterval('EST 1842')).toEqual(span([1837, 1, 1], [1847, 12, 31]));
  });
  it('widens CAL by ±5 years, from the day when it has one', () => {
    expect(dateInterval('CAL 1814-01-27')).toEqual(span([1809, 1, 27], [1819, 1, 27]));
  });
  it('reads BEF as open at the start, up to the end of its date', () => {
    expect(dateInterval('BEF 1814')).toEqual({ earliest: -Infinity, latest: day(1814, 12, 31) });
  });
  it('reads AFT as from the start of its date, open at the end', () => {
    expect(dateInterval('AFT 1814-03')).toEqual({ earliest: day(1814, 3, 1), latest: Infinity });
  });
  it('reads BET a AND b as the start of a to the end of b', () => {
    expect(dateInterval('BET 1850 AND 1851-06')).toEqual(span([1850, 1, 1], [1851, 6, 30]));
  });
  it('takes the widest reading of a reversed BET', () => {
    expect(dateInterval('BET 1860 AND 1850')).toEqual(span([1850, 1, 1], [1860, 12, 31]));
  });
  it('reads FROM a TO b like BET, and the open-ended FROM and TO', () => {
    expect(dateInterval('FROM 1850 TO 1860')).toEqual(span([1850, 1, 1], [1860, 12, 31]));
    expect(dateInterval('FROM 1850')).toEqual({ earliest: day(1850, 1, 1), latest: Infinity });
    expect(dateInterval('TO 1860')).toEqual({ earliest: -Infinity, latest: day(1860, 12, 31) });
  });
  it('reads INT as its date, ignoring the phrase', () => {
    expect(dateInterval('INT 1814-01-27 (from the parish book)')).toEqual(span([1814, 1, 27], [1814, 1, 27]));
    expect(dateInterval('INT 1814')).toEqual(span([1814, 1, 1], [1814, 12, 31]));
  });
  it('reads a dual year as the later, Gregorian year (#971)', () => {
    expect(dateInterval('11 FEB 1712/13')).toEqual(span([1713, 2, 11], [1713, 2, 11]));
    expect(dateInterval('JAN 1716/17')).toEqual(span([1717, 1, 1], [1717, 1, 31]));
    expect(dateInterval('1699/00')).toEqual(span([1700, 1, 1], [1700, 12, 31]));
    // Vendor spellings of the same later year.
    expect(dateInterval('1712/3')).toEqual(dateInterval('1713'));
    expect(dateInterval('1712/1713')).toEqual(dateInterval('1713'));
    expect(dateInterval('ABT 1712/13')).toEqual(dateInterval('ABT 1713'));
    expect(dateInterval('INT 13 JAN 1712/13 (old style)')).toEqual(dateInterval('13 JAN 1713'));
  });
  it('reads B.C. as a negative year, with 1 B.C. as year 0 (#971)', () => {
    expect(dateInterval('500 B.C.')).toEqual(span([-499, 1, 1], [-499, 12, 31]));
    expect(dateInterval('9 MAY 1000 B.C.')).toEqual(span([-999, 5, 9], [-999, 5, 9]));
    expect(dateInterval('500 BC')).toEqual(dateInterval('500 B.C.'));
    expect(dateInterval('500 bce')).toEqual(dateInterval('500 B.C.'));
    expect(dateInterval('1 B.C.')).toEqual(span([0, 1, 1], [0, 12, 31]));
    expect(dateInterval('ABT 44 BC')!.earliest).toBe(day(-48, 1, 1));
    expect(definitelyBefore(dateInterval('10 BC')!, dateInterval('10 AD')!)).toBe(true);
  });
  it('reads AD as the plain year', () => {
    expect(dateInterval('9 AD')).toEqual(dateInterval('9'));
    expect(dateInterval('abt 30 A.D.')).toEqual(dateInterval('ABT 30'));
  });
  it('returns null for a malformed dual year or era', () => {
    expect(dateInterval('1712/14')).toBeNull();
    expect(dateInterval('1712/13 BC')).toBeNull();
    expect(dateInterval('0 BC')).toBeNull();
    expect(dateInterval('1850-01-01 BC')).toBeNull();
    expect(dateInterval('BC')).toBeNull();
  });
  it('returns null for a date phrase', () => {
    expect(dateInterval('(the winter of the great frost)')).toBeNull();
  });
  it('returns null for empty and unreadable values', () => {
    expect(dateInterval(null)).toBeNull();
    expect(dateInterval('  ')).toBeNull();
    expect(dateInterval('sometime in spring')).toBeNull();
    expect(dateInterval('1814-02-30')).toBeNull();
    expect(dateInterval('1814-13')).toBeNull();
    expect(dateInterval('ABT the fire')).toBeNull();
    expect(dateInterval('BET 1850 AND later')).toBeNull();
    expect(dateInterval('0')).toBeNull();
  });
});

describe('overlap under the ±5-year reading', () => {
  it('ABT 1849 and 1814 do not overlap', () => {
    expect(overlaps('ABT 1849', '1814')).toBe(false);
  });
  it('ABT 1818 and 1814 overlap', () => {
    expect(overlaps('ABT 1818', '1814')).toBe(true);
  });
  it('definitelyBefore needs every reading to be before', () => {
    expect(definitelyBefore(dateInterval('1814-01-27')!, dateInterval('EST 1842')!)).toBe(true);
    expect(definitelyBefore(dateInterval('BEF 1850')!, dateInterval('1849')!)).toBe(false);
    expect(definitelyBefore(dateInterval('1814')!, dateInterval('1814')!)).toBe(false);
  });
});
