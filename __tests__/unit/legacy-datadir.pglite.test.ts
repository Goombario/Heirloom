import { describe, it, expect } from 'vitest';
import { PGlite as LegacyPGlite } from 'pglite-pg17';
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema } from '@/lib/db/ensure-schema';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';
import { convertLegacyDatadir, tarPgMajor } from '@/lib/db/legacy-datadir';
import { inspectBackupLogical } from '@/lib/db/connection.pglite';

// #235: a database written by PGlite 0.4 (Postgres 17) is converted for 0.6
// (Postgres 19) with every row, its photo bytes and its sequences intact.

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0xfe]);

async function legacyTree(): Promise<Blob> {
  const old = await LegacyPGlite.create();
  try {
    await ensureSchema(old as never);
    await old.query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, $1, $2)', ['local@test.local', 'local']);
    await old.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Smiths')`);
    await old.query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES (1, 1, 'Ada', 'Smith'), (1, 1, 'Ben', 'Smith')`);
    const media = await old.query<{ Id: number }>(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "ContentType") VALUES (1, 1, 'Ada', 'image/jpeg') RETURNING "Id"`,
    );
    await old.query('INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)', [media.rows[0].Id, PHOTO]);
    return await old.dumpDataDir('auto');
  } finally {
    await old.close();
  }
}

describe('PGlite 0.4 to 0.6 conversion (#235)', () => {
  it('reads the Postgres version inside a data directory tarball', async () => {
    const legacy = await legacyTree();
    expect(await tarPgMajor(legacy)).toBe(17);
    const fresh = await PGlite.create();
    try {
      expect(await tarPgMajor(await fresh.dumpDataDir('none'))).toBe(19);
    } finally {
      await fresh.close();
    }
    expect(await tarPgMajor(new Blob(['HLBK not a tar']))).toBeNull();
  }, 60_000);

  it('converts a 0.4 database with its rows, photo bytes and sequences', async () => {
    const legacy = await legacyTree();
    await expect(PGlite.create({ loadDataDir: legacy })).rejects.toThrow();

    const converted = await convertLegacyDatadir(legacy);
    expect(await tarPgMajor(converted)).toBe(19);

    const db = await PGlite.create({ loadDataDir: converted });
    try {
      const people = await db.query<{ FirstName: string }>('SELECT "FirstName" FROM "People" ORDER BY "FirstName"');
      expect(people.rows.map((r) => r.FirstName)).toEqual(['Ada', 'Ben']);
      const blob = await db.query<{ Data: Uint8Array }>('SELECT "Data" FROM "MediaBlob"');
      expect([...blob.rows[0].Data]).toEqual([...PHOTO]);
      const v = await db.query<{ v: number }>('SELECT MAX("Version") AS v FROM "_SchemaMeta"');
      expect(v.rows[0].v).toBe(SCHEMA_VERSION);
      // The next id carries on from the old one instead of colliding.
      const next = await db.query<{ Id: number }>(
        `INSERT INTO "People" ("UserId", "TreeId", "FirstName") VALUES (1, 1, 'Cy') RETURNING "Id"`,
      );
      const max = await db.query<{ m: number }>(`SELECT MAX("Id")::int AS m FROM "People" WHERE "FirstName" <> 'Cy'`);
      expect(next.rows[0].Id).toBeGreaterThan(max.rows[0].m);
      // ensureSchema finds it current and leaves it alone.
      await ensureSchema(db);
    } finally {
      await db.close();
    }
  }, 120_000);

  it('restores a raw .tar backup from 0.4 by converting it, and refuses a file that is neither', async () => {
    const { datadir, totals } = await inspectBackupLogical(await legacyTree());
    expect(totals).toEqual({ trees: 1, people: 2, families: 0, media: 1 });
    expect(await tarPgMajor(datadir)).toBe(19);
    await expect(inspectBackupLogical(new Blob(['not a backup at all']))).rejects.toThrow(/Unrecognized backup format/);
  }, 120_000);
});
