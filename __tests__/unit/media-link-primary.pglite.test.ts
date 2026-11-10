import { describe, expect, expectTypeOf, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import {
  getMediaForOwner,
  inspectMediaLinkIntegrity,
  linkMedia,
  unlinkMedia,
} from '@/lib/db/queries/media-links';
import type { MediaOwnerTable } from '@/lib/db/fact-tables';
import type { MediaLinkIntegrityReport } from '@/lib/db/schema';
import {
  formatMediaLinkAuditReport,
  getMediaLinkAuditExitCode,
} from '@/scripts/audit-media-links';

async function bootPrimaryFixture(): Promise<PGlite> {
  const db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
  await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (100, 1, 'A')`);
  await db.query(`
    INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES
      (5, 1, 100, 'Ada'),
      (6, 1, 100, 'Grace')
  `);
  await db.query(`
    INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title", "FilePath") VALUES
      (10, 1, 100, 'First', '10.jpg'),
      (11, 1, 100, 'Second', '11.jpg')
  `);
  return db;
}

describe('MediaLink owner-specific primary state', () => {
  it('formats zero and nonzero audit reports as stable JSON and maps issues to exit code 1', () => {
    const issue = {
      kind: 'missing_owner' as const,
      mediaId: 10,
      ownerTable: 'Families',
      ownerId: 999,
    };

    expect(formatMediaLinkAuditReport({
      treeId: 100,
      totalLinks: 0,
      primaryLinks: 0,
      issues: [],
    })).toBe('{"treeId":100,"totalLinks":0,"primaryLinks":0,"issues":[]}');
    expect(formatMediaLinkAuditReport({
      treeId: 100,
      totalLinks: 2,
      primaryLinks: 1,
      issues: [issue, {
        kind: 'invalid_owner_table' as const,
        mediaId: 9,
        ownerTable: 'Places',
        ownerId: 1,
      }],
    })).toBe('{"treeId":100,"totalLinks":2,"primaryLinks":1,"issues":[{"kind":"invalid_owner_table","mediaId":9,"ownerTable":"Places","ownerId":1},{"kind":"missing_owner","mediaId":10,"ownerTable":"Families","ownerId":999}]}');
    expect(getMediaLinkAuditExitCode([])).toBe(0);
    expect(getMediaLinkAuditExitCode([issue])).toBe(1);
  });

  it('restricts media query helper owner arguments to MediaOwnerTable', () => {
    expectTypeOf(getMediaForOwner).parameter(0).toEqualTypeOf<MediaOwnerTable>();
    expectTypeOf(linkMedia).parameter(1).toEqualTypeOf<MediaOwnerTable>();
    expectTypeOf(unlinkMedia).parameter(1).toEqualTypeOf<MediaOwnerTable>();
  });

  it('allows primary state only for People links and only as zero or one', async () => {
    const db = await bootPrimaryFixture();

    await db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
      [10, 'People', 5, 1],
    );
    await expect(db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
      [11, 'Families', 2, 1],
    )).rejects.toThrow();
    await expect(db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
      [11, 'People', 6, 2],
    )).rejects.toThrow();

    const row = await db.query<{ IsPrimary: number }>(
      `SELECT "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = $2 AND "OwnerId" = $3`,
      [10, 'People', 5],
    );
    expect(row.rows).toEqual([{ IsPrimary: 1 }]);
    await db.close();
  });

  it('enforces one primary per person while allowing shared media to be primary for distinct people', async () => {
    const db = await bootPrimaryFixture();

    await db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
      [10, 'People', 5, 1],
    );
    await expect(db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
      [11, 'People', 5, 1],
    )).rejects.toThrow();
    await db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
      [10, 'People', 6, 1],
    );

    const rows = await db.query<{ MediaId: number; OwnerId: number }>(`
      SELECT "MediaId", "OwnerId"
      FROM "MediaLink"
      WHERE "OwnerTable" = 'People' AND "IsPrimary" = 1
      ORDER BY "OwnerId"
    `);
    expect(rows.rows).toEqual([
      { MediaId: 10, OwnerId: 5 },
      { MediaId: 10, OwnerId: 6 },
    ]);
    await db.close();
  });

  it('reports invalid, missing, cross-tree, and multiple-primary links deterministically', async () => {
    const db = await bootPrimaryFixture();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (200, 1, 'B')`);
    await db.query(`INSERT INTO "Events" ("Id", "UserId", "TreeId", "Type", "PersonId") VALUES (50, 1, 200, 'EVEN', 5)`);
    await db.query(`DROP INDEX "idx_medialink_one_primary_person"`);
    await db.query(`
      INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES
        (10, 'Places', 1, 0),
        (10, 'Families', 999, 0),
        (11, 'Events', 50, 0),
        (10, 'People', 5, 1),
        (11, 'People', 5, 1)
    `);
    const report: MediaLinkIntegrityReport = await inspectMediaLinkIntegrity(100, executor);

    expect(report).toEqual({
      issues: [
        { kind: 'missing_owner', mediaId: 10, ownerTable: 'Families', ownerId: 999 },
        { kind: 'multiple_primary', mediaId: 10, ownerTable: 'People', ownerId: 5 },
        { kind: 'invalid_owner_table', mediaId: 10, ownerTable: 'Places', ownerId: 1 },
        { kind: 'cross_tree_owner', mediaId: 11, ownerTable: 'Events', ownerId: 50 },
        { kind: 'multiple_primary', mediaId: 11, ownerTable: 'People', ownerId: 5 },
      ],
    });
    await db.close();
  });

  it('returns a zero-issue cutover report for every allowed owner table in the media tree', async () => {
    const db = await bootPrimaryFixture();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await db.query(`INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES (20, 1, 100)`);
    await db.query(`INSERT INTO "Events" ("Id", "UserId", "TreeId", "Type", "PersonId") VALUES (30, 1, 100, 'EVEN', 5)`);
    await db.query(`INSERT INTO "Sources" ("Id", "OwnerId", "TreeId", "Title") VALUES (40, 1, 100, 'Source')`);
    await db.query(`
      INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES
        (10, 'People', 5),
        (10, 'Families', 20),
        (10, 'Events', 30),
        (10, 'Sources', 40)
    `);
    expect(await inspectMediaLinkIntegrity(100, executor)).toEqual({ issues: [] });
    await db.close();
  });

  it('runs the complete read-only audit through the supplied executor', async () => {
    const db = await bootPrimaryFixture();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
       VALUES (10, 'People', 5, 1)`,
    );
    const auditModule = await import('@/scripts/audit-media-links') as unknown as {
      runMediaLinkAudit?: (exec: DbExecutor) => Promise<Array<{
        treeId: number;
        totalLinks: number;
        primaryLinks: number;
        issues: MediaLinkIntegrityReport['issues'];
      }>>;
    };
    expect(auditModule.runMediaLinkAudit).toBeTypeOf('function');
    expect(await auditModule.runMediaLinkAudit!(executor)).toEqual([{
      treeId: 100,
      totalLinks: 1,
      primaryLinks: 1,
      issues: [],
    }]);
    await db.close();
  });
});
