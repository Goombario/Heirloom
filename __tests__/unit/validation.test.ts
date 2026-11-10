import { describe, it, expect } from 'vitest';
import {
  validateStringField,
  validateDateField,
  ValidationError,
  escapeHtml,
  validatePerson,
  getCompleteness,
  getCompletenessLabel,
} from '@/lib/validation';

describe('validateDateField', () => {
  it('caps a submitted date phrase at DATE_PHRASE_MAX server-side', () => {
    // The 35-char cap was browser-only: a direct API call could store a phrase
    // roughly 3x the GEDCOM DATE_PHRASE maximum and the writer re-emitted it whole.
    const long = 'z'.repeat(90);
    expect(validateDateField(`(${long})`, 'BirthDate', 100)).toBe(`(${'z'.repeat(35)})`);
  });

  it('caps and cleans the phrase inside a submitted INT date', () => {
    const long = `${'z'.repeat(20)}\n${'y'.repeat(20)}`;
    expect(validateDateField(`INT 1850 (${long})`, 'BirthDate', 100))
      .toBe(`INT 1850 (${'z'.repeat(20)} ${'y'.repeat(14)})`);
  });

  it('strips control characters from any date value', () => {
    expect(validateDateField('(1850\n0 @I9999@ INDI)', 'BirthDate', 100))
      .toBe('(1850 0 @I9999@ INDI)');
    expect(validateDateField('1850\n0 @I9999@ INDI', 'BirthDate', 100))
      .toBe('1850 0 @I9999@ INDI');
  });

  it('leaves ordinary and qualified dates untouched', () => {
    expect(validateDateField('1945-03-15', 'BirthDate', 100)).toBe('1945-03-15');
    expect(validateDateField('ABT 1850', 'BirthDate', 100)).toBe('ABT 1850');
    expect(validateDateField('BET 1877 AND 1880', 'BirthDate', 100)).toBe('BET 1877 AND 1880');
    expect(validateDateField('(abt 1850)', 'BirthDate', 100)).toBe('(abt 1850)');
  });

  it('returns null for empty and for a value that is nothing but control characters', () => {
    expect(validateDateField(null, 'BirthDate', 100)).toBeNull();
    expect(validateDateField('', 'BirthDate', 100)).toBeNull();
    expect(validateDateField('(\n\t)', 'BirthDate', 100)).toBeNull();
  });

  it('still applies the type and maxLength checks', () => {
    expect(() => validateDateField(123, 'BirthDate', 100)).toThrow(ValidationError);
    expect(() => validateDateField('x'.repeat(101), 'BirthDate', 100)).toThrow(ValidationError);
  });
});

describe('validateStringField', () => {
  it('returns trimmed string for valid input', () => {
    expect(validateStringField('  hello  ', 'Name', 100)).toBe('  hello  ');
  });

  it('returns null for null, undefined, or empty string', () => {
    expect(validateStringField(null, 'Name', 100)).toBeNull();
    expect(validateStringField(undefined, 'Name', 100)).toBeNull();
    expect(validateStringField('', 'Name', 100)).toBeNull();
  });

  it('throws ValidationError for non-string values', () => {
    expect(() => validateStringField(123, 'Age', 10)).toThrow(ValidationError);
    expect(() => validateStringField(123, 'Age', 10)).toThrow('Age must be a string');
    expect(() => validateStringField(true, 'Flag', 10)).toThrow(ValidationError);
    expect(() => validateStringField({}, 'Obj', 10)).toThrow(ValidationError);
  });

  it('throws ValidationError when string exceeds maxLength', () => {
    expect(() => validateStringField('abcdef', 'Code', 5)).toThrow(ValidationError);
    expect(() => validateStringField('abcdef', 'Code', 5)).toThrow('Code must be 5 characters or fewer');
  });

  it('returns string at exactly maxLength', () => {
    expect(validateStringField('abcde', 'Code', 5)).toBe('abcde');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns safe string unchanged', () => {
    expect(escapeHtml('John Smith')).toBe('John Smith');
  });
});

describe('validatePerson', () => {
  it('returns empty array for valid person', () => {
    const issues = validatePerson({ BirthDate: '1950-01-01', DeathDate: '2020-06-15' });
    expect(issues).toEqual([]);
  });

  it('returns empty array for person with no dates', () => {
    expect(validatePerson({})).toEqual([]);
  });

  it('detects death before birth', () => {
    const issues = validatePerson({ BirthDate: '1950', DeathDate: '1940' });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'DEATH_BEFORE_BIRTH' }));
  });

  it('detects future birth date', () => {
    const issues = validatePerson({ BirthDate: '2999' });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'FUTURE_BIRTH' }));
  });

  it('detects future death date', () => {
    const issues = validatePerson({ DeathDate: '2999' });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'FUTURE_DEATH' }));
  });

  it('detects unreasonable age (over 120)', () => {
    const issues = validatePerson({ BirthDate: '1800', DeathDate: '1950' });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'UNREASONABLE_AGE' }));
  });

  it('detects missing death for very old person', () => {
    const issues = validatePerson({ BirthDate: '1850' });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'MISSING_DEATH' }));
  });

  it('does not flag missing death for recently born person', () => {
    const issues = validatePerson({ BirthDate: '2000' });
    const codes = issues.map(i => i.code);
    expect(codes).not.toContain('MISSING_DEATH');
  });
});

describe('getCompleteness', () => {
  it('returns 0 for empty person', () => {
    expect(getCompleteness({})).toBe(0);
  });

  it('returns 100 for fully filled person', () => {
    expect(getCompleteness({
      FirstName: 'Jane',
      LastName: 'Doe',
      BirthDate: '1990-05-20',
      BirthPlace: 'Springfield',
      Sex: 'F',
    })).toBe(100);
  });

  it('returns partial percentage', () => {
    // 2 of 5 fields filled = 40%
    expect(getCompleteness({ FirstName: 'Jane', LastName: 'Doe' })).toBe(40);
  });

  it('ignores whitespace-only values', () => {
    expect(getCompleteness({ FirstName: '   ', LastName: 'Doe' })).toBe(20);
  });
});

describe('getCompletenessLabel', () => {
  it('returns Complete for 80+', () => {
    expect(getCompletenessLabel(80).label).toBe('Complete');
    expect(getCompletenessLabel(100).label).toBe('Complete');
  });

  it('returns Partial for 50-79', () => {
    expect(getCompletenessLabel(50).label).toBe('Partial');
    expect(getCompletenessLabel(79).label).toBe('Partial');
  });

  it('returns Incomplete for under 50', () => {
    expect(getCompletenessLabel(0).label).toBe('Incomplete');
    expect(getCompletenessLabel(49).label).toBe('Incomplete');
  });
});
