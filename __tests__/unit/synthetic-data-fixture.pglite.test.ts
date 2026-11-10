import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { buildSyntheticDataset, seedSyntheticDataset, syntheticCaseCounts } from '@/scripts/synthetic-data-fixture';
import { commitHostedSeed } from '@/scripts/seed-synthetic-data';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

describe('synthetic data fixture PGlite seed', () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it('persists local media bytes and tree-safe relationship data', async () => {
    db = await newEmptyClusterDb();
    const exec: DbExecutor = { query: (text, params) => db!.query(text, params) };
    await initializeSchema(exec);
    const user = await db.query<{ Id: number }>(`INSERT INTO "Users" ("Email", "GoogleId") VALUES ('synthetic@local.test', 'synthetic-local') RETURNING "Id"`);
    const tree = await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Synthetic QA Fixture') RETURNING "Id"`, [user.rows[0].Id]);
    await db.query('BEGIN');
    const result = await seedSyntheticDataset(exec, { userId: user.rows[0].Id, treeId: tree.rows[0].Id, storage: 'local' });
    await db.query('COMMIT');
    const dataset = buildSyntheticDataset();
    const counts = await db.query<{ people: number; families: number; media: number; blobs: number; tags: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "People" WHERE "TreeId" = $1) AS people,
         (SELECT COUNT(*)::int FROM "Families" WHERE "TreeId" = $1) AS families,
         (SELECT COUNT(*)::int FROM "Media" WHERE "TreeId" = $1) AS media,
         (SELECT COUNT(*)::int FROM "MediaBlob" b JOIN "Media" m ON m."Id" = b."MediaId" WHERE m."TreeId" = $1) AS blobs,
         (SELECT COUNT(*)::int FROM "MediaTag" mt JOIN "Media" m ON m."Id" = mt."MediaId" WHERE m."TreeId" = $1) AS tags`,
      [result.treeId],
    );

    expect(result.people).toBe(dataset.people.length);
    expect(result.media).toBe(dataset.media.length);
    expect(counts.rows[0]).toEqual({
      people: 120,
      families: dataset.families.length,
      media: 30,
      blobs: 30,
      tags: 120,
    });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "IsPrimary" = 1`)).rows[0]).toEqual({ n: 120 });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM "MediaFaceCandidate" WHERE "TreeId" = $1`, [result.treeId])).rows[0]).toEqual({ n: dataset.faceCandidates.length });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM "Events" WHERE ("PersonId" IS NOT NULL) = ("FamilyId" IS NOT NULL)`)).rows[0]).toEqual({ n: 0 });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM "Citation" WHERE "TreeId" = $1`, [result.treeId])).rows[0]).toEqual({ n: dataset.citations.length });
    // Every citation resolves to a fact in the same tree, whatever table it names.
    const orphans = await db.query(
      `SELECT c."Id" FROM "Citation" c
       JOIN "Sources" s ON s."Id" = c."SourceId" AND s."TreeId" = c."TreeId"
       WHERE c."TreeId" = $1 AND NOT (
         (c."FactTable" IN ('People', 'PersonName', 'PersonBirth', 'PersonDeath') AND EXISTS (SELECT 1 FROM "People" p WHERE p."Id" = c."FactId" AND p."TreeId" = c."TreeId"))
         OR (c."FactTable" = 'Events' AND EXISTS (SELECT 1 FROM "Events" e WHERE e."Id" = c."FactId" AND e."TreeId" = c."TreeId"))
         OR (c."FactTable" = 'Families' AND EXISTS (SELECT 1 FROM "Families" f WHERE f."Id" = c."FactId" AND f."TreeId" = c."TreeId"))
         OR (c."FactTable" = 'NameVariant' AND EXISTS (SELECT 1 FROM "NameVariant" nv WHERE nv."Id" = c."FactId" AND nv."TreeId" = c."TreeId"))
         OR (c."FactTable" = 'Cases' AND EXISTS (SELECT 1 FROM "Cases" k WHERE k."Id" = c."FactId" AND k."TreeId" = c."TreeId"))
         OR (c."FactTable" = 'CaseComments' AND EXISTS (SELECT 1 FROM "CaseComments" cc JOIN "Cases" k ON k."Id" = cc."CaseId" WHERE cc."Id" = c."FactId" AND k."TreeId" = c."TreeId"))
       )`,
      [result.treeId],
    );
    expect(orphans.rows).toEqual([]);
    // Cases (#913): each table's rows, tree-scoped, match the generator.
    const caseCounts = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM "Cases" WHERE "TreeId" = $1) AS "cases",
         (SELECT COUNT(*)::int FROM "CaseComments" cc JOIN "Cases" k ON k."Id" = cc."CaseId" WHERE k."TreeId" = $1) AS "caseComments",
         (SELECT COUNT(*)::int FROM "CasePerson" cp JOIN "Cases" k ON k."Id" = cp."CaseId" JOIN "People" p ON p."Id" = cp."PersonId" AND p."TreeId" = k."TreeId" WHERE k."TreeId" = $1) AS "casePeople",
         (SELECT COUNT(*)::int FROM "Citation" WHERE "TreeId" = $1 AND "FactTable" IN ('Cases', 'CaseComments')) AS "caseCitations",
         (SELECT COUNT(*)::int FROM "CaseMedia" cm JOIN "Cases" k ON k."Id" = cm."CaseId" JOIN "Media" m ON m."Id" = cm."MediaId" AND m."TreeId" = k."TreeId" WHERE k."TreeId" = $1) AS "caseMedia"`,
      [result.treeId],
    );
    expect(caseCounts.rows[0]).toEqual(syntheticCaseCounts(dataset));
    expect(result).toMatchObject(syntheticCaseCounts(dataset));
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM "Citation" c JOIN "Sources" s ON s."Id" = c."SourceId" WHERE c."TreeId" = $1`, [result.treeId])).rows[0]).toEqual({ n: dataset.citations.length });
  });

  it('persists hosted media files without using local blobs', async () => {
    db = await newEmptyClusterDb();
    const exec: DbExecutor = { query: (text, params) => db!.query(text, params) };
    await initializeSchema(exec);
    const user = await db.query<{ Id: number }>(`INSERT INTO "Users" ("Email", "GoogleId") VALUES ('synthetic-hosted@local.test', 'synthetic-hosted') RETURNING "Id"`);
    const tree = await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Synthetic QA Fixture') RETURNING "Id"`, [user.rows[0].Id]);
    const mediaDirectory = await mkdtemp(path.join(os.tmpdir(), 'synthetic-hosted-media-'));
    try {
      await db.query('BEGIN');
      await seedSyntheticDataset(exec, { userId: user.rows[0].Id, treeId: tree.rows[0].Id, storage: 'hosted', mediaDirectory });
      await db.query('COMMIT');
      expect(await readdir(mediaDirectory)).toHaveLength(30);
      expect((await db.query(`SELECT COUNT(*)::int AS n FROM "Media" WHERE "TreeId" = $1 AND "FilePath" LIKE 'synthetic-%'`, [tree.rows[0].Id])).rows[0]).toEqual({ n: 30 });
      expect((await db.query(`SELECT COUNT(*)::int AS n FROM "MediaBlob"`)).rows[0]).toEqual({ n: 0 });
    } finally {
      await rm(mediaDirectory, { recursive: true, force: true });
    }
  });

  it('registers hosted files before a later seed failure can make rollback ambiguous', async () => {
    db = await newEmptyClusterDb();
    await initializeSchema({ query: (text, params) => db!.query(text, params) });
    const user = await db.query<{ Id: number }>(`INSERT INTO "Users" ("Email", "GoogleId") VALUES ('synthetic-ambiguous@local.test', 'synthetic-ambiguous') RETURNING "Id"`);
    const tree = await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Synthetic QA Fixture') RETURNING "Id"`, [user.rows[0].Id]);
    const mediaDirectory = await mkdtemp(path.join(os.tmpdir(), 'synthetic-ambiguous-media-'));
    const client: DbExecutor = {
      query: async (text, params) => {
        if (text === 'ROLLBACK') throw new Error('synthetic rollback unavailable');
        const result = await db!.query(text, params);
        if (text.includes('INSERT INTO "Media"')) throw new Error('synthetic media acknowledgement lost');
        return result;
      },
    };

    try {
      await client.query('BEGIN');
      await expect(commitHostedSeed(client, (registerFiles) => seedSyntheticDataset(client, {
        userId: user.rows[0].Id,
        treeId: tree.rows[0].Id,
        storage: 'hosted',
        mediaDirectory,
        onHostedFilesWritten: registerFiles,
      }))).rejects.toThrow('synthetic media acknowledgement lost');
      expect(await readdir(mediaDirectory)).toHaveLength(1);
    } finally {
      await rm(mediaDirectory, { recursive: true, force: true });
    }
  });
});
