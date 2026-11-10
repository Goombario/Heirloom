import { afterEach, describe, expect, it } from 'vitest';
import { POST as REVERT } from '@/app/api/audit/revert/route';
import { query } from '@/lib/db/connection';
import { createRequest } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getTestUserIds } from '../../setup/test-user-ids';

const describeIf = hasTestDatabase() ? describe : describe.skip;
const USER_ID = getTestUserIds().user1;

type EntityType = 'person' | 'source' | 'citation' | 'mediatag' | 'namevariant';
type Row = Record<string, unknown> & { Id: number };

const TABLES: Record<EntityType, string> = {
  person: '"People"',
  source: '"Sources"',
  citation: '"Citation"',
  mediatag: '"MediaTag"',
  namevariant: '"NameVariant"',
};

async function createTree(name: string): Promise<number> {
  const result = await query(
    `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`,
    [USER_ID, name],
  );
  return (result.rows[0] as { Id: number }).Id;
}

async function createPerson(treeId: number): Promise<number> {
  const result = await query(
    `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName")
     VALUES ($1, $2, 'Fictional', 'Researcher') RETURNING "Id"`,
    [USER_ID, treeId],
  );
  return (result.rows[0] as { Id: number }).Id;
}

async function seedEntity(entityType: EntityType, treeId: number): Promise<Row> {
  const personId = await createPerson(treeId);

  if (entityType === 'source') {
    const result = await query(
      `INSERT INTO "Sources"
         ("OwnerId", "TreeId", "Title", "Author", "PublicationInfo", "RepositoryName", "CallNumber", "Text", "Type", "Contents", "Num", "RawGedcom", "RepositoryMedi", "Abbreviation")
       VALUES ($1, $2, 'Fictional archive', 'Fictional researcher', 'Fictional publication', 'Fictional repository', 'FIC-1', 'Fictional transcription', 'Book', 'Fictional contents', 7, '0 @S1@ SOUR', 'microfilm', 'FIC') RETURNING *`,
      [USER_ID, treeId],
    );
    return result.rows[0] as Row;
  }

  if (entityType === 'citation') {
    const source = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title")
       VALUES ($1, $2, 'Fictional citation source') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    const result = await query(
      `INSERT INTO "Citation"
         ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page", "Note", "Quay", "DataText", "DataDate", "Even", "Role")
       VALUES ($1, $2, 'People', $3, $4, 'page one', 'Fictional note', '2', 'Fictional evidence', '1900-01-01', 'BIRT', 'child') RETURNING *`,
      [USER_ID, treeId, personId, (source.rows[0] as { Id: number }).Id],
    );
    return result.rows[0] as Row;
  }

  if (entityType === 'namevariant') {
    const result = await query(
      `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name")
       VALUES ($1, $2, $3, 'Alias', 'Fictional alias') RETURNING *`,
      [USER_ID, treeId, personId],
    );
    return result.rows[0] as Row;
  }

  const media = await query(
    `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
     VALUES ($1, $2, 'Fictional photograph', 'fictional.jpg') RETURNING "Id"`,
    [USER_ID, treeId],
  );
  const result = await query(
    `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
     VALUES ($1, $2, 10, 20, 30, 40) RETURNING *`,
    [(media.rows[0] as { Id: number }).Id, personId],
  );
  return result.rows[0] as Row;
}

async function insertAudit(
  treeId: number,
  entityType: EntityType,
  action: 'create' | 'update' | 'delete',
  row: Row,
  changes: Record<string, unknown>,
  auditTreeId = treeId,
): Promise<number> {
  const result = await query(
    `INSERT INTO "AuditLog"
       ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "Id"`,
    [USER_ID, USER_ID, auditTreeId, action, entityType, row.Id, `${entityType} fixture`, JSON.stringify(changes)],
  );
  return (result.rows[0] as { Id: number }).Id;
}

async function revert(treeId: number, auditId: number) {
  return REVERT(createRequest(`http://localhost:3000/api/audit/revert?treeId=${treeId}`, {
    method: 'POST',
    body: { ids: [auditId] },
  }));
}

async function revertMany(treeId: number, auditIds: number[]) {
  return REVERT(createRequest(`http://localhost:3000/api/audit/revert?treeId=${treeId}`, {
    method: 'POST',
    body: { ids: auditIds },
  }));
}

