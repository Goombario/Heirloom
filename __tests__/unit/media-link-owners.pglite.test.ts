import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { getMediaLinkOwners, linkMedia } from '@/lib/db/queries/media-links';
import { getAllMediaWithPerson } from '@/lib/db/queries/media';
import { linkMediaForOwnerService, listLinkOwnersForMediaService, unlinkMediaForOwnerService } from '@/lib/services/media-links';
import { getCitedByForSource } from '@/lib/db/queries/citations';
import { NotFoundError } from '@/lib/data/errors';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** What a document is linked to, for the viewer's "Linked to" and the grid caption (#510). */
describe('media link owners', () => {
  let db: PGlite;
  let sourceId: number;
  let eventId: number;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await query('TRUNCATE "Citation", "MediaTag", "MediaLink", "Media", "Events", "Sources", "FamilyPerson", "Families", "People", "Trees", "Users" RESTART IDENTITY CASCADE');
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'doc@example.test', 'doc-g1')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Doc tree'), (2, 1, 'Other tree')`);
    await query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName", "LastName", "BirthDate") VALUES
      (10, 1, 1, 'Ann', 'Arbor', '12 MAR 1889'), (11, 1, 1, 'Bob', 'Arbor', NULL), (20, 1, 2, 'Zed', 'Other', NULL)`);
    await query(`INSERT INTO "Families" ("Id", "UserId", "TreeId", "Partner1Id", "Partner2Id", "MarriageDate") VALUES (100, 1, 1, 10, 11, '1910')`);
    sourceId = ((await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('Parish register', 1) RETURNING "Id"`)).rows[0] as { Id: number }).Id;
    eventId = ((await query(`INSERT INTO "Events" ("Type", "PersonId", "TreeId", "Date") VALUES ('GRAD', 11, 1, '1905') RETURNING "Id"`)).rows[0] as { Id: number }).Id;
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  async function pdf(treeId = 1): Promise<number> {
    const result = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "ContentType") VALUES (1, $1, 'Birth register', 'register.pdf', 'application/pdf') RETURNING "Id"`,
      [treeId],
    );
    return (result.rows[0] as { Id: number }).Id;
  }

  it('names every record a document is linked to, people first, with the fact and its date', async () => {
    const doc = await pdf();
    await linkMedia(doc, 'Sources', sourceId);
    await linkMedia(doc, 'People', 10, 'Birth');
    await linkMedia(doc, 'Families', 100, 'Marriage');
    await linkMedia(doc, 'Events', eventId);
    await linkMedia(doc, 'People', 11);

    const owners = await getMediaLinkOwners(doc, 1);
    expect(owners.map((o) => [o.OwnerTable, o.OwnerId, o.OwnerFact, o.PersonId, o.FirstName, o.FactDate])).toEqual([
      ['People', 10, 'Birth', 10, 'Ann', '12 MAR 1889'],
      ['People', 11, null, 11, 'Bob', null],
      ['Families', 100, 'Marriage', 10, 'Ann', '1910'],
      ['Events', eventId, null, 11, 'Bob', '1905'],
      ['Sources', sourceId, null, null, null, null],
    ]);
    expect(owners[2]).toMatchObject({ Partner2FirstName: 'Bob', Partner2LastName: 'Arbor' });
    expect(owners[3].EventType).toBe('GRAD');
    expect(owners[4].SourceTitle).toBe('Parish register');
  });

  it('links a file to one citation, names it by its source and page, and shows it on the citation row (#47)', async () => {
    const doc = await pdf();
    const citationId = ((await query(
      `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page") VALUES (1, 1, 'PersonBirth', 10, $1, 'p. 4') RETURNING "Id"`,
      [sourceId],
    )).rows[0] as { Id: number }).Id;
    await linkMediaForOwnerService({ mediaId: doc, ownerTable: 'Citation', ownerId: citationId, requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1 });

    const owners = await getMediaLinkOwners(doc, 1);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ OwnerTable: 'Citation', OwnerId: citationId, SourceTitle: 'Parish register', CitationSourceId: sourceId, CitationPage: 'p. 4', PersonId: null });
    const [row] = await getCitedByForSource(sourceId, 1);
    expect(row).toMatchObject({ citationId, fileMediaId: doc, fileTitle: 'Birth register', fileContentType: 'application/pdf' });

    await unlinkMediaForOwnerService({ mediaId: doc, ownerTable: 'Citation', ownerId: citationId, requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1 });
    expect(await getMediaLinkOwners(doc, 1)).toEqual([]);
    expect((await getCitedByForSource(sourceId, 1))[0].fileMediaId).toBeNull();
  });

  it('refuses to link a file to a citation in another tree (#47)', async () => {
    const doc = await pdf();
    const otherSource = ((await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('Elsewhere', 2) RETURNING "Id"`)).rows[0] as { Id: number }).Id;
    const otherCitation = ((await query(
      `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId") VALUES (1, 2, 'People', 20, $1) RETURNING "Id"`,
      [otherSource],
    )).rows[0] as { Id: number }).Id;
    await expect(linkMediaForOwnerService({ mediaId: doc, ownerTable: 'Citation', ownerId: otherCitation, requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1 }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect((await query('SELECT 1 FROM "MediaLink"')).rows).toEqual([]);
  });

  it('leaves out a link to a record in another tree', async () => {
    const doc = await pdf();
    await linkMedia(doc, 'People', 20);
    expect(await getMediaLinkOwners(doc, 1)).toEqual([]);
    expect(await getMediaLinkOwners(doc, 2)).toEqual([]);
  });

  it('counts the people and links a library tile captions', async () => {
    const linked = await pdf();
    const sourceOnly = await pdf();
    const loose = await pdf();
    await linkMedia(linked, 'People', 10);
    await linkMedia(linked, 'People', 10, 'Birth');
    await linkMedia(linked, 'People', 11);
    await linkMedia(sourceOnly, 'Sources', sourceId);

    const rows = new Map((await getAllMediaWithPerson(1)).map((m) => [m.Id, m]));
    expect(rows.get(linked)).toMatchObject({ LinkedPersonCount: 2, LinkCount: 3 });
    expect([...(rows.get(linked)?.LinkedPersonNames ?? [])].sort()).toEqual(['Ann Arbor', 'Bob Arbor']);
    expect(rows.get(sourceOnly)).toMatchObject({ LinkedPersonCount: 0, LinkCount: 1, LinkedPersonNames: [] });
    expect(rows.get(loose)).toMatchObject({ LinkedPersonCount: 0, LinkCount: 0 });
  });

  it('refuses a media row the tree does not hold', async () => {
    const foreign = await pdf(2);
    await expect(listLinkOwnersForMediaService({
      mediaId: foreign, requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1,
    })).rejects.toBeInstanceOf(NotFoundError);
  });
});
