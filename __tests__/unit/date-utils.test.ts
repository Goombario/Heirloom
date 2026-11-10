import { describe, it, expect } from 'vitest';
import {
  parseDateComponents,
  formatDateForDisplay,
  formatYearForDisplay,
  formatYearOrEmpty,
  calculateAge,
  parseUserDateInput,
  formatDateForGedcom,
  formatDateForInput,
  sortableYear,
  compareSortableYears,
  isMonthWord,
} from '@/lib/date-utils';

describe('parseDateComponents', () => {
  it('parses full date YYYY-MM-DD', () => {
    expect(parseDateComponents('1945-03-15')).toEqual({
      year: 1945, month: 3, day: 15, precision: 'full',
    });
  });

  it('parses year-month YYYY-MM', () => {
    expect(parseDateComponents('1945-03')).toEqual({
      year: 1945, month: 3, precision: 'year-month',
    });
  });

  it('parses year only YYYY', () => {
    expect(parseDateComponents('1945')).toEqual({
      year: 1945, precision: 'year',
    });
  });

  it('returns null for null, undefined, empty', () => {
    expect(parseDateComponents(null)).toBeNull();
    expect(parseDateComponents(undefined)).toBeNull();
    expect(parseDateComponents('')).toBeNull();
    expect(parseDateComponents('   ')).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    expect(parseDateComponents('not-a-date')).toBeNull();
    expect(parseDateComponents('12')).toBeNull();
    expect(parseDateComponents('1945-3')).toBeNull(); // needs zero-pad
  });
});

describe('formatDateForDisplay', () => {
  it('formats year only', () => {
    expect(formatDateForDisplay('1945')).toBe('1945');
  });

  it('formats year-month', () => {
    expect(formatDateForDisplay('1945-03')).toBe('Mar 1945');
  });

  it('formats full date', () => {
    expect(formatDateForDisplay('1945-03-15')).toBe('Mar 15, 1945');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatDateForDisplay(null)).toBe('');
    expect(formatDateForDisplay(undefined)).toBe('');
  });

  it('returns raw string for unparseable date', () => {
    expect(formatDateForDisplay('garbage')).toBe('garbage');
  });
});

describe('formatYearForDisplay', () => {
  it('extracts year from full date', () => {
    expect(formatYearForDisplay('1945-03-15')).toBe('1945');
  });

  it('extracts year from year-month', () => {
    expect(formatYearForDisplay('1945-03')).toBe('1945');
  });

  it('returns year from year-only', () => {
    expect(formatYearForDisplay('1945')).toBe('1945');
  });

  it('returns ? for null/undefined', () => {
    expect(formatYearForDisplay(null)).toBe('?');
    expect(formatYearForDisplay(undefined)).toBe('?');
  });
});

describe('formatYearOrEmpty', () => {
  it('returns the year (with GEDCOM qualifiers) when present', () => {
    expect(formatYearOrEmpty('1945-03-15')).toBe('1945');
    expect(formatYearOrEmpty('ABT 1876')).toBe('~1876');
    expect(formatYearOrEmpty('BEF 1920')).toBe('<1920');
    expect(formatYearOrEmpty('AFT 1850')).toBe('>1850');
  });

  it('returns "" (not "?") when no year is known', () => {
    expect(formatYearOrEmpty(null)).toBe('');
    expect(formatYearOrEmpty(undefined)).toBe('');
    expect(formatYearOrEmpty('ABT unknown')).toBe('');
  });
});

