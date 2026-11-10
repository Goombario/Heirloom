import { describe, it, expect, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomFillSync } from 'node:crypto';
import {
  __setTestDb,
  datadirToMetadataGz,
  dumpDatabaseLogical,
  getDatabaseTotals,
  inspectBackupLogical,
  logicalBackupFromSnapshot,
  logicalToDatadir,
} from '@/lib/db/connection.pglite';
import { decodeContainer, encodeContainer, verifyContainer } from '@/lib/db/backup-container';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

function rnd(n: number) {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i += 65536) randomFillSync(b, i, Math.min(65536, n - i));
  return new Uint8Array(b);
}

async function seed(db: PGlite) {
  await db.exec(`
    CREATE TABLE "_SchemaMeta" ("Version" INTEGER NOT NULL);
    INSERT INTO "_SchemaMeta" ("Version") VALUES (${SCHEMA_VERSION});
    CREATE TABLE "Media" ("Id" int PRIMARY KEY, "Caption" text);
    CREATE TABLE "MediaBlob" ("MediaId" int PRIMARY KEY REFERENCES "Media"("Id") ON DELETE CASCADE, "Data" bytea NOT NULL);
    CREATE TABLE "MediaThumb" ("MediaId" int PRIMARY KEY REFERENCES "Media"("Id") ON DELETE CASCADE, "Data" bytea NOT NULL);
  `);
  await db.query('INSERT INTO "Media" VALUES ($1,$2)', [1, 'Grandpa']);
  await db.query('INSERT INTO "Media" VALUES ($1,$2)', [2, 'Grandma']);
  await db.query('INSERT INTO "MediaBlob" VALUES ($1,$2)', [1, new Uint8Array([0, 1, 2, 253, 254, 255])]);
  await db.query('INSERT INTO "MediaBlob" VALUES ($1,$2)', [2, new Uint8Array([10, 20, 30])]);
  await db.query('INSERT INTO "MediaThumb" VALUES ($1,$2)', [1, new Uint8Array([7, 7, 7])]);
}

afterEach(() => __setTestDb(null));

async function gunzipText(blob: Blob): Promise<string> {
  const ds = new DecompressionStream('gzip');
  return new Response(blob.stream().pipeThrough(ds)).text();
}

describe('datadirToMetadataGz', () => {
  it('keeps table definitions and non-media data but omits media bytes', async () => {
    const src = await newEmptyClusterDb();
    await seed(src);
    const physical = await src.dumpDataDir('none');
    await src.close();

    const { metaGz, mediaIds } = await datadirToMetadataGz(physical);
    expect(mediaIds).toEqual([1, 2]);
    const sql = await gunzipText(metaGz);
    expect(sql).toContain('MediaBlob');   // table definition kept
    expect(sql).toContain('MediaThumb');  // table definition kept
    expect(sql).toContain('Grandpa');     // non-media row kept
    // No media bytea hex for our blobs (\x000102fdfeff etc.).
    expect(sql.toLowerCase()).not.toContain('000102fdfeff');
    expect(sql.toLowerCase()).not.toContain('070707');
  });
});

describe('dumpDatabaseLogical → logicalToDatadir round-trip', () => {
  it('restores rows and MediaBlob bytes bit-identically; MediaThumb empty', async () => {
    const src = await newEmptyClusterDb();
    await seed(src);
    __setTestDb(src); // dumpDatabaseLogical dumps + streams from this instance

    const container = await dumpDatabaseLogical();

    // Sanity: container carries the two blobs and reads back to its last byte.
    expect(await verifyContainer(container)).toEqual({ mediaCount: 2 });
    await expect(verifyContainer(new Blob([container, new Uint8Array([0])]))).rejects.toThrow(/Malformed/);
    await expect(verifyContainer(container.slice(0, container.size - 1))).rejects.toThrow();
    const decoded = await decodeContainer(container);
    const ids: number[] = [];
    for await (const r of decoded.blobs) ids.push(r.mediaId);
    expect(ids.sort()).toEqual([1, 2]);

    const datadir = await logicalToDatadir(container);
    const dst = await PGlite.create({ loadDataDir: datadir });

    const media = await dst.query<{ Id: number; Caption: string }>('SELECT * FROM "Media" ORDER BY "Id"');
    expect(media.rows.map((r) => r.Caption)).toEqual(['Grandpa', 'Grandma']);
    const b1 = await dst.query<{ Data: Uint8Array }>('SELECT "Data" FROM "MediaBlob" WHERE "MediaId"=1');
    expect(Array.from(b1.rows[0].Data)).toEqual([0, 1, 2, 253, 254, 255]);
    const thumbCount = await dst.query<{ n: number }>('SELECT COUNT(*)::int n FROM "MediaThumb"');
    expect(thumbCount.rows[0].n).toBe(0); // excluded data, table exists
    await dst.close();
    await src.close();
  });
});

