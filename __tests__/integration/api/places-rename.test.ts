import { describe, it, expect, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { movePlaceRecordsService, renamePlaceService } from '@/lib/services/places';
import { getPlaceAncestors } from '@/lib/db/queries/places';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { ValidationError } from '@/lib/validation';
import { TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { factPlaceText, insertRecord } from '../../setup/fact-places';

const describeIf = hasTestDatabase() ? describe : describe.skip;

const owner = TEST_USER.id;

// Direct seed helpers — precise control over the fact columns and gazetteer rows.
// Multi-tree: reads are TreeId-scoped now. This file's afterEach runs
// cleanupTestData() (drops the test user's "Trees" row), so every helper
// resolves the tree id fresh on each call rather than caching it.
async function addPerson(birth: string | null, death: string | null): Promise<number> {
  const treeId = await resolveDefaultTree(owner);
  return (await insertRecord({ query }, 'People', { UserId: owner, TreeId: treeId, FirstName: 'P', LastName: 'X', BirthPlace: birth, DeathPlace: death })).Id;
}
async function addEvent(personId: number, place: string): Promise<number> {
  const treeId = await resolveDefaultTree(owner);
  return (await insertRecord({ query }, 'Events', { UserId: owner, TreeId: treeId, Type: 'RESI', Place: place, PersonId: personId })).Id;
}
async function addFamily(place: string): Promise<number> {
  const treeId = await resolveDefaultTree(owner);
  return (await insertRecord({ query }, 'Families', { UserId: owner, TreeId: treeId, MarriagePlace: place })).Id;
}
async function addGazetteer(name: string, fields: { lat?: number; form?: string; parentId?: number } = {}): Promise<number> {
  const treeId = await resolveDefaultTree(owner);
  // A fact added first already made the bare place of its name (ADR 0037): fill that one in.
  const existing = await query(
    `UPDATE "Places" SET "Latitude" = $3, "Longitude" = $3, "Form" = $4, "ParentId" = $5
      WHERE "Id" = "PlaceIdByName"($1, $2) AND "Name" = $2 RETURNING "Id"`,
    [treeId, name, fields.lat ?? null, fields.form ?? null, fields.parentId ?? null],
  );
  if (existing.rows[0]) return existing.rows[0].Id as number;
  const r = await query(
    `INSERT INTO "Places" ("UserId","TreeId","Name","Latitude","Longitude","Form","ParentId") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "Id"`,
    [owner, treeId, name, fields.lat ?? null, fields.lat ?? null, fields.form ?? null, fields.parentId ?? null],
  );
  return r.rows[0].Id as number;
}
async function parentOf(placeId: number): Promise<number | null> {
  const r = await query(`SELECT "ParentId" AS v FROM "Places" WHERE "Id" = $1`, [placeId]);
  return (r.rows[0]?.v as number | null) ?? null;
}
async function placeOf(kind: 'birth' | 'death' | 'event' | 'marriage', id: number): Promise<string | null> {
  const map = {
    birth: ['People', 'BirthPlace'],
    death: ['People', 'DeathPlace'],
    event: ['Events', 'Place'],
    marriage: ['Families', 'MarriagePlace'],
  } as const;
  const [table, field] = map[kind];
  return factPlaceText({ query }, table, id, field);
}
async function latestPlaceAudit(): Promise<{ Id: number; EntityLabel: string } | null> {
  const r = await query(
    `SELECT "Id","EntityLabel" FROM "AuditLog"
     WHERE "TreeOwnerId" = $1 AND "EntityType" = 'place'
     ORDER BY "Id" DESC LIMIT 1`,
    [owner],
  );
  return (r.rows[0] as { Id: number; EntityLabel: string } | undefined) ?? null;
}

describeIf('places rename & merge (§1.2)', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('rewrites every fact column and renames the gazetteer row', async () => {
    const person = await addPerson('Old Town', 'Old Town');
    const event = await addEvent(person, 'Old Town');
    const family = await addFamily('Old Town');
    await addGazetteer('Old Town', { lat: 55.9, form: 'City' });

    const res = await renamePlaceService({ from: 'Old Town', to: 'New Town', requestedOwnerId: null, currentUserId: owner });
    expect(res).toMatchObject({ renamed: 4, wasMerge: false, to: 'New Town' });

    expect(await placeOf('birth', person)).toBe('New Town');
    expect(await placeOf('death', person)).toBe('New Town');
    expect(await placeOf('event', event)).toBe('New Town');
    expect(await placeOf('marriage', family)).toBe('New Town');

    const gaz = await query(`SELECT "Name","Form" FROM "Places" WHERE "UserId"=$1`, [owner]);
    expect(gaz.rows).toHaveLength(1);
    expect(gaz.rows[0].Name).toBe('New Town');
    expect(gaz.rows[0].Form).toBe('City');
  });

  it('normalizes the new name like every other place write, and merges into the normalized row (#884)', async () => {
    const person = await addPerson('Old Town', null);
    await addGazetteer('José');

    // NFD, a zero-width space and outer whitespace all fold to the stored NFC spelling.
    const res = await renamePlaceService({ from: 'Old Town', to: ' Jo\u200Bse\u0301 ', requestedOwnerId: null, currentUserId: owner });
    expect(res).toMatchObject({ wasMerge: true, to: 'José' });
    expect(await placeOf('birth', person)).toBe('José');

    await expect(renamePlaceService({ from: 'José', to: '\u200B ', requestedOwnerId: null, currentUserId: owner }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(renamePlaceService({ from: 'José', to: 'x'.repeat(501), requestedOwnerId: null, currentUserId: owner }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('merge folds source into target, filling only the target null fields', async () => {
    const moved = await addPerson('Springfield', null);
    const alreadyThere = await addPerson('Springfield, IL', null);
    // Source has coords + Form; target has neither → the merge fills them.
    await addGazetteer('Springfield', { lat: 39.7, form: 'City' });
    await addGazetteer('Springfield, IL'); // all null

    const res = await renamePlaceService({ from: 'Springfield', to: 'Springfield, IL', requestedOwnerId: null, currentUserId: owner });
    expect(res.wasMerge).toBe(true);
    expect(res.renamed).toBe(1);

    // Moved record now points at the target; the pre-existing target record is unchanged.
    expect(await placeOf('birth', moved)).toBe('Springfield, IL');
    expect(await placeOf('birth', alreadyThere)).toBe('Springfield, IL');

    // Only the target gazetteer row survives, with the source's coords/form folded in.
    const gaz = await query(`SELECT "Name","Latitude","Form" FROM "Places" WHERE "UserId"=$1`, [owner]);
    expect(gaz.rows).toHaveLength(1);
    expect(gaz.rows[0].Name).toBe('Springfield, IL');
    expect(gaz.rows[0].Latitude).toBe(39.7);
    expect(gaz.rows[0].Form).toBe('City');
  });

  it('merge does NOT overwrite a target field the target already has', async () => {
    await addPerson('A', null);
    await addPerson('B', null);
    await addGazetteer('A', { lat: 20 });
    await addGazetteer('B', { lat: 10 }); // target already has coords

    await renamePlaceService({ from: 'A', to: 'B', requestedOwnerId: null, currentUserId: owner });
    const gaz = await query(`SELECT "Latitude" FROM "Places" WHERE "UserId"=$1 AND "Name"='B'`, [owner]);
    expect(gaz.rows[0].Latitude).toBe(10); // kept target's value, not A's 20
  });

  it('reverting a rename restores the fact columns and the gazetteer name', async () => {
    const person = await addPerson('Old Town', null);
    await addGazetteer('Old Town', { form: 'City' });
    const res = await renamePlaceService({ from: 'Old Town', to: 'New Town', requestedOwnerId: null, currentUserId: owner });
    expect(await placeOf('birth', person)).toBe('New Town');

    const entry = await latestPlaceAudit();
    expect(entry).not.toBeNull();
    // The phone page's Undo reverts exactly the entry the rename returned (#1118).
    expect(res.auditIds).toEqual([entry!.Id]);
    await revertAuditEntry(entry!.Id, await resolveDefaultTree(owner), owner, owner);

    expect(await placeOf('birth', person)).toBe('Old Town');
    const gaz = await query(`SELECT "Name" FROM "Places" WHERE "UserId"=$1`, [owner]);
    expect(gaz.rows.map((r) => r.Name)).toEqual(['Old Town']);
  });

  it('reverting a merge pulls back only the moved records and recreates the source', async () => {
    const moved = await addPerson('Springfield', null);
    const alreadyThere = await addPerson('Springfield, IL', null);
    await addGazetteer('Springfield', { lat: 39.7 });
    await addGazetteer('Springfield, IL');

    await renamePlaceService({ from: 'Springfield', to: 'Springfield, IL', requestedOwnerId: null, currentUserId: owner });
    const entry = await latestPlaceAudit();
    await revertAuditEntry(entry!.Id, await resolveDefaultTree(owner), owner, owner);

    // The moved record is back at the source; the originally-target record stays put.
    expect(await placeOf('birth', moved)).toBe('Springfield');
    expect(await placeOf('birth', alreadyThere)).toBe('Springfield, IL');

    // Both gazetteer rows exist again, and the filled target field was re-nulled.
    const gaz = await query(`SELECT "Name","Latitude" FROM "Places" WHERE "UserId"=$1 ORDER BY "Name"`, [owner]);
    const byName = Object.fromEntries(gaz.rows.map((r) => [r.Name, r.Latitude]));
    expect(byName['Springfield']).toBe(39.7);
    expect(byName['Springfield, IL']).toBeNull();
  });

  it('reverting a merge whose source had NO gazetteer row keeps the target row intact', async () => {
    // 'From' exists only as free text (no Places row); 'To' is a real gazetteer row.
    const a = await addPerson('From', null);
    const b = await addPerson('To', null);
    await addGazetteer('To', { lat: 40 });

    const res = await renamePlaceService({ from: 'From', to: 'To', requestedOwnerId: null, currentUserId: owner });
    expect(res.wasMerge).toBe(true);

    const entry = await latestPlaceAudit();
    await revertAuditEntry(entry!.Id, await resolveDefaultTree(owner), owner, owner);

    // Only the moved record returns to 'From'; the pre-existing 'To' row must survive
    // with its coordinates (regression: it was being renamed to 'From'). 'From' gets a
    // bare row of its own, as every place a fact names does (#1167).
    expect(await placeOf('birth', a)).toBe('From');
    expect(await placeOf('birth', b)).toBe('To');
    const gaz = await query(`SELECT "Name","Latitude" FROM "Places" WHERE "UserId"=$1 ORDER BY "Name"`, [owner]);
    expect(gaz.rows).toEqual([{ Name: 'From', Latitude: null }, { Name: 'To', Latitude: 40 }]);
  });

  it('reverting a merge preserves a later edit to a folded target field', async () => {
    await addPerson('A', null);
    await addPerson('B', null);
    await addGazetteer('A', { lat: 20 });
    await addGazetteer('B'); // null coords → merge fills them from A

    await renamePlaceService({ from: 'A', to: 'B', requestedOwnerId: null, currentUserId: owner });
    // The user re-geocodes the surviving 'B' after the merge.
    await query(`UPDATE "Places" SET "Latitude" = 99 WHERE "UserId" = $1 AND "Name" = 'B'`, [owner]);

    const entry = await latestPlaceAudit();
    await revertAuditEntry(entry!.Id, await resolveDefaultTree(owner), owner, owner);

    // The edit is preserved — revert only re-nulls a field still holding the folded value.
    const gaz = await query(`SELECT "Latitude" FROM "Places" WHERE "UserId" = $1 AND "Name" = 'B'`, [owner]);
    expect(gaz.rows[0].Latitude).toBe(99);
  });

  it('merging a child into its parent never makes the parent its own parent (no cycle)', async () => {
    // 'Town' is a child of 'County'. Merging Town → County must NOT fold Town's
    // ParentId (= County) into County, which would make County its own parent and
    // hang getPlaceAncestors's recursive CTE.
    const county = await addGazetteer('County');
    await addGazetteer('Town', { form: 'City', parentId: county });
    await addPerson('Town', null);

    await renamePlaceService({ from: 'Town', to: 'County', requestedOwnerId: null, currentUserId: owner });

    // County survived without a self-referential parent, so ancestor lookup terminates.
    expect(await parentOf(county)).toBeNull();
    await expect(getPlaceAncestors(county, owner)).resolves.toEqual([]);
  });

  it('reverting a merge succeeds even if the source name was reclaimed afterward', async () => {
    // 'A' has a child; merge A → B re-points the child to B. Then a NEW place takes
    // the 'A' name. Two places may share a name (#1186), so revert brings the merged
    // 'A' back under its own id beside the new one and re-points the child to it.
    const a = await addGazetteer('A');
    const child = await addGazetteer('A-child', { parentId: a });
    await addGazetteer('B');
    await addPerson('A', null);

    await renamePlaceService({ from: 'A', to: 'B', requestedOwnerId: null, currentUserId: owner });
    expect(await parentOf(child)).toBe((await query(`SELECT "Id" FROM "Places" WHERE "UserId"=$1 AND "Name"='B'`, [owner])).rows[0].Id);

    // Someone recreates a place named 'A' before reverting.
    const reclaimedA = await addGazetteer('A', { lat: 12 });

    const entry = await latestPlaceAudit();
    await expect(revertAuditEntry(entry!.Id, await resolveDefaultTree(owner), owner, owner)).resolves.toBeUndefined();
    expect(await parentOf(child)).toBe(a);
    const named = (await query(`SELECT "Id" FROM "Places" WHERE "UserId"=$1 AND "Name"='A' ORDER BY "Id"`, [owner])).rows.map((r) => r.Id);
    expect(named).toEqual([a, reclaimedA]);
  });

  it('reverting a merge of a place into its own child restores the child\'s parent link', async () => {
    // 'Parent' is the parent of 'Child'. Merge Parent → Child: deleting Parent nulls
    // Child.ParentId (ON DELETE SET NULL). Revert must restore Child → Parent.
    const parent = await addGazetteer('Parent');
    const child = await addGazetteer('Child', { parentId: parent });
    await addPerson('Parent', null);

    await renamePlaceService({ from: 'Parent', to: 'Child', requestedOwnerId: null, currentUserId: owner });
    expect(await parentOf(child)).toBeNull(); // Parent gone → link nulled

    const entry = await latestPlaceAudit();
    await revertAuditEntry(entry!.Id, await resolveDefaultTree(owner), owner, owner);

    const restoredParent = (await query(`SELECT "Id" FROM "Places" WHERE "UserId"=$1 AND "Name"='Parent'`, [owner])).rows[0].Id;
    expect(await parentOf(child)).toBe(restoredParent);
  });

  it('does not touch another owner\'s identically-named place', async () => {
    await addPerson('Shared', null);
    const theirs = await insertRecord({ query }, 'People', { UserId: TEST_USER_2.id, TreeId: await resolveDefaultTree(TEST_USER_2.id), FirstName: 'O', LastName: 'Y', BirthPlace: 'Shared' });
    await renamePlaceService({ from: 'Shared', to: 'Renamed', requestedOwnerId: null, currentUserId: owner });

    expect(await factPlaceText({ query }, 'People', theirs.Id, 'BirthPlace')).toBe('Shared'); // untouched
  });

  it('rejects an empty or unchanged name', async () => {
    await expect(renamePlaceService({ from: 'X', to: '', requestedOwnerId: null, currentUserId: owner }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(renamePlaceService({ from: 'X', to: 'X', requestedOwnerId: null, currentUserId: owner }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects renaming a place that does not exist', async () => {
    await expect(renamePlaceService({ from: 'Nowhere', to: 'Somewhere', requestedOwnerId: null, currentUserId: owner }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("never moves another tree's records, even when the caller names its places", async () => {
    const birth = await addPerson('Theirs', null);
    const from = await addGazetteer('Theirs');
    const to = await addGazetteer('Elsewhere');
    await query(`UPDATE "People" SET "BirthPlaceId" = $2 WHERE "Id" = $1`, [birth, from]);
    // TEST_USER_2 acts in their own tree, where neither place exists.
    await expect(movePlaceRecordsService({ fromId: from, toId: to, requestedOwnerId: null, currentUserId: TEST_USER_2.id }))
      .rejects.toThrow(/not found/i);
    expect((await query(`SELECT "BirthPlaceId" AS v FROM "People" WHERE "Id" = $1`, [birth])).rows[0].v).toBe(from);
  });
});