describe('calculateAge', () => {
  it('calculates age from full dates', () => {
    expect(calculateAge('1950-01-15', '2020-06-20', false)).toEqual({ kind: 'years', value: 70 });
  });

  it('accounts for birthday not yet passed', () => {
    expect(calculateAge('1950-06-15', '2020-03-10', false)).toEqual({ kind: 'years', value: 69 });
  });

  it('returns approximate age for year-only dates', () => {
    expect(calculateAge('1950', null, false)).toEqual({ kind: 'years_approx', value: expect.any(Number) });
  });

  it('returns null when no birth date', () => {
    expect(calculateAge(null, null, false)).toBeNull();
  });

  it('returns null when birth date unparseable', () => {
    expect(calculateAge('garbage', null, false)).toBeNull();
  });

  it('returns deceased for year-only birth, deceased without death date', () => {
    // Year-only precision means birth.month is undefined, triggering the isDeceased branch
    expect(calculateAge('1950', null, true)).toEqual({ kind: 'deceased' });
  });

  it('returns months for infants under 2 years old', () => {
    // Birth to death span of 18 months
    const result = calculateAge('2020-01-15', '2021-07-15', false);
    expect(result).toEqual({ kind: 'months', value: expect.any(Number) });
  });
});

describe('parseUserDateInput', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(parseUserDateInput('1945-03-15')).toBe('1945-03-15');
  });

  it('accepts YYYY-MM', () => {
    expect(parseUserDateInput('1945-03')).toBe('1945-03');
  });

  it('accepts YYYY', () => {
    expect(parseUserDateInput('1945')).toBe('1945');
  });

  it('accepts M/D/YYYY', () => {
    expect(parseUserDateInput('3/15/1945')).toBe('1945-03-15');
  });

  it('accepts MM/DD/YYYY', () => {
    expect(parseUserDateInput('03/15/1945')).toBe('1945-03-15');
  });

  it('accepts "Month YYYY"', () => {
    expect(parseUserDateInput('March 1945')).toBe('1945-03');
    expect(parseUserDateInput('Mar 1945')).toBe('1945-03');
  });

  it('accepts "Month DD, YYYY"', () => {
    expect(parseUserDateInput('October 4, 1884')).toBe('1884-10-04');
  });

  it('accepts "Mon DD YYYY"', () => {
    expect(parseUserDateInput('Oct 04 1884')).toBe('1884-10-04');
  });

  it('accepts "DD Month YYYY"', () => {
    expect(parseUserDateInput('15 Mar 1945')).toBe('1945-03-15');
    expect(parseUserDateInput('15 March 1945')).toBe('1945-03-15');
  });

  it('returns null for empty or whitespace', () => {
    expect(parseUserDateInput('')).toBeNull();
    expect(parseUserDateInput('   ')).toBeNull();
  });

  it('returns null for invalid dates', () => {
    expect(parseUserDateInput('not a date')).toBeNull();
  });

  it('accepts GEDCOM qualifier prefixes and ranges', () => {
    expect(parseUserDateInput('abt 1850')).toBe('ABT 1850');
    expect(parseUserDateInput('BET 1850 AND 1855')).toBe('BET 1850 AND 1855');
    expect(parseUserDateInput('FROM 1850 TO 1855')).toBe('FROM 1850 TO 1855');
    expect(parseUserDateInput('bef 3 Mar 1900')).toBe('BEF 1900-03-03');
    expect(parseUserDateInput('AFT October 4, 1884')).toBe('AFT 1884-10-04');
    expect(parseUserDateInput('CAL 1945')).toBe('CAL 1945');
    expect(parseUserDateInput('EST 1945-03')).toBe('EST 1945-03');
  });

  it('rejects invalid month in YYYY-MM', () => {
    expect(parseUserDateInput('1945-13')).toBeNull();
  });

  it('rejects invalid full date', () => {
    expect(parseUserDateInput('1945-13-01')).toBeNull();
  });

  // New tokenizer-based formats (any ordering of year + text month + optional day)
  it('accepts "YYYY Mon DD" (year-first format)', () => {
    expect(parseUserDateInput('1888 Jun 20')).toBe('1888-06-20');
    expect(parseUserDateInput('1888 June 20')).toBe('1888-06-20');
  });

  it('accepts "YYYY Month" (year-first month-only)', () => {
    expect(parseUserDateInput('1945 March')).toBe('1945-03');
    expect(parseUserDateInput('1945 Mar')).toBe('1945-03');
  });

  it('accepts tokenized formats in any order', () => {
    expect(parseUserDateInput('Jun 20 1888')).toBe('1888-06-20');
    expect(parseUserDateInput('20 Jun 1888')).toBe('1888-06-20');
    expect(parseUserDateInput('1888 Jun 20')).toBe('1888-06-20');
  });

  it('rejects month+day without year (June 20)', () => {
    expect(parseUserDateInput('June 20')).toBeNull();
  });

  // slashOrder: DMY
  it('accepts D/M/YYYY with slashOrder DMY', () => {
    expect(parseUserDateInput('20/3/1945', 'DMY')).toBe('1945-03-20');
    expect(parseUserDateInput('15/12/1900', 'DMY')).toBe('1900-12-15');
  });

  it('accepts M/D/YYYY with default slashOrder MDY', () => {
    expect(parseUserDateInput('3/20/1945')).toBe('1945-03-20');
    expect(parseUserDateInput('3/20/1945', 'MDY')).toBe('1945-03-20');
  });

  it('rejects invalid DMY slash date', () => {
    // Day 20, Month 15 is invalid in DMY order
    expect(parseUserDateInput('20/15/1945', 'DMY')).toBeNull();
  });

  it('rejects year 0', () => {
    expect(parseUserDateInput('0000')).toBeNull();
  });

  it('rejects year 3000', () => {
    expect(parseUserDateInput('3000')).toBeNull();
  });
});

