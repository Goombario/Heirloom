import { describe, it, expect } from 'vitest';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

// #40 (ADR 0049): a repository imported before v72 kept its WWW/PHON/EMAIL in
// "RawGedcom". The boot backfill lifts the first of each, once.
describe('repository contacts backfill (v72)', () => {
  it('lifts the first of each once, and later boots leave edits alone', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Repository" ("OwnerId", "TreeId", "Name", "RawGedcom") VALUES
      (1, 1, 'Old', $1), (1, 1, 'Plain', '1 CHAN'), (1, 1, 'None', NULL)`,
      ['1 PHON 555-0100\n1 PHON 555-0199\n1 WWW https://old.example\n1 CHAN\n2 DATE 1 JAN 2000']);
    // Pretend this database predates the backfill.
    await db.query(`COMMENT ON COLUMN "Repository"."Website" IS NULL`);
    await initializeSchema(executor);

    const rows = async () => (await db.query<{ Name: string; Website: string | null; Phone: string | null; Email: string | null; RawGedcom: string | null }>(
      `SELECT "Name", "Website", "Phone", "Email", "RawGedcom" FROM "Repository" ORDER BY "Name"`,
    )).rows;
    expect(await rows()).toEqual([
      { Name: 'None', Website: null, Phone: null, Email: null, RawGedcom: null },
      { Name: 'Old', Website: 'https://old.example', Phone: '555-0100', Email: null, RawGedcom: '1 PHON 555-0199\n1 CHAN\n2 DATE 1 JAN 2000' },
      { Name: 'Plain', Website: null, Phone: null, Email: null, RawGedcom: '1 CHAN' },
    ]);

    // Someone clears the phone; the next boot must not lift the second one.
    await db.query(`UPDATE "Repository" SET "Phone" = NULL, "Website" = NULL WHERE "Name" = 'Old'`);
    await initializeSchema(executor);
    expect((await rows())[1]).toMatchObject({ Phone: null, Website: null, RawGedcom: '1 PHON 555-0199\n1 CHAN\n2 DATE 1 JAN 2000' });
    await db.close();
  });
});
