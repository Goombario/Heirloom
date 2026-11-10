import { describe, test, expect } from 'vitest';
import { personCardModel } from '@/app/components/tree/personCardModel';

describe('personCardModel', () => {
  test('short names pass through unchanged', () => {
    expect(personCardModel({ name: 'Jane Doe' }).displayName).toBe('Jane Doe');
  });

  test('abbreviates middle names to initials when long', () => {
    expect(personCardModel({ name: 'Osric Lionel Fairweather' }).displayName)
      .toBe('Osric L. Fairweather');
  });

  test('a long nickname name leads with the nickname and drops the first name', () => {
    expect(personCardModel({ name: 'Edmund "Ned" Ashby David Thornbury' }).displayName)
      .toBe('"Ned" A. D. Thornbury');
  });

  test('initials come from first + last word (quotes stripped)', () => {
    expect(personCardModel({ name: 'Osric Lionel Fairweather' }).initials).toBe('OF');
    expect(personCardModel({ name: 'Madonna' }).initials).toBe('M');
  });

  test('status maps living / deceased / unknown', () => {
    expect(personCardModel({ name: 'X', isDeceased: false }).status).toBe('living');
    expect(personCardModel({ name: 'X', isDeceased: true }).status).toBe('deceased');
    expect(personCardModel({ name: 'X', isDeceased: null }).status).toBe('unknown');
    expect(personCardModel({ name: 'X' }).status).toBe('unknown');
  });

  test('age hides for an unknown status at 70 or more', () => {
    expect(personCardModel({ name: 'X', isDeceased: null, age: 70 }).age).toBeNull();
    expect(personCardModel({ name: 'X', isDeceased: null, age: 69 }).age).toBe('69');
    expect(personCardModel({ name: 'X', isDeceased: true, age: 90 }).age).toBe('90');
    expect(personCardModel({ name: 'X', isDeceased: false, age: '6mo' }).age).toBe('6mo');
    expect(personCardModel({ name: 'X', isDeceased: false }).age).toBeNull();
  });
});
