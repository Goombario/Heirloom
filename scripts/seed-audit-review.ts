import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeSchema, SCHEMA_VERSION, type DbExecutor } from '../lib/db/init-schema';
import { getDataDir } from '../lib/data-dir';
import {
  auditCanonicalMediaOwnershipChange, auditCanonicalPrimaryChange, auditCreate, auditDataCheckConfirmation, auditDelete,
  auditFamilyChild, auditFamilyChildMove, auditImport, auditNote, auditPlaceEdit, auditPlaceRename, auditUpdate,
} from '../lib/db/queries/audit-capture';
import type { AuditEntityType } from '../lib/db/schema';
import type { NoteAuditSnapshot } from '../lib/db/queries/notes';
import { factPlaceTextColumns, resolvePlaceTexts } from '../lib/db/queries/place-links';
import { seedSyntheticDataset } from './synthetic-data-fixture';
import { commitHostedSeed, createOrFindUser, createStaticBackup, writeAtomic } from './seed-synthetic-data';

/**
 * Review material for the audit log's Record column (#930): the synthetic tree,
 * plus one audit entry for each entity type and action, written through the real
 * `audit-capture` functions. Each entry comes twice: once for a record that is in
 * the tree, and once for a record deleted after its entries were written, so
 * the page shows how a deleted record reads.
 *
 * The entries only describe changes; the records themselves are left as they
 * are. Reverting one from the log does act on the record, so use a throwaway tree.
 *
 *   npm run db:seed:audit-review -- --email you@example.com   # new tree in the dev database
 *   npm run fixture:audit-review                              # .hlbak to restore in the static build
 */

const DEFAULT_TREE_NAME = 'Audit Review Fixture';
const DEFAULT_OUTPUT = path.join('.playwright-screenshots', 'audit-review', 'audit-review.hlbak');

/** Ids no tree has, for a legacy story and a note that were never saved as rows. */
const GONE = 2_000_000_000;

type Row = Record<string, unknown>;

async function first(exec: DbExecutor, sql: string, params: unknown[]): Promise<Row> {
  const row = (await exec.query(sql, params)).rows[0] as Row | undefined;
  if (!row) throw new Error(`Audit review seed found no row for: ${sql}`);
  return row;
}

/** Create, update and delete entries for one record, changing `field` to `value`. */
async function crud(exec: DbExecutor, type: AuditEntityType, row: Row, field: string, value: unknown, ownerId: number, userId: number): Promise<void> {
  await auditCreate(type, row, ownerId, userId, exec);
  await auditUpdate(type, row, { ...row, [field]: value }, new Set([field]), ownerId, userId, exec);
  await auditDelete(type, row, ownerId, userId, exec);
}

