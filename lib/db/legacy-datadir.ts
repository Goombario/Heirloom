/**
 * Moving local databases from PGlite 0.4 (Postgres 17) to 0.5 (Postgres 18), #235.
 *
 * Postgres 18 refuses a Postgres 17 data directory, so a database or a raw `.tar`
 * backup written by 0.4 is converted once: the 0.4 engine (the `pglite-pg17`
 * alias, fetched only when needed) opens it, 0.5's pg_dump (which reads older
 * servers) dumps it without the photo bytes, the dump runs in 0.5, and the photo
 * bytes are copied across one at a time. Every table's row count is compared
 * before the result is used.
 */

/** The Postgres major version a data directory's `PG_VERSION` names, or null. */
function parseMajor(bytes: Uint8Array): number | null {
  const n = Number.parseInt(new TextDecoder().decode(bytes).trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The Postgres major version of the data directory PGlite keeps in the IndexedDB
 * database `idbName`, read straight from its IDBFS store without opening it.
 * Null when there is no such database or the file can't be read.
 */
export async function idbPgMajor(idbName: string): Promise<number | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(idbName);
      // Opening a name that doesn't exist would create it; abort that instead.
      req.onupgradeneeded = () => req.transaction?.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
  try {
    if (!db.objectStoreNames.contains('FILE_DATA')) return null;
    const entry = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('FILE_DATA', 'readonly').objectStore('FILE_DATA').get(`${idbName}/PG_VERSION`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const contents = (entry as { contents?: unknown } | undefined)?.contents;
    if (contents instanceof Uint8Array) return parseMajor(contents);
    if (ArrayBuffer.isView(contents)) return parseMajor(new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength));
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

const GZIP = [0x1f, 0x8b];

async function tarBytes(blob: Blob): Promise<Uint8Array> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gz = head[0] === GZIP[0] && head[1] === GZIP[1];
  const source = gz ? new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob() : Promise.resolve(blob);
  return new Uint8Array(await (await source).arrayBuffer());
}

function field(block: Uint8Array, start: number, length: number): string {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

/**
 * The Postgres major version of a data directory tarball (`dumpDataDir`, plain
 * or gzipped): its top-level `PG_VERSION`. Null when the blob isn't a tar or
 * holds no such file.
 */
export async function tarPgMajor(blob: Blob): Promise<number | null> {
  let bytes: Uint8Array;
  try {
    bytes = await tarBytes(blob);
  } catch {
    return null;
  }
  let found: number | null = null;
  for (let off = 0; off + 512 <= bytes.length;) {
    const header = bytes.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = [field(header, 345, 155), field(header, 0, 100)].filter(Boolean).join('/');
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) return null;
    const parts = name.split('/').filter((p) => p && p !== '.');
    // The data directory's own PG_VERSION, not one under base/<db>/.
    if (parts[parts.length - 1] === 'PG_VERSION' && !parts.includes('base')) {
      found = parseMajor(bytes.subarray(off + 512, off + 512 + size));
      if (found !== null) return found;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return found;
}

/** The major version 0.4 writes, which this build converts. */
export const LEGACY_PG_MAJOR = 17;

type Db = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
};

const TABLES_SQL = `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`;

async function rowCounts(db: Db): Promise<Map<string, number>> {
  const tables = (await db.query<{ name: string }>(TABLES_SQL)).rows.map((r) => r.name);
  const counts = new Map<string, number>();
  for (const name of tables) {
    const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM public."${name.replace(/"/g, '""')}"`);
    counts.set(name, r.rows[0].n);
  }
  return counts;
}

/**
 * Convert a Postgres 17 data directory into a Postgres 18 one for 0.5: either a
 * tarball (a raw `.tar` backup) or a 0.4 data directory in IndexedDB, opened in
 * place so the database isn't held in memory twice. Throws, changing nothing,
 * if the converted copy doesn't hold the same rows in every table.
 */
export async function convertLegacyDatadir(legacy: Blob | { dataDir: string }): Promise<Blob> {
  const { PGlite: LegacyPGlite } = await import('pglite-pg17');
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump');
  const old = legacy instanceof Blob
    ? await LegacyPGlite.create({ loadDataDir: legacy })
    : await LegacyPGlite.create(legacy.dataDir);
  // The engine has its own copy now; let the blob go before the dump.
  legacy = null as unknown as Blob;
  let next: Awaited<ReturnType<typeof PGlite.create>> | null = null;
  try {
    const before = await rowCounts(old);
    const hasBlobs = before.has('MediaBlob');
    // Photo bytes stay out of the SQL text, where they would be hex and twice the size.
    const args = hasBlobs ? ['--exclude-table-data="MediaBlob"'] : [];
    const sql = await (await pgDump({ pg: old as never, args })).text();
    next = await PGlite.create();
    await next.exec(sql);
    await next.exec('SET search_path TO public;');
    if (hasBlobs) {
      const ids = await old.query<{ MediaId: number }>('SELECT "MediaId" FROM "MediaBlob" ORDER BY "MediaId"');
      for (const { MediaId } of ids.rows) {
        const r = await old.query<{ Data: Uint8Array }>('SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = $1', [MediaId]);
        await next.query('INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)', [MediaId, r.rows[0].Data]);
      }
    }
    const after = await rowCounts(next);
    for (const [name, n] of before) {
      if (after.get(name) !== n) throw new Error(`The upgraded database is missing rows in ${name}`);
    }
    return await next.dumpDataDir('none');
  } finally {
    await next?.close().catch(() => {});
    await old.close().catch(() => {});
  }
}
