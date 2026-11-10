import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { truncateAllTables } from '../setup/pglite-truncate';
import { buildJpegWithXmp, mwgPacket } from '../fixtures/xmp/build-fixture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// The desktop/static upload re-encodes through createImageBitmap + canvas, which
// no Node test environment provides. Stub JUST that step so the REST of the wire
// — upload -> captureFacesForMedia -> MediaFaceCandidate — runs for real. Capture
// is fed the ORIGINAL bytes anyway, which is the property under test.
vi.mock('@/lib/media/process-image', () => ({
  processForUpload: async (file: File) => ({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: 'image/jpeg', format: 'JPG', width: 100, height: 100,
  }),
  downscaleToThumb: async () => null,   // no thumb: not what this test is about
}));

/** A JPEG naming one face, as digiKam would write it. */
function facePhoto(name: string): File {
  const bytes = buildJpegWithXmp(mwgPacket([{ name, x: 0.35, y: 0.24, w: 0.05, h: 0.1 }]));
  return new File([bytes as BlobPart], 'reunion.jpg', { type: 'image/jpeg' });
}

describe('static/desktop upload stages face candidates (#487)', () => {
  let db: PGlite;
  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(db); __resetLocalUserCache(); });
  afterAll(async () => { __setTestDb(null); await db.close(); });

  it('an upload — not a direct captureFacesForMedia call — writes the candidate row', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });

    const media = await client.media.upload({ file: facePhoto('Ada Whitcombe'), title: 'Reunion' });

    const rows = await query(
      `SELECT "MediaId", "TreeId", "SourceName", "MatchKind", "SuggestedPersonId", "Status", "RegionX"
         FROM "MediaFaceCandidate"`);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as {
      MediaId: number; TreeId: number; SourceName: string; MatchKind: string;
      SuggestedPersonId: number; Status: string; RegionX: number;
    };
    expect(row.MediaId).toBe(media.Id);
    expect(row.TreeId).toBe(media.TreeId);
    expect(row.SourceName).toBe('Ada Whitcombe');
    expect(row.MatchKind).toBe('exact');
    expect(row.SuggestedPersonId).toBe(person.Id);
    expect(row.Status).toBe('pending');
    expect(row.RegionX).toBeCloseTo(32.5, 1);   // centre-relative -> top-left %

    // And the queue the Faces page reads sees it.
    const { groups, pendingTotal } = await client.media.listFaceQueue();
    expect(pendingTotal).toBe(1);
    expect(groups[0].sourceName).toBe('Ada Whitcombe');
    expect(groups[0].suggestedPerson).toMatchObject({ id: person.Id, name: 'Ada Whitcombe', mediaId: null });
  });

  it("stores the photo's own taken date on upload, and none when it has no date (#802)", async () => {
    const client = new LocalDataClient();
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:DateCreated="1921-05-14"/></rdf:RDF></x:xmpmeta>`;
    const dated = new File([buildJpegWithXmp(xmp) as BlobPart], 'wedding.jpg', { type: 'image/jpeg' });
    const media = await client.media.upload({ file: dated });
    expect(media.Date).toBe('1921-05-14');
    const stored = await query(`SELECT "Date" FROM "Media" WHERE "Id" = $1`, [media.Id]);
    expect((stored.rows[0] as { Date: string | null }).Date).toBe('1921-05-14');

    const plain = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'plain.jpg', { type: 'image/jpeg' });
    expect((await client.media.upload({ file: plain })).Date ?? null).toBeNull();
  });

  it('an upload with no face metadata stages nothing', async () => {
    const client = new LocalDataClient();
    const plain = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'plain.jpg', { type: 'image/jpeg' });
    await client.media.upload({ file: plain, title: 'Plain' });
    const rows = await query(`SELECT 1 FROM "MediaFaceCandidate"`);
    expect(rows.rows).toHaveLength(0);
  });

  it('returns the same normalized confirmation result contract locally', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    await client.media.upload({ file: facePhoto('Ada Whitcombe'), title: 'Reunion' });
    const candidates = await query(`SELECT "Id" FROM "MediaFaceCandidate"`);
    const id = (candidates.rows[0] as { Id: number }).Id;

    const result = await client.media.confirmFaces([id, id, 2_000_000_000], person.Id);

    expect(result).toMatchObject({
      requestedCount: 2,
      confirmedCount: 1,
      skippedCount: 1,
      failedCount: 0,
      results: [
        { candidateId: id, status: 'confirmed' },
        { candidateId: 2_000_000_000, status: 'skipped', code: 'not_found_or_inaccessible' },
      ],
    });

    await expect(client.media.listFaceQueue({ countOnly: true }))
      .resolves.toEqual({ groups: [], pendingTotal: 0, resolvedTotal: 0 });
    await expect(client.media.listFaceQueue({ countOnly: true, resolved: true }))
      .resolves.toEqual({ groups: [], pendingTotal: 0, resolvedTotal: 1 });
  });
});
