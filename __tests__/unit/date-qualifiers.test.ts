import { describe, it, expect } from 'vitest';
import {
  splitDateQualifier,
  isDatePhrase,
  datePhraseText,
  makeDatePhrase,
  DATE_PHRASE_MAX,
  composeDateValue,
  decomposeDateValue,
  QUALIFIER_OPTIONS,
  hoistQualifier,
} from '@/lib/date-qualifiers';

describe('splitDateQualifier — existing grammar (regression)', () => {
  it('splits a single-prefix qualifier', () => {
    expect(splitDateQualifier('ABT 1850')).toEqual({ prefix: 'ABT', parts: ['1850'], sep: null });
  });

  it('splits BET … AND …', () => {
    expect(splitDateQualifier('BET 1877 AND 1880')).toEqual({
      prefix: 'BET', parts: ['1877', '1880'], sep: 'AND',
    });
  });

  it('splits FROM … TO … and the half forms', () => {
    expect(splitDateQualifier('FROM 1901 TO 1905')).toEqual({
      prefix: 'FROM', parts: ['1901', '1905'], sep: 'TO',
    });
    expect(splitDateQualifier('FROM 1901')).toEqual({ prefix: 'FROM', parts: ['1901'], sep: null });
    expect(splitDateQualifier('TO 1905')).toEqual({ prefix: 'TO', parts: ['1905'], sep: null });
  });

  it('returns null for a plain date', () => {
    expect(splitDateQualifier('1945-03-15')).toBeNull();
    expect(splitDateQualifier('1945')).toBeNull();
  });

  it('rejects lenient entry forms — storage grammar stays strict', () => {
    expect(splitDateQualifier('ABT. 1850')).toBeNull();
    expect(splitDateQualifier('~1850')).toBeNull();
    expect(splitDateQualifier('vers 1850')).toBeNull();
  });
});

describe('splitDateQualifier — date phrases', () => {
  it('reports a bare parenthesised value as a phrase', () => {
    expect(splitDateQualifier('(harvest time)')).toEqual({
      prefix: 'PHRASE', parts: ['harvest time'], sep: null,
    });
  });

  // The load-bearing ordering assertion: the parenthesis test must precede the
  // prefix table, or these phrases mutate into qualified dates on reload.
  it.each([
    ['(abt 1850)', 'abt 1850'],
    ['(from the war)', 'from the war'],
    ['(between harvests)', 'between harvests'],
    ['(to be confirmed)', 'to be confirmed'],
    ['(1877 and 1880 sometime)', '1877 and 1880 sometime'],
  ])('%s stays a phrase, never a qualified date', (stored, text) => {
    expect(splitDateQualifier(stored)).toEqual({ prefix: 'PHRASE', parts: [text], sep: null });
  });

  it('does not treat INT <date> (<phrase>) as a bare phrase', () => {
    expect(splitDateQualifier('INT 1850 (the year of the fire)')).toEqual({
      prefix: 'INT', parts: ['1850 (the year of the fire)'], sep: null,
    });
  });

  // A bare "()" still satisfies the "parentheses are authoritative" rule — it is
  // an empty phrase, not a plain date or malformed input — so it stays a PHRASE
  // with empty text rather than falling through to null.
  it('treats "()" as an empty phrase', () => {
    expect(splitDateQualifier('()')).toEqual({ prefix: 'PHRASE', parts: [''], sep: null });
  });
});

describe('phrase helpers', () => {
  it('isDatePhrase / datePhraseText', () => {
    expect(isDatePhrase('(harvest time)')).toBe(true);
    expect(isDatePhrase('ABT 1850')).toBe(false);
    expect(isDatePhrase(null)).toBe(false);
    expect(datePhraseText('(harvest time)')).toBe('harvest time');
    expect(datePhraseText('INT 1850 (the fire)')).toBe('the fire');
    expect(datePhraseText('1850')).toBeNull();
  });

  it('makeDatePhrase caps at 35 characters and strips parentheses', () => {
    expect(makeDatePhrase('harvest time')).toBe('(harvest time)');
    expect(makeDatePhrase('  spaced  ')).toBe('(spaced)');
    expect(makeDatePhrase('a(b)c')).toBe('(abc)');
    const long = 'x'.repeat(50);
    expect(makeDatePhrase(long)).toBe(`(${'x'.repeat(DATE_PHRASE_MAX)})`);
    expect(makeDatePhrase('   ')).toBe('');
  });

  it('makeDatePhrase strips control characters and collapses whitespace', () => {
    // A newline inside a date value ends the DATE line on export and lets the
    // remainder be read back as further GEDCOM lines — a forged record inside
    // the user's own file.
    expect(makeDatePhrase('1850\n0 @I9999@ INDI')).toBe('(1850 0 @I9999@ INDI)');
    expect(makeDatePhrase('a\r\nb')).toBe('(a b)');
    expect(makeDatePhrase('a\tb')).toBe('(a b)');
    expect(makeDatePhrase('a\x00b')).toBe('(a b)');
    expect(makeDatePhrase('a   b')).toBe('(a b)');
    expect(makeDatePhrase('\n\t ')).toBe('');
  });
});

