import { PGlite } from '@electric-sql/pglite';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeContainer, decodeContainer } from '../lib/db/backup-container';
import { initializeSchema, SCHEMA_VERSION, type DbExecutor } from '../lib/db/init-schema';
import { getDataDir } from '../lib/data-dir';
import { buildSyntheticDataset, seedSyntheticDataset, syntheticCaseCounts, SYNTHETIC_GENERATOR_VERSION, type SyntheticSeedResult } from './synthetic-data-fixture';

export interface SyntheticCliArgs {
  mode: 'hosted' | 'static' | 'verify';
  email: string | null;
  treeName: string;
  treeId: number | null;
  output: string;
  input: string | null;
  replace: false;
}

const DEFAULT_TREE_NAME = 'Synthetic QA Fixture';
const DEFAULT_OUTPUT = path.join('test-fixtures', 'synthetic.hlbak');

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseSyntheticCliArgs(argv: string[]): SyntheticCliArgs {
  const mode = argv[0] as SyntheticCliArgs['mode'] | undefined;
  if (mode !== 'hosted' && mode !== 'static' && mode !== 'verify') throw new Error('Usage: hosted | static | verify');
  let email: string | null = null;
  let treeName = DEFAULT_TREE_NAME;
  let treeId: number | null = null;
  let output = DEFAULT_OUTPUT;
  let input: string | null = null;
  for (let index = 1; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--email') email = requireValue(argv, index++, option);
    else if (option === '--tree-name') treeName = requireValue(argv, index++, option);
    else if (option === '--tree-id') {
      const raw = requireValue(argv, index++, option);
      treeId = Number(raw);
      if (!Number.isInteger(treeId) || treeId <= 0) throw new Error('tree-id must be a positive integer');
    } else if (option === '--output') output = requireValue(argv, index++, option);
    else if (option === '--input') input = requireValue(argv, index++, option);
    else if (option === '--replace') throw new Error('Replacement is intentionally unsupported; target an empty test tree');
    else throw new Error(`Unknown option ${option}`);
  }
  if (mode === 'hosted' && !email) throw new Error('Hosted mode requires --email');
  if (mode !== 'hosted' && email) throw new Error('Unknown option --email for this mode');
  if (mode === 'verify' && !input) throw new Error('Verify mode requires --input');
  if (mode !== 'verify' && treeId !== null && mode === 'static') throw new Error('--tree-id is valid only in hosted mode');
  return { mode, email, treeName, treeId, output, input, replace: false };
}

function summary(mode: SyntheticCliArgs['mode'], result: SyntheticSeedResult | { treeId: number; counts: SyntheticSeedResult }): string {
  if ('counts' in result) return JSON.stringify({ mode, treeId: result.treeId, counts: result.counts });
  return JSON.stringify({ mode, treeId: result.treeId, counts: result });
}

export async function createOrFindUser(client: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }, email: string): Promise<number> {
  const existing = await client.query(`SELECT "Id" FROM "Users" WHERE "Email" = $1`, [email]);
  if (existing.rows[0]) return (existing.rows[0] as { Id: number }).Id;
  const googleId = `synthetic-fixture-${createHash('sha256').update(email).digest('hex').slice(0, 24)}`;
  const inserted = await client.query(`INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ($1, 'Synthetic Fixture Test User', $2) RETURNING "Id"`, [email, googleId]);
  return (inserted.rows[0] as { Id: number }).Id;
}

export async function assertEmptyTree(client: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }, treeId: number, userId: number): Promise<void> {
  // The caller has already opened a transaction. Locking the tree row before
  // counting means a concurrent hosted seed cannot pass this preflight and then
  // insert into the same tree before our transaction commits.
  const ownerResult = await client.query(`SELECT "OwnerId" FROM "Trees" WHERE "Id" = $1 FOR UPDATE`, [treeId]);
  const tree = ownerResult.rows[0] as { OwnerId: number } | undefined;
  if (!tree || tree.OwnerId !== userId) throw new Error('Target tree is not owned by the selected test account');
  const countResult = await client.query(`SELECT (SELECT COUNT(*) FROM "People" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Families" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Events" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Media" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Places" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Cases" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Sources" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Citation" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "NameVariant" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Repository" WHERE "TreeId" = $1) + (SELECT COUNT(*) FROM "Note" WHERE "TreeId" = $1) AS "rowCount"`, [treeId]);
  const rowCount = (countResult.rows[0] as { rowCount: number } | undefined)?.rowCount;
  if (Number(rowCount) !== 0) throw new Error('Target tree is not empty; refusing to modify it');
}