async function readEntity(entityType: EntityType, id: number): Promise<Row | null> {
  const result = await query(`SELECT * FROM ${TABLES[entityType]} WHERE "Id" = $1`, [id]);
  return (result.rows[0] as Row | undefined) ?? null;
}

function withoutCreatedAt(row: Row | null): Row | null {
  if (!row) return null;
  const { CreatedAt: _createdAt, ...rest } = row;
  return rest as Row;
}

async function mutateForUpdate(entityType: EntityType, row: Row): Promise<{ field: string; old: unknown; new: unknown }> {
  if (entityType === 'source') {
    await query(`UPDATE "Sources" SET "Title" = 'Changed archive' WHERE "Id" = $1`, [row.Id]);
    return { field: 'Title', old: row.Title, new: 'Changed archive' };
  }
  if (entityType === 'citation') {
    await query(`UPDATE "Citation" SET "Page" = 'page two' WHERE "Id" = $1`, [row.Id]);
    return { field: 'Page', old: row.Page, new: 'page two' };
  }
  if (entityType === 'namevariant') {
    await query(`UPDATE "NameVariant" SET "Name" = 'Changed alias' WHERE "Id" = $1`, [row.Id]);
    return { field: 'Name', old: row.Name, new: 'Changed alias' };
  }
  await query(`UPDATE "MediaTag" SET "RegionX" = 50 WHERE "Id" = $1`, [row.Id]);
  return { field: 'RegionX', old: row.RegionX, new: 50 };
}