describe('formatDateForGedcom', () => {
  it('formats year only', () => {
    expect(formatDateForGedcom('1945')).toBe('1945');
  });

  it('formats year-month', () => {
    expect(formatDateForGedcom('1945-03')).toBe('MAR 1945');
  });

  it('formats full date', () => {
    expect(formatDateForGedcom('1945-03-15')).toBe('15 MAR 1945');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatDateForGedcom(null)).toBe('');
    expect(formatDateForGedcom(undefined)).toBe('');
  });

  it('returns raw string for unparseable date', () => {
    expect(formatDateForGedcom('garbage')).toBe('garbage');
  });

  // Load-bearing for the person-event DATE fix: `Events."Date"` already contains
  // GEDCOM-formatted values in the wild, because the person-event export path used
  // to emit the column raw and the parser stores event dates verbatim. Routing that
  // column through this helper is only safe if re-formatting an already-formatted
  // value is a no-op.
  it('is idempotent — re-formatting an already-GEDCOM date does not corrupt it', () => {
    expect(formatDateForGedcom('9 AUG 1960')).toBe('9 AUG 1960');
    expect(formatDateForGedcom('15 MAR 1945')).toBe('15 MAR 1945');
    expect(formatDateForGedcom('MAR 1945')).toBe('MAR 1945');
    expect(formatDateForGedcom('1945')).toBe('1945');
    expect(formatDateForGedcom('ABT 1850')).toBe('ABT 1850');
    expect(formatDateForGedcom('BET 1900 AND 1905')).toBe('BET 1900 AND 1905');
    // Applying it twice must equal applying it once, for every shape above.
    for (const value of ['1945-03-15', '1945-03', '1945', 'ABT 1850-06', 'garbage', '9 AUG 1960']) {
      expect(formatDateForGedcom(formatDateForGedcom(value)), value).toBe(formatDateForGedcom(value));
    }
  });
});

describe('formatDateForInput', () => {
  it('formats year only', () => {
    expect(formatDateForInput('1945')).toBe('1945');
  });

  it('formats year-month', () => {
    expect(formatDateForInput('1945-03')).toBe('Mar 1945');
  });

  it('formats full date', () => {
    expect(formatDateForInput('1945-03-15')).toBe('Mar 15, 1945');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatDateForInput(null)).toBe('');
    expect(formatDateForInput(undefined)).toBe('');
  });
});

