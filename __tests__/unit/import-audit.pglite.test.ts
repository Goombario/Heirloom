import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { auditCanonicalMediaOwnershipChange, auditCanonicalPrimaryChange, auditImport } from '@/lib/db/queries/audit-capture';
import { revertAuditEntry, getAuditLog } from '@/lib/db/queries/audit';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * DB-level checks for the FUNC-5 import summary entry against a real (PGlite)
 * schema: the widened AuditLog EntityType CHECK must accept 'import', and such
 * entries must be non-revertable.
 */
describe('import audit entry (PGlite)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(mdb); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('AuditLog accepts an EntityType=import row via auditImport', async () => {
    await auditImport('overwrite', { people: 9, families: 3, sources: 2 }, 1, 1);

    const res = await query(
      `SELECT "EntityType","Action","EntityId","EntityLabel" FROM "AuditLog"`, [],
    );
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0] as { EntityType: string; Action: string; EntityId: number; EntityLabel: string };
    expect(row.EntityType).toBe('import');
    expect(row.Action).toBe('create');
    expect(row.EntityId).toBe(0);
    expect(row.EntityLabel).toContain('9 people');
    expect(row.EntityLabel).toContain('overwrite');
  });

  it('an import entry is not revertable', async () => {
    await auditImport('merge', { people: 1, families: 0 }, 1, 1, undefined, 1);
    const res = await query(`SELECT "Id" FROM "AuditLog" WHERE "EntityType" = 'import'`, []);
    const id = (res.rows[0] as { Id: number }).Id;

    // Owner (1,1) passes the permission gate → the rejection is specifically the
    // non-revertable entity type, not a permission error.
    await expect(revertAuditEntry(id, 1, 1, 1)).rejects.toThrow(/import/i);
  });

  it("'import' is an accepted audit-log filter (not rejected as invalid)", async () => {
    await auditImport('overwrite', { people: 2, families: 1 }, 1, 1, undefined, 1);
    // Regression guard: the filter chip offers 'import', so getAuditLog must
    // accept it rather than throwing "Invalid entityType".
    const { entries } = await getAuditLog(1, { entityType: 'import', page: 1, pageSize: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0].EntityType).toBe('import');
  });

  it('reverts a canonical-primary summary through its own path, not as a generic media update', async () => {
    await auditCanonicalPrimaryChange({
      personId: 17,
      oldMediaId: 41,
      newMediaId: 42,
      treeOwnerId: 1,
      userId: 1,
      treeId: 1,
      exec: { query },
    });
    const res = await query(
      `SELECT "Id" FROM "AuditLog" WHERE "EntityType" = 'media' ORDER BY "Id" DESC LIMIT 1`,
    );
    const id = (res.rows[0] as { Id: number }).Id;

    // Person 17 doesn't exist: the profile-picture revert (#1044) refuses it,
    // rather than the generic path rewriting Media #42.
    await expect(revertAuditEntry(id, 1, 1, 1))
      .rejects.toThrow(/person is no longer in this tree/i);
  });

  it("labels a canonical-primary summary with the person's name, falling back to the id", async () => {
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
    const treeId = (await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'T') RETURNING "Id"`, [])).rows[0] as { Id: number };
    const person = (await query(
      `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES (1, $1, 'Hazel', 'Bracken') RETURNING "Id"`,
      [treeId.Id],
    )).rows[0] as { Id: number };
    const capture = (personId: number) => auditCanonicalPrimaryChange({
      personId,
      oldMediaId: null,
      newMediaId: 42,
      treeOwnerId: 1,
      userId: 1,
      treeId: treeId.Id,
      exec: { query },
    });

    await capture(person.Id);
    await capture(person.Id + 1000);
    const res = await query(`SELECT "EntityLabel" FROM "AuditLog" WHERE "EntityType" = 'media' ORDER BY "Id"`, []);
    expect((res.rows as { EntityLabel: string }[]).map((r) => r.EntityLabel)).toEqual([
      'Profile picture — Hazel Bracken',
      `Profile picture — Person #${person.Id + 1000}`,
    ]);
  });

  it('rejects a canonical-ownership summary explicitly instead of treating it as a generic media update', async () => {
    await auditCanonicalMediaOwnershipChange({
      mediaId: 42,
      oldPersonIds: [17],
      newPersonIds: [18],
      treeOwnerId: 1,
      userId: 1,
      treeId: 1,
      exec: { query },
    });
    const res = await query(
      `SELECT "Id" FROM "AuditLog" WHERE "EntityType" = 'media' ORDER BY "Id" DESC LIMIT 1`,
    );
    const id = (res.rows[0] as { Id: number }).Id;

    await expect(revertAuditEntry(id, 1, 1, 1))
      .rejects.toThrow(/canonical ownership summary is not revertible/i);
  });
});
