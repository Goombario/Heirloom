import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { afterEach } from 'vitest';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema } from '@/lib/db/init-schema';
import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { AccessError, NotFoundError, NotImplementedError, StorageLimitError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { truncateAllTables } from '../setup/pglite-truncate';

const mediaEnrichmentMocks = vi.hoisted(() => ({
  captureFacesForMedia: vi.fn().mockResolvedValue({ captured: 0, caption: null }),
  patchMediaTitle: vi.fn(),
}));

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));
vi.mock('@/lib/services/media-face-capture', () => ({
  captureFacesForMedia: mediaEnrichmentMocks.captureFacesForMedia,
}));
vi.mock('@/lib/db/queries/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/queries/media')>('@/lib/db/queries/media');
  return {
    ...actual,
    patchMediaTitle: async (id: number, treeId: number, title: string) => {
      mediaEnrichmentMocks.patchMediaTitle(id, treeId, title);
      return actual.patchMediaTitle(id, treeId, title);
    },
  };
});

afterEach(() => { vi.unstubAllGlobals(); });

// File-level db used by the 'MediaBlob schema' describe via direct db.query.
// It does NOT go through the connection shim, so it never touches global
// injection state.
let db: PGlite;
beforeAll(async () => {
  db = await newEmptyClusterDb();
  await initializeSchema({ query: (text, params) => db.query(text, params as unknown[]) });
});
beforeEach(async () => { await truncateAllTables(db); });
afterAll(async () => { await db.close(); });

describe('MediaBlob schema', () => {
  it('stores and reads back bytea keyed by MediaId', async () => {
    await db.query(`INSERT INTO "Media" ("Id","UserId","Title") VALUES (1, 1, 'x')`);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await db.query(`INSERT INTO "MediaBlob" ("MediaId","Data") VALUES ($1, $2)`, [1, bytes]);
    const res = await db.query<{ Data: Uint8Array }>(`SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = 1`);
    expect(Array.from(res.rows[0].Data)).toEqual([1, 2, 3, 4]);
  });

  it('cascades blob deletion when the Media row is deleted', async () => {
    await db.query(`INSERT INTO "Media" ("Id","UserId","Title") VALUES (2, 1, 'y')`);
    await db.query(`INSERT INTO "MediaBlob" ("MediaId","Data") VALUES (2, $1)`, [new Uint8Array([9])]);
    await db.query(`DELETE FROM "Media" WHERE "Id" = 2`);
    const res = await db.query(`SELECT 1 FROM "MediaBlob" WHERE "MediaId" = 2`);
    expect(res.rows).toHaveLength(0);
  });
});

