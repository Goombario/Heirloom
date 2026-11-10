import { ValidationError } from '@/lib/validation';

/**
 * Parse a positive integer ID from a query-string value (or path param). Returns
 * null for missing / non-numeric / non-positive input — routes typically map a
 * null result to a 400. This replaces the pattern
 *   `parseInt(searchParams.get('ownerId') ?? '', 10)`
 * which silently produces NaN for bad input and propagates it into SQL as a
 * parameter that matches no rows.
 */
export function parseIdParam(value: string | number | null | undefined): number | null {
    if (value == null) return null;
    // Digits only: parseInt alone read "12abc" as 12 and "1.5" as 1, and an id
    // past INTEGER's range reached SQL and failed there as a 500 (#867). A JSON
    // body's id arrives as a number and goes through the same check as text.
    const trimmed = String(value).trim();
    if (!/^\d{1,10}$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return n > 0 && n <= MAX_ID ? n : null;
}

/** The largest value an `INTEGER` id column holds. */
const MAX_ID = 2147483647;

/**
 * Parse an OPTIONAL entity-id param: absent (null/undefined/empty) → null,
 * valid → the id, present-but-malformed → ValidationError, which the standard
 * `handleApiError` ladder maps to a 400 — so call this inside the route's try.
 * This is the one place the "absent is fine, garbage is a client error"
 * semantics live; don't re-inline the guard per route.
 */
export function parseOptionalIdParam(value: string | null | undefined, name: string): number | null {
    if (value == null || value === '') return null;
    const id = parseIdParam(value);
    if (id === null) throw new ValidationError(`Invalid ${name}`);
    return id;
}
