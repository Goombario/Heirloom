// Data validation utility functions for genealogy data

import { sortableYear } from '@/lib/date-utils';
import { datePhraseText, makeDatePhrase, splitDateQualifier, stripControlCharacters } from '@/lib/date-qualifiers';

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Validate that a value is a string within the given max length.
 * Returns the trimmed string or null if the value is null/undefined/empty.
 * Throws ValidationError if the value is not a string or exceeds maxLength.
 */
export function validateStringField(
    value: unknown,
    fieldName: string,
    maxLength: number
): string | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        throw new ValidationError(`${fieldName} must be a string`);
    }
    if (value.length > maxLength) {
        throw new ValidationError(`${fieldName} must be ${maxLength} characters or fewer`);
    }
    return value;
}

// Invisible characters that only ever hide inside a name: zero-width space,
// word joiner, BOM, soft hyphen, and the bidi embedding/override/isolate controls.
const INVISIBLE = /[\u00AD\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
// ZWNJ/ZWJ shape Arabic, Indic and emoji text, so they're kept between two
// characters of those kinds and dropped anywhere else (inside Latin, Cyrillic, Greek).
const isJoiner = (c: string) => c === '\u200C' || c === '\u200D';
const JOINS = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|(?![\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])[\p{L}\p{M}])$/u;

/**
 * The one normalizer for names and places, used by the API and every import
 * (#884): NFC, no invisible characters, control characters as spaces, trimmed.
 * NFD "José" and NFC "José", or "Jo\u200Bsé", otherwise stay distinct to
 * duplicate detection, sorting and merge matching.
 */
export function normalizeNameText(value: string): string {
    const composed = value.normalize('NFC').replace(INVISIBLE, '');
    const chars = Array.from(composed);
    return chars
        .filter((c, i) => !isJoiner(c) || (JOINS.test(chars[i - 1] ?? '') && JOINS.test(chars[i + 1] ?? '')))
        .join('')
        .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
        .trim();
}

/** `normalizeNameText` for a nullable value; empty becomes null. */
export function normalizeNameOrNull(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return normalizeNameText(value) || null;
}

/**
 * `validateStringField` for a name or place: normalized, and blank after
 * normalization is null. Import is uncapped, so a value longer than `maxLength`
 * is still accepted when it equals the `stored` one: an edit must never fail
 * on a field the user didn't change (#884).
 */
export function validateNameField(
    value: unknown,
    fieldName: string,
    maxLength: number,
    stored?: string | null
): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') {
        throw new ValidationError(`${fieldName} must be a string`);
    }
    const normalized = normalizeNameText(value);
    if (!normalized) return null;
    if (normalized.length > maxLength && normalized !== normalizeNameOrNull(stored)) {
        throw new ValidationError(`${fieldName} must be ${maxLength} characters or fewer`);
    }
    return normalized;
}

/** GEDCOM SEX values (5.5.1 M/F/U, plus 7.0's X). */
const SEX_VALUES = ['M', 'F', 'U', 'X'] as const;

/** Sex submitted through the API: one of `SEX_VALUES`, any case; blank is null. */
export function validateSexField(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new ValidationError('Sex must be a string');
    const sex = value.trim().toUpperCase();
    if (!sex) return null;
    if (!(SEX_VALUES as readonly string[]).includes(sex)) {
        throw new ValidationError(`Sex must be one of ${SEX_VALUES.join(', ')}`);
    }
    return sex;
}

/**
 * Validate a date field submitted through the API.
 *
 * `validateStringField`'s type/length checks, plus the two rules the browser was
 * previously the only thing enforcing:
 *
 *  - control characters are stripped and whitespace collapsed, for any date form.
 *    A stored date is free text, and a `\n` in one turns a single `DATE` line into
 *    several on export.
 *  - a `(phrase)` is capped at DATE_PHRASE_MAX. `DATE_PHRASE` is 35 characters in
 *    GEDCOM 5.5.1; the cap lived only in `composeDateValue` in the browser, so a
 *    direct API call could store roughly 3x that and have it re-emitted whole.
 *
 * Deliberately scoped to **submitted** values. The GEDCOM import path does not
 * come through here and must not: an imported file round-trips verbatim and
 * uncapped (see `parseDate`), because handing a user back an altered copy of
 * their own file is worse than storing a long phrase.
 */