describe('composeDateValue', () => {
  it('builds every qualifier in the §2 table', () => {
    expect(composeDateValue({ qualifier: 'EXACT', first: '1850-03-15', second: '' })).toBe('1850-03-15');
    expect(composeDateValue({ qualifier: 'ABT', first: '1850', second: '' })).toBe('ABT 1850');
    expect(composeDateValue({ qualifier: 'EST', first: '1850', second: '' })).toBe('EST 1850');
    expect(composeDateValue({ qualifier: 'CAL', first: '1850', second: '' })).toBe('CAL 1850');
    expect(composeDateValue({ qualifier: 'BEF', first: '1850', second: '' })).toBe('BEF 1850');
    expect(composeDateValue({ qualifier: 'AFT', first: '1850', second: '' })).toBe('AFT 1850');
    expect(composeDateValue({ qualifier: 'BET', first: '1877', second: '1880' })).toBe('BET 1877 AND 1880');
    expect(composeDateValue({ qualifier: 'FROM', first: '1901', second: '1905' })).toBe('FROM 1901 TO 1905');
  });

  // §2 half-known ranges. BET with one bound is not "Between" — AFT/BEF is the
  // only legal way to write the same claim.
  it.each([
    ['FROM', '1901', '', 'FROM 1901'],
    ['FROM', '', '1905', 'TO 1905'],
    ['BET', '1877', '', 'AFT 1877'],
    ['BET', '', '1880', 'BEF 1880'],
    ['FROM', '', '', ''],
    ['BET', '', '', ''],
  ] as const)('%s(%s, %s) → "%s"', (qualifier, first, second, expected) => {
    expect(composeDateValue({ qualifier, first, second })).toBe(expected);
  });

  it('stores nothing when the date box is empty, whatever the select says', () => {
    for (const q of QUALIFIER_OPTIONS) {
      expect(composeDateValue({ qualifier: q, first: '', second: '' })).toBe('');
    }
  });

  it('wraps PHRASE text and passes RAW through', () => {
    expect(composeDateValue({ qualifier: 'PHRASE', first: 'harvest time', second: '' })).toBe('(harvest time)');
    expect(composeDateValue({ qualifier: 'PHRASE', first: '', second: '' })).toBe('');
    expect(composeDateValue({ qualifier: 'RAW', first: 'INT 1850 (fire)', second: '' })).toBe('INT 1850 (fire)');
  });
});

describe('decomposeDateValue', () => {
  it('round-trips every composed value', () => {
    const stored = [
      '1850-03-15', 'ABT 1850', 'EST 1850', 'CAL 1850', 'BEF 1850', 'AFT 1850',
      'BET 1877 AND 1880', 'FROM 1901 TO 1905', 'FROM 1901', 'TO 1905',
      '(harvest time)', 'INT 1850 (fire)', '',
    ];
    for (const s of stored) {
      expect(composeDateValue(decomposeDateValue(s))).toBe(s);
    }
  });

  // §2: on reload the select reads what is genuinely stored. Showing "Between"
  // with one empty box would be the control lying about the record.
  it('reads a half-known range back as the qualifier that was stored', () => {
    expect(decomposeDateValue('AFT 1877')).toEqual({ qualifier: 'AFT', first: '1877', second: '' });
    expect(decomposeDateValue('BEF 1880')).toEqual({ qualifier: 'BEF', first: '1880', second: '' });
    expect(decomposeDateValue('FROM 1901')).toEqual({ qualifier: 'FROM', first: '1901', second: '' });
    expect(decomposeDateValue('TO 1905')).toEqual({ qualifier: 'FROM', first: '', second: '1905' });
  });

  it('defaults an empty value to Exact', () => {
    expect(decomposeDateValue('')).toEqual({ qualifier: 'EXACT', first: '', second: '' });
    expect(decomposeDateValue(null)).toEqual({ qualifier: 'EXACT', first: '', second: '' });
  });

  it('puts a phrase in PHRASE mode and an INT in RAW mode', () => {
    expect(decomposeDateValue('(harvest time)')).toEqual({ qualifier: 'PHRASE', first: 'harvest time', second: '' });
    expect(decomposeDateValue('INT 1850 (fire)')).toEqual({ qualifier: 'RAW', first: 'INT 1850 (fire)', second: '' });
  });

  it('keeps an unrecognised legacy value visible as Exact text rather than dropping it', () => {
    expect(decomposeDateValue('sometime in the war')).toEqual({
      qualifier: 'EXACT', first: 'sometime in the war', second: '',
    });
  });
});

