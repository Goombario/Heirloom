import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import {
  createMedia,
} from '@/lib/db/queries/media';
import { createCanonicalMedia, setPrimaryMediaForPerson } from '@/lib/services/media';
import { linkMedia, unlinkMedia, getMediaForOwner, attachMediaToEvents } from '@/lib/db/queries/media-links';
import { attachNoteCountsToEvents } from '@/lib/db/queries/notes';
import type { GedcomEvent } from '@/lib/db/schema';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Independent-media model (#86): detaching media from an owner unlinks ONLY —
 * the Media row survives in the library (a library upload attached to an event
 * must not vanish when detached). Explicit deletion is a separate action.
 */
describe('unlinkMedia — detach is unlink-only', () => {
  let db: PGlite;
  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  beforeEach(async () => {
    await query(`TRUNCATE "MediaLink", "Media", "Users" RESTART IDENTITY CASCADE`);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
  });
  afterAll(async () => { __setTestDb(null); await db.close(); });

  it('removes the link but keeps the media row (library media survives detach)', async () => {
    const media = await createMedia(
      { UserId: 1, TreeId: 1, Title: 'lib photo', FilePath: null, Format: 'jpeg', ContentType: 'image/jpeg' },
      1,
    );
    await linkMedia(media.Id, 'Events', 500);
    expect(await getMediaForOwner('Events', 500, 1)).toHaveLength(1);

    const removed = await unlinkMedia(media.Id, 'Events', 500, 1);
    expect(removed).toBe(true);
    expect(await getMediaForOwner('Events', 500, 1)).toHaveLength(0);

    const still = await query(`SELECT 1 FROM "Media" WHERE "Id" = $1`, [media.Id]);
    expect(still.rowCount).toBe(1);
  });

  it('returns false when there was no link to remove', async () => {
    const media = await createMedia(
      { UserId: 1, TreeId: 1, Title: 'x', FilePath: null, Format: 'jpeg', ContentType: 'image/jpeg' },
      1,
    );
    expect(await unlinkMedia(media.Id, 'Events', 999, 1)).toBe(false);
  });
});

describe('attachMediaToEvents', () => {
  let db: PGlite;
  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  beforeEach(async () => {
    await query(`TRUNCATE "MediaLink", "Media", "Events", "People", "Users" RESTART IDENTITY CASCADE`);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
    await query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES (10, 1, 1, 'Ada')`);
  });
  afterAll(async () => { __setTestDb(null); await db.close(); });

  async function makeEvent(type: string): Promise<GedcomEvent> {
    const r = await query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId") VALUES (1, 1, $1, 10) RETURNING *`,
      [type],
    );
    return r.rows[0] as GedcomEvent;
  }

  it('attaches Events-linked media to the right event and [] to the rest', async () => {
    const ev1 = await makeEvent('OCCU');
    const ev2 = await makeEvent('RESI');
    const media = await createMedia(
      { UserId: 1, TreeId: 1, Title: 'p', FilePath: null, Format: 'jpeg', ContentType: 'image/jpeg' },
      1,
    );
    await linkMedia(media.Id, 'Events', ev1.Id);

    const out = await attachMediaToEvents([ev1, ev2], 1);
    expect(out.find((e) => e.Id === ev1.Id)!.media).toHaveLength(1);
    expect(out.find((e) => e.Id === ev1.Id)!.media![0].Title).toBe('p');
    expect(out.find((e) => e.Id === ev2.Id)!.media).toEqual([]);
  });

  it('short-circuits on empty input', async () => {
    expect(await attachMediaToEvents([], 1)).toEqual([]);
  });
});

describe('attachNoteCountsToEvents', () => {
  let db: PGlite;
  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  beforeEach(async () => {
    await query(`TRUNCATE "NoteLink", "Note", "Events", "Users" RESTART IDENTITY CASCADE`);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
  });
  afterAll(async () => { __setTestDb(null); await db.close(); });

  async function makeEvent(treeId: number): Promise<GedcomEvent> {
    const result = await query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "FamilyId") VALUES (1, $1, 'DIV', 7) RETURNING *`,
      [treeId],
    );
    return result.rows[0] as GedcomEvent;
  }

  async function makeNote(treeId: number, text: string): Promise<number> {
    const result = await query(
      `INSERT INTO "Note" ("OwnerId", "TreeId", "Text") VALUES (1, $1, $2) RETURNING "Id"`,
      [treeId, text],
    );
    return (result.rows[0] as { Id: number }).Id;
  }

  it('attaches one tree-scoped count to each event and defaults empty rows to zero', async () => {
    const ev1 = await makeEvent(1);
    const ev2 = await makeEvent(1);
    const note = await makeNote(1, 'same-tree');
    const foreignNote = await makeNote(2, 'other-tree');
    await query(`INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId") VALUES ($1, 'Events', $2), ($3, 'Events', $2)`, [note, ev1.Id, foreignNote]);

    const output = await attachNoteCountsToEvents([ev1, ev2], 1);
    expect(output.find((event) => event.Id === ev1.Id)?.noteCount).toBe(1);
    expect(output.find((event) => event.Id === ev2.Id)?.noteCount).toBe(0);
  });

  it('short-circuits on empty input', async () => {
    expect(await attachNoteCountsToEvents([], 1)).toEqual([]);
  });
});