describeIf('scoped audit reverts', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  for (const entityType of ['source', 'citation', 'mediatag', 'namevariant'] as EntityType[]) {
    it(`reverts an ${entityType} update`, async () => {
      const treeId = await createTree(`Update ${entityType}`);
      const row = await seedEntity(entityType, treeId);
      const change = await mutateForUpdate(entityType, row);
      const auditId = await insertAudit(treeId, entityType, 'update', row, {
        fields: { [change.field]: { old: change.old, new: change.new } },
      });

      const response = await revert(treeId, auditId);
      expect(response.status).toBe(200);
      expect((await readEntity(entityType, row.Id))?.[change.field]).toBe(change.old);
    });

    it(`reverts an ${entityType} creation by deleting the row`, async () => {
      const treeId = await createTree(`Create ${entityType}`);
      const row = await seedEntity(entityType, treeId);
      if (entityType === 'mediatag') {
        await query(
          `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES ($1, 'People', $2)`,
          [row.MediaId, row.PersonId],
        );
      }
      const auditId = await insertAudit(treeId, entityType, 'create', row, { snapshot: row });

      const response = await revert(treeId, auditId);
      expect(response.status).toBe(200);
      expect(await readEntity(entityType, row.Id)).toBeNull();
      if (entityType === 'mediatag') {
        const link = await query(
          `SELECT 1 FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'People' AND "OwnerId" = $2`,
          [row.MediaId, row.PersonId],
        );
        expect(link.rows).toHaveLength(1);
      }
    });

    it(`reverts an ${entityType} deletion by restoring the row`, async () => {
      const treeId = await createTree(`Delete ${entityType}`);
      const row = await seedEntity(entityType, treeId);
      await query(`DELETE FROM ${TABLES[entityType]} WHERE "Id" = $1`, [row.Id]);
      const auditId = await insertAudit(treeId, entityType, 'delete', row, { snapshot: row });

      const response = await revert(treeId, auditId);
      expect(response.status).toBe(200);
      const restored = await readEntity(entityType, row.Id);
      expect(withoutCreatedAt(restored)).toEqual(withoutCreatedAt(row));
      if (entityType !== 'mediatag') {
        expect(restored).toEqual(expect.objectContaining({ OwnerId: USER_ID, TreeId: treeId }));
      }
    });
  }

  for (const entityType of ['source', 'citation', 'mediatag', 'namevariant'] as EntityType[]) {
    it(`does not cross a tree boundary for a forged ${entityType} audit`, async () => {
      const treeA = await createTree(`Isolation A ${entityType}`);
      const treeB = await createTree(`Isolation B ${entityType}`);
      const row = await seedEntity(entityType, treeB);
      const auditId = await insertAudit(treeA, entityType, 'create', row, { snapshot: row }, treeA);

      const response = await revert(treeA, auditId);
      expect(response.status).toBe(404);
      expect(await readEntity(entityType, row.Id)).toEqual(expect.objectContaining({ Id: row.Id }));
    });
  }

  it('rejects a delete snapshot whose explicit TreeId differs from the audit tree', async () => {
    const treeA = await createTree('Mismatched snapshot A');
    const treeB = await createTree('Mismatched snapshot B');
    const row = await seedEntity('source', treeB);
    await query(`DELETE FROM "Sources" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'source', 'delete', row, {
      snapshot: { ...row, TreeId: treeB },
    }, treeA);

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('source', row.Id)).toBeNull();
  });

  it('does not modify a user-scoped row owned by another user', async () => {
    const treeId = await createTree('User ownership boundary');
    const result = await query(
      `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName")
       VALUES ($1, $2, 'Other', 'Owner') RETURNING *`,
      [getTestUserIds().user2, treeId],
    );
    const row = result.rows[0] as Row;
    await query(`DELETE FROM "People" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeId, 'person', 'delete', row, { snapshot: row }, treeId);

    const response = await revert(treeId, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('person', row.Id)).toBeNull();
  });

  it('does not modify an owner-scoped row owned by another user', async () => {
    const treeId = await createTree('Owner ownership boundary');
    const result = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title")
       VALUES ($1, $2, 'Other owner source') RETURNING *`,
      [getTestUserIds().user2, treeId],
    );
    const row = result.rows[0] as Row;
    const auditId = await insertAudit(treeId, 'source', 'create', row, { snapshot: row }, treeId);

    const response = await revert(treeId, auditId);
    expect(response.status).toBe(404);
    expect(await readEntity('source', row.Id)).toEqual(expect.objectContaining({ Id: row.Id, OwnerId: getTestUserIds().user2 }));
  });

  it('rejects a source restore whose repository is in another tree', async () => {
    const treeA = await createTree('Repository source A');
    const treeB = await createTree('Repository source B');
    const repository = await query(
      `INSERT INTO "Repository" ("OwnerId", "TreeId", "Name") VALUES ($1, $2, 'Fictional repository') RETURNING "Id"`,
      [USER_ID, treeB],
    );
    const source = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "RepositoryId")
       VALUES ($1, $2, 'Fictional source', $3) RETURNING *`,
      [USER_ID, treeA, (repository.rows[0] as { Id: number }).Id],
    );
    const row = source.rows[0] as Row;
    await query(`DELETE FROM "Sources" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'source', 'delete', row, { snapshot: row });

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('source', row.Id)).toBeNull();
  });

  it('rejects a citation restore whose fact is in another tree even when its source is local', async () => {
    const treeA = await createTree('Citation fact A');
    const treeB = await createTree('Citation fact B');
    const personB = await createPerson(treeB);
    const sourceA = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Local source') RETURNING "Id"`,
      [USER_ID, treeA],
    );
    const citation = await query(
      `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId")
       VALUES ($1, $2, 'People', $3, $4) RETURNING *`,
      [USER_ID, treeA, personB, (sourceA.rows[0] as { Id: number }).Id],
    );
    const row = citation.rows[0] as Row;
    await query(`DELETE FROM "Citation" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'citation', 'delete', row, { snapshot: row });

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('citation', row.Id)).toBeNull();
  });

  it('rejects a name variant restore whose person is in another tree while the variant is local', async () => {
    const treeA = await createTree('Local variant A');
    const treeB = await createTree('Local variant B');
    const personB = await createPerson(treeB);
    const variant = await query(
      `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name")
       VALUES ($1, $2, $3, 'Alias', 'Cross-tree alias') RETURNING *`,
      [USER_ID, treeA, personB],
    );
    const row = variant.rows[0] as Row;
    await query(`DELETE FROM "NameVariant" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'namevariant', 'delete', row, { snapshot: row });

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('namevariant', row.Id)).toBeNull();
  });

  it('rejects a MediaTag restore whose person is in another tree while the media is local', async () => {
    const treeA = await createTree('Local tag A');
    const treeB = await createTree('Local tag B');
    const personB = await createPerson(treeB);
    const media = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Local photograph') RETURNING "Id"`,
      [USER_ID, treeA],
    );
    const tag = await query(
      `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
       VALUES ($1, $2, 1, 2, 3, 4) RETURNING *`,
      [(media.rows[0] as { Id: number }).Id, personB],
    );
    const row = tag.rows[0] as Row;
    await query(`DELETE FROM "MediaTag" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'mediatag', 'delete', row, { snapshot: row });

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('mediatag', row.Id)).toBeNull();
  });

  it('accepts the legacy lowercase family citation fact value', async () => {
    const treeId = await createTree('Legacy family citation');
    const family = await query(
      `INSERT INTO "Families" ("UserId", "TreeId") VALUES ($1, $2) RETURNING "Id"`,
      [USER_ID, treeId],
    );
    const source = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Family source') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    const citation = await query(
      `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId")
       VALUES ($1, $2, 'family', $3, $4) RETURNING *`,
      [USER_ID, treeId, (family.rows[0] as { Id: number }).Id, (source.rows[0] as { Id: number }).Id],
    );
    const row = citation.rows[0] as Row;
    await query(`DELETE FROM "Citation" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeId, 'citation', 'delete', row, { snapshot: row });

    const response = await revert(treeId, auditId);
    expect(response.status).toBe(200);
    expect(await readEntity('citation', row.Id)).toEqual(expect.objectContaining({ Id: row.Id, FactTable: 'family' }));
  });

  it('rejects a batch containing an audit entry from another tree', async () => {
    const treeA = await createTree('Mixed batch A');
    const treeB = await createTree('Mixed batch B');
    const local = await seedEntity('source', treeA);
    const foreign = await seedEntity('source', treeB);
    await query(`DELETE FROM "Sources" WHERE "Id" = ANY($1::integer[])`, [[local.Id, foreign.Id]]);
    const localAuditId = await insertAudit(treeA, 'source', 'delete', local, { snapshot: local });
    const foreignAuditId = await insertAudit(treeB, 'source', 'delete', foreign, { snapshot: foreign });

    const response = await revertMany(treeA, [localAuditId, foreignAuditId]);
    expect(response.status).toBe(500);
    expect(await readEntity('source', local.Id)).toBeNull();
    expect(await readEntity('source', foreign.Id)).toBeNull();
  });

  it('restores citations for canonical Events, NameVariant, and Families facts', async () => {
    const treeId = await createTree('Canonical citation facts');
    const person1 = await createPerson(treeId);
    const person2 = await createPerson(treeId);
    const family = await query(
      `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id")
       VALUES ($1, $2, $3, $4) RETURNING "Id"`,
      [USER_ID, treeId, person1, person2],
    );
    const event = await query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId")
       VALUES ($1, $2, 'BIRT', $3) RETURNING "Id"`,
      [USER_ID, treeId, person1],
    );
    const variant = await query(
      `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name")
       VALUES ($1, $2, $3, 'Alias', 'Canonical alias') RETURNING "Id"`,
      [USER_ID, treeId, person1],
    );
    const source = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Canonical source') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    const sourceId = (source.rows[0] as { Id: number }).Id;
    const facts = [
      { table: 'Events', id: (event.rows[0] as { Id: number }).Id },
      { table: 'NameVariant', id: (variant.rows[0] as { Id: number }).Id },
      { table: 'Families', id: (family.rows[0] as { Id: number }).Id },
    ];
    const rows: Row[] = [];
    const auditIds: number[] = [];
    for (const fact of facts) {
      const citation = await query(
        `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId")
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [USER_ID, treeId, fact.table, fact.id, sourceId],
      );
      const row = citation.rows[0] as Row;
      rows.push(row);
      await query(`DELETE FROM "Citation" WHERE "Id" = $1`, [row.Id]);
      auditIds.push(await insertAudit(treeId, 'citation', 'delete', row, { snapshot: row }));
    }

    const response = await revertMany(treeId, auditIds);
    expect(response.status).toBe(200);
    for (const row of rows) {
      expect(await readEntity('citation', row.Id)).toEqual(expect.objectContaining({ Id: row.Id }));
    }
  });

  it('rejects citations whose same-tree fact rows point to people in another tree', async () => {
    const treeA = await createTree('Nested citation A');
    const treeB = await createTree('Nested citation B');
    const foreignPerson = await createPerson(treeB);
    const source = await query(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Nested source') RETURNING "Id"`,
      [USER_ID, treeA],
    );
    const sourceId = (source.rows[0] as { Id: number }).Id;
    const variant = await query(
      `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name")
       VALUES ($1, $2, $3, 'Alias', 'Nested alias') RETURNING "Id"`,
      [USER_ID, treeA, foreignPerson],
    );
    const event = await query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId") VALUES ($1, $2, 'BIRT', $3) RETURNING "Id"`,
      [USER_ID, treeA, foreignPerson],
    );
    const family = await query(
      `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id") VALUES ($1, $2, $3) RETURNING "Id"`,
      [USER_ID, treeA, foreignPerson],
    );
    const facts = [
      { table: 'NameVariant', id: (variant.rows[0] as { Id: number }).Id },
      { table: 'Events', id: (event.rows[0] as { Id: number }).Id },
      { table: 'Families', id: (family.rows[0] as { Id: number }).Id },
    ];
    const auditIds: number[] = [];
    for (const fact of facts) {
      const citation = await query(
        `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId")
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [USER_ID, treeA, fact.table, fact.id, sourceId],
      );
      const row = citation.rows[0] as Row;
      await query(`DELETE FROM "Citation" WHERE "Id" = $1`, [row.Id]);
      auditIds.push(await insertAudit(treeA, 'citation', 'delete', row, { snapshot: row }));
    }

    const response = await revertMany(treeA, auditIds);
    expect(response.status).toBe(500);
    for (const auditId of auditIds) {
      const audit = await query(`SELECT "EntityId" FROM "AuditLog" WHERE "Id" = $1`, [auditId]);
      expect(await readEntity('citation', (audit.rows[0] as { EntityId: number }).EntityId)).toBeNull();
    }
  });

  it('rejects a citation restore whose source is in another tree', async () => {
    const treeA = await createTree('Citation source A');
    const treeB = await createTree('Citation source B');
    const row = await seedEntity('citation', treeB);
    await query(`DELETE FROM "Citation" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'citation', 'delete', row, {
      snapshot: { ...row, TreeId: treeA },
    }, treeA);

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('citation', row.Id)).toBeNull();
  });

  it('rejects a name variant restore whose person is in another tree', async () => {
    const treeA = await createTree('Variant person A');
    const treeB = await createTree('Variant person B');
    const row = await seedEntity('namevariant', treeB);
    await query(`DELETE FROM "NameVariant" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeA, 'namevariant', 'delete', row, {
      snapshot: { ...row, TreeId: treeA },
    }, treeA);

    const response = await revert(treeA, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('namevariant', row.Id)).toBeNull();
  });

  it('rejects a MediaTag restore for a same-tree person owned by another user', async () => {
    const treeId = await createTree('Same tree tag owner');
    const person = await query(
      `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName")
       VALUES ($1, $2, 'Other', 'Tree Owner') RETURNING "Id"`,
      [getTestUserIds().user2, treeId],
    );
    const media = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Owner photograph') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    const tag = await query(
      `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
       VALUES ($1, $2, 1, 2, 3, 4) RETURNING *`,
      [(media.rows[0] as { Id: number }).Id, (person.rows[0] as { Id: number }).Id],
    );
    const row = tag.rows[0] as Row;
    await query(`DELETE FROM "MediaTag" WHERE "Id" = $1`, [row.Id]);
    const auditId = await insertAudit(treeId, 'mediatag', 'delete', row, { snapshot: row });

    const response = await revert(treeId, auditId);
    expect(response.status).toBe(500);
    expect(await readEntity('mediatag', row.Id)).toBeNull();
  });

  it('rolls back every restore when a later batch entry fails scope validation', async () => {
    const treeA = await createTree('Batch rollback A');
    const treeB = await createTree('Batch rollback B');
    const first = await seedEntity('source', treeA);
    const second = await seedEntity('source', treeA);
    await query(`DELETE FROM "Sources" WHERE "Id" = ANY($1::integer[])`, [[first.Id, second.Id]]);

    // The valid entry is newer, so batch order restores it before the invalid entry.
    const invalidAuditId = await insertAudit(treeA, 'source', 'delete', first, {
      snapshot: { ...first, TreeId: treeB },
    }, treeA);
    const validAuditId = await insertAudit(treeA, 'source', 'delete', second, {
      snapshot: second,
    }, treeA);

    const response = await revertMany(treeA, [invalidAuditId, validAuditId]);
    expect(response.status).toBe(500);
    expect(await readEntity('source', first.Id)).toBeNull();
    expect(await readEntity('source', second.Id)).toBeNull();
  });
});
