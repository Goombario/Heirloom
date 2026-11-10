import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { normalisedEventDate } from '@/lib/db/backfill-event-dates';

/**
 * v23 backfill (#400): legacy imports stored RAW GEDCOM in Events."Date" while the
 * promoted columns stored ISO. This repairs them in place, which is the one
 * irreversible-by-redeploy step in this slice — so the gate is not "does it fix
 * the raw rows" but "does it leave everything else byte-identical".
 */
async function boot(seed: Array<[number, string | null]>): Promise<{ db: PGlite; executor: DbExecutor }> {
  const db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
  for (const [id, date] of seed) {
    await db.query(`INSERT INTO "Events" ("Id","UserId","Type","Date","PersonId") VALUES ($1,1,'RESI',$2,1)`, [id, date]);
  }
  return { db, executor };
}

async function dates(db: PGlite): Promise<Array<string | null>> {
  const r = await db.query<{ Date: string | null }>(`SELECT "Date" FROM "Events" ORDER BY "Id"`);
  return r.rows.map((x) => x.Date);
}

describe('normalisedEventDate — the row-level decision', () => {
  it('converts raw GEDCOM to ISO at each precision', () => {
    expect(normalisedEventDate('26 AUG 1819')).toBe('1819-08-26');
    expect(normalisedEventDate('AUG 1819')).toBe('1819-08');
    expect(normalisedEventDate('1819')).toBeNull(); // already ISO year — untouched
  });

  // The hazard that dictates the shape gate: parsePlainDate splits on whitespace
  // and falls back to parseInt, and parseInt('1930-01-01') === 1930. Re-parsing an
  // already-ISO date would therefore TRUNCATE it to year precision. Every one of
  // these must come back null (= leave the row alone), not a shortened date.
  it('never re-parses an already-ISO date (truncation guard)', () => {
    expect(normalisedEventDate('1930-01-01')).toBeNull();
    expect(normalisedEventDate('1930-01')).toBeNull();
    expect(normalisedEventDate('1930')).toBeNull();
  });

  it('leaves all six qualifier forms alone once they are ISO-shaped', () => {
    for (const d of [
      'ABT 1850', 'EST 1850', 'CAL 1850', 'BEF 1900-03-03', 'AFT 1900-03',
      'BET 1850 AND 1860', 'FROM 1850 TO 1860', 'FROM 1850', 'TO 1860',
      'INT 1850 (guessed from the census)',
    ]) {
      expect(normalisedEventDate(d), d).toBeNull();
    }
  });

  it('normalises the inner date of a qualifier that is still raw', () => {
    expect(normalisedEventDate('ABT 26 AUG 1819')).toBe('ABT 1819-08-26');
    expect(normalisedEventDate('BET 26 AUG 1819 AND 3 MAR 1900')).toBe('BET 1819-08-26 AND 1900-03-03');
  });

  it('keeps free text and unresolvable qualifiers exactly as stored (#400 `?? value`)', () => {
    expect(normalisedEventDate('during the war')).toBeNull();
    expect(normalisedEventDate('ABT banana')).toBeNull();
    expect(normalisedEventDate('')).toBeNull();
  });

  // `parseDate` treats CIRCA as an alias for ABT and keeps an unresolvable
  // remainder, so it maps "circa the war" → "ABT the war" — a DIFFERENT
  // un-normalised value. The backfill must not make that edit to stored data: it
  // rewrites the user's own wording in place, irreversibly, and buys no
  // sortability. Only rewrites INTO the normalised shape are allowed.
  it('refuses a rewrite that lands on another un-normalised value', () => {
    expect(normalisedEventDate('circa the war')).toBeNull();
  });

  // The truncation the OUTPUT gate cannot catch. `parsePlainDate` is a PREFIX
  // parser (every branch tests `parts.length >= N`), so it returns a perfectly
  // well-shaped date for a value that carries trailing text — and that result
  // passes the output gate. Only an anchored gate on the INPUT stops these, and
  // every one of them is a value a real GEDCOM file can carry.
  it('never truncates a date that carries trailing text', () => {
    expect(normalisedEventDate('1990 or 1991')).toBeNull();
    expect(normalisedEventDate('1990 (approximate, per family Bible)')).toBeNull();
    expect(normalisedEventDate('JAN 1990 per family bible')).toBeNull();
    expect(normalisedEventDate('ABT 1990 (see notes)')).toBeNull();
    expect(normalisedEventDate('26 AUG 1819 or thereabouts')).toBeNull();
  });

  it('still normalises a lowercase qualifier on an otherwise clean date', () => {
    expect(normalisedEventDate('abt 1850')).toBe('ABT 1850');
    expect(normalisedEventDate('26 aug 1819')).toBe('1819-08-26');
  });
});

describe('Events."Date" backfill (v23, #400)', () => {
  it('rewrites raw GEDCOM dates and leaves every other row byte-identical', async () => {
    const { db, executor } = await boot([
      [1, '26 AUG 1819'],      // raw       → normalised
      [2, '1930-01-01'],       // ISO full  → MUST survive intact
      [3, 'circa the war'],    // free text → kept verbatim
      [4, 'ABT 1850'],         // qualified → already normal
      [5, null],               // null      → untouched
      [6, ''],                 // empty     → untouched
    ]);
    await initializeSchema(executor); // re-run: the backfill sees rows added after first init
    expect(await dates(db)).toEqual([
      '1819-08-26', '1930-01-01', 'circa the war', 'ABT 1850', null, '',
    ]);
    await db.close();
  });

  it('is idempotent — repeated init never rewrites a row twice', async () => {
    const { db, executor } = await boot([[1, '26 AUG 1819'], [2, '1930-01-01']]);
    await initializeSchema(executor);
    const once = await dates(db);
    await initializeSchema(executor);
    await initializeSchema(executor);
    expect(await dates(db)).toEqual(once);
    expect(once).toEqual(['1819-08-26', '1930-01-01']);
    await db.close();
  });

  // The regression this backfill actually exists to fix: ORDER BY "Date" on a TEXT
  // column is chronological only while the values are ISO. Mixed raw values sort
  // lexicographically, which silently reorders a person's timeline.
  it('restores chronological ORDER BY "Date" for a mixed-format tree', async () => {
    const { db, executor } = await boot([[1, '1 JAN 1930'], [2, '2 OCT 1837']]);
    const before = await db.query<{ Id: number }>(`SELECT "Id" FROM "Events" ORDER BY "Date"`);
    expect(before.rows.map((r) => r.Id)).toEqual([1, 2]); // '1 JAN 1930' < '2 OCT 1837'

    await initializeSchema(executor);
    const after = await db.query<{ Id: number }>(`SELECT "Id" FROM "Events" ORDER BY "Date"`);
    expect(after.rows.map((r) => r.Id)).toEqual([2, 1]); // 1837 now precedes 1930
    await db.close();
  });
});