const EN = { ABT: ['about', 'abt', 'ca', 'circa'], BEF: ['before', 'bef'], AFT: ['after', 'aft'] };
// Mirrors messages/fr.json exactly. 'apr' is deliberately absent: it collides
// with the GEDCOM month token APR (April), which would make "apr 1850" ambiguous
// (see date-alias-month-collision.test.ts).
const FR = { ABT: ['vers', 'environ', 'env'], BEF: ['avant', 'av'], AFT: ['après', 'apres'] };
const RU = { ABT: ['около', 'ок', 'прибл'], BEF: ['до', 'ранее'], AFT: ['после', 'позже'] };

describe('hoistQualifier — symbols (language-neutral)', () => {
  it.each([
    ['~1850', 'ABT', '1850', ''],
    ['~ 1850', 'ABT', '1850', ''],
    ['<1920', 'BEF', '1920', ''],
    ['>1850', 'AFT', '1850', ''],
    ['1877-1880', 'BET', '1877', '1880'],
    ['1877–1880', 'BET', '1877', '1880'],
    ['1877 – 1880', 'BET', '1877', '1880'],
  ])('%s', (input, qualifier, first, second) => {
    expect(hoistQualifier(input)).toEqual({ qualifier, first, second });
  });

  it('leaves an ISO partial alone — 1945-03 is a date, not a range', () => {
    expect(hoistQualifier('1945-03')).toBeNull();
    expect(hoistQualifier('1945-03-15')).toBeNull();
    expect(hoistQualifier('1945')).toBeNull();
  });
});

describe('hoistQualifier — GEDCOM tokens, accepted in every language', () => {
  it.each([
    ['ABT 1850', 'ABT', '1850', ''],
    ['abt 1850', 'ABT', '1850', ''],
    ['abt. 1850', 'ABT', '1850', ''],
    ['EST 1850', 'EST', '1850', ''],
    ['CAL 1850', 'CAL', '1850', ''],
    ['BEF 1920', 'BEF', '1920', ''],
    ['AFT 1850', 'AFT', '1850', ''],
    ['BET 1877 AND 1880', 'BET', '1877', '1880'],
    ['bet 1877 and 1880', 'BET', '1877', '1880'],
    ['FROM 1901 TO 1905', 'FROM', '1901', '1905'],
    ['from 1901 to 1905', 'FROM', '1901', '1905'],
    ['FROM 1901', 'FROM', '1901', ''],
    ['TO 1905', 'FROM', '', '1905'],
  ])('%s (no alias table needed)', (input, qualifier, first, second) => {
    expect(hoistQualifier(input)).toEqual({ qualifier, first, second });
  });
});

describe('hoistQualifier — word aliases per language', () => {
  it.each([
    [EN, 'about 1850', 'ABT'], [EN, 'ca 1850', 'ABT'], [EN, 'ca. 1850', 'ABT'],
    [EN, 'circa 1850', 'ABT'], [EN, 'before 1850', 'BEF'], [EN, 'after 1850', 'AFT'],
    [FR, 'vers 1850', 'ABT'], [FR, 'environ 1850', 'ABT'], [FR, 'env. 1850', 'ABT'],
    [FR, 'avant 1850', 'BEF'], [FR, 'av. 1850', 'BEF'], [FR, 'après 1850', 'AFT'],
    [RU, 'около 1850', 'ABT'], [RU, 'ок. 1850', 'ABT'], [RU, 'прибл 1850', 'ABT'],
    [RU, 'до 1850', 'BEF'], [RU, 'ранее 1850', 'BEF'], [RU, 'после 1850', 'AFT'],
  ])('%#: %s → %s', (aliases, input, qualifier) => {
    expect(hoistQualifier(input, aliases)).toEqual({ qualifier, first: '1850', second: '' });
  });

  it('keeps the whole remainder, not just a year', () => {
    expect(hoistQualifier('abt 15 Mar 1945')).toEqual({ qualifier: 'ABT', first: '15 Mar 1945', second: '' });
  });

  it('returns null when nothing matches', () => {
    expect(hoistQualifier('15 Mar 1945')).toBeNull();
    expect(hoistQualifier('harvest time 1850')).toBeNull();
    expect(hoistQualifier('vers 1850')).toBeNull();  // no alias table supplied
    expect(hoistQualifier('')).toBeNull();
  });

  it('never hoists a parenthesised phrase', () => {
    expect(hoistQualifier('(abt 1850)')).toBeNull();
  });
});