describe('parseUserDateInput — French month names', () => {
  it('accepts full French month names', () => {
    expect(parseUserDateInput('15 mars 1945')).toBe('1945-03-15');
    expect(parseUserDateInput('mars 1945')).toBe('1945-03');
    expect(parseUserDateInput('15 janvier 1900')).toBe('1900-01-15');
    expect(parseUserDateInput('décembre 1888')).toBe('1888-12');
    expect(parseUserDateInput('15 août 1815')).toBe('1815-08-15');
  });

  it('accepts abbreviated French month names', () => {
    expect(parseUserDateInput('15 mars 1945')).toBe('1945-03-15');
    expect(parseUserDateInput('janv 1900')).toBe('1900-01');
    expect(parseUserDateInput('févr 1800')).toBe('1800-02');
    expect(parseUserDateInput('juil 1776')).toBe('1776-07');
  });

  it('accepts French months in any token order', () => {
    expect(parseUserDateInput('1945 mars 15')).toBe('1945-03-15');
    expect(parseUserDateInput('mars 15 1945')).toBe('1945-03-15');
  });

  it('is case-insensitive for French names', () => {
    expect(parseUserDateInput('15 Mars 1945')).toBe('1945-03-15');
    expect(parseUserDateInput('MARS 1945')).toBe('1945-03');
  });
});

describe('parseUserDateInput — Russian month names', () => {
  it('accepts Russian nominative month names', () => {
    expect(parseUserDateInput('март 1945')).toBe('1945-03');
    expect(parseUserDateInput('январь 1900')).toBe('1900-01');
    expect(parseUserDateInput('декабрь 1888')).toBe('1888-12');
  });

  it('accepts Russian genitive month names (used in date phrases)', () => {
    expect(parseUserDateInput('15 марта 1945')).toBe('1945-03-15');
    expect(parseUserDateInput('1 января 1900')).toBe('1900-01-01');
    expect(parseUserDateInput('25 декабря 1888')).toBe('1888-12-25');
  });

  it('accepts Russian months in any token order', () => {
    expect(parseUserDateInput('1945 марта 15')).toBe('1945-03-15');
    expect(parseUserDateInput('марта 15 1945')).toBe('1945-03-15');
  });
});

describe('formatDateForDisplay — locale support', () => {
  it('formats in French (fr)', () => {
    expect(formatDateForDisplay('1945-03-15', 'fr')).toBe('15 mars 1945');
    expect(formatDateForDisplay('1945-03', 'fr')).toBe('mars 1945');
    expect(formatDateForDisplay('1945', 'fr')).toBe('1945');
    expect(formatDateForDisplay('1815-08-15', 'fr')).toBe('15 août 1815');
    expect(formatDateForDisplay('1900-01', 'fr')).toBe('janv. 1900');
  });

  it('formats in Russian (ru)', () => {
    expect(formatDateForDisplay('1945-03-15', 'ru')).toBe('15 мар. 1945');
    expect(formatDateForDisplay('1945-03', 'ru')).toBe('мар. 1945');
    expect(formatDateForDisplay('1945', 'ru')).toBe('1945');
    expect(formatDateForDisplay('1900-01-01', 'ru')).toBe('1 янв. 1900');
  });

  it('defaults to English when no locale given', () => {
    expect(formatDateForDisplay('1945-03-15')).toBe('Mar 15, 1945');
    expect(formatDateForDisplay('1945-03')).toBe('Mar 1945');
  });

  it('returns empty string for null/undefined regardless of locale', () => {
    expect(formatDateForDisplay(null, 'fr')).toBe('');
    expect(formatDateForDisplay(undefined, 'ru')).toBe('');
  });
});