// #878: the metadata and the media bytes must come from the same moment, even
// when the app keeps writing while the backup runs.
describe('a write between the two halves of a backup', () => {
  it('a photo added after the snapshot is left out, and the backup restores', async () => {
    const src = await newEmptyClusterDb();
    await seed(src);
    __setTestDb(src);
    const snapshot = await src.dumpDataDir('none');
    await src.query('INSERT INTO "Media" VALUES ($1,$2)', [3, 'Added during backup']);
    await src.query('INSERT INTO "MediaBlob" VALUES ($1,$2)', [3, new Uint8Array([9, 9])]);

    const container = await logicalBackupFromSnapshot(snapshot);
    const dst = await PGlite.create({ loadDataDir: await logicalToDatadir(container) });
    const blobs = await dst.query<{ MediaId: number }>('SELECT "MediaId" FROM "MediaBlob" ORDER BY 1');
    expect(blobs.rows.map((r) => r.MediaId)).toEqual([1, 2]);
    await dst.close();
    await src.close();
  });

  it('a photo deleted after the snapshot fails the backup instead of silently dropping it', async () => {
    const src = await newEmptyClusterDb();
    await seed(src);
    __setTestDb(src);
    const snapshot = await src.dumpDataDir('none');
    await src.query('DELETE FROM "Media" WHERE "Id" = 2');

    await expect(logicalBackupFromSnapshot(snapshot)).rejects.toThrow(/deleted while the backup was running/);
    await src.close();
  });

  it('an older backup carrying a blob with no Media row still restores', async () => {
    const src = await newEmptyClusterDb();
    await seed(src);
    const { metaGz } = await datadirToMetadataGz(await src.dumpDataDir('none'));
    await src.close();
    async function* records() {
      yield { mediaId: 1, data: new Uint8Array([1]) };
      yield { mediaId: 99, data: new Uint8Array([2]) };
    }

    const dst = await PGlite.create({ loadDataDir: await logicalToDatadir(await encodeContainer(metaGz, records())) });
    const blobs = await dst.query<{ MediaId: number }>('SELECT "MediaId" FROM "MediaBlob" ORDER BY 1');
    expect(blobs.rows.map((r) => r.MediaId)).toEqual([1]);
    await dst.close();
  });
});

describe('inspectBackupLogical', () => {
  it('counts what a backup holds, and restores the same datadir it counted (BK-1)', async () => {
    const src = await newEmptyClusterDb();
    await seed(src);
    await src.exec(`
      CREATE TABLE "Trees" ("Id" int PRIMARY KEY);
      CREATE TABLE "People" ("Id" int PRIMARY KEY);
      CREATE TABLE "Families" ("Id" int PRIMARY KEY);
      INSERT INTO "Trees" VALUES (1), (2);
      INSERT INTO "People" VALUES (1), (2), (3);
      INSERT INTO "Families" VALUES (1);
    `);
    __setTestDb(src);

    const current = await getDatabaseTotals();
    expect(current).toEqual({ trees: 2, people: 3, families: 1, media: 2 });

    const { datadir, totals } = await inspectBackupLogical(await dumpDatabaseLogical());
    expect(totals).toEqual(current);
    const dst = await PGlite.create({ loadDataDir: datadir });
    const people = await dst.query<{ n: number }>('SELECT COUNT(*)::int n FROM "People"');
    expect(people.rows[0].n).toBe(3);
    await dst.close();
    await src.close();
  });

  it('throws on a non-HLBK blob, before anything is counted or replaced', async () => {
    const bogus = new Blob([new Uint8Array([0x1f, 0x8b, 0, 0])]);
    await expect(inspectBackupLogical(bogus)).rejects.toThrow(/backup format/i);
  });
});

describe('rejects unknown format', () => {
  it('logicalToDatadir throws on a non-HLBK blob', async () => {
    const bogus = new Blob([new Uint8Array([0x1f, 0x8b, 0, 0])]);
    await expect(logicalToDatadir(bogus)).rejects.toThrow(/backup format/i);
  });
});

it('container of a churned DB is smaller than its physical dump', async () => {
  const db = await newEmptyClusterDb();
  await db.exec(`
    CREATE TABLE "_SchemaMeta" ("Version" INTEGER NOT NULL);
    INSERT INTO "_SchemaMeta" ("Version") VALUES (${SCHEMA_VERSION});
    CREATE TABLE "Media" ("Id" int PRIMARY KEY);
    CREATE TABLE "MediaBlob" ("MediaId" int PRIMARY KEY REFERENCES "Media"("Id") ON DELETE CASCADE, "Data" bytea NOT NULL);
    CREATE TABLE "MediaThumb" ("MediaId" int PRIMARY KEY REFERENCES "Media"("Id") ON DELETE CASCADE, "Data" bytea NOT NULL);
  `);
  const per = 512 * 1024;
  for (let i = 1; i <= 10; i++) {
    await db.query('INSERT INTO "Media" VALUES ($1)', [i]);
    await db.query('INSERT INTO "MediaBlob" VALUES ($1,$2)', [i, rnd(per)]);
  }
  for (let i = 1; i <= 6; i++) { // churn → dead tuples
    await db.query('DELETE FROM "MediaBlob" WHERE "MediaId"=$1', [i]);
    await db.query('DELETE FROM "Media" WHERE "Id"=$1', [i]);
    await db.query('INSERT INTO "Media" VALUES ($1)', [i + 100]);
    await db.query('INSERT INTO "MediaBlob" VALUES ($1,$2)', [i + 100, rnd(per)]);
  }
  const physical = await db.dumpDataDir('auto');
  __setTestDb(db);
  const container = await dumpDatabaseLogical();
  expect(container.size).toBeLessThan(physical.size);
  await db.close();
});
