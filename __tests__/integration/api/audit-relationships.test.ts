import { afterEach, describe, expect, it } from 'vitest';
import { GET as LIST_AUDIT } from '@/app/api/audit/route';
import { POST as REVERT } from '@/app/api/audit/revert/route';
import { DELETE as DELETE_PERSON } from '@/app/api/people/[id]/route';
import { DELETE as DELETE_FAMILY } from '@/app/api/families/[id]/route';
import {
  POST as ADD_CHILD,
  PATCH as UPDATE_CHILD_TYPE,
  DELETE as REMOVE_CHILD,
} from '@/app/api/families/[id]/children/route';
import { POST as MOVE_CHILD } from '@/app/api/families/[id]/children/move/route';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getTestUserIds } from '../../setup/test-user-ids';

/**
 * #788 (task audit ED-8, ED-10): every child-link change is audited and
 * revertible, and reverting a person delete brings back the rows the delete
 * cascaded away or left linked.
 */
const describeIf = hasTestDatabase() ? describe : describe.skip;
const USER_ID = getTestUserIds().user1;

type Row = Record<string, unknown>;

async function insertOne(sql: string, params: unknown[]): Promise<Row> {
  return (await query(sql, params)).rows[0] as Row;
}

async function createTree(name: string): Promise<number> {
  const row = await insertOne(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [USER_ID, name]);
  return row.Id as number;
}

async function createPerson(treeId: number, first: string): Promise<number> {
  const row = await insertOne(
    `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, $3, 'Fictional') RETURNING "Id"`,
    [USER_ID, treeId, first],
  );
  return row.Id as number;
}

async function createFamily(treeId: number, partner1: number): Promise<number> {
  const row = await insertOne(
    `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id") VALUES ($1, $2, $3) RETURNING "Id"`,
    [USER_ID, treeId, partner1],
  );
  return row.Id as number;
}

async function revert(treeId: number, auditId: number) {
  return REVERT(createRequest(`http://localhost:3000/api/audit/revert?treeId=${treeId}`, {
    method: 'POST',
    body: { ids: [auditId] },
  }));
}

async function childRequest(
  handler: typeof ADD_CHILD,
  method: 'POST' | 'PATCH' | 'DELETE',
  treeId: number,
  familyId: number,
  body: Row,
) {
  return handler(
    createRequest(`http://localhost:3000/api/families/${familyId}/children?treeId=${treeId}`, { method, body }),
    { params: Promise.resolve({ id: String(familyId) }) },
  );
}