describe('date qualifiers (GED-4)', () => {
  it('formatDateForGedcom re-emits qualifier + GEDCOM date', () => {
    expect(formatDateForGedcom('ABT 1850')).toBe('ABT 1850');
    expect(formatDateForGedcom('BEF 1900-03-03')).toBe('BEF 3 MAR 1900');
    expect(formatDateForGedcom('AFT 1880-06')).toBe('AFT JUN 1880');
    expect(formatDateForGedcom('BET 1850 AND 1860')).toBe('BET 1850 AND 1860');
    expect(formatDateForGedcom('FROM 1850-01 TO 1860')).toBe('FROM JAN 1850 TO 1860');
  });

  it('formatDateForDisplay formats inner date and keeps the qualifier', () => {
    expect(formatDateForDisplay('ABT 1850')).toBe('ABT 1850');
    expect(formatDateForDisplay('BEF 1900-03-03')).toBe('BEF Mar 3, 1900');
    expect(formatDateForDisplay('BET 1850 AND 1860')).toBe('BET 1850 AND 1860');
    expect(formatDateForDisplay('BEF 1900-03', 'fr')).toBe('BEF mars 1900');
  });

  it('formatYearForDisplay marks qualified/uncertain years distinctly from exact ones (#193)', () => {
    // Exact years are unchanged.
    expect(formatYearForDisplay('1850')).toBe('1850');
    expect(formatYearForDisplay('1850-03-15')).toBe('1850');
    // Approximation qualifiers → "~".
    expect(formatYearForDisplay('ABT 1850')).toBe('~1850');
    expect(formatYearForDisplay('EST 1878')).toBe('~1878');
    expect(formatYearForDisplay('CAL 1901')).toBe('~1901');
    // Before / after → "<" / ">".
    expect(formatYearForDisplay('BEF 1920')).toBe('<1920');
    expect(formatYearForDisplay('AFT 1850')).toBe('>1850');
    // Ranges collapse to the first year, marked uncertain.
    expect(formatYearForDisplay('BET 1877 AND 1880')).toBe('~1877');
    expect(formatYearForDisplay('FROM 1877 TO 1880')).toBe('~1877');
    // Unparseable / empty stays "?".
    expect(formatYearForDisplay('ABT unknown')).toBe('?');
    expect(formatYearForDisplay(null)).toBe('?');
  });
});

describe('date phrases through display / export / year', () => {
  it('displays a phrase as its bare text', () => {
    expect(formatDateForDisplay('(harvest time)')).toBe('harvest time');
    expect(formatDateForDisplay('(harvest time)', 'fr')).toBe('harvest time');
  });

  it('exports a phrase with its parentheses intact', () => {
    expect(formatDateForGedcom('(harvest time)')).toBe('(harvest time)');
  });

  it('re-exports an imported (abt 1850) unchanged — phrases are never promoted', () => {
    expect(formatDateForGedcom('(abt 1850)')).toBe('(abt 1850)');
  });

  it('gives a phrase no year', () => {
    expect(formatYearForDisplay('(harvest time)')).toBe('?');
    expect(formatYearOrEmpty('(harvest time)')).toBe('');
    expect(formatYearForDisplay('(abt 1850)')).toBe('?');
  });

  it('keeps a typed phrase as a phrase and caps it at 35 characters', () => {
    expect(parseUserDateInput('(harvest time)')).toBe('(harvest time)');
    expect(parseUserDateInput(`(${'x'.repeat(50)})`)).toBe(`(${'x'.repeat(35)})`);
  });
});

describe('sortableYear', () => {
  it('reads a plain date', () => {
    expect(sortableYear('1945-03-15')).toBe(1945);
    expect(sortableYear('1945')).toBe(1945);
  });

  it('reads the stated year of a prefix qualifier', () => {
    expect(sortableYear('ABT 1850')).toBe(1850);
    expect(sortableYear('BEF 1920')).toBe(1920);
    expect(sortableYear('AFT 1850')).toBe(1850);
    expect(sortableYear('EST 1850-03')).toBe(1850);
  });

  it('reads the earliest bound of a range', () => {
    expect(sortableYear('BET 1877 AND 1880')).toBe(1877);
    expect(sortableYear('FROM 1901 TO 1905')).toBe(1901);
    expect(sortableYear('FROM 1901')).toBe(1901);
  });

  it('reads the end year of a bare TO, which has no start', () => {
    expect(sortableYear('TO 1880')).toBe(1880);
  });

  it('returns null for a phrase, a yearless value, and nothing', () => {
    expect(sortableYear('(harvest time)')).toBeNull();
    expect(sortableYear('(abt 1850)')).toBeNull();
    expect(sortableYear('sometime')).toBeNull();
    expect(sortableYear(null)).toBeNull();
    expect(sortableYear(undefined)).toBeNull();
    expect(sortableYear('')).toBeNull();
  });
});

