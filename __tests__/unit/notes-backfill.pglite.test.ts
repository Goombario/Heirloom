import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

/**
 * Slice 1 backfill gate (G-MIG + G-REG): mirroring People."Notes" into the new
 * Note + NoteLink model must be idempotent (running initializeSchema repeatedly
 * — as PGlite does on every version change — never duplicates) and must surface
 * the same text through the decoupled path.
 *
 * #524 / ADR 0010 dropped the column in the same `initializeSchema` run that
 * mirrors it, so a current schema has no `People."Notes"` to insert into. These
 * tests re-add it by hand to reconstruct exactly what a database predating #524
 * looks like, then let the next init do mirror-then-drop on it. That ordering
 * within one run is the entire safety property: a local-first user who has not
 * opened the app since the expand half shipped still gets their column mirrored
 * on the same boot that removes it.
 */

/** Re-create the legacy column that the current schema no longer has. */
async function addLegacyNotesColumn(db: PGlite): Promise<void> {
  await db.query(`ALTER TABLE "People" ADD COLUMN "Notes" TEXT`);
}

async function hasNotesColumn(db: PGlite): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'People' AND column_name = 'Notes'`
  );
  return res.rows.length > 0;
}

async function bootWithPerson(notes: string | null): Promise<{ db: PGlite; executor: DbExecutor; personId: number }> {
  const db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  await db.query(
    `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`
  );
  await addLegacyNotesColumn(db);
  const res = await db.query<{ Id: number }>(
    `INSERT INTO "People" ("UserId", "FirstName", "Notes") VALUES (1, 'Ada', $1) RETURNING "Id"`,
    [notes]
  );
  return { db, executor, personId: res.rows[0].Id };
}

async function counts(db: PGlite): Promise<{ notes: number; links: number }> {
  const n = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Note"`);
  const l = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "NoteLink"`);
  return { notes: parseInt(n.rows[0].c, 10), links: parseInt(l.rows[0].c, 10) };
}

describe('Note backfill (Slice 1)', () => {
  it('mirrors People.Notes into Note + NoteLink(People) on init', async () => {
    const { db, executor, personId } = await bootWithPerson('A short biography');
    // The person row was inserted AFTER the first init, so re-run to backfill it.
    await initializeSchema(executor);

    const note = await db.query<{ Text: string; BackfilledFromPersonId: number }>(
      `SELECT "Text", "BackfilledFromPersonId" FROM "Note"`
    );
    expect(note.rows).toHaveLength(1);
    expect(note.rows[0].Text).toBe('A short biography');
    expect(note.rows[0].BackfilledFromPersonId).toBe(personId);

    const link = await db.query<{ OwnerTable: string; OwnerId: number }>(
      `SELECT "OwnerTable", "OwnerId" FROM "NoteLink"`
    );
    expect(link.rows[0]).toEqual({ OwnerTable: 'People', OwnerId: personId });

    // …and the same run removed the column it just read (#524 / ADR 0010).
    expect(await hasNotesColumn(db)).toBe(false);
    await db.close();
  });

  it('is idempotent — repeated init never duplicates the backfilled note (G-MIG)', async () => {
    const { db, executor } = await bootWithPerson('Keep me once');
    await initializeSchema(executor);
    await initializeSchema(executor);
    await initializeSchema(executor);
    expect(await counts(db)).toEqual({ notes: 1, links: 1 });
    await db.close();
  });

  it('skips people with no notes', async () => {
    const { db, executor } = await bootWithPerson(null);
    // An empty-string note must be skipped too. Inserted while the legacy column
    // still exists — the init below is what removes it.
    await db.query(`INSERT INTO "People" ("UserId", "FirstName", "Notes") VALUES (1, 'Empty', '')`);
    await initializeSchema(executor);
    expect(await counts(db)).toEqual({ notes: 0, links: 0 });
    await db.close();
  });

  it('refuses to drop legacy notes that cannot be assigned to an owner', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await addLegacyNotesColumn(db);
    await db.query(`INSERT INTO "People" ("FirstName", "Notes") VALUES ('Unowned', 'Keep this legacy note')`);

    await expect(initializeSchema(executor)).rejects.toThrow(/cannot retire People\."Notes"/i);
    expect(await hasNotesColumn(db)).toBe(true);
    expect(await counts(db)).toEqual({ notes: 0, links: 0 });
    await db.close();
  });
});

/**
 * #524 / ADR 0010 — the guard on the backfill's SELECT.
 *
 * The mirror reads `People."Notes"`, and the DROP a few statements below removes
 * it. Without the `information_schema` check in front of that SELECT, the second
 * and every later `initializeSchema` would reference a column that no longer
 * exists — a hard failure at schema-init time, i.e. the app does not start. For a
 * PGlite user that database lives in their browser with no ops recovery, so it
 * would be unrecoverable rather than merely loud.
 */
describe('People."Notes" drop guard (#524)', () => {
  it('a second initializeSchema against the same database does not throw', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    // The assertion IS that this resolves. Without the column-exists guard the
    // backfill SELECT raises `column p."Notes" does not exist` and rejects.
    await expect(initializeSchema(executor)).resolves.not.toThrow();
    expect(await hasNotesColumn(db)).toBe(false);
    await db.close();
  });

  it('survives a re-boot after mirroring a legacy column, and keeps the note', async () => {
    // The path a real upgrading user takes: one boot mirrors-and-drops, the next
    // boot must be a clean no-op rather than a crash — with the note still there.
    const { db, executor } = await bootWithPerson('Survive the reboot');
    await initializeSchema(executor); // mirror + drop
    await expect(initializeSchema(executor)).resolves.not.toThrow();

    const note = await db.query<{ Text: string }>(`SELECT "Text" FROM "Note"`);
    expect(note.rows.map((r) => r.Text)).toEqual(['Survive the reboot']);
    await db.close();
  });
});

/**
 * The backfill inserts `Note` with no `TreeId`, so the generic multi-tree stamping
 * pass fills it from the owner's DEFAULT tree (lowest Id) regardless of which tree
 * the person actually lives in. That was harmless while the person UI read the
 * `People."Notes"` column directly. ADR 0010 moved every person-notes surface onto
 * `getNotesForOwner(..., treeId)`, which filters `n."TreeId"`, so a legacy note on
 * anyone outside the default tree would simply stop appearing.
 */
describe('Note backfill — tree assignment (ADR 0010)', () => {
  it('assigns a backfilled note to the tree its person is in, not the default tree', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);

    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Default'), (2, 1, 'Second')`);
    await addLegacyNotesColumn(db);
    // The person lives in the SECOND tree — not the owner's default.
    const res = await db.query<{ Id: number }>(
      `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "Notes")
       VALUES (1, 2, 'Ada', 'He was a farmer.') RETURNING "Id"`,
    );
    const personId = res.rows[0].Id;

    await initializeSchema(executor);

    const note = await db.query<{ TreeId: number }>(
      `SELECT n."TreeId" FROM "Note" n WHERE n."BackfilledFromPersonId" = $1`,
      [personId],
    );
    expect(note.rows).toHaveLength(1);
    expect(note.rows[0].TreeId).toBe(2);
    await db.close();
  });

  it('is idempotent across repeated init', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Default'), (2, 1, 'Second')`);
    await addLegacyNotesColumn(db);
    await db.query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "Notes") VALUES (1, 2, 'Ada', 'Once')`);
    await initializeSchema(executor);
    await initializeSchema(executor);
    expect(await counts(db)).toEqual({ notes: 1, links: 1 });
    await db.close();
  });
});