describe('LocalMediaClient upload + getFile (PGlite)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(mdb); __resetLocalUserCache(); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  async function count(table: 'Media' | 'MediaBlob' | 'CaseMedia' | 'MediaLink'): Promise<number> {
    const result = await query(`SELECT count(*)::int AS n FROM "${table}"`);
    return (result.rows[0] as { n: number }).n;
  }

  async function expectZeroMediaMutation(): Promise<void> {
    expect(await count('Media')).toBe(0);
    expect(await count('MediaBlob')).toBe(0);
    expect(await count('CaseMedia')).toBe(0);
    expect(await count('MediaLink')).toBe(0);
  }

  function trackedSvg(): { file: File; arrayBuffer: ReturnType<typeof vi.spyOn> } {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });
    return { file, arrayBuffer: vi.spyOn(file, 'arrayBuffer') };
  }

  it('uploads an SVG and reads its bytes back via getFile', async () => {
    const client = new LocalDataClient();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const file = new File([svg], 'icon.svg', { type: 'image/svg+xml' });

    const media = await client.media.upload({ file, title: 'My SVG' });
    expect(media.Id).toBeGreaterThan(0);
    expect(media.Title).toBe('My SVG');

    const { bytes, contentType } = await client.media.getFile(media.Id);
    expect(contentType).toBe('image/svg+xml');
    expect(new TextDecoder().decode(bytes)).toContain('<svg');
  });

  it('stores a PDF as it came and skips face capture (#510)', async () => {
    const client = new LocalDataClient();
    const pdf = '%PDF-1.4\n%%EOF\n';
    const file = new File([pdf], 'register.pdf', { type: 'application/pdf' });
    mediaEnrichmentMocks.captureFacesForMedia.mockClear();

    const media = await client.media.upload({ file, title: 'Register' });
    expect(media).toMatchObject({ ContentType: 'application/pdf', Format: 'PDF', FileSize: pdf.length });
    expect(mediaEnrichmentMocks.captureFacesForMedia).not.toHaveBeenCalled();

    const { bytes, contentType } = await client.media.getFile(media.Id);
    expect(contentType).toBe('application/pdf');
    expect(new TextDecoder().decode(bytes)).toBe(pdf);
  });

  it('refuses a file named .pdf that is not a PDF, storing nothing', async () => {
    const client = new LocalDataClient();
    const file = new File(['<html></html>'], 'evil.pdf', { type: 'application/pdf' });

    await expect(client.media.upload({ file })).rejects.toBeInstanceOf(ValidationError);
    await expectZeroMediaMutation();
  });

  it('creates the canonical People link immediately when uploading for a person', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Linked', LastName: 'Now' });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'portrait.svg', { type: 'image/svg+xml' });

    const media = await client.media.upload({ file, personId: person.Id, isPrimary: true });

    const links = await query(
      `SELECT "OwnerTable", "OwnerId", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1`,
      [media.Id],
    );
    expect(links.rows).toEqual([{ OwnerTable: 'People', OwnerId: person.Id, IsPrimary: 1 }]);
  });

  it('stops using a photo as the portrait, keeps it linked, and undoes that (#1051)', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Greta', LastName: 'Halvorsen' });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'portrait.svg', { type: 'image/svg+xml' });
    const media = await client.media.upload({ file, personId: person.Id, isPrimary: true });
    const other = await client.media.upload({ file: new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'b.svg', { type: 'image/svg+xml' }), personId: person.Id });

    // A stale request for a photo that's no longer the portrait changes nothing.
    expect((await client.media.clearPrimary(other.Id, person.Id)).auditIds).toEqual([]);
    const { auditIds } = await client.media.clearPrimary(media.Id, person.Id);
    expect(auditIds).toHaveLength(1);
    const linked = async () => (await query(
      `SELECT "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'People'`, [media.Id],
    )).rows;
    expect(await linked()).toEqual([{ IsPrimary: 0 }]);

    await client.audit.revert(auditIds);
    expect(await linked()).toEqual([{ IsPrimary: 1 }]);
  });

  it('creates a non-primary canonical People link when uploading for a person', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Linked', LastName: 'Non-primary' });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'portrait.svg', { type: 'image/svg+xml' });

    const media = await client.media.upload({ file, personId: person.Id, isPrimary: false });

    const links = await query(
      `SELECT "OwnerTable", "OwnerId", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1`,
      [media.Id],
    );
    expect(links.rows).toEqual([{ OwnerTable: 'People', OwnerId: person.Id, IsPrimary: 0 }]);
  });

  it('deduplicates a generic People owner matching the person target', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Linked', LastName: 'Once' });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'portrait.svg', { type: 'image/svg+xml' });

    const media = await client.media.upload({
      file,
      personId: person.Id,
      ownerTable: 'People',
      ownerRecordId: person.Id,
      isPrimary: false,
    });

    const links = await query(
      `SELECT "OwnerTable", "OwnerId", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1`,
      [media.Id],
    );
    expect(links.rows).toEqual([{ OwnerTable: 'People', OwnerId: person.Id, IsPrimary: 0 }]);
  });

  it('rejects a foreign person before decoding bytes or mutating media tables', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Default', LastName: 'Tree' });
    const foreignTree = await client.trees.create('Foreign tree');
    const foreignPerson = await client.people.create({ FirstName: 'Foreign', LastName: 'Person' }, { treeId: foreignTree.Id });
    const requestedTree = (await client.trees.list()).trees.find(tree => tree.Id !== foreignTree.Id)!;
    const tracked = trackedSvg();

    await expect(client.media.upload({ file: tracked.file, personId: foreignPerson.Id }, requestedTree.Id))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it('rejects a foreign case before decoding bytes or mutating media tables', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Default', LastName: 'Tree' });
    const foreignTree = await client.trees.create('Foreign tree');
    const foreignCase = await client.cases.create({ Title: 'Foreign case' }, foreignTree.Id);
    const requestedTree = (await client.trees.list()).trees.find(tree => tree.Id !== foreignTree.Id)!;
    const tracked = trackedSvg();

    await expect(client.media.upload({ file: tracked.file, caseId: foreignCase.Id }, requestedTree.Id))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it('rejects a foreign owner before decoding bytes or mutating media tables', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Default', LastName: 'Tree' });
    const foreignTree = await client.trees.create('Foreign tree');
    const foreignPerson = await client.people.create({ FirstName: 'Foreign', LastName: 'Owner' }, { treeId: foreignTree.Id });
    const requestedTree = (await client.trees.list()).trees.find(tree => tree.Id !== foreignTree.Id)!;
    const tracked = trackedSvg();

    await expect(client.media.upload({
      file: tracked.file, ownerTable: 'People', ownerRecordId: foreignPerson.Id,
    }, requestedTree.Id)).rejects.toBeInstanceOf(NotFoundError);
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it.each([
    ['invalid owner table', { ownerTable: 'Places', ownerRecordId: 1 }, ValidationError],
    ['incomplete owner pair', { ownerTable: 'Families' }, ValidationError],
  ] as const)('rejects %s before decoding bytes or mutating media tables', async (_label, target, ErrorType) => {
    const client = new LocalDataClient();
    const tracked = trackedSvg();

    await expect(client.media.upload({ file: tracked.file, ...target } as never))
      .rejects.toBeInstanceOf(ErrorType);
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it('rejects an invalid explicit tree before decoding bytes or mutating media tables', async () => {
    const client = new LocalDataClient();
    const tracked = trackedSvg();

    await expect(client.media.upload({ file: tracked.file }, 2_147_483_647))
      .rejects.toBeInstanceOf(AccessError);
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it('rejects view permission before decoding bytes or mutating media tables', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Local', LastName: 'User' });
    const localUser = await query(`SELECT "Id" FROM "Users" WHERE "GoogleId" = 'local-web'`);
    const owner = await query(
      `INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ($1, $2, $3) RETURNING "Id"`,
      ['owner@example.test', 'Owner', 'owner-google-id'],
    );
    const tree = await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [owner.rows[0].Id, 'Shared view']);
    await query(
      `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`,
      [owner.rows[0].Id, localUser.rows[0].Id, tree.rows[0].Id],
    );
    const tracked = trackedSvg();

    await expect(client.media.upload({ file: tracked.file }, tree.rows[0].Id))
      .rejects.toBeInstanceOf(AccessError);
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it('rejects before processing when the browser estimate cannot fit the file', async () => {
    const client = new LocalDataClient();
    const tracked = trackedSvg();
    const estimate = vi.fn().mockResolvedValue({ quota: tracked.file.size - 1, usage: 0 });
    vi.stubGlobal('navigator', { storage: { estimate } });

    await expect(client.media.upload({ file: tracked.file })).rejects.toBeInstanceOf(StorageLimitError);
    expect(estimate).toHaveBeenCalledOnce();
    expect(tracked.arrayBuffer).not.toHaveBeenCalled();
    await expectZeroMediaMutation();
  });

  it('continues uploading when the browser estimate is unavailable', async () => {
    const client = new LocalDataClient();
    const tracked = trackedSvg();
    vi.stubGlobal('navigator', {});

    await expect(client.media.upload({ file: tracked.file })).resolves.toMatchObject({ Id: expect.any(Number) });
    expect(tracked.arrayBuffer).toHaveBeenCalled();
  });

  it('continues uploading when the browser estimate is rejected', async () => {
    const client = new LocalDataClient();
    const tracked = trackedSvg();
    const estimate = vi.fn().mockRejectedValue(new Error('estimate unavailable'));
    vi.stubGlobal('navigator', { storage: { estimate } });

    await expect(client.media.upload({ file: tracked.file })).resolves.toMatchObject({ Id: expect.any(Number) });
    expect(estimate).toHaveBeenCalledOnce();
    expect(tracked.arrayBuffer).toHaveBeenCalled();
  });

  it('converts a write-time browser quota exception and rolls back the upload', async () => {
    const client = new LocalDataClient();
    const tracked = trackedSvg();
    const originalQuery = mdb.query.bind(mdb);
    const quotaError = Object.assign(new Error('browser quota details'), { name: 'QuotaExceededError' });
    const querySpy = vi.spyOn(mdb, 'query').mockImplementation(async (text, params) => {
      if (typeof text === 'string' && text.includes('INSERT INTO "MediaBlob"')) throw quotaError;
      return originalQuery(text, params as unknown[]);
    });

    await expect(client.media.upload({ file: tracked.file })).rejects.toBeInstanceOf(StorageLimitError);
    await expectZeroMediaMutation();
    querySpy.mockRestore();
  });

  it('getFile is wired (not a NotImplementedError stub)', async () => {
    const client = new LocalDataClient();
    await expect(client.media.getFile(999999)).rejects.not.toBeInstanceOf(NotImplementedError);
  });

  // ── Service round-trip tests (Task 5) ────────────────────────────────────

  it('list() returns uploaded media', async () => {
    const client = new LocalDataClient();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const file = new File([svg], 'photo.svg', { type: 'image/svg+xml' });

    const uploaded = await client.media.upload({ file, title: 'Gallery Photo' });
    const { media, count } = await client.media.list();
    expect(count).toBe(1);
    expect(media[0].Id).toBe(uploaded.Id);
    expect(media[0].Title).toBe('Gallery Photo');
  });

  it('update() changes the title of an uploaded media', async () => {
    const client = new LocalDataClient();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const file = new File([svg], 'update-me.svg', { type: 'image/svg+xml' });

    const uploaded = await client.media.upload({ file, title: 'Original Title' });
    const updated = await client.media.update(uploaded.Id, { Title: 'Updated Title' });
    expect(updated.Id).toBe(uploaded.Id);
    expect(updated.Title).toBe('Updated Title');
    // The phone viewer's Edit offers Undo through these (#1121).
    expect(updated.auditIds).toHaveLength(1);
    await client.audit.revert(updated.auditIds);
    const [reverted] = (await client.media.list()).media.filter((m) => m.Id === uploaded.Id);
    expect(reverted.Title).toBe('Original Title');
  });

  it('applies a captured caption through the tree-scoped media title query', async () => {
    const client = new LocalDataClient();
    mediaEnrichmentMocks.captureFacesForMedia.mockResolvedValueOnce({ captured: 0, caption: 'Metadata caption' });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'captioned.svg', { type: 'image/svg+xml' });

    const uploaded = await client.media.upload({ file });

    expect(mediaEnrichmentMocks.patchMediaTitle)
      .toHaveBeenCalledWith(uploaded.Id, uploaded.TreeId, 'Metadata caption');
    const stored = await query(`SELECT "Title" FROM "Media" WHERE "Id" = $1`, [uploaded.Id]);
    expect(stored.rows).toEqual([{ Title: 'Metadata caption' }]);
  });

  it('tag CRUD: createTag/listTags/removeTag round-trip against a person', async () => {
    const client = new LocalDataClient();

    // Create a person to tag
    const person = await client.people.create({ FirstName: 'Jane', LastName: 'Doe' });

    // Upload a photo associated with the person
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const file = new File([svg], 'tagged.svg', { type: 'image/svg+xml' });
    const uploaded = await client.media.upload({ file, title: 'Tagged Photo', personId: person.Id });

    // Create a tag
    const tag = await client.media.createTag(uploaded.Id, {
      PersonId: person.Id,
      RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20,
    });
    expect(tag.Id).toBeGreaterThan(0);
    expect(tag.PersonId).toBe(person.Id);
    expect(tag.MediaId).toBe(uploaded.Id);

    // List tags
    const tags = await client.media.listTags(uploaded.Id);
    expect(tags).toHaveLength(1);
    expect(tags[0].PersonFirstName).toBe('Jane');
    expect(tags[0].PersonLastName).toBe('Doe');
    // Jane had no profile picture, so tagging her made this one (#922).
    expect(tags[0].IsPersonPrimary).toBe(true);

    await client.media.setPrimary(uploaded.Id, person.Id);
    const primaryTags = await client.media.listTags(uploaded.Id);
    expect(primaryTags[0].IsPersonPrimary).toBe(true);

    const updated = await client.media.updateTag(uploaded.Id, tag.Id, {
      RegionX: 12, RegionY: 13, RegionW: 24, RegionH: 25,
    });
    expect(updated).toMatchObject({
      Id: tag.Id,
      PersonId: person.Id,
      RegionX: 12,
      RegionY: 13,
      RegionW: 24,
      RegionH: 25,
      IsPersonPrimary: true,
    });

    await expect(client.media.updateTag(uploaded.Id, tag.Id, {
      RegionX: 12, RegionY: 13, RegionW: Number.NaN, RegionH: 25,
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.media.updateTag(uploaded.Id, tag.Id, {
      RegionX: Number.POSITIVE_INFINITY, RegionY: 13, RegionW: 24, RegionH: 25,
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.media.updateTag(uploaded.Id, tag.Id, {
      RegionX: 12, RegionY: Number.NEGATIVE_INFINITY, RegionW: 24, RegionH: 25,
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.media.updateTag(uploaded.Id, tag.Id, {
      RegionX: 12, RegionY: 13, RegionW: Number.POSITIVE_INFINITY, RegionH: 25,
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.media.listTags(uploaded.Id)).resolves.toEqual([
      expect.objectContaining({ RegionX: 12, RegionY: 13, RegionW: 24, RegionH: 25 }),
    ]);

    // Remove the tag
    await client.media.removeTag(uploaded.Id, tag.Id);
    const tagsAfter = await client.media.listTags(uploaded.Id);
    expect(tagsAfter).toHaveLength(0);
  });
});