describe('compareSortableYears', () => {
  it('orders ascending and sinks the yearless to the end', () => {
    const dates = ['(harvest time)', '1905', null, 'ABT 1850', 'BET 1877 AND 1880'];
    expect([...dates].sort(compareSortableYears)).toEqual([
      'ABT 1850', 'BET 1877 AND 1880', '1905', '(harvest time)', null,
    ]);
  });

  it('is 0 for two yearless values, so callers keep their own tiebreak', () => {
    expect(compareSortableYears(null, '(harvest time)')).toBe(0);
  });
});

describe('isMonthWord', () => {
  it('recognises month names across the shipped languages', () => {
    expect(isMonthWord('Mar')).toBe(true);
    expect(isMonthWord('mars')).toBe(true);
    expect(isMonthWord('март')).toBe(true);
    expect(isMonthWord('abt')).toBe(false);
    expect(isMonthWord('vers')).toBe(false);
  });
});

describe('parseUserDateInput — INT', () => {
  // DATE_VALUE requires `INT <DATE> (<DATE_PHRASE>)`; the bare `INT <rest>` this
  // used to emit was invalid GEDCOM the moment it was exported.
  it('parenthesises the phrase and normalises the date', () => {
    expect(parseUserDateInput('INT 1850 (the year of the fire)')).toBe('INT 1850 (the year of the fire)');
    expect(parseUserDateInput('INT 15 Mar 1945 (from the diary)')).toBe('INT 1945-03-15 (from the diary)');
  });

  it('supplies the remainder as the phrase when the user typed none', () => {
    // There is no phrase to preserve, and the grammar requires one; echoing the
    // date text keeps the value legal and lossless.
    expect(parseUserDateInput('INT 1850')).toBe('INT 1850 (1850)');
  });

  it('caps the phrase at 35 characters', () => {
    expect(parseUserDateInput(`INT 1850 (${'x'.repeat(50)})`)).toBe(`INT 1850 (${'x'.repeat(35)})`);
  });
});

describe('formatDateForDisplay — localised qualifier words (§5)', () => {
  const FR = { ABT: 'Vers', EST: 'Estimée', CAL: 'Calculée', INT: 'Interprétée',
               BEF: 'Avant', AFT: 'Après', BET: 'Entre', AND: 'et', FROM: 'De', TO: 'à' };
  const RU = { ABT: 'Ок.', EST: 'Оценочно', CAL: 'Вычислено', INT: 'Интерпретировано',
               BEF: 'До', AFT: 'После', BET: 'Между', AND: 'и', FROM: 'С', TO: 'по' };

  it('renders the qualifier as a translated word', () => {
    expect(formatDateForDisplay('ABT 1945-03', 'fr', FR)).toBe('Vers mars 1945');
    expect(formatDateForDisplay('ABT 1945-03', 'ru', RU)).toBe('Ок. мар. 1945');
    expect(formatDateForDisplay('BET 1877 AND 1880', 'fr', FR)).toBe('Entre 1877 et 1880');
    expect(formatDateForDisplay('BET 1877 AND 1880', 'ru', RU)).toBe('Между 1877 и 1880');
    expect(formatDateForDisplay('FROM 1901 TO 1905', 'fr', FR)).toBe('De 1901 à 1905');
    expect(formatDateForDisplay('TO 1905', 'fr', FR)).toBe('à 1905');
  });

  it('falls back to the raw GEDCOM tag when no words are injected', () => {
    // The server-side GEDCOM paths have no translation context.
    expect(formatDateForDisplay('ABT 1850')).toBe('ABT 1850');
    expect(formatDateForDisplay('BET 1877 AND 1880')).toBe('BET 1877 AND 1880');
  });

  it('leaves a phrase and the compact year forms alone', () => {
    expect(formatDateForDisplay('(harvest time)', 'fr', FR)).toBe('harvest time');
    expect(formatYearForDisplay('ABT 1876')).toBe('~1876');
    expect(formatYearForDisplay('BEF 1920')).toBe('<1920');
    expect(formatYearForDisplay('AFT 1850')).toBe('>1850');
  });

  it('does not change what is exported — storage keeps the raw tag', () => {
    expect(formatDateForGedcom('ABT 1850')).toBe('ABT 1850');
    expect(formatDateForGedcom('BET 1877 AND 1880')).toBe('BET 1877 AND 1880');
  });
});