type HostedSeedClient = { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

export async function commitHostedSeed<T>(
  client: HostedSeedClient,
  seed: (registerFiles: (files: string[]) => void) => Promise<T>,
): Promise<T> {
  const writtenFiles: string[] = [];
  let commitAttempted = false;
  try {
    const result = await seed((files) => writtenFiles.push(...files));
    commitAttempted = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    let rollbackSucceeded = false;
    try {
      await client.query('ROLLBACK');
      rollbackSucceeded = true;
    } catch {
      // Preserve files when the transaction outcome cannot be established.
    }
    if (!commitAttempted && rollbackSucceeded) {
      await Promise.all(writtenFiles.map(file => unlink(file).catch(() => undefined)));
    }
    throw error;
  }
}

async function seedHosted(args: SyntheticCliArgs): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for hosted mode');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await initializeSchema(pool);
    const client = await pool.connect();
    let transactionManagedByCommitHelper = false;
    try {
      await client.query('BEGIN');
      const userId = await createOrFindUser(client, args.email!);
      let treeId = args.treeId;
      if (treeId === null) {
        const existing = await client.query(`SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 AND "Name" = $2`, [userId, args.treeName]);
        if (existing.rows[0]) throw new Error('A tree with this name already exists; pass a new --tree-name or an empty --tree-id');
        const created = await client.query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [userId, args.treeName]);
        treeId = (created.rows[0] as { Id: number }).Id;
      } else await assertEmptyTree(client, treeId, userId);
      transactionManagedByCommitHelper = true;
      const result = await commitHostedSeed(client, (registerFiles) => seedSyntheticDataset(client, {
        userId,
        treeId,
        storage: 'hosted',
        mediaDirectory: path.join(getDataDir(), 'uploads', String(userId), 'media'),
        onHostedFilesWritten: registerFiles,
      }));
      process.stdout.write(`${summary('hosted', result)}\n`);
    } catch (error) {
      if (!transactionManagedByCommitHelper) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function gzip(input: Blob): Promise<Blob> {
  return new Response(input.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function createStaticBackup(db: PGlite): Promise<Blob> {
  const physical = await db.dumpDataDir('none');
  const temporary = await PGlite.create({ loadDataDir: physical });
  try {
    await temporary.exec('TRUNCATE "MediaBlob", "MediaThumb";');
    const metadata = await (await pgDump({ pg: temporary })).text();
    if (!metadata.includes('"MediaBlob"')) throw new Error('Synthetic metadata dump omitted MediaBlob schema');
    if (!metadata.includes('CREATE TABLE public.\"MediaBlob\"')) throw new Error('Synthetic metadata dump omitted MediaBlob table definition');
    const metadataGzip = await gzip(new Blob([metadata]));
    async function* blobs() {
      const ids = await db.query<{ MediaId: number }>(`SELECT "MediaId" FROM "MediaBlob" ORDER BY "MediaId"`);
      for (const row of ids.rows) {
        const data = await db.query<{ Data: Uint8Array }>(`SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = $1`, [row.MediaId]);
        if (data.rows[0]?.Data) yield { mediaId: row.MediaId, data: new Uint8Array(data.rows[0].Data) };
      }
    }
    return encodeContainer(metadataGzip, blobs());
  } finally {
    await temporary.close();
  }
}

export async function writeAtomic(filename: string, data: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, data);
  await rename(temporary, filename);
}

function manifest(result: SyntheticSeedResult) {
  return { schemaVersion: SCHEMA_VERSION, generatorVersion: SYNTHETIC_GENERATOR_VERSION, counts: result };
}

async function seedStatic(args: SyntheticCliArgs): Promise<void> {
  const db = new PGlite();
  const exec: DbExecutor = { query: (text, params) => db.query(text, params) };
  try {
    await initializeSchema(exec);
    await db.query('BEGIN');
    const user = await db.query<{ Id: number }>(`INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ('local@web', 'Local User', 'local-web') RETURNING "Id"`);
    const tree = await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [user.rows[0].Id, args.treeName]);
    const result = await seedSyntheticDataset(exec, { userId: user.rows[0].Id, treeId: tree.rows[0].Id, storage: 'local' });
    await db.query(`CREATE TABLE IF NOT EXISTS "_SchemaMeta" ("Version" INTEGER NOT NULL)`);
    await db.query(`INSERT INTO "_SchemaMeta" ("Version") VALUES ($1)`, [SCHEMA_VERSION]);
    await db.query('COMMIT');
    await writeAtomic(args.output, new Uint8Array(await (await createStaticBackup(db)).arrayBuffer()));
    await writeAtomic(`${args.output.replace(/\.hlbak$/i, '')}.manifest.json`, JSON.stringify(manifest(result), null, 2) + '\n');
    process.stdout.write(`${summary('static', result)}\n`);
  } finally {
    await db.close();
  }
}

async function verifyStatic(args: SyntheticCliArgs): Promise<void> {
  const input = new Blob([await readFile(args.input!)]);
  const decoded = await decodeContainer(input);
  const sql = await new Response(decoded.metaGz.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const db = new PGlite();
  try {
    await db.exec(sql);
    await db.exec('SET search_path TO public;');
    const mediaTable = await db.query<{ reg: string | null }>(`SELECT to_regclass('public.\"MediaBlob\"') AS reg`);
    if (!mediaTable.rows[0]?.reg) throw new Error('Synthetic metadata dump did not restore the MediaBlob table');
    let blobCount = 0;
    let mediaBytes = 0;
    for await (const blob of decoded.blobs) {
      await db.query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)`, [blob.mediaId, blob.data]);
      blobCount++;
      mediaBytes += blob.data.byteLength;
    }
    const counts = await db.query<{ people: number; families: number; media: number; tags: number; candidates: number; sources: number; citations: number }>(`SELECT (SELECT COUNT(*)::int FROM "People") AS people, (SELECT COUNT(*)::int FROM "Families") AS families, (SELECT COUNT(*)::int FROM "Media") AS media, (SELECT COUNT(*)::int FROM "MediaTag") AS tags, (SELECT COUNT(*)::int FROM "MediaFaceCandidate") AS candidates, (SELECT COUNT(*)::int FROM "Sources") AS sources, (SELECT COUNT(*)::int FROM "Citation") AS citations`);
    // Cases are checked one table at a time (#913), so a missing journal or
    // evidence link can't hide inside a combined row count.
    const caseCounts = await db.query<{ cases: number; caseComments: number; casePeople: number; caseCitations: number; caseMedia: number }>(`SELECT (SELECT COUNT(*)::int FROM "Cases") AS "cases", (SELECT COUNT(*)::int FROM "CaseComments") AS "caseComments", (SELECT COUNT(*)::int FROM "CasePerson") AS "casePeople", (SELECT COUNT(*)::int FROM "Citation" WHERE "FactTable" IN ('Cases', 'CaseComments')) AS "caseCitations", (SELECT COUNT(*)::int FROM "CaseMedia") AS "caseMedia"`);
    const expected = buildSyntheticDataset();
    const row = counts.rows[0];
    if (row.people !== expected.people.length || row.families !== expected.families.length || row.media !== expected.media.length || row.tags !== expected.media.reduce((sum, media) => sum + media.tags.length, 0) || row.candidates !== expected.faceCandidates.length || row.sources !== expected.sources.length || row.citations !== expected.citations.length || blobCount !== expected.media.length) throw new Error('Synthetic fixture verification counts did not match the generator contract');
    const expectedCases = syntheticCaseCounts(expected);
    for (const [table, count] of Object.entries(expectedCases)) {
      const actual = caseCounts.rows[0][table as keyof typeof expectedCases];
      if (actual !== count) throw new Error(`Synthetic fixture verification: expected ${count} ${table}, found ${actual}`);
    }
    const result: SyntheticSeedResult = { treeId: 1, people: row.people, families: row.families, childLinks: expected.childLinks.length, events: expected.events.length, places: expected.places.length, media: row.media, tags: row.tags, faceCandidates: row.candidates, sources: row.sources, citations: row.citations, ...caseCounts.rows[0], mediaBytes };
    process.stdout.write(`${summary('verify', result)}\n`);
  } finally {
    await db.close();
  }
}

export async function runSyntheticCli(argv: string[]): Promise<void> {
  const args = parseSyntheticCliArgs(argv);
  if (args.mode === 'hosted') return seedHosted(args);
  if (args.mode === 'static') return seedStatic(args);
  return verifyStatic(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runSyntheticCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
