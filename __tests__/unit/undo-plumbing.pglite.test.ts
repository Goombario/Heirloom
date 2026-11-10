import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

// Every person-page write returns the audit ids it created, and reverting them
// restores the rows (#1044, notes #1045). Runs through the local data client, which calls the
// same services the HTTP routes do.
vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { getPrimaryMediaLinkForPerson } from '@/lib/db/queries/media-links';
import { truncateAllTables } from '../setup/pglite-truncate';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';

let db: PGlite;
let client: LocalDataClient;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
});

beforeEach(async () => {
  await truncateAllTables(db);
  __resetLocalUserCache();
  client = new LocalDataClient();
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

// A fact's place text is built from its references (ADR 0037).
const PLACE_RECORDS = { People: 'people', Families: 'families', Events: 'events' } as const;

async function row(table: string, id: number): Promise<Record<string, unknown> | undefined> {
  const records = PLACE_RECORDS[table as keyof typeof PLACE_RECORDS];
  const places = records ? `, ${factPlaceTextColumns(records, 'r')}` : '';
  const result = await query(`SELECT r.*${places} FROM "${table}" r WHERE r."Id" = $1`, [id]);
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function undo(auditIds: number[]): Promise<void> {
  expect(auditIds.length).toBeGreaterThan(0);
  await client.audit.revert(auditIds);
}

async function person(first = 'Ada', last = 'Vale') {
  return client.people.create({ FirstName: first, LastName: last });
}

describe('Undo plumbing (#1044)', () => {
  describe('events', () => {
    it('reverts a create, an update and a delete', async () => {
      const p = await person();
      const created = await client.events.create({ Type: 'OCCU', PersonId: p.Id, Description: 'Miller' });
      expect(created.auditIds).toHaveLength(1);

      const updated = await client.events.update(created.Id, { Description: 'Baker' });
      await undo(updated.auditIds);
      expect((await row('Events', created.Id))?.Description).toBe('Miller');

      const removed = await client.events.remove(created.Id);
      expect(await row('Events', created.Id)).toBeUndefined();
      await undo(removed.auditIds);
      expect((await row('Events', created.Id))?.Description).toBe('Miller');

      await undo(created.auditIds);
      expect(await row('Events', created.Id)).toBeUndefined();
    });

    it('returns no ids for an update that changes nothing', async () => {
      const p = await person();
      const created = await client.events.create({ Type: 'OCCU', PersonId: p.Id, Description: 'Miller' });
      const same = await client.events.update(created.Id, { Description: 'Miller' });
      expect(same.auditIds).toEqual([]);
    });
  });

  describe('people', () => {
    it('reverts a create', async () => {
      const p = await person();
      expect(p.auditIds).toHaveLength(1);
      await undo(p.auditIds);
      expect(await row('People', p.Id)).toBeUndefined();
    });

    it('reverts birth, death and living status edits', async () => {
      const p = await person();
      const died = await client.people.update(p.Id, { DeathDate: '1901', DeathPlace: 'Duluth', IsDeceased: 1 });
      await undo(died.auditIds);
      const after = await row('People', p.Id);
      expect(after?.DeathDate).toBeNull();
      expect(after?.DeathPlace).toBeNull();
      expect(after?.IsDeceased).not.toBe(1);
    });

    it('reverts a compound change: delete the death and mark living', async () => {
      const p = await person();
      await client.people.update(p.Id, { DeathDate: '1901', IsDeceased: 1 });
      const cleared = await client.people.update(p.Id, { DeathDate: null });
      const living = await client.people.update(p.Id, { IsDeceased: 0 });
      await undo([...cleared.auditIds, ...living.auditIds]);
      const after = await row('People', p.Id);
      expect(after?.DeathDate).toBe('1901');
      expect(after?.IsDeceased).toBe(1);
    });
  });

  describe('name variants', () => {
    it('reverts a create, an update and a delete', async () => {
      const p = await person();
      const v = await client.people.createNameVariant(p.Id, { Type: 'Maiden', Name: 'Hollis' });
      const renamed = await client.people.updateNameVariant(p.Id, v.Id, 'Hollins');
      await undo(renamed.auditIds);
      expect((await row('NameVariant', v.Id))?.Name).toBe('Hollis');

      const removed = await client.people.removeNameVariant(p.Id, v.Id);
      await undo(removed.auditIds);
      expect((await row('NameVariant', v.Id))?.Name).toBe('Hollis');

      await undo(v.auditIds);
      expect(await row('NameVariant', v.Id)).toBeUndefined();
    });

    it('reverts a primary switch as one change', async () => {
      const p = await person();
      const first = await client.people.createNameVariant(p.Id, { Type: 'Nickname', Name: 'Addie' });
      const second = await client.people.createNameVariant(p.Id, { Type: 'Nickname', Name: 'Dot' });
      expect((await row('NameVariant', first.Id))?.IsPrimary).toBe(1);

      const switched = await client.people.setPrimaryNameVariant(p.Id, second.Id, true);
      expect(switched.auditIds).toHaveLength(2);
      await undo(switched.auditIds);
      expect((await row('NameVariant', first.Id))?.IsPrimary).toBe(1);
      expect((await row('NameVariant', second.Id))?.IsPrimary).toBe(0);
    });
  });

  describe('citations', () => {
    it('reverts a create, an update and a delete', async () => {
      const p = await person();
      const source = await client.sources.create({ Title: '1900 census' });
      const c = await client.citations.create({ FactTable: 'PersonBirth', FactId: p.Id, SourceId: source.Id, Page: 'p. 4' });
      const edited = await client.citations.update(c.Id, { Page: 'p. 5' });
      await undo(edited.auditIds);
      expect((await row('Citation', c.Id))?.Page).toBe('p. 4');

      const removed = await client.citations.remove(c.Id);
      await undo(removed.auditIds);
      expect((await row('Citation', c.Id))?.Page).toBe('p. 4');

      await undo(c.auditIds);
      expect(await row('Citation', c.Id)).toBeUndefined();
    });
  });

  describe('portrait', () => {
    async function photo(personId: number): Promise<number> {
      const owner = await row('People', personId);
      const result = await query(
        `INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Portrait') RETURNING "Id"`,
        [owner?.UserId, owner?.TreeId],
      );
      return (result.rows[0] as { Id: number }).Id;
    }

    it('reverts choosing a profile picture', async () => {
      const p = await person();
      const treeId = (await row('People', p.Id))?.TreeId as number;
      const mediaId = await photo(p.Id);
      const chosen = await client.media.setPrimary(mediaId, p.Id);
      expect(await getPrimaryMediaLinkForPerson(p.Id, treeId)).toBe(mediaId);
      await undo(chosen.auditIds);
      expect(await getPrimaryMediaLinkForPerson(p.Id, treeId)).toBeNull();
    });

    it('reverts a crop of the person’s own tag region', async () => {
      const p = await person();
      const mediaId = await photo(p.Id);
      const tag = await client.media.createTag(mediaId, { PersonId: p.Id, RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 });
      const cropped = await client.media.updateTag(mediaId, tag.Id, { RegionX: 30, RegionY: 30, RegionW: 40, RegionH: 40 });
      await undo(cropped.auditIds);
      const after = await row('MediaTag', tag.Id);
      expect(Number(after?.RegionX)).toBe(10);
      expect(Number(after?.RegionW)).toBe(20);
    });
  });

  describe('notes (#1045)', () => {
    it('reverts a create, and stamps UpdatedAt on the new note', async () => {
      const p = await person();
      const note = await client.notes.create('People', p.Id, 'Kept bees');
      expect(note.auditIds).toHaveLength(1);
      expect((await row('Note', note.Id))?.UpdatedAt).not.toBeNull();
      await undo(note.auditIds);
      expect(await row('Note', note.Id)).toBeUndefined();
    });

    it('reverts a text edit, which moves UpdatedAt; saving the same text does neither', async () => {
      const p = await person();
      const note = await client.notes.create('People', p.Id, 'Kept bees');
      await query(`UPDATE "Note" SET "UpdatedAt" = '2001-01-01' WHERE "Id" = $1`, [note.Id]);

      const same = await client.notes.update(note.Id, 'People', p.Id, 'Kept bees');
      expect(same.auditIds).toEqual([]);
      expect(new Date((await row('Note', note.Id))?.UpdatedAt as string).getUTCFullYear()).toBe(2001);

      const edited = await client.notes.update(note.Id, 'People', p.Id, 'Kept bees and goats');
      expect(new Date((await row('Note', note.Id))?.UpdatedAt as string).getUTCFullYear()).toBeGreaterThan(2001);
      await undo(edited.auditIds);
      expect((await row('Note', note.Id))?.Text).toBe('Kept bees');
    });

    it('reverts a delete, restoring the same note as the preferred one', async () => {
      const p = await person();
      const note = await client.notes.create('People', p.Id, 'Biography');
      await client.notes.setPrimary(note.Id, 'People', p.Id, true);
      const created = (await row('Note', note.Id))?.CreatedAt;

      const removed = await client.notes.remove(note.Id, 'People', p.Id);
      expect(await row('Note', note.Id)).toBeUndefined();
      await undo(removed.auditIds);

      const [restored] = await client.notes.listForOwner('People', p.Id);
      expect(restored).toMatchObject({ Id: note.Id, Text: 'Biography', IsPrimary: 1, AddedInApp: 1 });
      expect((await row('Note', note.Id))?.CreatedAt).toEqual(created);
    });

    it('reverts unlinking a shared note without touching its other record', async () => {
      const p = await person();
      const other = await person('Olav', 'Vale');
      const note = await client.notes.create('People', p.Id, 'Shared');
      await query(`INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId") VALUES ($1, 'People', $2)`, [note.Id, other.Id]);

      const removed = await client.notes.remove(note.Id, 'People', p.Id);
      expect(await row('Note', note.Id)).toBeDefined();
      await undo(removed.auditIds);
      expect((await client.notes.listForOwner('People', p.Id)).map((n) => n.Id)).toEqual([note.Id]);
      expect((await client.notes.listForOwner('People', other.Id)).map((n) => n.Id)).toEqual([note.Id]);
    });

    it('reverts a preferred-note switch as one change', async () => {
      const p = await person();
      const first = await client.notes.create('People', p.Id, 'First');
      const second = await client.notes.create('People', p.Id, 'Second');
      await client.notes.setPrimary(first.Id, 'People', p.Id, true);

      const switched = await client.notes.setPrimary(second.Id, 'People', p.Id, true);
      expect(switched.auditIds).toHaveLength(2);
      await undo(switched.auditIds);
      const notes = await client.notes.listForOwner('People', p.Id);
      expect(notes.find((n) => n.Id === first.Id)?.IsPrimary).toBe(1);
      expect(notes.find((n) => n.Id === second.Id)?.IsPrimary).toBe(0);

      const again = await client.notes.setPrimary(first.Id, 'People', p.Id, true);
      expect(again.auditIds).toEqual([]);
    });

    it('logs note changes under the note entity type with the person named', async () => {
      const p = await person();
      await client.notes.create('People', p.Id, 'Kept bees');
      const log = await query(`SELECT "EntityType", "EntityLabel" FROM "AuditLog" WHERE "EntityType" = 'note'`);
      expect(log.rows).toEqual([{ EntityType: 'note', EntityLabel: 'Note — Ada Vale' }]);
    });
  });

  describe('family links', () => {
    it('reverts creating a person and linking them as a child, together', async () => {
      const parent = await person('Olav', 'Vale');
      const family = await client.families.create({ Partner1Id: parent.Id });
      const child = await person('Greta', 'Vale');
      const linked = await client.families.addChild(family.Id, child.Id, 'Birth');
      expect(linked.auditIds).toHaveLength(1);

      await undo([...child.auditIds, ...linked.auditIds]);
      expect(await row('People', child.Id)).toBeUndefined();
      const links = await query(`SELECT 1 FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1`, [family.Id]);
      expect(links.rows).toHaveLength(0);
    });

    it('reverts a child relationship change and a partner change', async () => {
      const parent = await person('Olav', 'Vale');
      const family = await client.families.create({ Partner1Id: parent.Id });
      const child = await person('Greta', 'Vale');
      await client.families.addChild(family.Id, child.Id, 'Birth');

      const adopted = await client.families.updateChildType(family.Id, child.Id, 'Adoption');
      await undo(adopted.auditIds);
      const link = await query(
        `SELECT "Partner1Relationship", "Partner2Relationship" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
        [family.Id, child.Id],
      );
      expect(link.rows[0]).toEqual({ Partner1Relationship: 'Birth', Partner2Relationship: 'Birth' });

      const partner = await person('Sigrid', 'Moe');
      const joined = await client.families.update(family.Id, { Partner1Id: parent.Id, Partner2Id: partner.Id });
      await undo(joined.auditIds);
      expect((await row('Families', family.Id))?.Partner2Id).toBeNull();

      await undo(family.auditIds);
      expect(await row('Families', family.Id)).toBeUndefined();
    });
  });
});