describe('formatDateForGedcom — a date value can never forge extra GEDCOM lines', () => {
  it('emits exactly one line for a value carrying newlines (record-injection repro)', () => {
    const forged = '(1850\n0 @I9999@ INDI\n1 NAME Injected /Record/)';
    const line = `2 DATE ${formatDateForGedcom(forged)}`;
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain('INDI\n');
  });

  it('strips control characters wherever they sit in the value', () => {
    expect(formatDateForGedcom('ABT 1850\n0 @X@ NOTE')).toBe('ABT 1850 0 @X@ NOTE');
    expect(formatDateForGedcom('1850\r\n1 NAME x')).toBe('1850 1 NAME x');
    expect(formatDateForGedcom('1850\x00x')).toBe('1850 x');
  });

  it('escapes a bare @xref@-shaped value so it is not read as a pointer', () => {
    expect(formatDateForGedcom('@I1@')).toBe('@@I1@');
    expect(formatDateForGedcom('(@I1@)')).toBe('(@I1@)');
  });

  it('leaves legitimate values byte-identical (round-trip invariant)', () => {
    expect(formatDateForGedcom('(abt 1850)')).toBe('(abt 1850)');
    expect(formatDateForGedcom('(abt the time of the fire)')).toBe('(abt the time of the fire)');
    expect(formatDateForGedcom('ABT 1850')).toBe('ABT 1850');
    expect(formatDateForGedcom('BET 1877 AND 1880')).toBe('BET 1877 AND 1880');
    expect(formatDateForGedcom('FROM 1901 TO 1905')).toBe('FROM 1901 TO 1905');
    expect(formatDateForGedcom('INT 1850 (the fire)')).toBe('INT 1850 (the fire)');
    expect(formatDateForGedcom('1945-03-15')).toBe('15 MAR 1945');
  });
});

describe('parseUserDateInput — INT reuses the single phrase-capping path', () => {
  it('caps and cleans an INT phrase through makeDatePhrase, not a second inline slice', () => {
    const long = 'y'.repeat(50);
    expect(parseUserDateInput(`INT 1850 (${long})`)).toBe(`INT 1850 (${'y'.repeat(35)})`);
    expect(parseUserDateInput('INT 1850 (the\nfire)')).toBe('INT 1850 (the fire)');
  });
});

describe('sorting places phrase-dated and undated events last', () => {
  it('an undated or phrase-dated event does not lead the timeline', () => {
    const dates = ['1920', null, '(harvest time)', 'ABT 1850', 'BET 1877 AND 1880', 'TO 1880'];
    const sorted = [...dates].sort(compareSortableYears);
    expect(sorted.slice(0, 4)).toEqual(['ABT 1850', 'BET 1877 AND 1880', 'TO 1880', '1920']);
    expect(new Set(sorted.slice(4))).toEqual(new Set([null, '(harvest time)']));
  });
});
