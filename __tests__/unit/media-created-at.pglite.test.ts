import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema } from '@/lib/db/init-schema';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { insertMediaRow, getAllMedia, getAllMediaWithPerson } from '@/lib/db/queries/media';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { compareRecentlyAdded } from '@/lib/media/recently-added';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #25: "Media"."CreatedAt" (schema v75) records when a row entered the app.

const USER_ID = 990025;
type Row = { Id: number; CreatedAt: Date | string | null };

describe('Media upload timestamp (#25)', () => {
  let db: PGlite;
  let treeId: number;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, `m25-${USER_ID}@test.local`, `m25-${USER_ID}`]);
    treeId = await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('stamps a direct upload, and the list exposes it', async () => {
    const before = Date.now();
    const created = await insertMediaRow({ UserId: USER_ID, TreeId: treeId, Title: 'Upload', FilePath: 'a.jpg', Format: 'jpg', ContentType: 'image/jpeg' }, { query });
    const listed = (await getAllMedia(treeId)) as unknown as Row[];
    const row = listed.find((m) => m.Id === created.Id)!;
    expect(row.CreatedAt).not.toBeNull();
    expect(new Date(row.CreatedAt!).getTime()).toBeGreaterThanOrEqual(before - 5000);
  });

  it('stamps media a GEDCOM import creates', async () => {
    const { importGedcomService } = await import('@/lib/services/gedcom');
    const ged = ['0 HEAD', '0 @I1@ INDI', '1 NAME Ada /Stamp/', '1 OBJE @O1@', '0 @O1@ OBJE', '1 FILE photos/a.jpg', '1 FORM jpeg', '0 TRLR'].join('\n');
    await importGedcomService({ file: new File([ged], 'tree.ged', { type: 'text/plain' }), mode: 'overwrite', currentUserId: USER_ID, requestedTreeId: treeId });
    const rows = (await query('SELECT "CreatedAt" FROM "Media" WHERE "TreeId" = $1', [treeId])).rows as Row[];
    expect(rows.length).toBe(1);
    expect(rows[0].CreatedAt).not.toBeNull();
  });

  it('lists the newest upload first, older untimed rows after, and the higher Id first on a tie', async () => {
    await query(
      `INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title", "CreatedAt") VALUES
         (1, $1, $2, 'legacy low', NULL), (2, $1, $2, 'legacy high', NULL),
         (3, $1, $2, 'new', '2026-11-20T10:00:00Z'), (4, $1, $2, 'old', '2026-01-01T00:00:00Z'),
         (5, $1, $2, 'same as new', '2026-11-20T10:00:00Z')`,
      [USER_ID, treeId],
    );
    const listed = (await getAllMedia(treeId)) as unknown as Row[];
    expect(listed.map((m) => m.Id)).toEqual([5, 3, 4, 2, 1]);
    // The client sort agrees, from any starting order.
    expect([...listed].reverse().sort(compareRecentlyAdded).map((m) => m.Id)).toEqual([5, 3, 4, 2, 1]);
    // The Library's list reads the same order.
    expect((await getAllMediaWithPerson(treeId)).map((m) => m.Id)).toEqual([5, 3, 4, 2, 1]);
  });

  it('keeps the upload time, or its absence, when a delete is undone', async () => {
    const { deleteMediaService } = await import('@/lib/services/media');
    await query(
      `INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title", "CreatedAt") VALUES
         (7, $1, $2, 'timed', '2026-01-02T03:04:05Z'), (8, $1, $2, 'legacy', NULL)`,
      [USER_ID, treeId],
    );
    for (const id of [7, 8]) {
      expect(await deleteMediaService({ id, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID })).toBe(true);
      const entry = (await query(
        `SELECT "Id" FROM "AuditLog" WHERE "TreeId" = $1 AND "EntityType" = 'media' AND "EntityId" = $2 AND "Action" = 'delete'`,
        [treeId, id],
      )).rows[0] as { Id: number };
      await revertAuditEntry(entry.Id, treeId, USER_ID, USER_ID);
    }
    const rows = (await query('SELECT "Id", "CreatedAt" FROM "Media" WHERE "Id" IN (7, 8) ORDER BY "Id"')).rows as Row[];
    expect(new Date(rows[0].CreatedAt!).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(rows[1].CreatedAt).toBeNull();
  });
});

describe('v75 migration (#25)', () => {
  it('leaves rows that predate the column without a time, and stamps rows added after', async () => {
    const db = await newEmptyClusterDb();
    const exec = { query: (text: string, params?: unknown[]) => db.query(text, params) };
    try {
      await initializeSchema(exec);
      // A pre-v75 database: no column, one existing row.
      await db.query('ALTER TABLE "Media" DROP COLUMN "CreatedAt"');
      await db.query(`INSERT INTO "Media" ("Id", "Title") VALUES (1, 'before')`);
      await initializeSchema(exec);
      await db.query(`INSERT INTO "Media" ("Id", "Title") VALUES (2, 'after')`);
      // Running the schema again never backfills.
      await initializeSchema(exec);
      const rows = (await db.query('SELECT "Id", "CreatedAt" FROM "Media" ORDER BY "Id"')).rows as Row[];
      expect(rows[0].CreatedAt).toBeNull();
      expect(rows[1].CreatedAt).not.toBeNull();
    } finally {
      await db.close();
    }
  });
});

describe('Media inserts (#25)', () => {
  // Literal inserts only; the audit restore's dynamic insert is covered by the undo test above.
  it('never write "CreatedAt" in a literal insert, so new rows take the database time', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) { if (name !== 'generated') walk(file); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/INSERT INTO "Media"\s*\(([^)]*)\)/g)) if (m[1].includes('"CreatedAt"')) offenders.push(file);
      }
    };
    walk(path.join(process.cwd(), 'lib'));
    walk(path.join(process.cwd(), 'app'));
    expect(offenders).toEqual([]);
  });
});

describe('compareRecentlyAdded (#25)', () => {
  it('accepts Date objects from PGlite and strings from HTTP alike', () => {
    const a = { Id: 1, CreatedAt: new Date('2026-05-01T00:00:00Z') };
    const b = { Id: 2, CreatedAt: '2026-04-01T00:00:00Z' };
    expect([b, a].sort(compareRecentlyAdded).map((m) => m.Id)).toEqual([1, 2]);
  });
});
