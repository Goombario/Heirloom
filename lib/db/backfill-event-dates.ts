import type { DbExecutor } from './init-schema';
import { parseDate } from '../gedcom/parser';

/** ISO partial-precision date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
const ISO = String.raw`\d{4}(?:-\d{2}(?:-\d{2})?)?`;

/**
 * A date already in the shape `parseDate` produces — ISO, or a GEDCOM qualifier
 * wrapping ISO. `INT` is included wholesale because `parseDate` deliberately keeps
 * its remainder verbatim (parser.ts:1412), so an `INT` value is already terminal.
 *
 * This gate is the safety property of the whole backfill, and it is NOT redundant
 * with the `parsed === row.Date` check below. `parsePlainDate` splits on
 * whitespace and falls back to `parseInt`, and `parseInt('1930-01-01')` is `1930`
 * — so re-parsing an ALREADY-ISO full date silently truncates it to year
 * precision. Anything matching here must never be handed back to `parseDate`.
 */
const ALREADY_NORMALISED = new RegExp(
  `^(?:${ISO}` +
  `|(?:ABT|EST|CAL|BEF|AFT) ${ISO}` +
  `|BET ${ISO} AND ${ISO}` +
  `|FROM ${ISO}(?: TO ${ISO})?` +
  `|TO ${ISO}` +
  `|INT .*)$`,
);

const MONTHS = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';

/** A plain GEDCOM date: `26 AUG 1819`, `AUG 1819`, `1819`. */
const RAW_PLAIN = String.raw`(?:\d{1,2}\s+(?:${MONTHS})\s+\d{1,4}|(?:${MONTHS})\s+\d{1,4}|\d{1,4})`;

/**
 * A stored value that is ENTIRELY a raw GEDCOM date — mirroring `parseDate`'s own
 * grammar, anchored at both ends.
 *
 * This gate exists because `parsePlainDate` is a PREFIX parser, not a full-string
 * one: every branch tests `parts.length >= N`, never `=== N`, so it happily returns
 * `1990` for `"1990 or 1991"` and `1990-01` for `"JAN 1990 per family bible"`,
 * discarding the rest. The output gate below cannot catch that — the surviving
 * prefix is perfectly well-shaped — so without this the backfill would silently
 * and irreversibly truncate any date carrying a trailing annotation, which is
 * exactly the kind of value that ends up in a free-text date field.
 *
 * Anything not matched here is left untouched. Missing a normalisation is cheap;
 * destroying the user's wording is not.
 */
const RAW_GEDCOM_DATE = new RegExp(
  `^(?:${RAW_PLAIN}` +
  `|(?:ABT|ABOUT|CIRCA|CA|EST|CAL|BEF|AFT)\\s+${RAW_PLAIN}` +
  `|BET\\s+${RAW_PLAIN}\\s+AND\\s+${RAW_PLAIN}` +
  `|FROM\\s+${RAW_PLAIN}(?:\\s+TO\\s+${RAW_PLAIN})?` +
  `|TO\\s+${RAW_PLAIN})$`,
  'i',
);

/** Rewrite one stored date, or null when it must be left exactly as it is. */
export function normalisedEventDate(stored: string): string | null {
  if (!stored || !stored.trim()) return null;
  if (ALREADY_NORMALISED.test(stored)) return null;
  if (!RAW_GEDCOM_DATE.test(stored.trim())) return null;
  const parsed = parseDate(stored);
  if (!parsed || parsed === stored) return null;
  // The backfill may only move a row INTO the normalised shape — never merely to a
  // DIFFERENT un-normalised one. `parseDate` is lenient about qualifiers: CIRCA is
  // an alias for ABT (parser.ts:1362) and an unresolvable remainder is kept, so
  // "circa the war" comes back "ABT the war". That is fine on IMPORT, but here it
  // would rewrite a user's free text in place, irreversibly, for no gain in
  // sortability. Requiring the RESULT to be normalised keeps such rows untouched
  // and makes idempotency structural rather than incidental.
  return ALREADY_NORMALISED.test(parsed) ? parsed : null;
}

const CHUNK = 500;

/**
 * One-time repair for #400: before the parser learned `parseDate(value) ?? value`,
 * every GEDCOM-imported event stored its date as RAW GEDCOM ("26 AUG 1819") while
 * BirthDate/DeathDate/MarriageDate stored ISO. That left Events."Date" holding two
 * formats, which `formatDateForDisplay` renders literally, and — because
 * `getEventsByPersonId` sorts `ORDER BY "Date"` on a TEXT column — silently
 * MIS-ORDERS timelines, since lexicographic order is chronological only for ISO.
 *
 * Idempotent: a rewritten row matches ALREADY_NORMALISED on the next run, and a
 * row that cannot be improved is skipped rather than rewritten.
 *
 * Returns the number of rows changed (0 on every run after the first).
 */
export async function backfillEventDates(db: DbExecutor): Promise<number> {
  const res = await db.query(
    `SELECT "Id", "Date" FROM "Events" WHERE "Date" IS NOT NULL AND "Date" <> ''`,
  );
  const rows = res.rows as Array<{ Id: number; Date: string }>;

  const pending: Array<{ id: number; next: string }> = [];
  for (const row of rows) {
    const next = normalisedEventDate(row.Date);
    if (next !== null) pending.push({ id: row.Id, next });
  }
  if (pending.length === 0) return 0;

  // Batched rather than per-row: a tree imported from GEDCOM has EVERY event date
  // in the raw form, so this can be thousands of rows on the one boot that repairs
  // them — and PGlite runs it in the browser.
  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map(({ id, next }) => {
      const a = params.push(id);
      const b = params.push(next);
      return `($${a}::int, $${b}::text)`;
    });
    await db.query(
      `UPDATE "Events" AS e SET "Date" = v.d
       FROM (VALUES ${tuples.join(', ')}) AS v(id, d)
       WHERE e."Id" = v.id`,
      params,
    );
  }
  return pending.length;
}