async function childLink(familyId: number, childId: number): Promise<Row | null> {
  const result = await query(
    `SELECT "Partner1Relationship", "Partner2Relationship" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
    [familyId, childId],
  );
  return (result.rows[0] as Row | undefined) ?? null;
}

/** One relationship for both partners, as `childLink` reads it. */
const both = (type: string): Row => ({ Partner1Relationship: type, Partner2Relationship: type });

async function childAuditRows(treeId: number): Promise<Row[]> {
  const result = await query(
    `SELECT "Id", "Action", "EntityId", "EntityLabel", "Changes" FROM "AuditLog"
     WHERE "TreeId" = $1 AND "EntityType" = 'familychild' ORDER BY "Id"`,
    [treeId],
  );
  return result.rows as Row[];
}

describeIf('audit: relationship changes and person-delete revert (#788)', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('restores name variants, note links, face tags, case links and citations when a person delete is reverted', async () => {
    const treeId = await createTree('Revert dependents');
    const personId = await createPerson(treeId, 'Hazel');

    await query(
      `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name", "IsPrimary")
       VALUES ($1, $2, $3, 'Nickname', 'Hazie', 0)`,
      [USER_ID, treeId, personId],
    );
    const note = await insertOne(
      `INSERT INTO "Note" ("OwnerId", "TreeId", "Text") VALUES ($1, $2, 'Fictional note') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    await query(`INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "AddedInApp") VALUES ($1, 'People', $2, 1)`, [note.Id, personId]);
    const media = await insertOne(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Fictional portrait') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, 'People', $2, 1)`, [media.Id, personId]);
    await query(
      `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
       VALUES ($1, $2, 0.1, 0.2, 0.3, 0.4)`,
      [media.Id, personId],
    );
    const theCase = await insertOne(
      `INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Fictional case') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    await query(`INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ($1, $2)`, [theCase.Id, personId]);
    const source = await insertOne(
      `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Fictional census') RETURNING "Id"`,
      [USER_ID, treeId],
    );
    await query(
      `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page")
       VALUES ($1, $2, 'People', $3, $4, 'p. 4')`,
      [USER_ID, treeId, personId, source.Id],
    );

    const snapshotOf = async () => ({
      nameVariants: (await query(`SELECT "Id", "Type", "Name", "IsPrimary", "TreeId" FROM "NameVariant" WHERE "PersonId" = $1 ORDER BY "Id"`, [personId])).rows,
      noteLinks: (await query(`SELECT "NoteId", "OwnerTable", "OwnerFact", "AddedInApp" FROM "NoteLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1`, [personId])).rows,
      mediaLinks: (await query(`SELECT "MediaId", "IsPrimary" FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1`, [personId])).rows,
      mediaTags: (await query(`SELECT "Id", "MediaId", "RegionX", "RegionY", "RegionW", "RegionH" FROM "MediaTag" WHERE "PersonId" = $1 ORDER BY "Id"`, [personId])).rows,
      casePeople: (await query(`SELECT "CaseId" FROM "CasePerson" WHERE "PersonId" = $1`, [personId])).rows,
      citations: (await query(`SELECT "Id", "SourceId", "Page" FROM "Citation" WHERE "FactTable" = 'People' AND "FactId" = $1 ORDER BY "Id"`, [personId])).rows,
    });
    const before = await snapshotOf();
    expect(before.nameVariants).toHaveLength(1);
    expect(before.mediaTags).toHaveLength(1);

    const deleteRes = await DELETE_PERSON(
      createRequest(`http://localhost:3000/api/people/${personId}?treeId=${treeId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: String(personId) }) },
    );
    expect(deleteRes.status).toBeLessThan(300);
    const afterDelete = await snapshotOf();
    expect(afterDelete.nameVariants).toHaveLength(0);
    expect(afterDelete.mediaTags).toHaveLength(0);
    expect(afterDelete.casePeople).toHaveLength(0);

    const entry = await insertOne(
      `SELECT "Id" FROM "AuditLog" WHERE "TreeId" = $1 AND "EntityType" = 'person' AND "Action" = 'delete' AND "EntityId" = $2`,
      [treeId, personId],
    );
    const revertRes = await revert(treeId, entry.Id as number);
    expect(revertRes.status).toBe(200);

    expect(await snapshotOf()).toEqual(before);
  });

  it('writes an audit row when a child is added or removed, and reverting the removal restores the link', async () => {
    const treeId = await createTree('Child links');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);

    const addRes = await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child, relationshipType: 'Adoption' });
    expect(addRes.status).toBe(201);
    const removeRes = await childRequest(REMOVE_CHILD, 'DELETE', treeId, familyId, { childId: child });
    expect(removeRes.status).toBe(200);
    const { auditId } = await parseResponse<{ auditId: number }>(removeRes);
    expect(await childLink(familyId, child)).toBeNull();

    const rows = await childAuditRows(treeId);
    expect(rows.map(r => r.Action)).toEqual(['create', 'delete']);
    expect(rows[1].Id).toBe(auditId);
    expect(rows[1].EntityId).toBe(familyId);
    expect(rows[1].EntityLabel).toBe('Child — Child Fictional · Parent Fictional');

    // The Undo toast calls this same revert.
    expect((await revert(treeId, auditId)).status).toBe(200);
    expect(await childLink(familyId, child)).toEqual(both('Adoption'));
    expect((await childAuditRows(treeId)).map(r => r.Action)).toEqual(['create', 'delete', 'create']);

    // Reverting the original add removes the link again.
    expect((await revert(treeId, rows[0].Id as number)).status).toBe(200);
    expect(await childLink(familyId, child)).toBeNull();
  });

  // #551: the list names the people and families its change details refer to.
  it('returns names for the person and family ids in the listed entries', async () => {
    const treeId = await createTree('Readable rows');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);
    await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child });

    const res = await LIST_AUDIT(createRequest(`http://localhost:3000/api/audit?treeId=${treeId}`));
    const { refs } = await parseResponse<{ refs: { people: Record<string, string>; families: Record<string, string> } }>(res);
    expect(refs.people[child]).toBe('Child Fictional');
    expect(refs.families[familyId]).toBe('Parent Fictional');
  });

  it('audits and reverts a child relationship-type change', async () => {
    const treeId = await createTree('Child type');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);

    await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child });
    const patchRes = await childRequest(UPDATE_CHILD_TYPE, 'PATCH', treeId, familyId, { childId: child, relationshipType: 'Foster' });
    expect(patchRes.status).toBe(200);

    const update = (await childAuditRows(treeId)).find(r => r.Action === 'update')!;
    expect(update.Changes).toMatchObject({
      fields: {
        Partner1Relationship: { old: 'Birth', new: 'Foster' },
        Partner2Relationship: { old: 'Birth', new: 'Foster' },
      },
    });

    expect((await revert(treeId, update.Id as number)).status).toBe(200);
    expect(await childLink(familyId, child)).toEqual(both('Birth'));
  });

  // #982: one partner's relationship changes on its own, and Undo restores only it.
  it('audits and reverts a change to one partner only', async () => {
    const treeId = await createTree('Child step');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);

    await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child, relationshipType: 'Adoption' });
    const patchRes = await childRequest(UPDATE_CHILD_TYPE, 'PATCH', treeId, familyId, {
      childId: child, relationshipType: { partner1: 'Adoption', partner2: 'Step' },
    });
    expect(patchRes.status).toBe(200);
    expect(await childLink(familyId, child)).toEqual({ Partner1Relationship: 'Adoption', Partner2Relationship: 'Step' });

    const update = (await childAuditRows(treeId)).find(r => r.Action === 'update')!;
    expect((update.Changes as { fields: Row }).fields).toEqual({ Partner2Relationship: { old: 'Adoption', new: 'Step' } });

    expect((await revert(treeId, update.Id as number)).status).toBe(200);
    expect(await childLink(familyId, child)).toEqual(both('Adoption'));
  });

  it('refuses a relationship outside the set, for either partner', async () => {
    const treeId = await createTree('Child bad type');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);
    await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child });

    for (const relationshipType of ['Sealed', { partner1: 'Birth', partner2: 'Sealed' }, { partner1: 'Birth' }]) {
      expect((await childRequest(UPDATE_CHILD_TYPE, 'PATCH', treeId, familyId, { childId: child, relationshipType })).status).toBe(400);
    }
    expect(await childLink(familyId, child)).toEqual(both('Birth'));
  });

  // An entry written before #982 holds one RelationshipType; Undo still reads it.
  it('reverts a pre-#982 type change to both partners', async () => {
    const treeId = await createTree('Legacy child type');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);
    await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child, relationshipType: 'Foster' });
    const legacy = await insertOne(
      `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
       VALUES ($1, $1, $2, 'update', 'familychild', $3, 'legacy', $4) RETURNING "Id"`,
      [USER_ID, treeId, familyId, JSON.stringify({
        fields: { RelationshipType: { old: 'Adoption', new: 'Foster' } },
        snapshot: { FamilyId: familyId, ChildId: child, RelationshipType: 'Foster', TreeId: treeId },
      })],
    );

    expect((await revert(treeId, legacy.Id as number)).status).toBe(200);
    expect(await childLink(familyId, child)).toEqual(both('Adoption'));
  });

  // #796 (ED-8): a move is one audited step, and one revert puts the child back.
  it('moves a child to another family as one audit entry, and reverting it moves the child back', async () => {
    const treeId = await createTree('Child move');
    const parentA = await createPerson(treeId, 'ParentA');
    const parentB = await createPerson(treeId, 'ParentB');
    const child = await createPerson(treeId, 'Child');
    const fromId = await createFamily(treeId, parentA);
    const toId = await createFamily(treeId, parentB);
    await childRequest(ADD_CHILD, 'POST', treeId, fromId, { childId: child, relationshipType: 'Adoption' });

    const moveRes = await childRequest(MOVE_CHILD, 'POST', treeId, fromId, { childId: child, toFamilyId: toId });
    expect(moveRes.status).toBe(200);
    const { auditId } = await parseResponse<{ auditId: number }>(moveRes);
    expect(await childLink(fromId, child)).toBeNull();
    expect(await childLink(toId, child)).toEqual(both('Adoption'));

    const rows = await childAuditRows(treeId);
    expect(rows.map(r => r.Action)).toEqual(['create', 'update']);
    expect(rows[1]).toMatchObject({
      Id: auditId,
      EntityId: toId,
      EntityLabel: 'Child — Child Fictional · ParentB Fictional',
      Changes: { fields: { FamilyId: { old: fromId, new: toId } } },
    });

    expect((await revert(treeId, auditId)).status).toBe(200);
    expect(await childLink(toId, child)).toBeNull();
    expect(await childLink(fromId, child)).toEqual(both('Adoption'));
    expect((await childAuditRows(treeId)).at(-1)).toMatchObject({
      Action: 'update',
      EntityId: fromId,
      Changes: { fields: { FamilyId: { old: toId, new: fromId } } },
    });
  });

  it('refuses to move a child into a family it is already in, or one in another tree', async () => {
    const treeId = await createTree('Child move refusals');
    const otherTree = await createTree('Other tree');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const fromId = await createFamily(treeId, parent);
    const toId = await createFamily(treeId, parent);
    const foreignId = await createFamily(otherTree, await createPerson(otherTree, 'Foreign'));
    await childRequest(ADD_CHILD, 'POST', treeId, fromId, { childId: child });
    await childRequest(ADD_CHILD, 'POST', treeId, toId, { childId: child });

    expect((await childRequest(MOVE_CHILD, 'POST', treeId, fromId, { childId: child, toFamilyId: toId })).status).toBe(400);
    expect((await childRequest(MOVE_CHILD, 'POST', treeId, fromId, { childId: child, toFamilyId: foreignId })).status).toBe(404);
    expect((await childRequest(MOVE_CHILD, 'POST', treeId, fromId, { childId: child, toFamilyId: fromId })).status).toBe(400);
    expect(await childLink(fromId, child)).not.toBeNull();
    expect(await childLink(foreignId, child)).toBeNull();
  });

  it('returns the family-delete audit id, and reverting it brings the family back with its children', async () => {
    const treeId = await createTree('Partner removal');
    const parent = await createPerson(treeId, 'Parent');
    const child = await createPerson(treeId, 'Child');
    const familyId = await createFamily(treeId, parent);
    await childRequest(ADD_CHILD, 'POST', treeId, familyId, { childId: child });

    const deleteRes = await DELETE_FAMILY(
      createRequest(`http://localhost:3000/api/families/${familyId}?treeId=${treeId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: String(familyId) }) },
    );
    expect(deleteRes.status).toBe(200);
    const { auditId } = await parseResponse<{ auditId: number }>(deleteRes);

    expect((await revert(treeId, auditId)).status).toBe(200);
    expect((await query(`SELECT "Partner1Id" FROM "Families" WHERE "Id" = $1`, [familyId])).rows).toEqual([{ Partner1Id: parent }]);
    expect(await childLink(familyId, child)).toEqual(both('Birth'));
  });

  it('refuses to restore a child link whose child is in another tree', async () => {
    const treeA = await createTree('Link A');
    const treeB = await createTree('Link B');
    const familyId = await createFamily(treeA, await createPerson(treeA, 'Parent'));
    const foreignChild = await createPerson(treeB, 'Foreign');
    const forged = await insertOne(
      `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
       VALUES ($1, $1, $2, 'delete', 'familychild', $3, 'forged', $4) RETURNING "Id"`,
      [USER_ID, treeA, familyId, JSON.stringify({ snapshot: { FamilyId: familyId, ChildId: foreignChild, RelationshipType: 'Birth', TreeId: treeA } })],
    );

    expect((await revert(treeA, forged.Id as number)).status).toBe(500);
    expect(await childLink(familyId, foreignChild)).toBeNull();
  });

  it('fails the revert, rather than dropping it, when a name variant can\'t be restored under its Id', async () => {
    const treeA = await createTree('Id collision A');
    const treeB = await createTree('Id collision B');
    const personId = await createPerson(treeA, 'Collide');
    const taken = await insertOne(
      `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name") VALUES ($1, $2, $3, 'Alias', 'Other tree') RETURNING "Id"`,
      [USER_ID, treeB, await createPerson(treeB, 'Other')],
    );
    const snapshot = (await query(`SELECT * FROM "People" WHERE "Id" = $1`, [personId])).rows[0] as Row;
    await query(`DELETE FROM "People" WHERE "Id" = $1`, [personId]);
    const entry = await insertOne(
      `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
       VALUES ($1, $1, $2, 'delete', 'person', $3, 'collision', $4) RETURNING "Id"`,
      [USER_ID, treeA, personId, JSON.stringify({
        snapshot,
        dependents: { NameVariant: [{ Id: taken.Id, Type: 'Nickname', Name: 'Lost' }], MediaTag: [], CasePerson: [], NoteLink: [], MediaLink: [] },
      })],
    );

    expect((await revert(treeA, entry.Id as number)).status).toBe(500);
    // Rolled back as a whole: the person isn't half-restored, and the other tree's row is untouched.
    expect((await query(`SELECT 1 FROM "People" WHERE "Id" = $1`, [personId])).rows).toHaveLength(0);
    expect((await query(`SELECT "Name", "TreeId" FROM "NameVariant" WHERE "Id" = $1`, [taken.Id])).rows)
      .toEqual([{ Name: 'Other tree', TreeId: treeB }]);
  });

  it('skips restored dependents that point at another tree', async () => {
    const treeA = await createTree('Dependents A');
    const treeB = await createTree('Dependents B');
    const personId = await createPerson(treeA, 'Local');
    const foreignMedia = await insertOne(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Foreign photo') RETURNING "Id"`,
      [USER_ID, treeB],
    );
    const snapshot = (await query(`SELECT * FROM "People" WHERE "Id" = $1`, [personId])).rows[0] as Row;
    await query(`DELETE FROM "People" WHERE "Id" = $1`, [personId]);
    const forged = await insertOne(
      `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
       VALUES ($1, $1, $2, 'delete', 'person', $3, 'forged', $4) RETURNING "Id"`,
      [USER_ID, treeA, personId, JSON.stringify({
        snapshot,
        dependents: {
          NameVariant: [{ Type: 'Nickname', Name: 'Kept', TreeId: treeB, OwnerId: 999, PersonId: 1 }],
          MediaTag: [{ MediaId: foreignMedia.Id, RegionX: 0, RegionY: 0, RegionW: 1, RegionH: 1 }],
          CasePerson: [], NoteLink: [], MediaLink: [{ MediaId: foreignMedia.Id, IsPrimary: 0 }],
        },
      })],
    );

    expect((await revert(treeA, forged.Id as number)).status).toBe(200);
    // Re-pointed at the restored person and this tree, whatever the snapshot said.
    expect((await query(`SELECT "TreeId", "PersonId", "Name" FROM "NameVariant" WHERE "PersonId" = $1`, [personId])).rows)
      .toEqual([{ TreeId: treeA, PersonId: personId, Name: 'Kept' }]);
    expect((await query(`SELECT 1 FROM "MediaTag" WHERE "MediaId" = $1`, [foreignMedia.Id])).rows).toHaveLength(0);
    expect((await query(`SELECT 1 FROM "MediaLink" WHERE "MediaId" = $1`, [foreignMedia.Id])).rows).toHaveLength(0);
  });
});