describe('canonical media transactions', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await query(`TRUNCATE "AuditLog", "MediaTag", "MediaLink", "Media", "People", "Trees", "Users" RESTART IDENTITY CASCADE`);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'canonical@example.test', 'canonical-g1')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Canonical')`);
    await query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES (10, 1, 1, 'Ada')`);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  const mediaData = (title: string) => ({
    UserId: 1,
    TreeId: 1,
    Title: title,
    FilePath: null,
    Format: 'jpeg',
    ContentType: 'image/jpeg',
  });

  it('uses the held executor for media, canonical links, and audit', async () => {
    const client = await (await import('@/lib/db/connection.pglite')).getClient();
    let released = false;
    try {
      await client.query('BEGIN');
      const media = await createCanonicalMedia({
        data: mediaData('executor-owned'),
        links: [{ ownerTable: 'People', ownerId: 10 }],
        actingUserId: 1,
      }, client);
      await client.query('COMMIT');
      client.release();
      released = true;

      expect((await query(
        `SELECT "OwnerId", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1`,
        [media.Id],
      )).rows).toEqual([{ OwnerId: 10, IsPrimary: 0 }]);
      expect((await query(
        `SELECT "Action", "EntityType", "EntityId" FROM "AuditLog" WHERE "EntityId" = $1`,
        [media.Id],
      )).rows).toEqual([{ Action: 'create', EntityType: 'media', EntityId: media.Id }]);
    } finally {
      if (!released) client.release();
    }
  });

  it('rolls back a media row when the second canonical creation statement fails', async () => {
    const client = await (await import('@/lib/db/connection.pglite')).getClient();
    const failingExec = {
      query: async (text: string, params?: unknown[]) => {
        if (text.includes('INSERT INTO "MediaLink"')) throw new Error('forced link failure');
        return client.query(text, params);
      },
    };
    try {
      await client.query('BEGIN');
      await expect(createCanonicalMedia({
        data: mediaData('must roll back'),
        links: [{ ownerTable: 'People', ownerId: 10 }],
        actingUserId: 1,
      }, failingExec)).rejects.toThrow('forced link failure');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect((await query(`SELECT COUNT(*)::int AS n FROM "Media"`)).rows[0].n).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "MediaLink"`)).rows[0].n).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n).toBe(0);
  });

  it('rolls back canonical state when setting the new primary fails', async () => {
    const oldMedia = await createMedia(mediaData('old'), 1);
    const nextMedia = await createMedia(mediaData('next'), 1);
    await query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
       VALUES ($1, 'People', 10, 1), ($2, 'People', 10, 0)`,
      [oldMedia.Id, nextMedia.Id],
    );
    await query(
      `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
       VALUES ($1, 10, 10, 10, 20, 20), ($2, 10, 30, 30, 20, 20)`,
      [oldMedia.Id, nextMedia.Id],
    );
    const auditBefore = (await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n;

    await query(`
      CREATE OR REPLACE FUNCTION "fail_next_media_primary"() RETURNS trigger AS $$
      BEGIN
        IF NEW."MediaId" = ${nextMedia.Id} AND NEW."IsPrimary" = 1 THEN
          RAISE EXCEPTION 'forced primary failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      CREATE TRIGGER "fail_next_media_primary_trigger"
      BEFORE UPDATE OF "IsPrimary" ON "MediaLink"
      FOR EACH ROW EXECUTE FUNCTION "fail_next_media_primary"()
    `);

    try {
      await expect(setPrimaryMediaForPerson({
        mediaId: nextMedia.Id,
        personId: 10,
        treeId: 1,
        actingUserId: 1,
      })).rejects.toThrow('forced primary failure');
    } finally {
      await query(`DROP TRIGGER IF EXISTS "fail_next_media_primary_trigger" ON "MediaLink"`);
      await query(`DROP FUNCTION IF EXISTS "fail_next_media_primary"()`);
    }

    expect((await query(
      `SELECT "MediaId", "IsPrimary" FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = 10 ORDER BY "MediaId"`,
    )).rows).toEqual([
      { MediaId: oldMedia.Id, IsPrimary: 1 },
      { MediaId: nextMedia.Id, IsPrimary: 0 },
    ]);
    expect((await query(
      `SELECT "Id", "Title" FROM "Media" WHERE "Id" = ANY($1::int[]) ORDER BY "Id"`,
      [[oldMedia.Id, nextMedia.Id]],
    )).rows).toEqual([
      { Id: oldMedia.Id, Title: 'old' },
      { Id: nextMedia.Id, Title: 'next' },
    ]);
    expect((await query(
      `SELECT "MediaId", "RegionX" FROM "MediaTag" WHERE "PersonId" = 10 ORDER BY "MediaId"`,
    )).rows).toEqual([
      { MediaId: oldMedia.Id, RegionX: 10 },
      { MediaId: nextMedia.Id, RegionX: 30 },
    ]);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n).toBe(auditBefore);
  });
});

describe('media transaction architecture', () => {
  it('keeps client ownership in the media service and query modules statement-only', async () => {
    const services = await import('@/lib/services/media');
    const mediaQueries = await import('@/lib/db/queries/media');
    const tagQueries = await import('@/lib/db/queries/media-tags');

    expect(services.setPrimaryMediaForPerson).toBeTypeOf('function');
    expect(services.clearPrimaryMediaForPerson).toBeTypeOf('function');
    expect(services.removeMediaTagCanonical).toBeTypeOf('function');
    expect(services.createCanonicalMedia).toBeTypeOf('function');
    expect(mediaQueries).not.toHaveProperty('createCanonicalMedia');
    expect(mediaQueries).not.toHaveProperty('setPrimaryMediaForPerson');
    expect(mediaQueries).not.toHaveProperty('clearPrimaryMediaForPerson');
    expect(tagQueries).not.toHaveProperty('deleteMediaTag');

    const root = process.cwd();
    const mediaQuerySource = readFileSync(path.join(root, 'lib/db/queries/media.ts'), 'utf8');
    const tagQuerySource = readFileSync(path.join(root, 'lib/db/queries/media-tags.ts'), 'utf8');
    const serviceSource = readFileSync(path.join(root, 'lib/services/media.ts'), 'utf8');
    const uploadSource = readFileSync(path.join(root, 'lib/services/media-upload.ts'), 'utf8');
    const localMediaSource = readFileSync(path.join(root, 'lib/data/local/media.ts'), 'utf8');
    expect(mediaQuerySource).not.toContain('getClient');
    expect(tagQuerySource).not.toContain('getClient');
    expect(mediaQuerySource).not.toContain("client.query('BEGIN')");
    expect(tagQuerySource).not.toContain("client.query('BEGIN')");
    expect(serviceSource).toContain("client.query('BEGIN')");
    expect(uploadSource).toContain("from '@/lib/services/media'");
    expect(localMediaSource).toContain("from '@/lib/services/media'");
    expect(uploadSource).not.toContain("setPrimaryForPerson");
  });
});
