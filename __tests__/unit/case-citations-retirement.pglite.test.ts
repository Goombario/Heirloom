import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

async function hasRelation(db: PGlite, name: string): Promise<boolean> {
  const result = await db.query<{ reg: string | null }>(
    `SELECT to_regclass($1) AS reg`,
    [`"${name}"`],
  );
  return result.rows[0]?.reg !== null;
}

async function hasColumn(db: PGlite, table: string, column: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return result.rows.length > 0;
}

describe('CaseCitations retirement migration', () => {
  it('copies legacy rows to structured citations before dropping the table', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };

    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'case-retire@test.local', 'case-retire')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Case retirement fixture')`);
    const caseResult = await db.query<{ Id: number }>(
      `INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES (1, 1, 'Legacy citation case') RETURNING "Id"`,
    );
    await db.query(`
      CREATE TABLE "CaseCitations" (
        "Id" SERIAL PRIMARY KEY,
        "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
        "Title" VARCHAR(500) NOT NULL,
        "Url" TEXT,
        "Notes" TEXT,
        "CreatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(
      `INSERT INTO "CaseCitations" ("CaseId", "Title", "Url", "Notes") VALUES
       ($1, $2, $3, $4), ($1, $2, $3, $5), ($1, $2, $6, $7)`,
      [
        caseResult.rows[0].Id,
        'Legacy archive scan',
        'https://example.test/scan/7',
        'Compare the witnesses.',
        'Check the marginal note.',
        'https://example.test/scan/8',
        'Compare the index.',
      ],
    );

    await initializeSchema(executor);

    const source = await db.query<{ Id: number; Title: string; Type: string; Text: string; TreeId: number }>(
      `SELECT "Id", "Title", "Type", "Text", "TreeId"
       FROM "Sources" WHERE "TreeId" = 1 AND "Title" = 'Legacy archive scan'`,
    );
    expect(source.rows).toHaveLength(2);
    expect(source.rows).toContainEqual(expect.objectContaining({
      Title: 'Legacy archive scan',
      Type: 'Other',
      Text: 'https://example.test/scan/7',
      TreeId: 1,
    }));
    expect(source.rows).toContainEqual(expect.objectContaining({
      Title: 'Legacy archive scan',
      Type: 'Other',
      Text: 'https://example.test/scan/8',
      TreeId: 1,
    }));

    const citation = await db.query<{ FactTable: string; FactId: number; Page: string | null; Note: string; TreeId: number }>(
      `SELECT "FactTable", "FactId", "Page", "Note", "TreeId"
       FROM "Citation" WHERE "FactTable" = 'Cases'`,
    );
    expect(citation.rows).toHaveLength(3);
    expect(citation.rows).toContainEqual(expect.objectContaining({
      FactTable: 'Cases',
      FactId: caseResult.rows[0].Id,
      Page: null,
      Note: 'Compare the witnesses.',
      TreeId: 1,
    }));
    expect(citation.rows).toContainEqual(expect.objectContaining({ Note: 'Check the marginal note.' }));
    expect(citation.rows).toContainEqual(expect.objectContaining({ Note: 'Compare the index.' }));

    expect(await hasRelation(db, 'CaseCitations')).toBe(false);
    expect(await hasColumn(db, 'Sources', 'MigratedFromCaseCitationId')).toBe(false);

    // A second boot must not recreate the table or duplicate the migrated rows.
    await initializeSchema(executor);
    expect(await hasRelation(db, 'CaseCitations')).toBe(false);
    const sourceCount = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Sources" WHERE "Title" = 'Legacy archive scan'`);
    const citationCount = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Citation" WHERE "FactTable" = 'Cases'`);
    expect(sourceCount.rows[0].n).toBe(2);
    expect(citationCount.rows[0].n).toBe(3);

    await db.close();
  });

  it('keeps same-owner legacy citations in their case trees and repairs v38 copies', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'two-trees@test.local', 'two-trees')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'First'), (2, 1, 'Second')`);
    const cases = await db.query<{ Id: number; TreeId: number }>(`
      INSERT INTO "Cases" ("UserId", "TreeId", "Title")
      VALUES (1, 1, 'First case'), (1, 2, 'Second case') RETURNING "Id", "TreeId"
    `);
    const first = cases.rows.find((row) => row.TreeId === 1)!;
    const second = cases.rows.find((row) => row.TreeId === 2)!;
    await db.query(`
      CREATE TABLE "CaseCitations" (
        "Id" SERIAL PRIMARY KEY, "CaseId" INTEGER NOT NULL,
        "Title" VARCHAR(500) NOT NULL, "Url" TEXT, "Notes" TEXT
      )
    `);
    await db.query(
      `INSERT INTO "CaseCitations" ("CaseId", "Title", "Url", "Notes")
       VALUES ($1, 'Shared archive', 'https://example.test/shared', 'First note'),
              ($2, 'Shared archive', 'https://example.test/shared', 'Second note'),
              ($2, 'Second-tree archive', 'https://example.test/private', 'Private note')`,
      [first.Id, second.Id],
    );
    await initializeSchema(executor);

    const migrated = await db.query<{ FactId: number; citationTree: number; sourceTree: number; SourceId: number; Note: string }>(`
      SELECT ci."FactId", ci."TreeId" AS "citationTree", s."TreeId" AS "sourceTree", ci."SourceId", ci."Note"
      FROM "Citation" ci JOIN "Sources" s ON s."Id" = ci."SourceId"
      WHERE ci."FactTable" = 'Cases' ORDER BY ci."FactId"
    `);
    expect(migrated.rows).toHaveLength(3);
    expect(migrated.rows).toContainEqual(expect.objectContaining({ FactId: first.Id, citationTree: 1, sourceTree: 1 }));
    expect(migrated.rows).toContainEqual(expect.objectContaining({ FactId: second.Id, citationTree: 2, sourceTree: 2 }));
    const firstCitation = migrated.rows.find((row) => row.Note === 'First note')!;
    const secondCitation = migrated.rows.find((row) => row.Note === 'Second note')!;
    expect(firstCitation.SourceId).not.toBe(secondCitation.SourceId);
    const leaked = await db.query<{ n: number }>(`
      SELECT COUNT(*)::int AS n FROM "Sources"
      WHERE "TreeId" = 1 AND "Title" = 'Second-tree archive'
    `);
    expect(leaked.rows[0].n).toBe(0);

    // Simulate the already-deployed v38 result after its legacy table was dropped.
    await db.query(
      `UPDATE "Citation" SET "TreeId" = 1, "SourceId" = $1 WHERE "FactId" = $2 AND "FactTable" = 'Cases' AND "Note" = 'Second note'`,
      [firstCitation.SourceId, second.Id],
    );
    await db.query(`DELETE FROM "Sources" WHERE "Id" = $1`, [secondCitation.SourceId]);
    await initializeSchema(executor);
    const repaired = await db.query<{ citationTree: number; sourceTree: number; Note: string }>(`
      SELECT ci."TreeId" AS "citationTree", s."TreeId" AS "sourceTree", ci."Note"
      FROM "Citation" ci JOIN "Sources" s ON s."Id" = ci."SourceId"
      WHERE ci."FactTable" = 'Cases' AND ci."FactId" = $1 AND ci."Note" = 'Second note'
    `, [second.Id]);
    expect(repaired.rows).toEqual([{ citationTree: 2, sourceTree: 2, Note: 'Second note' }]);
    await db.close();
  });
});