export async function seedAuditReviewEntries(exec: DbExecutor, options: { userId: number; treeId: number }): Promise<{ entries: number }> {
  const { userId, treeId } = options;
  const owner = userId;
  const t = [treeId];

  const person = await first(exec, `SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."TreeId" = $1 ORDER BY p."Id" LIMIT 1`, t);
  const family = await first(exec, `SELECT f.*, ${factPlaceTextColumns('families', 'f')} FROM "Families" f WHERE f."TreeId" = $1 AND f."Partner1Id" IS NOT NULL AND f."Partner2Id" IS NOT NULL ORDER BY f."Id" LIMIT 1`, t);
  const otherFamily = await first(exec, `SELECT f.*, ${factPlaceTextColumns('families', 'f')} FROM "Families" f WHERE f."TreeId" = $1 AND f."Id" <> $2 ORDER BY f."Id" LIMIT 1`, [treeId, family.Id]);
  const event = await first(exec, `SELECT e.*, ${factPlaceTextColumns('events', 'e')} FROM "Events" e WHERE e."TreeId" = $1 AND e."PersonId" IS NOT NULL ORDER BY e."Id" LIMIT 1`, t);
  const familyEvent = await first(exec, `SELECT e.*, ${factPlaceTextColumns('events', 'e')} FROM "Events" e WHERE e."TreeId" = $1 AND e."FamilyId" IS NOT NULL ORDER BY e."Id" LIMIT 1`, t);
  const media = await first(exec, `SELECT * FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, t);
  const tag = await first(exec, `SELECT mt.*, m."TreeId" FROM "MediaTag" mt JOIN "Media" m ON m."Id" = mt."MediaId" WHERE m."TreeId" = $1 ORDER BY mt."Id" LIMIT 1`, t);
  const caseRow = await first(exec, `SELECT * FROM "Cases" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, t);
  const source = await first(exec, `SELECT * FROM "Sources" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, t);
  const variant = await first(exec, `SELECT * FROM "NameVariant" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, t);
  const place = await first(exec, `SELECT * FROM "Places" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, t);
  const child = await first(exec, `SELECT fp.*, f."TreeId" FROM "FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1 ORDER BY fp."FamiliesAsChildId" LIMIT 1`, t);
  const note = await first(exec, `SELECT n.*, nl."OwnerTable", nl."OwnerId" AS "RecordId" FROM "Note" n JOIN "NoteLink" nl ON nl."NoteId" = n."Id" WHERE n."TreeId" = $1 AND nl."OwnerTable" = 'People' ORDER BY n."Id" LIMIT 1`, t);
  // One citation of each kind of fact the log names.
  const citations = (await exec.query(
    `SELECT DISTINCT ON ("FactTable") * FROM "Citation" WHERE "TreeId" = $1 ORDER BY "FactTable", "Id"`, t,
  )).rows as Row[];

  // Records in the tree.
  await crud(exec, 'person', person, 'LastName', `${person.LastName ?? ''}-Smith`, owner, userId);
  await crud(exec, 'family', family, 'MarriagePlace', 'Dover, Kent', owner, userId);
  await crud(exec, 'event', event, 'Place', 'Dover, Kent', owner, userId);
  await crud(exec, 'event', familyEvent, 'Date', '1 JAN 1900', owner, userId);
  await crud(exec, 'media', media, 'Title', `${media.Title ?? 'Photo'} (retitled)`, owner, userId);
  await crud(exec, 'mediatag', tag, 'RegionX', Number(tag.RegionX) + 1, owner, userId);
  await crud(exec, 'case', caseRow, 'Status', 'closed', owner, userId);
  await crud(exec, 'source', source, 'Title', `${source.Title ?? 'Source'} (2nd ed.)`, owner, userId);
  await crud(exec, 'namevariant', variant, 'Name', `${variant.Name} (spelling)`, owner, userId);
  for (const citation of citations) await crud(exec, 'citation', citation, 'Page', 'p. 12', owner, userId);
  // Stories were folded into notes; old logs still hold their entries.
  await crud(exec, 'story', { Id: GONE + 90, TreeId: treeId, PersonId: person.Id, Title: 'How they met' }, 'Title', 'How they met in Dover', owner, userId);

  const link = { FamilyId: child.FamiliesAsChildId as number, ChildId: child.ChildrenId as number, Partner1Relationship: 'Birth', Partner2Relationship: 'Birth', TreeId: treeId };
  await auditFamilyChild('create', link, owner, userId, exec);
  await auditFamilyChild('update', { ...link, Partner2Relationship: 'Step' }, owner, userId, exec, { Partner1Relationship: 'Birth', Partner2Relationship: 'Birth' });
  await auditFamilyChild('delete', link, owner, userId, exec);
  await auditFamilyChildMove({ ...link, FamilyId: otherFamily.Id as number }, link.FamilyId, owner, userId, exec);

  const noteSnapshot: NoteAuditSnapshot = {
    NoteId: note.Id as number, TreeId: treeId, NoteOwnerId: owner, Text: note.Text as string, GedcomXref: null,
    CreatedAt: null, UpdatedAt: null, OwnerTable: 'People', RecordId: note.RecordId as number,
    Links: [{ OwnerFact: null, IsPrimary: 0, AddedInApp: 1 }],
  };
  await auditNote('create', noteSnapshot, owner, userId, undefined, exec);
  await auditNote('update', noteSnapshot, owner, userId, { Text: { old: note.Text, new: `${note.Text} (edited)` } }, exec);
  await auditNote('delete', noteSnapshot, owner, userId, undefined, exec);

  await auditCanonicalPrimaryChange({ personId: person.Id as number, oldMediaId: null, newMediaId: media.Id as number, treeOwnerId: owner, userId, treeId, exec });
  await auditCanonicalMediaOwnershipChange({ mediaId: media.Id as number, oldPersonIds: [person.Id as number], newPersonIds: [person.Id as number, tag.PersonId as number], treeOwnerId: owner, userId, treeId, exec });

  const rule = { TreeId: treeId, PersonId: person.Id as number, Rule: 'mother_too_old', Threshold: 55, Reason: 'Checked the parish register' };
  await auditDataCheckConfirmation('create', rule, owner, userId, exec);
  await auditDataCheckConfirmation('delete', rule, owner, userId, exec);

  const placeName = place.Name as string;
  const renameId = await auditPlaceRename(owner, userId, { from: 'Dovr', to: placeName, wasMerge: false, affected: [{ kind: 'birth', recordId: person.Id as number }] }, place.Id as number, exec, treeId);
  await auditPlaceRename(owner, userId, { from: `${placeName} (old spelling)`, to: placeName, wasMerge: true, affected: [{ kind: 'event', recordId: event.Id as number }, { kind: 'birth', recordId: person.Id as number }] }, place.Id as number, exec, treeId);
  // The trail marker a revert leaves; audit.ts writes it the same way.
  await exec.query(
    `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes") VALUES ($1, $2, $3, 'update', 'place', $4, $5, $6)`,
    [owner, userId, treeId, place.Id, `Reverted: Renamed Dovr → ${placeName} (1 record)`, JSON.stringify({ snapshot: { revertOf: renameId } })],
  );
  const placeState = { Latitude: place.Latitude ?? null, Longitude: place.Longitude ?? null, DisplayName: place.DisplayName ?? null, OsmType: null, OsmId: null, PinSuppressed: false, ParentId: null };
  await auditPlaceEdit({ kind: 'coordinates', changes: [{ id: place.Id as number, name: placeName, before: { ...placeState, Latitude: null, Longitude: null }, after: { ...placeState, Latitude: 51.13, Longitude: 1.31 } }], treeOwnerId: owner, userId, treeId, exec });

  await auditImport('merge', { people: 12, families: 4, sources: 3 }, owner, userId, exec, treeId);
  await auditImport('overwrite', { people: 120, families: 40 }, owner, userId, exec, treeId);

  // The same entries for records deleted since: made for real, audited while
  // they exist (so their labels save names, as in real use), then deleted.
  const row = (sql: string, params: unknown[]) => first(exec, sql, params);
  const edith = await row(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex", "BirthDate") VALUES ($1, $2, 'Edith', 'Gone', 'F', '1889') RETURNING *`, [userId, treeId]);
  const tom = await row(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex") VALUES ($1, $2, 'Tom', 'Gone', 'M') RETURNING *`, [userId, treeId]);
  const mary = await row(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex") VALUES ($1, $2, 'Mary', 'Gone', 'F') RETURNING *`, [userId, treeId]);
  const goneFamily = await row(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id", "Type") VALUES ($1, $2, $3, $4, 'Marriage') RETURNING *`, [userId, treeId, tom.Id, mary.Id]);
  const lumen = (await resolvePlaceTexts(exec, treeId, userId, ['Lumen'])).get('Lumen')!;
  const goneEvent = await row(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "PlaceId", "PlaceNameId", "PersonId") VALUES ($1, $2, 'OCCU', $3, $4, $5) RETURNING *, ${factPlaceTextColumns('events', '"Events"')}`, [userId, treeId, lumen.id, lumen.nameId, edith.Id]);
  const goneMedia = await row(`INSERT INTO "Media" ("UserId", "TreeId", "Title", "Format", "ContentType") VALUES ($1, $2, 'Lost photo', 'png', 'image/png') RETURNING *`, [userId, treeId]);
  const goneTag = await row(`INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, $2, 10, 10, 20, 20) RETURNING *`, [goneMedia.Id, edith.Id]);
  const goneCase = await row(`INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Closed-down case') RETURNING *`, [userId, treeId]);
  const goneSource = await row(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Discarded source') RETURNING *`, [userId, treeId]);
  const goneVariant = await row(`INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name") VALUES ($1, $2, $3, 'Nickname', 'Edie') RETURNING *`, [userId, treeId, edith.Id]);
  const goneCitation = await row(`INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId") VALUES ($1, $2, 'PersonBirth', $3, $4) RETURNING *`, [userId, treeId, edith.Id, goneSource.Id]);
  const gonePlace = await row(`INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES ($1, $2, 'Lost Village') RETURNING *`, [userId, treeId]);

  await crud(exec, 'person', edith, 'LastName', 'Gone-Smith', owner, userId);
  await crud(exec, 'family', goneFamily, 'MarriagePlace', 'Dover, Kent', owner, userId);
  await crud(exec, 'event', goneEvent, 'Place', 'Dover, Kent', owner, userId);
  await crud(exec, 'media', goneMedia, 'Title', 'Lost photo (retitled)', owner, userId);
  await crud(exec, 'mediatag', { ...goneTag, TreeId: treeId }, 'RegionX', 11, owner, userId);
  await crud(exec, 'case', goneCase, 'Status', 'closed', owner, userId);
  await crud(exec, 'source', goneSource, 'Title', 'Discarded source (2nd ed.)', owner, userId);
  await crud(exec, 'namevariant', goneVariant, 'Name', 'Edie G.', owner, userId);
  await crud(exec, 'citation', goneCitation, 'Page', 'p. 12', owner, userId);
  const goneLink = { FamilyId: goneFamily.Id as number, ChildId: edith.Id as number, Partner1Relationship: 'Birth', Partner2Relationship: 'Birth', TreeId: treeId };
  await auditFamilyChild('create', goneLink, owner, userId, exec);
  await auditFamilyChild('delete', goneLink, owner, userId, exec);
  await auditNote('create', { ...noteSnapshot, NoteId: GONE + 11, RecordId: edith.Id as number }, owner, userId, undefined, exec);
  await auditCanonicalPrimaryChange({ personId: edith.Id as number, oldMediaId: null, newMediaId: goneMedia.Id as number, treeOwnerId: owner, userId, treeId, exec });
  await auditDataCheckConfirmation('create', { ...rule, PersonId: edith.Id as number }, owner, userId, exec);
  await auditPlaceEdit({ kind: 'geocode', changes: [{ id: gonePlace.Id as number, name: 'Lost Village', before: { ...placeState, DisplayName: null }, after: { ...placeState, DisplayName: 'Lost Village, Kent, England' } }], treeOwnerId: owner, userId, treeId, exec });

  await exec.query(`DELETE FROM "Citation" WHERE "Id" = $1`, [goneCitation.Id]);
  await exec.query(`DELETE FROM "Sources" WHERE "Id" = $1`, [goneSource.Id]);
  await exec.query(`DELETE FROM "Cases" WHERE "Id" = $1`, [goneCase.Id]);
  await exec.query(`DELETE FROM "Media" WHERE "Id" = $1`, [goneMedia.Id]);
  await exec.query(`DELETE FROM "Events" WHERE "Id" = $1`, [goneEvent.Id]);
  await exec.query(`DELETE FROM "Families" WHERE "Id" = $1`, [goneFamily.Id]);
  await exec.query(`DELETE FROM "People" WHERE "Id" = ANY($1::int[])`, [[edith.Id, tom.Id, mary.Id]]);
  await exec.query(`DELETE FROM "Places" WHERE "Id" = $1`, [gonePlace.Id]);

  // Spread the entries a minute apart, newest last, so the log reads as a history.
  const result = await exec.query(
    `UPDATE "AuditLog" a SET "CreatedAt" = NOW() - (o.n * INTERVAL '1 minute')
       FROM (SELECT "Id", ROW_NUMBER() OVER (ORDER BY "Id" DESC) AS n FROM "AuditLog" WHERE "TreeId" = $1) o
      WHERE a."Id" = o."Id" RETURNING a."Id"`,
    t,
  );
  return { entries: result.rows.length };
}

interface AuditReviewArgs { mode: 'hosted' | 'static'; email: string | null; treeName: string; output: string }

function parseArgs(argv: string[]): AuditReviewArgs {
  const mode = argv[0];
  if (mode !== 'hosted' && mode !== 'static') throw new Error('Usage: hosted --email <email> | static [--output <file>]');
  const args: AuditReviewArgs = { mode, email: null, treeName: DEFAULT_TREE_NAME, output: DEFAULT_OUTPUT };
  for (let i = 1; i < argv.length; i++) {
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argv[i]} requires a value`);
    if (argv[i] === '--email') args.email = value;
    else if (argv[i] === '--tree-name') args.treeName = value;
    else if (argv[i] === '--output') args.output = value;
    else throw new Error(`Unknown option ${argv[i]}`);
    i++;
  }
  if (mode === 'hosted' && !args.email) throw new Error('Hosted mode requires --email');
  return args;
}

async function seedHosted(args: AuditReviewArgs): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for hosted mode');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await initializeSchema(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = await createOrFindUser(client, args.email!);
      const existing = await client.query(`SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 AND "Name" = $2`, [userId, args.treeName]);
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        throw new Error('A tree with this name already exists; pass a new --tree-name');
      }
      const created = await client.query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [userId, args.treeName]);
      const treeId = (created.rows[0] as { Id: number }).Id;
      const result = await commitHostedSeed(client, async (registerFiles) => {
        await seedSyntheticDataset(client, {
          userId, treeId, storage: 'hosted',
          mediaDirectory: path.join(getDataDir(), 'uploads', String(userId), 'media'),
          onHostedFilesWritten: registerFiles,
        });
        return seedAuditReviewEntries(client, { userId, treeId });
      });
      process.stdout.write(`${JSON.stringify({ mode: 'hosted', treeId, ...result })}\n`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function seedStatic(args: AuditReviewArgs): Promise<void> {
  const db = new PGlite();
  const exec: DbExecutor = { query: (text, params) => db.query(text, params) };
  try {
    await initializeSchema(exec);
    await db.query('BEGIN');
    const user = await db.query<{ Id: number }>(`INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ('local@web', 'Local User', 'local-web') RETURNING "Id"`);
    const tree = await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [user.rows[0].Id, args.treeName]);
    const options = { userId: user.rows[0].Id, treeId: tree.rows[0].Id };
    await seedSyntheticDataset(exec, { ...options, storage: 'local' });
    const result = await seedAuditReviewEntries(exec, options);
    await db.query(`CREATE TABLE IF NOT EXISTS "_SchemaMeta" ("Version" INTEGER NOT NULL)`);
    await db.query(`INSERT INTO "_SchemaMeta" ("Version") VALUES ($1)`, [SCHEMA_VERSION]);
    await db.query('COMMIT');
    await writeAtomic(args.output, new Uint8Array(await (await createStaticBackup(db)).arrayBuffer()));
    process.stdout.write(`${JSON.stringify({ mode: 'static', output: args.output, ...result })}\n`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  (args.mode === 'hosted' ? seedHosted(args) : seedStatic(args)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
