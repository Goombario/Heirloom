import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { mergePeopleService, previewMergeService } from '@/lib/services/person-merge';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #28, ADR 0052: a merge moves everything onto the kept person, and its one audit
// entry reverts both people to exactly how they were.

const USER_ID = 990028;

type Row = Record<string, unknown>;

const TABLES: Record<string, string> = {
  People: '"Id"',
  Events: '"Id"',
  Citation: '"Id"',
  NameVariant: '"Id"',
  MediaTag: '"Id"',
  MediaFaceCandidate: '"Id"',
  MediaLink: '"MediaId", "OwnerTable", "OwnerId", "OwnerFact"',
  NoteLink: '"NoteId", "OwnerTable", "OwnerId", "OwnerFact"',
  CasePerson: '"CaseId", "PersonId"',
  CaseLeadPerson: '"LeadId", "PersonId"',
  CaseClaims: '"Id"',
  DataCheckConfirmations: '"Id"',
  Families: '"Id"',
  FamilyPerson: '"FamiliesAsChildId", "ChildrenId"',
};

/** Every row the merge could touch, in a stable order. */
async function dump(): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const [table, order] of Object.entries(TABLES)) {
    // As JSON, so timestamps compare to the microsecond.
    out[table] = ((await query(`SELECT to_jsonb(t) AS r FROM "${table}" t ORDER BY ${order}`)).rows as { r: Row }[]).map((x) => x.r);
  }
  return JSON.parse(JSON.stringify(out));
}

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  return (await query(sql, params)).rows[0] as T;
}