export function validateDateField(
    value: unknown,
    fieldName: string,
    maxLength: number
): string | null {
    const raw = validateStringField(value, fieldName, maxLength);
    if (raw === null) return null;

    const qualifier = splitDateQualifier(raw);
    const phrase = datePhraseText(raw);
    // DATE_PHRASE appears both bare and as the parenthesised half of INT. Keep
    // INT's date portion intact while applying the same cleaning/cap to its
    // submitted phrase; GEDCOM imports deliberately bypass this boundary.
    if (phrase !== null) {
        const cleanedPhrase = makeDatePhrase(phrase);
        if (qualifier?.prefix === 'INT') {
            const intParts = qualifier.parts[0].match(/^([\s\S]*?)\s*\([^)]*\)\s*$/);
            const date = stripControlCharacters(intParts?.[1] ?? '').replace(/\s+/g, ' ').trim();
            return date ? `INT ${date} ${cleanedPhrase || '()'}` : `INT ${cleanedPhrase || '()'}`;
        }
        return cleanedPhrase || null;
    }

    const cleaned = stripControlCharacters(raw).replace(/\s+/g, ' ').trim();
    return cleaned || null;
}

/**
 * The place a form picked for a place field, by id (#1186): a positive integer,
 * or undefined when none was sent. Which tree it belongs to is checked where it
 * is written.
 */
export function validatePlaceIdField(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`${fieldName} must be a place id`);
    }
    return value;
}

/**
 * HTML-escape a string to prevent XSS when injecting into HTML.
 */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export interface ValidationIssue {
    type: 'error' | 'warning';
    code: string;
    message: string;
}

interface PersonDates {
    BirthDate?: string | null;
    DeathDate?: string | null;
}

export function validatePerson(person: PersonDates): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const birthYear = sortableYear(person.BirthDate);
    const deathYear = sortableYear(person.DeathDate);
    const currentYear = new Date().getFullYear();

    // Death before birth
    if (birthYear !== null && deathYear !== null && deathYear < birthYear) {
        issues.push({
            type: 'error',
            code: 'DEATH_BEFORE_BIRTH',
            message: 'Death date is before birth date'
        });
    }

    // Born in the future
    if (birthYear !== null && birthYear > currentYear) {
        issues.push({
            type: 'error',
            code: 'FUTURE_BIRTH',
            message: 'Birth date is in the future'
        });
    }

    // Died in the future
    if (deathYear !== null && deathYear > currentYear) {
        issues.push({
            type: 'warning',
            code: 'FUTURE_DEATH',
            message: 'Death date is in the future'
        });
    }

    // Unreasonable age (over 120)
    if (birthYear !== null && deathYear !== null && (deathYear - birthYear) > 120) {
        issues.push({
            type: 'warning',
            code: 'UNREASONABLE_AGE',
            message: 'Age at death exceeds 120 years'
        });
    }

    // Still alive but would be over 120
    if (birthYear !== null && deathYear === null && (currentYear - birthYear) > 120) {
        issues.push({
            type: 'warning',
            code: 'MISSING_DEATH',
            message: 'Person would be over 120 years old - death date may be missing'
        });
    }

    return issues;
}

export function getCompleteness(person: {
    FirstName?: string | null;
    LastName?: string | null;
    BirthDate?: string | null;
    BirthPlace?: string | null;
    Sex?: string | null;
}): number {
    const fields = [
        person.FirstName,
        person.LastName,
        person.BirthDate,
        person.BirthPlace,
        person.Sex
    ];

    const filled = fields.filter(f => f && f.trim()).length;
    return Math.round((filled / fields.length) * 100);
}

export function getCompletenessLabel(percentage: number): { label: string; color: string } {
    if (percentage >= 80) return { label: 'Complete', color: 'text-green-600' };
    if (percentage >= 50) return { label: 'Partial', color: 'text-yellow-600' };
    return { label: 'Incomplete', color: 'text-red-600' };
}