describe('Person merge (#28)', () => {
  let db: PGlite;
  let treeId: number;
  let kept: number;
  let other: number;
  let shared: { media: number; note: number; caseId: number; parents: number; sibling: number };

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, `pm-${USER_ID}@test.local`, `pm-${USER_ID}`]);
    treeId = await resolveDefaultTree(USER_ID);
    const person = async (first: string, last: string, extra: Row = {}) => {
      const cols = ['UserId', 'TreeId', 'FirstName', 'LastName', ...Object.keys(extra)];
      const vals = [USER_ID, treeId, first, last, ...Object.values(extra)];
      return (await one<{ Id: number }>(`INSERT INTO "People" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING "Id"`, vals)).Id;
    };
    kept = await person('Anna Maria', 'Lindqvist', { Sex: 'F', IsDeceased: 1, BirthDate: '12 MAR 1850', DeathDate: '4 JAN 1921' });
    other = await person('Anna', 'Lindqvist', { Sex: 'U', IsDeceased: 0, BirthDate: 'ABT 1850', DeathDate: '1921', GedcomId: '@I7@' });
    const dad = await person('Erik', 'Lindqvist');
    const mum = await person('Karin', 'Lindqvist');
    const spouse = await person('Johan', 'Berg');
    const sibling = await person('Per', 'Lindqvist');

    const source = (await one<{ Id: number }>(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Parish book') RETURNING "Id"`, [USER_ID, treeId])).Id;
    const cite = (table: string, id: number) => query(`INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId") VALUES ($1, $2, $3, $4, $5)`, [USER_ID, treeId, table, id, source]);
    for (const p of [kept, other]) {
      await cite('PersonBirth', p);
      await cite('PersonName', p);
      await cite('People', p);
    }
    await cite('PersonDeath', other);

    const event = (await one<{ Id: number }>(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "PersonId") VALUES ($1, $2, 'Residence', '1880', $3) RETURNING "Id"`, [USER_ID, treeId, other])).Id;
    await cite('Events', event);
    await query(`INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name", "IsPrimary") VALUES ($1, $2, $3, 'Nickname', 'Annie', 1), ($1, $2, $4, 'Nickname', 'Mia', 1)`, [USER_ID, treeId, kept, other]);

    const media = async () => (await one<{ Id: number }>(`INSERT INTO "Media" ("UserId", "TreeId", "Title", "FileSize") VALUES ($1, $2, 'p.jpg', 10) RETURNING "Id"`, [USER_ID, treeId])).Id;
    const photoBoth = await media();
    const photoOther = await media();
    await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, 'People', $2, 1), ($1, 'People', $3, 0), ($4, 'People', $3, 1)`, [photoBoth, kept, other, photoOther]);
    await query(`INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, $2, 0.1, 0.1, 0.2, 0.2), ($1, $3, 0.5, 0.5, 0.2, 0.2), ($4, $3, 0.3, 0.3, 0.2, 0.2)`, [photoBoth, kept, other, photoOther]);

    const note = (await one<{ Id: number }>(`INSERT INTO "Note" ("OwnerId", "TreeId", "Text") VALUES ($1, $2, 'Moved to Stockholm') RETURNING "Id"`, [USER_ID, treeId])).Id;
    await query(`INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, 'People', $2, 1)`, [note, other]);

    const caseId = (await one<{ Id: number }>(`INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Which Anna?') RETURNING "Id"`, [USER_ID, treeId])).Id;
    await query(`INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ($1, $2), ($1, $3)`, [caseId, kept, other]);

    // Both are children of Erik and Karin; the other is married to Johan.
    const parents = (await one<{ Id: number }>(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES ($1, $2, $3, $4) RETURNING "Id"`, [USER_ID, treeId, dad, mum])).Id;
    await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2), ($1, $3), ($1, $4)`, [parents, kept, other, sibling]);
    await query(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id", "HusbandId", "WifeId") VALUES ($1, $2, $3, $4, $3, $4)`, [USER_ID, treeId, spouse, other]);

    shared = { media: photoBoth, note, caseId, parents, sibling };
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  const merge = (take: Record<string, string> = {}) => mergePeopleService({ keptId: kept, otherId: other, take, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

  it('previews both people and what differs', async () => {
    const preview = await previewMergeService({ aId: kept, bId: other, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });
    expect(preview.differing).toEqual(['name', 'sex', 'living', 'birth', 'death']);
    expect(preview.blocked).toBeNull();
    expect(preview.b.Imported).toBe(true);
    expect(preview.b.Counts).toMatchObject({ events: 1, photos: 2, notes: 1, cases: 1, familyLinks: 2 });
  });

  it('moves everything onto the kept person and removes the other', async () => {
    const result = await merge({ death: 'other' });
    expect(result.auditIds).toHaveLength(1);

    expect(await one(`SELECT COUNT(*)::int AS n FROM "People" WHERE "Id" = $1`, [other])).toEqual({ n: 0 });
    const k = await one(`SELECT "FirstName", "Sex", "IsDeceased", "BirthDate", "DeathDate" FROM "People" WHERE "Id" = $1`, [kept]);
    expect(k).toEqual({ FirstName: 'Anna Maria', Sex: 'F', IsDeceased: 1, BirthDate: '12 MAR 1850', DeathDate: '1921' });

    // The other name is an Alias, with its name citation; birth sources are combined.
    const alias = await one<{ Id: number }>(`SELECT "Id" FROM "NameVariant" WHERE "PersonId" = $1 AND "Type" = 'Alias' AND "Name" = 'Anna Lindqvist'`, [kept]);
    expect(alias).toBeDefined();
    expect(await one(`SELECT COUNT(*)::int AS n FROM "Citation" WHERE "FactTable" = 'NameVariant' AND "FactId" = $1`, [alias.Id])).toEqual({ n: 1 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM "Citation" WHERE "FactTable" = 'PersonBirth' AND "FactId" = $1`, [kept])).toEqual({ n: 2 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM "Citation" WHERE "FactId" = $1 AND "FactTable" <> 'Events'`, [other])).toEqual({ n: 0 });

    // One preferred name, one primary photo; the shared photo, tag, case and child link collapse.
    expect((await query(`SELECT "Name" FROM "NameVariant" WHERE "PersonId" = $1 AND "IsPrimary" = 1`, [kept])).rows).toEqual([{ Name: 'Annie' }]);
    expect((await query(`SELECT "MediaId", "IsPrimary" FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 ORDER BY "MediaId"`, [kept])).rows)
      .toEqual([{ MediaId: shared.media, IsPrimary: 1 }, { MediaId: shared.media + 1, IsPrimary: 0 }]);
    expect(await one(`SELECT COUNT(*)::int AS n FROM "MediaTag" WHERE "PersonId" = $1`, [kept])).toEqual({ n: 2 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM "CasePerson" WHERE "CaseId" = $1`, [shared.caseId])).toEqual({ n: 1 });
    expect((await query(`SELECT "ChildrenId" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 ORDER BY "ChildrenId"`, [shared.parents])).rows)
      .toEqual([{ ChildrenId: kept }, { ChildrenId: shared.sibling }]);
    expect(await one(`SELECT COUNT(*)::int AS n FROM "Families" WHERE $1 IN ("Partner2Id", "WifeId")`, [kept])).toEqual({ n: 1 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM "NoteLink" WHERE "OwnerId" = $1 AND "IsPrimary" = 1`, [kept])).toEqual({ n: 1 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM "Events" WHERE "PersonId" = $1`, [kept])).toEqual({ n: 1 });

    const entry = await one<{ EntityType: string; EntityId: number; Changes: { summary: { kind: string }; merge: Record<string, unknown> } }>(`SELECT * FROM "AuditLog" WHERE "Id" = $1`, [result.auditIds[0]]);
    expect(entry.EntityType).toBe('person');
    expect(entry.EntityId).toBe(kept);
    expect(entry.Changes.summary.kind).toBe('person_merge');
    expect(entry.Changes.merge).toMatchObject({
      alternateName: 'Anna Lindqvist',
      moved: { events: 1, photos: 1, faceTags: 1, notes: 1, families: 1 },
      combined: { childLinks: 1, photos: 1, faceTags: 1, cases: 1 },
    });
  });

  it('reverts to exactly the rows before the merge', async () => {
    const before = await dump();
    const result = await merge({ name: 'other', sex: 'other', birth: 'other' });
    expect(await dump()).not.toEqual(before);
    await revertAuditEntry(result.auditIds[0], treeId, USER_ID, USER_ID);
    expect(await dump()).toEqual(before);
    // A second revert is refused, and the trail marker isn't revertible.
    await expect(revertAuditEntry(result.auditIds[0], treeId, USER_ID, USER_ID)).rejects.toThrow(/already reverted/);
    const trail = await one<{ Id: number }>(`SELECT "Id" FROM "AuditLog" ORDER BY "Id" DESC LIMIT 1`);
    await expect(revertAuditEntry(trail.Id, treeId, USER_ID, USER_ID)).rejects.toThrow();
  });

  it('undoes later changes to the kept person as part of the revert', async () => {
    const before = await dump();
    const result = await merge();
    const { updatePersonService } = await import('@/lib/services/people');
    await updatePersonService({ id: kept, body: { DeathCause: 'Fever' }, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });
    await revertAuditEntry(result.auditIds[0], treeId, USER_ID, USER_ID);
    expect(await dump()).toEqual(before);
  });

  it('refuses two partners of the same family', async () => {
    await query(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES ($1, $2, $3, $4)`, [USER_ID, treeId, kept, other]);
    const preview = await previewMergeService({ aId: kept, bId: other, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });
    expect(preview.blocked?.reason).toBe('partners');
    await expect(merge()).rejects.toThrow(/can't be merged/);
  });

  it('refuses a person and their own parent', async () => {
    const fam = (await one<{ Id: number }>(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id") VALUES ($1, $2, $3) RETURNING "Id"`, [USER_ID, treeId, kept])).Id;
    await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2)`, [fam, other]);
    await expect(merge()).rejects.toThrow(/can't be merged/);
  });
});
