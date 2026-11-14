import { backfillEventDates } from './backfill-event-dates';
import { backfillCitationLinks } from './backfill-citation-links';
import { backfillRepositoryContacts } from './backfill-repository-contacts';
import { dropFactPlaceText, hasFactPlaceText } from './place-text-migration';
import { FTM_VALUE_TO_CHILD_RELATIONSHIP } from '@/lib/child-relationship';

/**
 * Minimal database executor satisfied by both `pg.Pool` (server) and a PGlite
 * instance (browser). Only the single-statement query shape is needed here.
 */
export interface DbExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Schema revision. Bump this whenever the statements in `initializeSchema`
 * change (new table/column/index/migration). The static/PGlite build records
 * this number in a `_SchemaMeta` row after a successful init and skips the
 * whole ~80-statement init on subsequent page loads when the stored version
 * already matches — see `connection.pglite.ts`. The hosted (pg.Pool) path does
 * not use this; it memoizes init per long-lived server process instead.
 *
 * `__tests__/unit/schema-version-guard.test.ts` fingerprints the function below
 * and fails if it changes, to stop a schema edit shipping without a bump here.
 */
export const SCHEMA_VERSION = 74;

/** FTM's typed `_FREL` / `_MREL` values as a case-insensitive regex alternation. */
const MAPPED_FTM_VALUES = Object.keys(FTM_VALUE_TO_CHILD_RELATIONSHIP)
  .map((value) => value.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`))
  .join('|');

/**
 * #982: SQL for the type of a link's first `2 <tag>` line in "ChilRawGedcom" that
 * has one, or NULL when there is none. As in the GEDCOM parser, a value with no
 * type (Private) is skipped and the value matches case-insensitively.
 */
function ftmValueToType(tag: '_FREL' | '_MREL'): string {
  const cases = Object.entries(FTM_VALUE_TO_CHILD_RELATIONSHIP)
    .map(([value, type]) => `WHEN '${value}' THEN '${type}'`)
    .join(' ');
  return `CASE lower(substring("ChilRawGedcom" from '(?:^|\\n)2 ${tag} (${MAPPED_FTM_VALUES}) *(?:\\n|$)')) ${cases} END`;
}

/**
 * SQL that removes that same line and the lines under it, as the parser does. Only
 * the first: a second typed line for the same partner stays raw, as on re-import.
 */
function stripFtmLine(tag: '_FREL' | '_MREL', sql: string): string {
  return `regexp_replace(${sql}, '^2 ${tag} (${MAPPED_FTM_VALUES}) *(\\n[3-9][^\\n]*)*(\\n|$)', '', 'n')`;
}

/** The comment on `Citation."Url"` once its backfill has finished (#1024). */
const CITATION_URL_BACKFILLED = 'Record link; passthrough links lifted (#1024)';

/** The comment on `Repository."Website"` once its contacts backfill has finished (#40). */
const REPOSITORY_CONTACTS_BACKFILLED = 'Website; passthrough WWW/PHON/EMAIL lifted (#40)';

/**
 * Initialize database schema. Fully idempotent and race-condition safe.
 * All statements use IF NOT EXISTS — safe to call concurrently.
 */
export async function initializeSchema(pool: DbExecutor): Promise<void> {
  // Create all tables with IF NOT EXISTS (no race conditions)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Users" (
      "Id" SERIAL PRIMARY KEY,
      "Email" TEXT UNIQUE NOT NULL,
      "Name" TEXT,
      "Image" TEXT,
      "GoogleId" TEXT UNIQUE NOT NULL,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "UpdatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // #35 (ADR 0051): the last app version whose What's new this user has seen.
  // NULL until the app first records one, which it does silently.
  await pool.query(`ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "LastSeenVersion" TEXT;`);

  // Multi-tree: a user account can hold several separate trees; every
  // owner-bearing table below carries a "TreeId" scope column (backfilled at
  // the end of this function). Spec:
  // docs/superpowers/specs/2026-07-03-multi-tree-per-account-feasibility.md
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Trees" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
      "Name" TEXT NOT NULL,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "UpdatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_trees_owner ON "Trees"("OwnerId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "TreeSharing" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL,
      "SharedWithId" INTEGER NOT NULL,
      "TreeId" INTEGER,
      "Permission" TEXT NOT NULL CHECK ("Permission" IN ('view', 'contribute', 'edit')),
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sharing_sharedwith ON "TreeSharing"("SharedWithId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sharing_owner ON "TreeSharing"("OwnerId");`);

  // ── v66: pending shares (#1228) ──────────────────────────────────────────────
  // A share for an address with no "Users" row yet. It grants nothing on its own:
  // the first sign-in with that address moves it into "TreeSharing" and deletes it
  // (applyPendingShares). "Email" is stored normalised; one row per tree and address.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "PendingShares" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
      "TreeId" INTEGER NOT NULL REFERENCES "Trees"("Id") ON DELETE CASCADE,
      "Email" TEXT NOT NULL CHECK ("Email" = lower(btrim("Email")) AND "Email" <> ''),
      "Permission" TEXT NOT NULL CHECK ("Permission" IN ('view', 'contribute', 'edit')),
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pendingshares_tree_email ON "PendingShares"("TreeId", "Email");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pendingshares_email ON "PendingShares"("Email");`);

  // Geocoding gazetteer: stores resolved place names with optional coordinates.
  // Latitude/Longitude are nullable because a place name may be known without coordinates.
  // v20: place names are unique per TREE (idx_places_tree_name, created after the
  // TreeId backfill at the end of init) — the old inline UNIQUE("UserId","Name")
  // made one row serve ALL of a user's trees, so an import/geocode in tree B
  // silently overwrote the coordinates tree A rendered, and tree A's overwrite
  // wipe deleted rows tree B depended on.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Places" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
      "TreeId" INTEGER,
      "Name" TEXT NOT NULL,
      "Latitude" DOUBLE PRECISION,
      "Longitude" DOUBLE PRECISION,
      "DisplayName" TEXT,
      "OsmType" TEXT,
      "OsmId" BIGINT,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "UpdatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_places_userid ON "Places"("UserId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "People" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER,
      "TreeId" INTEGER,
      "FirstName" TEXT,
      "LastName" TEXT,
      "Sex" TEXT,
      "GedcomId" TEXT,
      "BirthDate" TEXT,
      "DeathDate" TEXT,
      "DeathCause" TEXT,
      -- No "BirthPlace" / "DeathPlace" text: a fact's place is its references
      -- (v64, ADR 0037), added further down with the "Places" table.
      "IsDeceased" INTEGER,
      -- No "Notes" column: retired in #524 / ADR 0010. People own notes through
      -- Note + NoteLink('People') like every other owner. A fresh database never
      -- creates it; an existing one has it dropped further down, after the
      -- one-time mirror.
      "UpdatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_people_userid ON "People"("UserId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Families" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER,
      "TreeId" INTEGER,
      "HusbandId" INTEGER,
      "WifeId" INTEGER,
      "MarriageDate" TEXT,
      "UpdatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_families_userid ON "Families"("UserId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "FamilyPerson" (
      "FamiliesAsChildId" INTEGER NOT NULL,
      "ChildrenId" INTEGER NOT NULL,
      PRIMARY KEY ("FamiliesAsChildId", "ChildrenId")
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Events" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER,
      "TreeId" INTEGER,
      "Type" TEXT NOT NULL,
      "Date" TEXT,
      "Description" TEXT,
      "PersonId" INTEGER,
      "FamilyId" INTEGER
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_userid ON "Events"("UserId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_personid ON "Events"("PersonId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_familyid ON "Events"("FamilyId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Media" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER,
      "TreeId" INTEGER,
      "Title" TEXT,
      "FilePath" TEXT,
      "Format" TEXT,
      "ContentType" TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_userid ON "Media"("UserId");`);

  // Face / multi-person tagging: links a Media to one or more People with an
  // optional face region (percent coords, like FocalX/Y). Person-specific
  // primary state belongs to MediaLink, not to the face-region row.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MediaTag" (
      "Id" SERIAL PRIMARY KEY,
      "MediaId" INTEGER NOT NULL REFERENCES "Media"("Id") ON DELETE CASCADE,
      "PersonId" INTEGER NOT NULL REFERENCES "People"("Id") ON DELETE CASCADE,
      "RegionX" REAL NOT NULL,
      "RegionY" REAL NOT NULL,
      "RegionW" REAL NOT NULL,
      "RegionH" REAL NOT NULL,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("MediaId", "PersonId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mediatag_mediaid ON "MediaTag"("MediaId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mediatag_personid ON "MediaTag"("PersonId");`);

  // Staging for face regions read out of photo metadata (#487). Deliberately
  // separate from MediaTag: a candidate has no confirmed person, and MediaTag's
  // PersonId is NOT NULL. Rows are never deleted — they transition status — so
  // the UNIQUE below keeps a re-imported photo from re-queueing resolved faces,
  // and so undo can restore a candidate exactly as it arrived.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MediaFaceCandidate" (
      "Id" SERIAL PRIMARY KEY,
      "MediaId" INTEGER NOT NULL REFERENCES "Media"("Id") ON DELETE CASCADE,
      "TreeId" INTEGER NOT NULL,
      "RegionX" REAL NOT NULL,
      "RegionY" REAL NOT NULL,
      "RegionW" REAL NOT NULL,
      "RegionH" REAL NOT NULL,
      "SourceName" TEXT,
      "SuggestedPersonId" INTEGER REFERENCES "People"("Id") ON DELETE SET NULL,
      "MatchKind" TEXT NOT NULL DEFAULT 'none',
      "Status" TEXT NOT NULL DEFAULT 'pending',
      "ConfirmedTagId" INTEGER REFERENCES "MediaTag"("Id") ON DELETE SET NULL,
      "DismissReason" TEXT,
      "ResolvedAt" TIMESTAMPTZ,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("MediaId", "SourceName", "RegionX", "RegionY")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_facecand_tree_status ON "MediaFaceCandidate"("TreeId", "Status");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_facecand_mediaid ON "MediaFaceCandidate"("MediaId");`);
  // The table UNIQUE above cannot dedupe UNNAMED regions: Postgres treats NULLs
  // as distinct, so a region with no name would re-queue on every import. This
  // partial index covers exactly that case.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facecand_unnamed
      ON "MediaFaceCandidate"("MediaId", "RegionX", "RegionY")
      WHERE "SourceName" IS NULL;
  `);

  // Local-first media bytes. Hosted leaves this empty (it stores files on disk
  // via Media.FilePath); the PGlite/static build writes image bytea here so a
  // single dumpDataDir() backup includes photos. Separate table (not a column
  // on Media) so the existing SELECT * Media queries never load image bytes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MediaBlob" (
      "MediaId" INTEGER PRIMARY KEY REFERENCES "Media"("Id") ON DELETE CASCADE,
      "Data" bytea NOT NULL
    );
  `);

  // Local-first thumbnails. Sibling of MediaBlob (bytes-only, cascades on delete
  // so it travels with backups and needs no extra delete/restore code). Lazily
  // generated on first read of an avatar-sized image (~256px longest edge, JPEG
  // q85) so the People list decodes ~10-20 KB instead of a full 2048px blob.
  // Hosted (Postgres/HTTP) mode never writes or reads it — harmless empty table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MediaThumb" (
      "MediaId" INTEGER PRIMARY KEY REFERENCES "Media"("Id") ON DELETE CASCADE,
      "Data" bytea NOT NULL
    );
  `);

  // Durable import lineage for each referenced media file. Structural GEDCOM
  // import commits these rows before byte materialization, so an interrupted
  // upload can be resumed without reconstructing archive identity.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MediaImportItem" (
      "Id" SERIAL PRIMARY KEY,
      "ImportId" TEXT NOT NULL,
      "DocumentMediaId" TEXT NOT NULL,
      "TreeId" INTEGER NOT NULL,
      "MediaId" INTEGER NOT NULL UNIQUE REFERENCES "Media"("Id") ON DELETE CASCADE,
      "ArchivePath" TEXT NOT NULL,
      "OriginalFilename" TEXT NOT NULL,
      "Status" TEXT NOT NULL DEFAULT 'pending',
      "FailureCode" TEXT,
      "SkipFaceCapture" INTEGER NOT NULL DEFAULT 0,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("ImportId", "DocumentMediaId"),
      CHECK ("Status" IN ('pending','ready','missing','failed')),
      CHECK (("Status" IN ('pending','ready') AND "FailureCode" IS NULL)
          OR ("Status" IN ('missing','failed') AND "FailureCode" IS NOT NULL)),
      CHECK ("ArchivePath" <> ''),
      CHECK ("SkipFaceCapture" IN (0,1))
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idx_mediaimportitem_tree_status"
      ON "MediaImportItem" ("TreeId", "Status");
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Sources" (
      "Id" SERIAL PRIMARY KEY,
      "TreeId" INTEGER,
      "Title" TEXT,
      "Author" TEXT,
      "PublicationInfo" TEXT,
      "RepositoryName" TEXT,
      "CallNumber" TEXT,
      "Text" TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "AuditLog" (
      "Id" SERIAL PRIMARY KEY,
      "TreeOwnerId" INTEGER NOT NULL,
      "TreeId" INTEGER,
      "UserId" INTEGER NOT NULL,
      "Action" TEXT NOT NULL CHECK ("Action" IN ('create', 'update', 'delete')),
      "EntityType" TEXT NOT NULL CHECK ("EntityType" IN ('person', 'family', 'event', 'media', 'story', 'case')),
      "EntityId" INTEGER NOT NULL,
      "EntityLabel" TEXT,
      "Changes" JSONB NOT NULL,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auditlog_treeowner ON "AuditLog"("TreeOwnerId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auditlog_createdat ON "AuditLog"("CreatedAt" DESC);`);

  // Column migrations (ADD COLUMN IF NOT EXISTS requires PostgreSQL 9.6+)
  // These handle upgrading older schemas that may be missing columns
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "UserId" INTEGER;`);
  // Migrate AuditLog EntityType constraint to include 'story' and 'case'
  // (for existing deployments). Rebuilds any constraint that doesn't yet allow 'case'.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%case%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case''))';
      END IF;
    END$migration$;
  `);
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "IsDeceased" INTEGER;`);
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "UserId" INTEGER;`);
  await pool.query(`ALTER TABLE "Events" ADD COLUMN IF NOT EXISTS "UserId" INTEGER;`);
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "UserId" INTEGER;`);
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "FocalX" REAL DEFAULT 50;`);
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "FocalY" REAL DEFAULT 50;`);
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "FocalRadius" REAL DEFAULT 50;`);
  // FocalRadius stores a percentage of min(nW,nH)/2. null = no crop circle set.
  // Default was originally 50; changed to NULL so new media has no crop by default.
  await pool.query(`ALTER TABLE "Media" ALTER COLUMN "FocalRadius" SET DEFAULT NULL;`);
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "FileSize" INTEGER NOT NULL DEFAULT 0;`);

  // #592 duplicate guard: SHA-256 of the ORIGINAL uploaded bytes (never the
  // compressed copy — both upload paths re-encode, so a sharp/libvips upgrade
  // would silently change a post-compression hash). Nullable on purpose: rows
  // predating the guard cannot be backfilled, since only the compressed copy was
  // kept, and a NULL must never match. Not UNIQUE either — the guard is advisory
  // and "include it anyway" has to stay a legal outcome.
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "ContentHash" TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_tree_hash ON "Media"("TreeId", "ContentHash");`);

  // v37 staged-event upload replay key. Nullable so ordinary uploads and all
  // existing rows retain their prior semantics. Uniqueness is tree-scoped:
  // opaque client intents must never reveal or reuse media across trees.
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "UploadIntentId" TEXT;`);
  // The normalized target snapshot is operational replay identity, not authored
  // genealogy data. Nullable so ordinary uploads and all legacy rows are unchanged.
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "UploadIntentTarget" TEXT;`);
  // #802: when a photo was taken, as a free-text genealogical date like an
  // event's. GEDCOM OBJE has no DATE, so it travels in media.json.
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "Date" TEXT;`);
  // #958: the FILE text a GEDCOM import declared, verbatim (`C:\FTM\photo.jpg`,
  // a URL, `photos/a.jpg`). Export writes it back for a reference whose bytes
  // never arrived. Display and round-trip only: never opened as a path.
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "SourceFile" TEXT;`);
  // #976: the FILE's sub-lines the app doesn't model (FTM's `_DATE` / `_TEXT`),
  // levels relative to FILE, written back under it on export.
  await pool.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "FileRawGedcom" TEXT;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_tree_upload_intent
      ON "Media" ("TreeId", "UploadIntentId")
      WHERE "UploadIntentId" IS NOT NULL;
  `);

  // GEDCOM passthrough: verbatim subtrees the importer does not yet model, kept on the
  // record so an import → export → re-import round-trip is lossless (audit Slice 0p).
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "RawGedcom" TEXT;`);
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "RawGedcom" TEXT;`);
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "RawGedcom" TEXT;`);
  // Events had no passthrough net at all (#423) — unmodeled event sub-tags (CAUS, AGE,
  // AGNC, RESN, …) were silently dropped on import with no way to recover them on export.
  await pool.query(`ALTER TABLE "Events" ADD COLUMN IF NOT EXISTS "RawGedcom" TEXT;`);
  // BIRT/DEAT/MARR are People/Families *columns*, not an Events row, so the above still
  // doesn't cover them — the common case for a lost "2 CAUS" is a bare "1 DEAT", which
  // never creates an Events row at all. Dedicated columns (not the general RawGedcom
  // above) so the generator can re-emit each nested under its own BIRT/DEAT/MARR line
  // rather than dangling, structurally misattached, at the end of the record (#423).
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "BirthRawGedcom" TEXT;`);
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "DeathRawGedcom" TEXT;`);
  // #964: the primary `1 NAME`'s unmodeled sub-lines (NPFX, NSFX, SPFX, TYPE, …).
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "NameRawGedcom" TEXT;`);
  // #968: 1 when the imported INDI had a bare `1 BIRT` (no date, place or anything
  // else), so it still exports. NULL otherwise.
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "BirthRecorded" INTEGER;`);
  await pool.query(`ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "DeathCause" TEXT;`);
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "MarriageRawGedcom" TEXT;`);
  // #965: 1 when the imported FAM had a bare `1 MARR` (married, no date, place
  // or anything else), so it still exports. NULL otherwise.
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "MarriageRecorded" INTEGER;`);
  // #989: each partner's sub-lines under the family's `1 HUSB` / `1 WIFE`
  // (Legacy's `2 _PREF Y`), re-emitted there on export.
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "Partner1RawGedcom" TEXT;`);
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "Partner2RawGedcom" TEXT;`);

  // Every event belongs to exactly one owner. Audit before adding the constraint
  // so an existing deployment with malformed rows fails loudly instead of
  // silently rewriting or orphaning data during initialization (#514).
  await pool.query(`
    DO $migration$
    DECLARE v_invalid_count BIGINT;
    BEGIN
      SELECT COUNT(*) INTO v_invalid_count
      FROM "Events"
      WHERE ("PersonId" IS NULL) = ("FamilyId" IS NULL);
      IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Events owner XOR invariant violated: % invalid row(s)', v_invalid_count;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Events"'::regclass AND conname = 'events_owner_xor'
      ) THEN
        ALTER TABLE "Events"
          ADD CONSTRAINT events_owner_xor
          CHECK (("PersonId" IS NOT NULL) <> ("FamilyId" IS NOT NULL));
      END IF;
    END$migration$;
  `);

  // Cases tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Cases" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
      "TreeId" INTEGER,
      "Title" VARCHAR(500) NOT NULL,
      "Description" TEXT,
      "Status" VARCHAR(20) NOT NULL DEFAULT 'in_progress',
      "Tags" TEXT[] NOT NULL DEFAULT '{}',
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_cases_userid" ON "Cases"("UserId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CasePerson" (
      "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
      "PersonId" INTEGER NOT NULL REFERENCES "People"("Id") ON DELETE CASCADE,
      PRIMARY KEY ("CaseId", "PersonId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caseperson_caseid" ON "CasePerson"("CaseId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caseperson_personid" ON "CasePerson"("PersonId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseMedia" (
      "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
      "MediaId" INTEGER NOT NULL REFERENCES "Media"("Id") ON DELETE CASCADE,
      PRIMARY KEY ("CaseId", "MediaId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_casemedia_caseid" ON "CaseMedia"("CaseId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseComments" (
      "Id" SERIAL PRIMARY KEY,
      "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
      "UserId" INTEGER NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
      "Body" TEXT NOT NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_casecomments_caseid" ON "CaseComments"("CaseId");`);

  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "MediaId" INTEGER REFERENCES "Media"("Id") ON DELETE SET NULL;`);
  // #801: journal entries the app writes. NULL is a researcher's note; 'status'
  // records a status change (Body is the new status, or 'reopened'), and
  // 'conclusion' is the answer written when the case closes.
  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "Kind" TEXT CHECK ("Kind" IN ('status', 'conclusion'));`);

  // ── v68: journal entries are append-only (#1251, ADR 0042) ──────────────────
  // An entry is never edited or deleted; a researcher's note that is no longer
  // accurate is struck out instead: when, by whom (null once that account is
  // gone) and an optional one-line reason. Only notes can be struck, never the
  // status and conclusion lines the app writes, and a reason or striker needs
  // a strike. Additive: every existing entry stays unstruck.
  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "StruckAt" TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "StruckBy" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "StruckReason" TEXT;`);
  await pool.query(`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"CaseComments"'::regclass AND conname = 'casecomments_struck_check'
      ) THEN
        ALTER TABLE "CaseComments" ADD CONSTRAINT casecomments_struck_check CHECK (
          ("StruckAt" IS NULL AND "StruckBy" IS NULL AND "StruckReason" IS NULL)
          OR ("StruckAt" IS NOT NULL AND "Kind" IS NULL)
        );
      END IF;
    END$migration$;
  `);

  // ── v69: a case holds leads, findings and claims (#58, ADR 0045) ────────────
  // The desktop research workspace. A lead is a sub-question with its own people;
  // a finding is a record a lead turned up (its source a Citation with FactTable
  // 'CaseFindings') or a search that found nothing; a claim is one thing a record
  // says, decided in place. A request tracks a record asked of an archive or a
  // relative. Lead status is worked out from these rows, never stored. Additive:
  // every existing case gains its question as its first lead, and nothing else
  // moves.
  await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "FromYear" INTEGER;`);
  await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "ToYear" INTEGER;`);
  await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "Place" TEXT;`);
  await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "QuestionKind" TEXT;`);
  await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "Outcome" TEXT CHECK ("Outcome" IN ('answered', 'ruled_out', 'unresolved'));`);
  await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "ClosedAt" TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseLeads" (
      "Id" SERIAL PRIMARY KEY,
      "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
      "Question" VARCHAR(500) NOT NULL,
      "FromYear" INTEGER,
      "ToYear" INTEGER,
      "Position" INTEGER NOT NULL DEFAULT 0,
      "CreatedBy" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "SettledAt" TIMESTAMPTZ,
      "SettledBy" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "DroppedAt" TIMESTAMPTZ,
      CONSTRAINT caseleads_years_check CHECK ("FromYear" IS NULL OR "ToYear" IS NULL OR "FromYear" <= "ToYear")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caseleads_caseid" ON "CaseLeads"("CaseId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseLeadPerson" (
      "LeadId" INTEGER NOT NULL REFERENCES "CaseLeads"("Id") ON DELETE CASCADE,
      "PersonId" INTEGER NOT NULL REFERENCES "People"("Id") ON DELETE CASCADE,
      PRIMARY KEY ("LeadId", "PersonId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caseleadperson_personid" ON "CaseLeadPerson"("PersonId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseRequests" (
      "Id" SERIAL PRIMARY KEY,
      "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
      "LeadId" INTEGER REFERENCES "CaseLeads"("Id") ON DELETE SET NULL,
      "UserId" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "AskedFor" TEXT NOT NULL,
      "Holder" TEXT,
      "SentBy" TEXT CHECK ("SentBy" IN ('online', 'email', 'post', 'in_person')),
      "SentOn" DATE,
      "Reference" TEXT,
      "RemindOn" DATE,
      "State" TEXT NOT NULL DEFAULT 'waiting' CHECK ("State" IN ('waiting', 'received', 'nothing')),
      "RepliedAt" TIMESTAMPTZ,
      "ReplyNote" TEXT,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caserequests_caseid" ON "CaseRequests"("CaseId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseFindings" (
      "Id" SERIAL PRIMARY KEY,
      "CaseId" INTEGER NOT NULL REFERENCES "Cases"("Id") ON DELETE CASCADE,
      "UserId" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "Kind" TEXT NOT NULL CHECK ("Kind" IN ('record', 'nothing')),
      "MediaId" INTEGER REFERENCES "Media"("Id") ON DELETE SET NULL,
      "SourceNature" TEXT CHECK ("SourceNature" IN ('original', 'derivative', 'authored')),
      "Information" TEXT CHECK ("Information" IN ('primary', 'secondary', 'unknown')),
      "Searched" TEXT,
      "Site" TEXT,
      "Note" TEXT,
      "RequestId" INTEGER REFERENCES "CaseRequests"("Id") ON DELETE SET NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT casefindings_nothing_check CHECK ("Kind" = 'record' OR ("Searched" IS NOT NULL AND "MediaId" IS NULL))
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_casefindings_caseid" ON "CaseFindings"("CaseId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_casefindings_mediaid" ON "CaseFindings"("MediaId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseFindingLead" (
      "FindingId" INTEGER NOT NULL REFERENCES "CaseFindings"("Id") ON DELETE CASCADE,
      "LeadId" INTEGER NOT NULL REFERENCES "CaseLeads"("Id") ON DELETE CASCADE,
      PRIMARY KEY ("FindingId", "LeadId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_casefindinglead_leadid" ON "CaseFindingLead"("LeadId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseClaims" (
      "Id" SERIAL PRIMARY KEY,
      "FindingId" INTEGER NOT NULL REFERENCES "CaseFindings"("Id") ON DELETE CASCADE,
      "Position" INTEGER NOT NULL DEFAULT 0,
      "What" TEXT NOT NULL,
      "PersonId" INTEGER REFERENCES "People"("Id") ON DELETE SET NULL,
      "PersonName" TEXT,
      "Says" TEXT,
      "Date" TEXT,
      "Place" TEXT,
      "Evidence" TEXT CHECK ("Evidence" IN ('direct', 'indirect', 'negative')),
      "Decision" TEXT NOT NULL DEFAULT 'undecided' CHECK ("Decision" IN ('accepted', 'rejected', 'undecided')),
      "DecidedAt" TIMESTAMPTZ,
      "DecidedBy" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "AppliedAt" TIMESTAMPTZ,
      "AppliedAuditId" INTEGER,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caseclaims_findingid" ON "CaseClaims"("FindingId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_caseclaims_personid" ON "CaseClaims"("PersonId");`);

  // The journal: the app's new entry kinds point at their finding or request, and
  // any entry can be filed under leads (none = the whole case). The Kind check is
  // replaced by a named one that allows the new kinds; ADR 0042's strike check is
  // unchanged, so only a researcher's note can still be struck out.
  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "FindingId" INTEGER REFERENCES "CaseFindings"("Id") ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE "CaseComments" ADD COLUMN IF NOT EXISTS "RequestId" INTEGER REFERENCES "CaseRequests"("Id") ON DELETE SET NULL;`);
  await pool.query(`
    DO $migration$
    DECLARE old_check TEXT;
    BEGIN
      SELECT conname INTO old_check FROM pg_constraint
       WHERE conrelid = '"CaseComments"'::regclass AND contype = 'c'
         AND conname <> 'casecomments_struck_check' AND conname <> 'casecomments_kind_check'
         AND pg_get_constraintdef(oid) LIKE '%Kind%';
      IF old_check IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "CaseComments" DROP CONSTRAINT %I', old_check);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"CaseComments"'::regclass AND conname = 'casecomments_kind_check'
      ) THEN
        ALTER TABLE "CaseComments" ADD CONSTRAINT casecomments_kind_check
          CHECK ("Kind" IN ('status', 'conclusion', 'finding', 'search', 'request', 'reply', 'lead'));
      END IF;
    END$migration$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CaseCommentLead" (
      "CommentId" INTEGER NOT NULL REFERENCES "CaseComments"("Id") ON DELETE CASCADE,
      "LeadId" INTEGER NOT NULL REFERENCES "CaseLeads"("Id") ON DELETE CASCADE,
      PRIMARY KEY ("CommentId", "LeadId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_casecommentlead_leadid" ON "CaseCommentLead"("LeadId");`);

  // Every case gets its question as its first lead, with the case's people, in one
  // statement so only the leads made here get people. Keyed on "has no lead yet",
  // so a later boot never gives a case a second one (a dropped lead keeps its row).
  await pool.query(`
    WITH made AS (
      INSERT INTO "CaseLeads" ("CaseId", "Question", "Position", "CreatedBy", "CreatedAt")
      SELECT c."Id", LEFT(c."Title", 500), 0, c."UserId", c."CreatedAt"
        FROM "Cases" c
       WHERE NOT EXISTS (SELECT 1 FROM "CaseLeads" l WHERE l."CaseId" = c."Id")
      RETURNING "Id", "CaseId"
    )
    INSERT INTO "CaseLeadPerson" ("LeadId", "PersonId")
    SELECT made."Id", cp."PersonId" FROM made JOIN "CasePerson" cp ON cp."CaseId" = made."CaseId"
    ON CONFLICT DO NOTHING;
  `);

  // ── v70: Answer and close cites its source on what it changed (#58, ADR 0046) ─
  // A claim applied to the tree makes up to two audited changes: the fact itself
  // ("AppliedAuditId", v69) and the citation of the record on it. Undo on the
  // closed case reverts both, so the citation's entry is kept too. Additive.
  await pool.query(`ALTER TABLE "CaseClaims" ADD COLUMN IF NOT EXISTS "AppliedCitationAuditId" INTEGER;`);

  // #789 (and #727): the last zone-less timestamps become TIMESTAMPTZ. Drivers
  // read a TIMESTAMP in whatever zone they like (node-pg: the Node process's;
  // PGlite: UTC), so a non-UTC server or desktop process showed case times hours
  // off, and PGlite showed them an hour off in DST. Every stored value came from
  // NOW()/CURRENT_TIMESTAMP, so it is wall time in the session zone it was
  // written in: UTC on a hosted server, and on PGlite the fixed host offset it
  // reports (e.g. Etc/GMT+5), which it also used at write time. Interpreting the
  // values in the session zone therefore recovers the instant in both builds.
  // A host that has changed zone since would convert with the new offset; that
  // is accepted. Idempotent: only columns still zone-less are altered.
  await pool.query(`
    DO $migration$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND data_type = 'timestamp without time zone'
          AND (table_name, column_name) IN (
            ('Cases', 'CreatedAt'), ('Cases', 'UpdatedAt'), ('CaseComments', 'CreatedAt'),
            ('MediaImportItem', 'CreatedAt'), ('MediaImportItem', 'UpdatedAt'))
      LOOP
        EXECUTE format(
          'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE current_setting(''TimeZone'')',
          r.table_name, r.column_name, r.column_name);
      END LOOP;
    END$migration$;
  `);

  // Migrate TreeSharing Permission constraint to include 'contribute'
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"TreeSharing"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%Permission%'
        AND pg_get_constraintdef(oid) NOT LIKE '%contribute%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "TreeSharing" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "TreeSharing" ADD CONSTRAINT treesharing_permission_check CHECK ("Permission" IN (''view'', ''contribute'', ''edit''))';
      END IF;
    END$migration$;
  `);

  // Migrate AuditLog EntityType constraint to include 'case'
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%case%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case''))';
      END IF;
    END$migration$;
  `);

  // Extend AuditLog EntityType constraint to include source/citation/mediatag/
  // namevariant and 'import' (the GEDCOM-import summary entry, FUNC-5). Match on
  // 'import' — the newest entry — so this re-runs cleanly on databases that
  // already had the earlier source/citation/mediatag migration applied, and is
  // the authoritative (last) rebuild so nothing after it drops 'import'.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%import%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case'', ''source'', ''citation'', ''mediatag'', ''namevariant'', ''import''))';
      END IF;
    END$migration$;
  `);

  // Extend AuditLog EntityType constraint to include 'place' (rename/merge summary
  // entries, CRUD §1.2). Matches on 'place' being absent so it re-runs cleanly and
  // is the authoritative (last) rebuild — keep any future widening below this one.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%place%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case'', ''source'', ''citation'', ''mediatag'', ''namevariant'', ''import'', ''place''))';
      END IF;
    END$migration$;
  `);

  // #830: confirming or reopening an unlikely data check is audited as 'datacheck'.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%datacheck%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case'', ''source'', ''citation'', ''mediatag'', ''namevariant'', ''import'', ''place'', ''familychild'', ''datacheck''))';
      END IF;
    END$migration$;
  `);

  // #788: child links (FamilyPerson) are audited and revertible as 'familychild'.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%familychild%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case'', ''source'', ''citation'', ''mediatag'', ''namevariant'', ''import'', ''place'', ''familychild''))';
      END IF;
    END$migration$;
  `);

  // #1045: notes are audited and revertible as 'note'. Runs after every earlier
  // EntityType block, so its list is the whole vocabulary.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%''note''%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case'', ''source'', ''citation'', ''mediatag'', ''namevariant'', ''import'', ''place'', ''familychild'', ''datacheck'', ''note''))';
      END IF;
    END$migration$;
  `);

  // #1227: a case journal note's edits and deletes are audited and revertible as
  // 'casenote'. Runs after the 'note' block, so its list is the whole vocabulary.
  await pool.query(`
    DO $migration$
    DECLARE v_conname TEXT;
    BEGIN
      SELECT conname INTO v_conname
      FROM pg_constraint
      WHERE conrelid = '"AuditLog"'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%EntityType%'
        AND pg_get_constraintdef(oid) NOT LIKE '%casenote%';
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "AuditLog" DROP CONSTRAINT %I', v_conname);
        EXECUTE 'ALTER TABLE "AuditLog" ADD CONSTRAINT auditlog_entitytype_check CHECK ("EntityType" IN (''person'', ''family'', ''event'', ''media'', ''story'', ''case'', ''source'', ''citation'', ''mediatag'', ''namevariant'', ''import'', ''place'', ''familychild'', ''datacheck'', ''note'', ''casenote''))';
      END IF;
    END$migration$;
  `);

  await pool.query(`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'People' AND column_name = 'CreatedAt'
      ) THEN
        ALTER TABLE "People" ADD COLUMN "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      END IF;
    END$migration$;
  `);

  // Phase 9: Rename HusbandId/WifeId → Partner1Id/Partner2Id (gender-neutral)
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "Partner1Id" INTEGER;`);
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "Partner2Id" INTEGER;`);
  await pool.query(`
    UPDATE "Families"
    SET "Partner1Id" = "HusbandId", "Partner2Id" = "WifeId"
    WHERE ("HusbandId" IS NOT NULL OR "WifeId" IS NOT NULL)
      AND ("Partner1Id" IS NULL AND "Partner2Id" IS NULL);
  `);

  // R3: Partnership type (backs the V1 family list filter chips). Defaults to 'Marriage'.
  await pool.query(`ALTER TABLE "Families" ADD COLUMN IF NOT EXISTS "Type" TEXT DEFAULT 'Marriage';`);

  // Phase 2 (family timeline): retire the EndedDate/EndedReason columns in favour of
  // divorce/annulment/separation Events. Backfill any column-based endings into Events
  // (skipping Death — derived from partner DeathDate — and families that already have an
  // equivalent end-event), then drop the columns. Guarded on column existence so it runs
  // exactly once and is a no-op thereafter.
  await pool.query(`
    DO $migration$
    BEGIN
      -- Serialize the one non-idempotent statement in this file so two replicas
      -- cold-starting together can't both pass the guard and double-insert before
      -- either drops the columns. The loser acquires the lock after the drop and the
      -- IF EXISTS guard makes it a no-op.
      PERFORM pg_advisory_xact_lock(hashtext('families_ended_backfill'));
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Families' AND column_name = 'EndedReason'
      ) THEN
        -- Unrecognized reasons (Unknown / date-only) collapse to SEPA so they stay
        -- recognized as an ending by the list derivation; Death is derived from partner
        -- DeathDate and never becomes an event.
        INSERT INTO "Events" ("UserId", "Type", "Date", "FamilyId")
        SELECT f."UserId",
               CASE f."EndedReason"
                 WHEN 'Divorce' THEN 'DIV'
                 WHEN 'Annulment' THEN 'ANUL'
                 ELSE 'SEPA'
               END,
               f."EndedDate",
               f."Id"
        FROM "Families" f
        WHERE (f."EndedReason" IS NOT NULL OR f."EndedDate" IS NOT NULL)
          AND COALESCE(f."EndedReason", '') <> 'Death'
          AND NOT EXISTS (
            SELECT 1 FROM "Events" ev
            WHERE ev."FamilyId" = f."Id" AND ev."Type" IN ('DIV', 'DIVF', 'ANUL', 'SEPA')
          );
        ALTER TABLE "Families" DROP COLUMN IF EXISTS "EndedReason";
        ALTER TABLE "Families" DROP COLUMN IF EXISTS "EndedDate";
      END IF;
    END$migration$;
  `);

  // #982 (ADR 0027): a child's relationship to EACH partner slot, Birth (default),
  // Adoption, Foster, Step, Guardian or Unknown. Replaces the one per-link
  // "RelationshipType" (ADR 0012), which can't describe a blended family.
  await pool.query(`ALTER TABLE "FamilyPerson" ADD COLUMN IF NOT EXISTS "Partner1Relationship" TEXT NOT NULL DEFAULT 'Birth';`);
  await pool.query(`ALTER TABLE "FamilyPerson" ADD COLUMN IF NOT EXISTS "Partner2Relationship" TEXT NOT NULL DEFAULT 'Birth';`);
  // #954: a child link's GEDCOM passthrough, re-emitted under its `1 FAMC` — a
  // `2 PEDI` with no RelationshipType (step, sealing) and unmodeled sub-lines.
  await pool.query(`ALTER TABLE "FamilyPerson" ADD COLUMN IF NOT EXISTS "FamcRawGedcom" TEXT;`);
  // #961: the same link's sub-lines under the family's `1 CHIL` (FTM `_FREL`/`_MREL`).
  await pool.query(`ALTER TABLE "FamilyPerson" ADD COLUMN IF NOT EXISTS "ChilRawGedcom" TEXT;`);
  // #982: copy the old type to both partners, then let FTM's `2 _FREL` / `2 _MREL`
  // kept in "ChilRawGedcom" (ADR 0023) set each partner, as a re-import of the same
  // file now would. A mapped line leaves the passthrough, since export writes it
  // from the columns; Related, Sealed, Private and other values stay raw. A link a
  // user retyped has no raw relationship lines left, so it keeps its type. Guarded
  // on the old column, so it runs once and drops it.
  await pool.query(`
    DO $migration$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('familyperson_partner_relationship'));
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'FamilyPerson' AND column_name = 'RelationshipType'
      ) THEN
        UPDATE "FamilyPerson"
           SET "Partner1Relationship" = COALESCE("RelationshipType", 'Birth'),
               "Partner2Relationship" = COALESCE("RelationshipType", 'Birth');
        UPDATE "FamilyPerson"
           SET "Partner1Relationship" = COALESCE(${ftmValueToType('_FREL')}, "Partner1Relationship"),
               "Partner2Relationship" = COALESCE(${ftmValueToType('_MREL')}, "Partner2Relationship"),
               "ChilRawGedcom" = NULLIF(rtrim(${stripFtmLine('_MREL', stripFtmLine('_FREL', '"ChilRawGedcom"'))}, chr(10)), '')
         WHERE "ChilRawGedcom" ~ '(^|\\n)2 _[FM]REL ';
        ALTER TABLE "FamilyPerson" DROP COLUMN "RelationshipType";
      END IF;
    END$migration$;
  `);

  // Phase 7: Citation, NameVariant, Repository tables + Source extensions

  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "OwnerId" INTEGER;`);
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "Type" TEXT DEFAULT 'Document';`);
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "Contents" TEXT;`);
  // ── v65: "ToldBy" folds into "Author" (#470, ADR 0038) ─────────────────────
  // The teller of an oral source is its author. An empty Author takes the teller;
  // a different Author keeps its value and names the teller after it, the same
  // rule as `foldToldBy` (lib/utils/told-by.ts) applies to an imported `_TOLDBY`.
  // One DO block, so the fold and the drop commit together: a crash between them
  // would otherwise fold a second time on the next boot. Fresh databases never
  // create the column, so this runs once, on the boot that upgrades.
  await pool.query(`
    DO $migration$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('sources_toldby_into_author'));
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'Sources' AND column_name = 'ToldBy'
      ) THEN
        -- Trims the whitespace JavaScript's trim() does, so both folds agree.
        UPDATE "Sources"
           SET "Author" = CASE
             WHEN NULLIF(btrim("Author", E' \\t\\r\\n'), '') IS NULL THEN btrim("ToldBy", E' \\t\\r\\n')
             WHEN btrim("Author", E' \\t\\r\\n') = btrim("ToldBy", E' \\t\\r\\n') THEN "Author"
             ELSE "Author" || ' (told by ' || btrim("ToldBy", E' \\t\\r\\n') || ')'
           END
         WHERE NULLIF(btrim("ToldBy", E' \\t\\r\\n'), '') IS NOT NULL;
        ALTER TABLE "Sources" DROP COLUMN "ToldBy";
      END IF;
    END$migration$;
  `);
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "Num" INTEGER;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sources_ownerid ON "Sources"("OwnerId");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Citation" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL,
      "TreeId" INTEGER,
      "FactTable" TEXT NOT NULL,
      "FactId" INTEGER NOT NULL,
      "SourceId" INTEGER NOT NULL REFERENCES "Sources"("Id") ON DELETE CASCADE,
      "Page" TEXT,
      "Note" TEXT,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_citation_ownerid ON "Citation"("OwnerId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_citation_fact ON "Citation"("FactTable", "FactId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_citation_sourceid ON "Citation"("SourceId");`);

  // Slice 3: GEDCOM SOURCE_CITATION evidence fields (spec p.39). These let a
  // citation carry evidence quality + transcription instead of dropping them on
  // import (audit ADH-8). All nullable, no backfill — purely additive.
  //   Quay     -> QUAY  (certainty 0-3)         DataText -> DATA.TEXT (transcription)
  //   DataDate -> DATA.DATE (entry recording)   Even     -> EVEN (event cited from)
  //   Role     -> EVEN.ROLE (role in that event)
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "Quay" TEXT;`);
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "DataText" TEXT;`);
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "DataDate" TEXT;`);
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "Even" TEXT;`);
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "Role" TEXT;`);
  // #976: a citation's sub-lines the app doesn't model (an OBJE), levels relative
  // to its SOUR line, because export may write the citation at another level.
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "RawGedcom" TEXT;`);
  // #990: the part of the fact a citation supports, 'DATE' or 'PLAC' (a GEDCOM
  // `3 SOUR` under the fact's DATE or PLAC line). NULL cites the whole fact.
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "Part" TEXT;`);
  // #1023: the link to the record a citation points at (ADR 0025), exported as `_LINK`.
  // #1024: then each citation's first link line is lifted out of its passthrough,
  // once. The column's comment marks it done, and is set only after the backfill
  // finishes, so one that failed partway runs again on the next boot. Running it
  // after that would bring back a citation's second link line once someone had
  // cleared the first.
  await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "Url" TEXT;`);
  const citationUrlNote = await pool.query(`
    SELECT col_description(a.attrelid, a.attnum) AS "Note" FROM pg_attribute a
    WHERE a.attrelid = '"Citation"'::regclass AND a.attname = 'Url'
  `);
  if ((citationUrlNote.rows[0] as { Note: string | null } | undefined)?.Note !== CITATION_URL_BACKFILLED) {
    await backfillCitationLinks(pool);
    await pool.query(`COMMENT ON COLUMN "Citation"."Url" IS '${CITATION_URL_BACKFILLED}'`);
  }

  // Normalize legacy citation FactTable values to canonical ones (see lib/db/fact-tables.ts).
  // Early person-detail code wrote lowercase singular values that the read query never matched,
  // hiding those citations. Idempotent: re-running affects nothing once values are canonical.
  // 'person' is ambiguous (was used for both birth and death) so it folds into the whole-person
  // bucket 'People'. The family-detail flow uses lowercase 'family' consistently, so it is left as-is.
  await pool.query(`UPDATE "Citation" SET "FactTable" = 'Events' WHERE "FactTable" = 'event';`);
  await pool.query(`UPDATE "Citation" SET "FactTable" = 'NameVariant' WHERE "FactTable" = 'namevariant';`);
  await pool.query(`UPDATE "Citation" SET "FactTable" = 'People' WHERE "FactTable" = 'person';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "NameVariant" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL,
      "TreeId" INTEGER,
      "PersonId" INTEGER NOT NULL REFERENCES "People"("Id") ON DELETE CASCADE,
      "Type" TEXT NOT NULL DEFAULT 'Alias',
      "Name" TEXT NOT NULL,
      "FromDate" TEXT,
      "ToDate" TEXT,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_namevariant_personid ON "NameVariant"("PersonId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_namevariant_ownerid ON "NameVariant"("OwnerId");`);
  // A variant can be marked the person's primary name (used as their first name
  // across the app). At most one primary per person, enforced by a partial index.
  await pool.query(`ALTER TABLE "NameVariant" ADD COLUMN IF NOT EXISTS "IsPrimary" INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_namevariant_one_primary ON "NameVariant"("PersonId") WHERE "IsPrimary" = 1;`);

  // v42 (#792): accent- and ё-insensitive name search. "SearchFold" decomposes
  // (NFD), drops the combining marks and lower-cases, so "Étienne" → "etienne"
  // and "Белозёрова" → "белозерова". Stored generated columns fill it on every
  // write path, and ADD COLUMN backfills existing rows. Search folds the query
  // with the same function, so each database is consistent with itself whatever
  // its locale does with lower().
  //
  // LANGUAGE sql, like "SortableYear": PGlite needs no procedural language for
  // it. IMMUTABLE is required by a generated column. A generated column rejects
  // an explicit value, so a row re-insert must name its columns, as the audit
  // revert and restorePersonDependents do, rather than copy a SELECT * row.
  await pool.query(`
    CREATE OR REPLACE FUNCTION "SearchFold"(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $fn$
      SELECT lower(regexp_replace(normalize(t, NFD), '[\\u0300-\\u036f]', '', 'g'))
    $fn$;
  `);
  await pool.query(`
    ALTER TABLE "People" ADD COLUMN IF NOT EXISTS "SearchName" TEXT
      GENERATED ALWAYS AS ("SearchFold"(COALESCE("FirstName", '') || ' ' || COALESCE("LastName", ''))) STORED;
  `);
  await pool.query(`
    ALTER TABLE "NameVariant" ADD COLUMN IF NOT EXISTS "SearchName" TEXT
      GENERATED ALWAYS AS ("SearchFold"("Name")) STORED;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Repository" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL,
      "TreeId" INTEGER,
      "Name" TEXT NOT NULL,
      "Address" TEXT,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_repository_ownerid ON "Repository"("OwnerId");`);
  // #966: a GEDCOM REPO record's passthrough (PHON, EMAIL, WWW, CHAN, …) and its
  // ADDR's structured lines (ADR1, CITY, …), re-emitted on export.
  await pool.query(`ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "RawGedcom" TEXT;`);
  await pool.query(`ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "AddressRawGedcom" TEXT;`);
  // #40 (ADR 0049): the first WWW, PHON and EMAIL are modeled; further ones stay in
  // "RawGedcom". The backfill lifts them once, marked done by the column's comment as
  // "Citation"."Url"'s backfill is.
  await pool.query(`ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "Website" TEXT;`);
  await pool.query(`ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "Phone" TEXT;`);
  await pool.query(`ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "Email" TEXT;`);
  const repositoryWebsiteNote = await pool.query(`
    SELECT col_description(a.attrelid, a.attnum) AS "Note" FROM pg_attribute a
    WHERE a.attrelid = '"Repository"'::regclass AND a.attname = 'Website'
  `);
  if ((repositoryWebsiteNote.rows[0] as { Note: string | null } | undefined)?.Note !== REPOSITORY_CONTACTS_BACKFILLED) {
    await backfillRepositoryContacts(pool);
    await pool.query(`COMMENT ON COLUMN "Repository"."Website" IS '${REPOSITORY_CONTACTS_BACKFILLED}'`);
  }

  // ── Slice 4: activate the Repository entity ────────────────────────────────
  // Sources previously carried a free-text "RepositoryName" with no shared
  // record (the Repository table was dead — audit ADH-3). Link sources to a real
  // Repository row via "RepositoryId" (one archive → many sources) and model the
  // GEDCOM source↔repo call-number medium (CALN.MEDI) as "RepositoryMedi".
  // "RepositoryName"/"CallNumber" stay the source of truth during the
  // transition (expand/contract); a later slice retires "RepositoryName".
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "RepositoryId" INTEGER REFERENCES "Repository"("Id") ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "RepositoryMedi" TEXT;`);
  // v25 (#501): `1 ABBR <SOURCE_FILED_BY_ENTRY>` (ged551-2.txt:251) — "a short title
  // used for sorting, filing, and retrieving source records" (ged551-4.txt:82,
  // size 1:60). Additive and nullable; it arrived via Sources."RawGedcom"
  // passthrough before this, so ABBR joins HANDLED_SOUR_L1 in the same change or
  // it would emit twice.
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "Abbreviation" TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sources_repositoryid ON "Sources"("RepositoryId");`);

  // (The Sources→Repository backfill, dedup and per-tree unique index — v20 —
  // now live at the END of init: they all reference "TreeId", which the
  // treeScopedTables loop only adds/stamps down there. Running them here
  // crashed a v18→v20 upgrade with 42703 "column TreeId does not exist".)

  // One-time Story → Source teardown. Stories were migrated into Sources (Type='Oral')
  // by an earlier release; this carries any straggler rows, then drops the legacy tables.
  // Guarded in JS (not a DO block) so it runs identically on Postgres and PGlite.
  const storiesReg = await pool.query(`SELECT to_regclass('"Stories"') AS reg`);
  if ((storiesReg.rows[0] as { reg: string | null } | undefined)?.reg) {
    await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "MigratedFromStoryId" INTEGER;`);
    await pool.query(`
      INSERT INTO "Sources" ("OwnerId", "Title", "Type", "Contents", "Author", "MigratedFromStoryId")
      SELECT s."UserId", s."Title", 'Oral', s."Contents", NULLIF(btrim(s."ToldBy"), ''), s."Id"
      FROM "Stories" s
      WHERE s."UserId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Sources" src WHERE src."MigratedFromStoryId" = s."Id");
    `);
    await pool.query(`DROP TABLE IF EXISTS "StoryPerson";`);
    await pool.query(`DROP TABLE IF EXISTS "Stories";`);
  }
  // Drop the tracking column once stories are gone (idempotent no-op afterwards).
  await pool.query(`DROP INDEX IF EXISTS idx_sources_migratedstoryid;`);
  await pool.query(`ALTER TABLE "Sources" DROP COLUMN IF EXISTS "MigratedFromStoryId";`);

  // v38: retire CaseCitations after the expand phase shipped. Existing databases may
  // still have the table, so finish copying every row before dropping it. Fresh
  // databases never create the table above. The guard also makes this safe for a
  // database that skipped the intermediate release.
  // The hosted connection wraps initializeSchema in a transaction, so this
  // transaction-scoped lock covers the catalog check, backfill, and DROP as one
  // unit. PGlite calls initializeSchema through its own init transaction.
  await pool.query(`SELECT pg_advisory_xact_lock(hashtext('genealogy_case_citations_retirement'))`);
  const legacyCaseCitationsResult = await pool.query(`SELECT to_regclass('"CaseCitations"') AS reg`);
  if ((legacyCaseCitationsResult.rows[0] as { reg: string | null } | undefined)?.reg) {
    // Older databases can reach this retirement without the tree backfill below.
    // Establish the case scope before creating any replacement records.
    await pool.query(`ALTER TABLE "Cases" ADD COLUMN IF NOT EXISTS "TreeId" INTEGER;`);
    await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "TreeId" INTEGER;`);
    await pool.query(`ALTER TABLE "Citation" ADD COLUMN IF NOT EXISTS "TreeId" INTEGER;`);
    await pool.query(`
      INSERT INTO "Trees" ("OwnerId", "Name")
      SELECT u."Id", 'My Tree' FROM "Users" u
      WHERE NOT EXISTS (SELECT 1 FROM "Trees" t WHERE t."OwnerId" = u."Id");
    `);
    await pool.query(`
      UPDATE "Cases" c SET "TreeId" = (
        SELECT t."Id" FROM "Trees" t WHERE t."OwnerId" = c."UserId" ORDER BY t."Id" LIMIT 1
      ) WHERE c."TreeId" IS NULL;
    `);
    await pool.query(`
      UPDATE "Sources" s SET "TreeId" = (
        SELECT t."Id" FROM "Trees" t WHERE t."OwnerId" = s."OwnerId" ORDER BY t."Id" LIMIT 1
      ) WHERE s."TreeId" IS NULL AND s."OwnerId" IS NOT NULL;
    `);
    // Title is the legacy source identity, but URL is also part of the value
    // being retired: same-title rows with different URLs must remain distinct
    // rather than silently losing one URL during the expand/contract step.
    await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "MigratedFromCaseCitationId" INTEGER;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sources_migratedcasecitationid ON "Sources"("MigratedFromCaseCitationId");`);
    await pool.query(`
      INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Type", "Text", "MigratedFromCaseCitationId")
      SELECT DISTINCT ON (c."UserId", c."TreeId", LOWER(cc."Title"), cc."Url")
             c."UserId", c."TreeId", cc."Title", 'Other', cc."Url", cc."Id"
      FROM "CaseCitations" cc
      JOIN "Cases" c ON c."Id" = cc."CaseId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "Sources" s
        WHERE s."OwnerId" = c."UserId"
          AND s."TreeId" = c."TreeId"
          AND LOWER(s."Title") = LOWER(cc."Title")
          AND s."Text" IS NOT DISTINCT FROM cc."Url"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Sources" s WHERE s."MigratedFromCaseCitationId" = cc."Id"
      )
      ORDER BY c."UserId", c."TreeId", LOWER(cc."Title"), cc."Url", cc."Id";
    `);
    await pool.query(`
      INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Note")
      SELECT c."UserId", c."TreeId", 'Cases', cc."CaseId", s."Id", cc."Notes"
      FROM "CaseCitations" cc
      JOIN "Cases" c ON c."Id" = cc."CaseId"
      JOIN LATERAL (
        SELECT s."Id"
        FROM "Sources" s
        WHERE s."OwnerId" = c."UserId"
          AND s."TreeId" = c."TreeId"
          AND LOWER(s."Title") = LOWER(cc."Title")
          AND s."Text" IS NOT DISTINCT FROM cc."Url"
        ORDER BY CASE WHEN s."MigratedFromCaseCitationId" = cc."Id" THEN 0 ELSE 1 END, s."Id"
        LIMIT 1
      ) s ON TRUE
      WHERE
        NOT EXISTS (
          SELECT 1 FROM "Citation" ci
          WHERE ci."FactTable" = 'Cases'
            AND ci."FactId" = cc."CaseId"
            AND ci."SourceId" = s."Id"
            AND ci."Page" IS NULL
            AND ci."Note" IS NOT DISTINCT FROM cc."Notes"
        );
    `);
    await pool.query(`DROP TABLE "CaseCitations";`);
  }
  await pool.query(`DROP INDEX IF EXISTS idx_sources_migratedcasecitationid;`);
  await pool.query(`ALTER TABLE "Sources" DROP COLUMN IF EXISTS "MigratedFromCaseCitationId";`);

  // (The earlier migration that broadened the AuditLog EntityType CHECK to
  // include 'source'/'citation' has been folded into the mediatag/namevariant
  // block above — kept here only as a marker so future maintainers know the
  // four new types live in that single block.)

  // ── Slice 1: Notes as first-class, attachable records ──────────────────────
  // A "Note" is shareable text; "NoteLink" attaches it polymorphically to any
  // owner in the LINK_OWNER_TABLES vocabulary (People, Families, Events,
  // Sources) — the same pattern Citation(FactTable, FactId) already uses for
  // sources. This decouples notes from being locked to the People."Notes" text
  // column (audit ADH-1) and lets shared GEDCOM `0 @N@ NOTE` records resolve to
  // a real row (finishes GED-3). GedcomXref preserves a record's import-time
  // pointer; BackfilledFromPersonId tracks the one-time People."Notes" backfill
  // for idempotency. Polymorphic OwnerId has no DB-level FK (same accepted
  // tradeoff as Citation) — app-layer cascade + an orphan sweep cover deletes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Note" (
      "Id" SERIAL PRIMARY KEY,
      "OwnerId" INTEGER NOT NULL,
      "TreeId" INTEGER,
      "Text" TEXT NOT NULL,
      "GedcomXref" TEXT,
      "BackfilledFromPersonId" INTEGER,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_note_ownerid ON "Note"("OwnerId");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_note_backfillperson ON "Note"("BackfilledFromPersonId");`);
  // #1045: when a note's text last changed ("Biography · edited 12 Sep 2026").
  // Added without a default so existing rows backfill from CreatedAt, not now.
  await pool.query(`ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "UpdatedAt" TIMESTAMPTZ;`);
  await pool.query(`UPDATE "Note" SET "UpdatedAt" = "CreatedAt" WHERE "UpdatedAt" IS NULL;`);
  await pool.query(`ALTER TABLE "Note" ALTER COLUMN "UpdatedAt" SET DEFAULT CURRENT_TIMESTAMP;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "NoteLink" (
      "NoteId" INTEGER NOT NULL REFERENCES "Note"("Id") ON DELETE CASCADE,
      "OwnerTable" TEXT NOT NULL,
      "OwnerId" INTEGER NOT NULL,
      "OwnerFact" TEXT,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("NoteId", "OwnerTable", "OwnerId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notelink_owner ON "NoteLink"("OwnerTable", "OwnerId");`);
  await pool.query(`ALTER TABLE "NoteLink" ADD COLUMN IF NOT EXISTS "OwnerFact" TEXT;`);
  // #512 promoted-fact notes need the fact dimension in link identity. The old
  // three-column primary key made the same shared NOTE under Birth and Death on
  // one person collide, so replace it with an expression index that treats the
  // nullable record-level value as a stable empty-string sentinel.
  await pool.query(`ALTER TABLE "NoteLink" DROP CONSTRAINT IF EXISTS "NoteLink_pkey";`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notelink_identity
      ON "NoteLink" ("NoteId", "OwnerTable", "OwnerId", COALESCE("OwnerFact", ''));
  `);

  // A link can be marked its owner's PRIMARY (preferred) note — what the hero slot
  // on a detail page shows once a record can carry several notes (ADR 0010/0012).
  // The flag belongs on the LINK, not the Note: a Note is shared across owners, so
  // a Note-level flag would mean "primary for every owner at once". Mirrors
  // MediaTag."IsPrimary", which sits on the join row for exactly the same reason.
  // At most one primary per (OwnerTable, OwnerId), enforced by a partial index —
  // same shape as idx_namevariant_one_primary / idx_mediatag_one_primary.
  await pool.query(`ALTER TABLE "NoteLink" ADD COLUMN IF NOT EXISTS "IsPrimary" INTEGER NOT NULL DEFAULT 0;`);
  // #902: 1 when the note was written in the app (POST /api/notes and its local
  // twin), 0 for imported and backfilled notes. The person page's oldest-note
  // biography fallback exists for imported and legacy notes only; a note someone
  // just wrote in the Notes list must stay there, not move into the biography.
  await pool.query(`ALTER TABLE "NoteLink" ADD COLUMN IF NOT EXISTS "AddedInApp" INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notelink_one_primary ON "NoteLink"("OwnerTable", "OwnerId") WHERE "IsPrimary" = 1;`);

  // One-time backfill: mirror each existing People."Notes" value into the new
  // Note + NoteLink(People) model so the decoupled read path returns the same
  // notes (G-REG). Idempotent via BackfilledFromPersonId (re-runs are no-ops).
  //
  // #524 / ADR 0010 — the contract half. This is the LAST boot on which the
  // column can still exist, and the DROP is a few statements below. The order
  // within this single initializeSchema run is the entire safety property:
  //
  //   mirror every remaining value  ->  then remove the column
  //
  // so even a local-first user who has not opened the app since the expand half
  // shipped gets their column mirrored in the same boot that removes it.
  //
  // The column-exists guard is not optional. Once the DROP has run, this SELECT
  // references a column that no longer exists, and on Postgres that is a hard
  // failure at schema-init time — i.e. the app does not start. For a PGlite user
  // the database lives in their browser with no ops recovery, so the failure
  // would be unrecoverable rather than merely loud. The guard is what makes the
  // second and every later boot a no-op instead of a crash.
  const hasNotesColumn = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'People' AND column_name = 'Notes'
  `);
  if (hasNotesColumn.rows.length > 0) {
    // Note."OwnerId" is mandatory, while legacy People."UserId" is nullable.
    // Do not turn an unowned legacy note into permanent data loss merely because
    // it has no valid first-class owner yet. Keeping the column lets the record
    // be assigned and safely migrated on a later boot.
    const unownedLegacyNotes = await pool.query(`
      SELECT 1
      FROM "People" p
      WHERE p."Notes" IS NOT NULL AND p."Notes" <> '' AND p."UserId" IS NULL
      LIMIT 1
    `);
    if (unownedLegacyNotes.rows.length > 0) {
      throw new Error('Cannot retire People."Notes": legacy notes exist on people without an owner');
    }

    await pool.query(`
      INSERT INTO "Note" ("OwnerId", "Text", "BackfilledFromPersonId")
      SELECT p."UserId", p."Notes", p."Id"
      FROM "People" p
      WHERE p."Notes" IS NOT NULL AND p."Notes" <> ''
        AND p."UserId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Note" n WHERE n."BackfilledFromPersonId" = p."Id");
    `);
  }
  // Reads "Note", not the column, so this half needs no guard and stays correct
  // after the DROP below — it is what links the rows the mirror above created.
  await pool.query(`
    INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId")
    SELECT n."Id", 'People', n."BackfilledFromPersonId"
    FROM "Note" n
    WHERE n."BackfilledFromPersonId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "NoteLink" l
        WHERE l."NoteId" = n."Id" AND l."OwnerTable" = 'People'
          AND l."OwnerId" = n."BackfilledFromPersonId"
      );
  `);

  // #524 / ADR 0010 — contract. Runs strictly AFTER both halves of the mirror
  // above, in the same initializeSchema call, so no value is lost on the boot
  // that removes the column. IF EXISTS makes re-runs no-ops.
  //
  // This is genuinely irreversible: nothing restores the column's contents but
  // the Note rows just written from it. That is why the mirror is unconditional
  // rather than gated on SCHEMA_VERSION — a database that skipped intermediate
  // versions still gets mirrored on the boot that drops.
  await pool.query(`ALTER TABLE "People" DROP COLUMN IF EXISTS "Notes";`);

  // ── Slice 2: Media as first-class, attachable records ──────────────────────
  // "MediaLink" attaches a Media row polymorphically to any owner in the
  // LINK_OWNER_TABLES vocabulary (same shape as NoteLink / Citation), so a photo
  // or document can hang off a family, source, or event — not just a person
  // (audit ADH-2). Media."PersonId" stays the source of truth during the
  // transition (expand/contract); a later slice retires it. The polymorphic
  // OwnerId has no DB FK (same accepted tradeoff as Citation/NoteLink).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "MediaLink" (
      "MediaId" INTEGER NOT NULL REFERENCES "Media"("Id") ON DELETE CASCADE,
      "OwnerTable" TEXT NOT NULL,
      "OwnerId" INTEGER NOT NULL,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("MediaId", "OwnerTable", "OwnerId")
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_medialink_owner ON "MediaLink"("OwnerTable", "OwnerId");`);
  await pool.query(`ALTER TABLE "MediaLink" ADD COLUMN IF NOT EXISTS "IsPrimary" INTEGER NOT NULL DEFAULT 0;`);
  // #905 / ADR 0030: a link can be scoped to a vital fact, as NoteLink is (#512):
  // Birth and Death on People, Marriage on Families. NULL is the record-level link,
  // so the fact joins link identity through an expression index, not the key.
  await pool.query(`ALTER TABLE "MediaLink" ADD COLUMN IF NOT EXISTS "OwnerFact" TEXT;`);
  await pool.query(`ALTER TABLE "MediaLink" DROP CONSTRAINT IF EXISTS "MediaLink_pkey";`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_medialink_identity
      ON "MediaLink" ("MediaId", "OwnerTable", "OwnerId", COALESCE("OwnerFact", ''));
  `);
  await pool.query(`ALTER TABLE "MediaLink" DROP CONSTRAINT IF EXISTS "medialink_owner_fact";`);
  await pool.query(`
    ALTER TABLE "MediaLink" ADD CONSTRAINT "medialink_owner_fact"
      CHECK ("OwnerFact" IS NULL
        OR ("OwnerTable" = 'People' AND "OwnerFact" IN ('Birth', 'Death'))
        OR ("OwnerTable" = 'Families' AND "OwnerFact" = 'Marriage'));
  `);
  // The portrait is always a record-level link: a fact-scoped link is never primary.
  // v71 (#119, ADR 0047): a family can have one too, its family photo. The old
  // People-only check is dropped for one that also admits Families; the partial
  // unique index was already per owner, so it keeps one photo per family as well.
  await pool.query(`ALTER TABLE "MediaLink" DROP CONSTRAINT IF EXISTS "medialink_primary_people_only";`);
  await pool.query(`ALTER TABLE "MediaLink" DROP CONSTRAINT IF EXISTS "medialink_primary_record_level";`);
  await pool.query(`
    ALTER TABLE "MediaLink" ADD CONSTRAINT "medialink_primary_record_level"
      CHECK ("IsPrimary" IN (0,1) AND ("IsPrimary" = 0
        OR ("OwnerTable" IN ('People', 'Families') AND "OwnerFact" IS NULL)));
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_medialink_one_primary_person"
      ON "MediaLink" ("OwnerTable", "OwnerId") WHERE "IsPrimary" = 1;
  `);

  // ── Slice 5: Places as a browsable entity (Option A, audit ADH-4) ──────────
  // The Places gazetteer already holds coordinates; promote it to a referenced
  // record with a jurisdiction hierarchy ("ParentId" self-link) and the GEDCOM
  // PLAC.FORM ("Form"). Records still reference places by their free-text name
  // column (lightweight — full PlaceId-FK normalization is the deferred Option B);
  // "Places" is also added to the NoteLink vocabulary so notes can attach to a
  // place. Coordinates already round-trip via PLAC.MAP.
  await pool.query(`ALTER TABLE "Places" ADD COLUMN IF NOT EXISTS "ParentId" INTEGER REFERENCES "Places"("Id") ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE "Places" ADD COLUMN IF NOT EXISTS "Form" TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_places_parentid ON "Places"("ParentId");`);
  // ── Precision & hierarchy rollup (docs/superpowers/specs/2026-07-09-places-precision-hierarchy-design.md) ──
  // Distinct from "no pin yet" (Latitude IS NULL, inherits from ParentId): an explicit
  // opt-out that must override inheritance even though Latitude/Longitude are also null.
  await pool.query(`ALTER TABLE "Places" ADD COLUMN IF NOT EXISTS "PinSuppressed" BOOLEAN NOT NULL DEFAULT FALSE;`);
  // #45 (ADR 0050): what kind of place the geocoder matched, as OSM's `key/value`
  // ("place/city", "landuse/cemetery"). Set by a match; shown when FORM gives no kind.
  await pool.query(`ALTER TABLE "Places" ADD COLUMN IF NOT EXISTS "OsmKind" TEXT;`);

  // (The "every referenced place gets a Places row" backfill now lives at the
  // END of init — it is keyed per tree and must run after the TreeId stamping
  // and the idx_places_tree_name unique index both exist.)

  // ── Performance indexes (audit Tier 1/2 — see PERFORMANCE-AUDIT.md) ────────
  // Back the hottest read paths as a tree grows to thousands of individuals:
  // the person profile, the places detail page, and the people list. All are
  // additive and idempotent (CREATE INDEX IF NOT EXISTS).

  // Families-by-spouse: every "families where this person is a partner" lookup
  // filters on COALESCE("Partner1Id","HusbandId") (and the Partner2/Wife pair),
  // which is non-sargable against a plain column index — so index the exact
  // expression the queries use. Also fixes the O(People × Families) correlated
  // PartnershipCount/ChildrenCount subqueries in getAllPeople.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_families_partner1 ON "Families" ((COALESCE("Partner1Id", "HusbandId")));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_families_partner2 ON "Families" ((COALESCE("Partner2Id", "WifeId")));`);

  // Child → parent-family lookups: FamilyPerson's only index is its composite PK
  // (FamiliesAsChildId, ChildrenId); queries keyed on ChildrenId alone (a
  // person's parents / "families as child") can't use the trailing PK column.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_familyperson_childrenid ON "FamilyPerson" ("ChildrenId");`);

  // People list: WHERE "UserId" = $1 ORDER BY "LastName", "FirstName" had no
  // covering index, forcing an in-memory sort of the whole tree on every load.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_people_user_name ON "People" ("UserId", "LastName", "FirstName");`);

  // Person-scoped citations: idx_citation_fact has no OwnerId prefix, so the
  // OR-shaped person query rode idx_citation_ownerid and scanned all of the
  // owner's citations. This lets the person-keyed branch be an index range scan.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_citation_owner_fact ON "Citation" ("OwnerId", "FactTable", "FactId");`);

  // ── Multi-tree (schema v19) ─────────────────────────────────────────────────
  // A "tree" stops being implicit ("all rows owned by this user") and becomes a
  // Trees row; every owner-bearing table gains a "TreeId" scope column. Legacy
  // owner columns (UserId/OwnerId/TreeOwnerId) are kept and still written — they
  // record the owning USER; "TreeId" records the scope. Plain INTEGER, no FK, to
  // match the existing owner-column style; deleteTreeData removes rows explicitly.
  // Runs at the END of init so every table (incl. late ones like Note) exists.
  // Spec: docs/superpowers/specs/2026-07-03-multi-tree-per-account-feasibility.md

  // Column + index for existing databases (fresh CREATEs above already include it).
  // [table, owner column] — the owner column drives the backfill stamp below.
  const treeScopedTables: Array<[table: string, ownerCol: string]> = [
    ['People', 'UserId'],
    ['Families', 'UserId'],
    ['Events', 'UserId'],
    ['Media', 'UserId'],
    ['Places', 'UserId'],
    ['Cases', 'UserId'],
    ['Sources', 'OwnerId'],
    ['Citation', 'OwnerId'],
    ['NameVariant', 'OwnerId'],
    ['Repository', 'OwnerId'],
    ['Note', 'OwnerId'],
    ['AuditLog', 'TreeOwnerId'],
    ['TreeSharing', 'OwnerId'],
  ];
  for (const [table] of treeScopedTables) {
    await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "TreeId" INTEGER;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table.toLowerCase()}_treeid ON "${table}"("TreeId");`);
  }

  // Sharing is per-tree: retire the account-level uniqueness in favour of one
  // share row per (tree, recipient) — createShare's ON CONFLICT targets this
  // unique index.
  await pool.query(`ALTER TABLE "TreeSharing" DROP CONSTRAINT IF EXISTS "TreeSharing_OwnerId_SharedWithId_key";`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sharing_tree_shared ON "TreeSharing"("TreeId", "SharedWithId");`);

  // Backfill (idempotent; re-runs are no-ops — G-MIG):
  // 1. One default tree per existing user.
  await pool.query(`
    INSERT INTO "Trees" ("OwnerId", "Name")
    SELECT u."Id", 'My Tree' FROM "Users" u
    WHERE NOT EXISTS (SELECT 1 FROM "Trees" t WHERE t."OwnerId" = u."Id");
  `);
  // 2. Stamp legacy rows with their owner's default (lowest-Id) tree. Rows with
  //    a NULL owner (orphans awaiting db:assign) stay NULL — invisible in every
  //    tree, exactly as they are invisible in owner-scoped reads today.
  //    Identifiers interpolate from the compile-time list above only.
  for (const [table, ownerCol] of treeScopedTables) {
    await pool.query(`
      UPDATE "${table}" x SET "TreeId" = (
        SELECT t."Id" FROM "Trees" t WHERE t."OwnerId" = x."${ownerCol}" ORDER BY t."Id" ASC LIMIT 1
      ) WHERE x."TreeId" IS NULL AND x."${ownerCol}" IS NOT NULL;
    `);
  }

  // v39: v38 could assign retired CaseCitations copies to the owner's default
  // tree even when the case belonged to another tree. Preserve the existing
  // Source for its own tree and give affected case citations a scoped copy.
  await pool.query(`ALTER TABLE "Sources" ADD COLUMN IF NOT EXISTS "RehomedFromSourceId" INTEGER;`);
  await pool.query(`
    INSERT INTO "Sources" (
      "OwnerId", "TreeId", "Title", "Author", "PublicationInfo", "RepositoryName",
      "CallNumber", "Text", "RawGedcom", "Type", "Contents", "Num",
      "RepositoryMedi", "Abbreviation", "RehomedFromSourceId"
    )
    SELECT DISTINCT ON (s."Id", c."TreeId")
      s."OwnerId", c."TreeId", s."Title", s."Author", s."PublicationInfo", s."RepositoryName",
      s."CallNumber", s."Text", s."RawGedcom", s."Type", s."Contents", s."Num",
      s."RepositoryMedi", s."Abbreviation", s."Id"
    FROM "Citation" ci
    JOIN "Cases" c ON ci."FactTable" = 'Cases' AND ci."FactId" = c."Id"
    JOIN "Sources" s ON s."Id" = ci."SourceId"
    WHERE c."TreeId" IS NOT NULL
      AND ci."OwnerId" = c."UserId" AND s."OwnerId" = c."UserId"
      AND s."TreeId" IS DISTINCT FROM c."TreeId"
      AND NOT EXISTS (
        SELECT 1 FROM "Sources" copy
        WHERE copy."RehomedFromSourceId" = s."Id" AND copy."TreeId" = c."TreeId"
      )
    ORDER BY s."Id", c."TreeId";
  `);
  await pool.query(`
    UPDATE "Citation" ci SET "SourceId" = copy."Id", "TreeId" = c."TreeId"
    FROM "Cases" c, "Sources" original, "Sources" copy
    WHERE ci."FactTable" = 'Cases' AND ci."FactId" = c."Id"
      AND ci."SourceId" = original."Id"
      AND ci."OwnerId" = c."UserId" AND original."OwnerId" = c."UserId"
      AND original."TreeId" IS DISTINCT FROM c."TreeId"
      AND copy."RehomedFromSourceId" = original."Id"
      AND copy."TreeId" = c."TreeId";
  `);
  await pool.query(`
    UPDATE "Citation" ci SET "TreeId" = c."TreeId"
    FROM "Cases" c, "Sources" s
    WHERE ci."FactTable" = 'Cases' AND ci."FactId" = c."Id"
      AND ci."SourceId" = s."Id" AND s."TreeId" = c."TreeId"
      AND ci."OwnerId" = c."UserId" AND ci."TreeId" IS DISTINCT FROM c."TreeId";
  `);
  await pool.query(`ALTER TABLE "Sources" DROP COLUMN IF EXISTS "RehomedFromSourceId";`);

  // ── v35: retire v34 media compatibility storage ───────────────────────────
  // Fresh databases never create these columns. Existing v34 databases run the
  // complete reconciliation below, fail closed on any invalid or mismatched
  // state, and only then drop all three columns in one atomic statement.
  const legacyMediaColumnsResult = await pool.query(`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'Media' AND column_name IN ('PersonId', 'IsPrimary'))
        OR (table_name = 'MediaTag' AND column_name = 'IsPrimary')
      );
  `);
  const legacyMediaColumns = new Set(
    (legacyMediaColumnsResult.rows as Array<{ tableName: string; columnName: string }>).map(
      row => `${row.tableName}.${row.columnName}`,
    ),
  );
  const hasMediaPersonId = legacyMediaColumns.has('Media.PersonId');
  const hasMediaIsPrimary = legacyMediaColumns.has('Media.IsPrimary');
  const hasMediaTagIsPrimary = legacyMediaColumns.has('MediaTag.IsPrimary');
  const legacyMediaColumnCount = [
    hasMediaPersonId,
    hasMediaIsPrimary,
    hasMediaTagIsPrimary,
  ].filter(Boolean).length;

  if (legacyMediaColumnCount > 0 && legacyMediaColumnCount < 3) {
    throw new Error(
      `Cannot retire partial v34 media compatibility contract (${legacyMediaColumnCount}/3 columns present)`,
    );
  }

  if (legacyMediaColumnCount === 3) {
  // TreeId stamping must happen first: only a real person in the same tree may
  // become a canonical owner. Legacy dangling and cross-tree PersonId/tag rows
  // remain untouched for the integrity audit instead of being laundered into a
  // valid-looking link. Existing canonical primaries are authoritative on a
  // restart. A legacy winner is seeded only for a person who has no canonical
  // primary yet; on first migration, primary tags outrank legacy owned
  // primaries and ties are deterministic by Media.Id.
  await pool.query(`
    INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId")
    SELECT c."MediaId", 'People', c."OwnerId"
    FROM (
      SELECT m."Id" AS "MediaId", p."Id" AS "OwnerId"
      FROM "Media" m
      JOIN "People" p ON p."Id" = m."PersonId" AND p."TreeId" = m."TreeId"
      WHERE m."PersonId" IS NOT NULL AND m."TreeId" IS NOT NULL
      UNION
      SELECT m."Id" AS "MediaId", p."Id" AS "OwnerId"
      FROM "MediaTag" t
      JOIN "Media" m ON m."Id" = t."MediaId"
      JOIN "People" p ON p."Id" = t."PersonId" AND p."TreeId" = m."TreeId"
      WHERE t."IsPrimary" = 1 AND m."TreeId" IS NOT NULL
    ) c
    ON CONFLICT DO NOTHING;
  `);
  await pool.query(`
    WITH canonical_owners AS (
      SELECT DISTINCT "OwnerId"
      FROM "MediaLink"
      WHERE "OwnerTable" = 'People' AND "IsPrimary" = 1
    ), candidates AS (
      SELECT t."PersonId" AS "OwnerId", t."MediaId", 0 AS "Priority"
      FROM "MediaTag" t
      JOIN "Media" m ON m."Id" = t."MediaId"
      JOIN "People" p ON p."Id" = t."PersonId" AND p."TreeId" = m."TreeId"
      WHERE t."IsPrimary" = 1 AND m."TreeId" IS NOT NULL
      UNION ALL
      SELECT p."Id" AS "OwnerId", m."Id" AS "MediaId", 1 AS "Priority"
      FROM "Media" m
      JOIN "People" p ON p."Id" = m."PersonId" AND p."TreeId" = m."TreeId"
      WHERE m."IsPrimary" = 1 AND m."TreeId" IS NOT NULL
    ), ranked AS (
      SELECT "OwnerId", "MediaId",
             ROW_NUMBER() OVER (PARTITION BY "OwnerId" ORDER BY "Priority", "MediaId") AS "Rank"
      FROM candidates
    )
    UPDATE "MediaLink" l SET "IsPrimary" = 1
    FROM ranked r
    WHERE r."Rank" = 1
      AND NOT EXISTS (
        SELECT 1 FROM canonical_owners c WHERE c."OwnerId" = r."OwnerId"
      )
      AND l."MediaId" = r."MediaId"
      AND l."OwnerTable" = 'People'
      AND l."OwnerId" = r."OwnerId";
  `);

  // Compatibility mirrors remain deliberately lossy while MediaLink is the
  // canonical relationship: PersonId records the lowest-ID valid linked person;
  // Media.IsPrimary can represent a canonical primary only for that one legacy
  // person; MediaTag.IsPrimary mirrors it only when that exact person is tagged
  // on the selected media. All three passes validate the person's TreeId against
  // the media. Invalid/cross-tree legacy values are retained as additive
  // migration evidence for the integrity audit; this pass never repairs them.
  await pool.query(`
    WITH mirrored AS (
      SELECT m."Id" AS "MediaId", MIN(p."Id") AS "PersonId"
      FROM "Media" m
      LEFT JOIN "MediaLink" l
        ON l."MediaId" = m."Id" AND l."OwnerTable" = 'People'
      LEFT JOIN "People" p
        ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
      GROUP BY m."Id"
    )
    UPDATE "Media" m SET "PersonId" = mirrored."PersonId"
    FROM mirrored
    WHERE m."Id" = mirrored."MediaId"
      AND (
        m."PersonId" IS NULL OR EXISTS (
          SELECT 1 FROM "People" existing_person
          WHERE existing_person."Id" = m."PersonId"
            AND existing_person."TreeId" = m."TreeId"
        )
      )
      AND m."PersonId" IS DISTINCT FROM mirrored."PersonId";
  `);
  await pool.query(`
    WITH mirrored AS (
      SELECT m."Id" AS "MediaId",
             CASE WHEN EXISTS (
               SELECT 1
               FROM "MediaLink" l
               JOIN "People" p
                 ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
               WHERE l."MediaId" = m."Id"
                 AND l."OwnerTable" = 'People'
                 AND l."OwnerId" = m."PersonId"
                 AND l."IsPrimary" = 1
             ) THEN 1 ELSE 0 END AS "IsPrimary"
      FROM "Media" m
    )
    UPDATE "Media" m SET "IsPrimary" = mirrored."IsPrimary"
    FROM mirrored
    WHERE m."Id" = mirrored."MediaId"
      AND (
        m."IsPrimary" <> 1 OR EXISTS (
          SELECT 1 FROM "People" existing_person
          WHERE existing_person."Id" = m."PersonId"
            AND existing_person."TreeId" = m."TreeId"
        )
      )
      AND m."IsPrimary" IS DISTINCT FROM mirrored."IsPrimary";
  `);
  await pool.query(`
    WITH mirrored AS (
      SELECT t."Id" AS "MediaTagId",
             CASE WHEN EXISTS (
               SELECT 1
               FROM "MediaLink" l
               JOIN "Media" m ON m."Id" = l."MediaId"
               JOIN "People" p
                 ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
               WHERE l."MediaId" = t."MediaId"
                 AND l."OwnerTable" = 'People'
                 AND l."OwnerId" = t."PersonId"
                 AND l."IsPrimary" = 1
             ) THEN 1 ELSE 0 END AS "IsPrimary"
      FROM "MediaTag" t
      JOIN "Media" tagged_media ON tagged_media."Id" = t."MediaId"
      JOIN "People" tagged_person
        ON tagged_person."Id" = t."PersonId"
       AND tagged_person."TreeId" = tagged_media."TreeId"
    )
    UPDATE "MediaTag" t SET "IsPrimary" = mirrored."IsPrimary"
    FROM mirrored
    WHERE t."Id" = mirrored."MediaTagId"
      AND t."IsPrimary" IS DISTINCT FROM mirrored."IsPrimary";
  `);

  // Invalid legacy rows are deliberately never laundered into canonical links.
  // The contract step fails closed so their evidence remains available for a
  // read-only audit instead of being destroyed with the compatibility columns.
  const legacyAnomalyResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE m."PersonId" IS NOT NULL AND p."Id" IS NULL
      )::int AS "danglingMediaOwners",
      COUNT(*) FILTER (
        WHERE p."Id" IS NOT NULL AND p."TreeId" IS DISTINCT FROM m."TreeId"
      )::int AS "crossTreeMediaOwners",
      COUNT(*) FILTER (
        WHERE m."IsPrimary" = 1 AND (m."PersonId" IS NULL OR p."Id" IS NULL)
      )::int AS "danglingMediaPrimaries",
      COUNT(*) FILTER (
        WHERE m."IsPrimary" = 1 AND p."Id" IS NOT NULL
          AND p."TreeId" IS DISTINCT FROM m."TreeId"
      )::int AS "crossTreeMediaPrimaries",
      (
        SELECT COUNT(*)::int
        FROM "MediaTag" t
        JOIN "Media" tm ON tm."Id" = t."MediaId"
        LEFT JOIN "People" tp ON tp."Id" = t."PersonId"
        WHERE t."IsPrimary" = 1 AND tp."Id" IS NULL
      ) AS "danglingTagPrimaries",
      (
        SELECT COUNT(*)::int
        FROM "MediaTag" t
        JOIN "Media" tm ON tm."Id" = t."MediaId"
        LEFT JOIN "People" tp ON tp."Id" = t."PersonId"
        WHERE t."IsPrimary" = 1 AND tp."Id" IS NOT NULL
          AND tp."TreeId" IS DISTINCT FROM tm."TreeId"
      ) AS "crossTreeTagPrimaries"
    FROM "Media" m
    LEFT JOIN "People" p ON p."Id" = m."PersonId";
  `);
  const legacyCountsRow = legacyAnomalyResult.rows[0] as Record<string, unknown> | undefined;
  const legacyCounts = {
    danglingMediaOwners: Number(legacyCountsRow?.danglingMediaOwners ?? 0),
    crossTreeMediaOwners: Number(legacyCountsRow?.crossTreeMediaOwners ?? 0),
    danglingMediaPrimaries: Number(legacyCountsRow?.danglingMediaPrimaries ?? 0),
    crossTreeMediaPrimaries: Number(legacyCountsRow?.crossTreeMediaPrimaries ?? 0),
    danglingTagPrimaries: Number(legacyCountsRow?.danglingTagPrimaries ?? 0),
    crossTreeTagPrimaries: Number(legacyCountsRow?.crossTreeTagPrimaries ?? 0),
  };
  const legacyAnomalyCount = Object.values(legacyCounts).reduce((sum, count) => sum + count, 0);
  if (legacyAnomalyCount > 0) {
    throw new Error(
      `Cannot retire v34 media compatibility contract: ${legacyAnomalyCount} invalid legacy relationship(s)`,
    );
  }

  const legacyMismatchResult = await pool.query(`
    WITH expected_media AS (
      SELECT m."Id" AS "MediaId", MIN(p."Id") AS "PersonId"
      FROM "Media" m
      LEFT JOIN "MediaLink" l
        ON l."MediaId" = m."Id" AND l."OwnerTable" = 'People'
      LEFT JOIN "People" p
        ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
      GROUP BY m."Id"
    ), mismatches AS (
      SELECT 1
      FROM "Media" m
      JOIN expected_media expected ON expected."MediaId" = m."Id"
      WHERE m."PersonId" IS DISTINCT FROM expected."PersonId"
      UNION ALL
      SELECT 1
      FROM "Media" m
      WHERE m."IsPrimary" IS DISTINCT FROM CASE WHEN EXISTS (
        SELECT 1
        FROM "MediaLink" l
        JOIN "People" p
          ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
        WHERE l."MediaId" = m."Id"
          AND l."OwnerTable" = 'People'
          AND l."OwnerId" = m."PersonId"
          AND l."IsPrimary" = 1
      ) THEN 1 ELSE 0 END
      UNION ALL
      SELECT 1
      FROM "MediaTag" t
      JOIN "Media" m ON m."Id" = t."MediaId"
      WHERE t."IsPrimary" IS DISTINCT FROM CASE WHEN EXISTS (
        SELECT 1
        FROM "MediaLink" l
        JOIN "People" p
          ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
        WHERE l."MediaId" = t."MediaId"
          AND l."OwnerTable" = 'People'
          AND l."OwnerId" = t."PersonId"
          AND l."IsPrimary" = 1
      ) THEN 1 ELSE 0 END
      UNION ALL
      SELECT 1
      FROM "MediaLink" l
      JOIN "Media" m ON m."Id" = l."MediaId"
      LEFT JOIN "People" p
        ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
      WHERE l."OwnerTable" = 'People' AND p."Id" IS NULL
      UNION ALL
      SELECT 1
      FROM "MediaLink" l
      JOIN "Media" m ON m."Id" = l."MediaId"
      LEFT JOIN "Families" f
        ON f."Id" = l."OwnerId" AND f."TreeId" = m."TreeId"
      WHERE l."OwnerTable" = 'Families' AND f."Id" IS NULL
      UNION ALL
      SELECT 1
      FROM "MediaLink" l
      JOIN "Media" m ON m."Id" = l."MediaId"
      LEFT JOIN "Events" e
        ON e."Id" = l."OwnerId" AND e."TreeId" = m."TreeId"
      WHERE l."OwnerTable" = 'Events' AND e."Id" IS NULL
      UNION ALL
      SELECT 1
      FROM "MediaLink" l
      JOIN "Media" m ON m."Id" = l."MediaId"
      LEFT JOIN "Sources" s
        ON s."Id" = l."OwnerId" AND s."TreeId" = m."TreeId"
      WHERE l."OwnerTable" = 'Sources' AND s."Id" IS NULL
      UNION ALL
      SELECT 1
      FROM "MediaLink" l
      WHERE l."OwnerTable" NOT IN ('People', 'Families', 'Events', 'Sources')
         OR (l."IsPrimary" = 1 AND l."OwnerTable" <> 'People')
    )
    SELECT COUNT(*)::int AS "issueCount" FROM mismatches;
  `);
  const legacyMismatchCount = Number(
    (legacyMismatchResult.rows[0] as { issueCount?: unknown } | undefined)?.issueCount ?? 0,
  );
  if (legacyMismatchCount > 0) {
    throw new Error(
      `Cannot retire v34 media compatibility contract: ${legacyMismatchCount} canonical mismatch(es)`,
    );
  }

  await pool.query(`
    DO $media_contract$
    BEGIN
      DROP INDEX IF EXISTS idx_media_personid;
      DROP INDEX IF EXISTS idx_mediatag_one_primary;
      ALTER TABLE "Media" DROP COLUMN "PersonId", DROP COLUMN "IsPrimary";
      ALTER TABLE "MediaTag" DROP COLUMN "IsPrimary";
    END
    $media_contract$;
  `);
  }

  // ── v22: backfilled person notes follow their PERSON's tree ────────────────
  // The People."Notes" backfill above inserts Note rows with no "TreeId", so the
  // generic stamping pass just above hands them the owner's DEFAULT tree (lowest
  // Id) — which is wrong for anyone whose person lives in a second tree. Harmless
  // while the person UI read the column directly; ADR 0010 moved every
  // person-notes surface onto getNotesForOwner(..., treeId), which filters on
  // "TreeId", so a legacy note outside the default tree would simply vanish from
  // the UI. Runs here, after the stamping pass, because People."TreeId" is only
  // populated there. Idempotent: IS DISTINCT FROM makes a re-run a no-op.
  await pool.query(`
    UPDATE "Note" n SET "TreeId" = p."TreeId"
    FROM "People" p
    WHERE n."BackfilledFromPersonId" = p."Id"
      AND p."TreeId" IS NOT NULL
      AND n."TreeId" IS DISTINCT FROM p."TreeId";
  `);

  // ── v20: Repository becomes per-TREE ────────────────────────────────────────
  // Runs after the TreeId column-add + stamping above (referencing "TreeId" any
  // earlier crashes a v18 upgrade — the column doesn't exist yet). Order matters:
  // 1) drop the old owner-level constraint FIRST — the per-tree backfill below
  //    may legitimately insert a same-owner same-name row for a second tree,
  //    which the old UNIQUE("OwnerId","Name") would reject with 23505;
  // 2) per-tree Sources→Repository backfill (one row per (TreeId, Name), each
  //    source linked to ITS tree's row — the old owner-keyed pass could link a
  //    non-default tree's source to another tree's repository);
  // 3) dedup any (TreeId, Name) twins (repoint sources to the lowest Id);
  // 4) create the per-tree unique index findOrCreateRepository's ON CONFLICT
  //    targets. All idempotent — re-runs are no-ops.
  await pool.query(`ALTER TABLE "Repository" DROP CONSTRAINT IF EXISTS "Repository_OwnerId_Name_key";`);
  await pool.query(`
    INSERT INTO "Repository" ("OwnerId", "TreeId", "Name")
    SELECT DISTINCT s."OwnerId", s."TreeId", s."RepositoryName"
    FROM "Sources" s
    WHERE s."RepositoryName" IS NOT NULL AND s."RepositoryName" <> ''
      AND s."OwnerId" IS NOT NULL AND s."TreeId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Repository" r
        WHERE r."TreeId" = s."TreeId" AND r."Name" = s."RepositoryName"
      );
  `);
  await pool.query(`
    UPDATE "Sources" s
    SET "RepositoryId" = r."Id"
    FROM "Repository" r
    WHERE s."RepositoryId" IS NULL
      AND s."RepositoryName" IS NOT NULL AND s."RepositoryName" <> ''
      AND r."TreeId" = s."TreeId" AND r."Name" = s."RepositoryName";
  `);
  await pool.query(`
    WITH d AS (
      SELECT "Id",
             MIN("Id") OVER (PARTITION BY "OwnerId", "TreeId", "Name") AS keep
      FROM "Repository"
    )
    UPDATE "Sources" s SET "RepositoryId" = d.keep
    FROM d
    WHERE s."RepositoryId" = d."Id" AND d."Id" <> d.keep;
  `);
  await pool.query(`
    WITH d AS (
      SELECT "Id",
             MIN("Id") OVER (PARTITION BY "OwnerId", "TreeId", "Name") AS keep
      FROM "Repository"
    )
    DELETE FROM "Repository" r USING d
    WHERE r."Id" = d."Id" AND d."Id" <> d.keep;
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_repository_tree_name ON "Repository"("TreeId", "Name");`);

  // ── v20: Places gazetteer becomes per-TREE ──────────────────────────────────
  // Runs after the TreeId stamping above so every legacy row already carries its
  // owner's default tree. Order matters: drop old key → dedup → unique index →
  // per-tree referenced-places backfill (the backfill's ON CONFLICT needs the
  // new index).
  // Skipped once v63 has run: from then on two places may share a name (#1186),
  // and this dedup would merge them on every boot.
  const placesMayShareNames = (await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_places_tree_name_lookup'`,
  )).rows.length > 0;
  if (!placesMayShareNames) {
    await pool.query(`ALTER TABLE "Places" DROP CONSTRAINT IF EXISTS "Places_UserId_Name_key";`);
    // Defensive dedup on the new (TreeId,Name) key. Under the old per-user
    // constraint per-tree duplicates cannot exist (a tree has one owner), so this
    // is a no-op belt-and-braces pass — but if a duplicate ever slipped in, the
    // unique-index CREATE below would fail and boot-loop init. Keep MIN(Id),
    // re-point children/links, then delete.
    await pool.query(`
      WITH d AS (
        SELECT "Id",
               MIN("Id") OVER (PARTITION BY "TreeId", "Name") AS keep
        FROM "Places"
      )
      UPDATE "Places" p SET "ParentId" = d.keep
      FROM d
      WHERE p."ParentId" = d."Id" AND d."Id" <> d.keep;
    `);
    for (const [linkTable, linkKey] of [['NoteLink', 'NoteId'], ['MediaLink', 'MediaId']] as const) {
      // Re-point links to the kept row unless an identical link already exists
      // (composite PK would collide); then drop the leftover duplicate links.
      await pool.query(`
        WITH d AS (
          SELECT "Id",
                 MIN("Id") OVER (PARTITION BY "TreeId", "Name") AS keep
          FROM "Places"
        )
        UPDATE "${linkTable}" l SET "OwnerId" = d.keep
        FROM d
        WHERE l."OwnerTable" = 'Places' AND l."OwnerId" = d."Id" AND d."Id" <> d.keep
          AND NOT EXISTS (
            SELECT 1 FROM "${linkTable}" x
            WHERE x."${linkKey}" = l."${linkKey}" AND x."OwnerTable" = 'Places' AND x."OwnerId" = d.keep
          );
      `);
      await pool.query(`
        WITH d AS (
          SELECT "Id",
                 MIN("Id") OVER (PARTITION BY "TreeId", "Name") AS keep
          FROM "Places"
        )
        DELETE FROM "${linkTable}" l USING d
        WHERE l."OwnerTable" = 'Places' AND l."OwnerId" = d."Id" AND d."Id" <> d.keep;
      `);
    }
    await pool.query(`
      WITH d AS (
        SELECT "Id",
               MIN("Id") OVER (PARTITION BY "TreeId", "Name") AS keep
        FROM "Places"
      )
      DELETE FROM "Places" p USING d
      WHERE p."Id" = d."Id" AND d."Id" <> d.keep;
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_places_tree_name ON "Places"("TreeId", "Name");`);
  }

  // ── v61: facts point at their place by id (#1167, ADR 0031) ────────────────
  // A place has an identity apart from its names: each fact keeps its place as
  // recorded and also points at the gazetteer row through a nullable FK. A place
  // can carry other names ("Lemberg" until 1918, "Lwów", "Львів"), each with an
  // optional language and date range; a fact recorded under one of them points at
  // that place. Unique per tree, like Places."Name": a string names one place, and
  // the place-name services keep the two tables from sharing a string.
  //
  // ON DELETE SET NULL, not CASCADE: deleting a gazetteer row must never delete a
  // fact, and the next link pass recreates the row from the fact's string.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "PlaceName" (
      "Id" SERIAL PRIMARY KEY,
      "PlaceId" INTEGER NOT NULL REFERENCES "Places"("Id") ON DELETE CASCADE,
      "UserId" INTEGER,
      "TreeId" INTEGER NOT NULL,
      "Name" TEXT NOT NULL CHECK (btrim("Name") <> ''),
      "Language" TEXT,
      "FromDate" TEXT,
      "ToDate" TEXT,
      "CreatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_placename_tree_name ON "PlaceName"("TreeId", "Name");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_placename_place ON "PlaceName"("PlaceId");`);
  for (const [table, column] of [['People', 'BirthPlaceId'], ['People', 'DeathPlaceId'], ['Families', 'MarriagePlaceId'], ['Events', 'PlaceId']] as const) {
    await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" INTEGER REFERENCES "Places"("Id") ON DELETE SET NULL;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table.toLowerCase()}_${column.toLowerCase()} ON "${table}"("${column}");`);
  }

  // ── v62: facts also point at which name they use (#1186) ─────────────────
  // The place references become the truth and the fact text a copy of the name
  // they pick: a rename or merge moves references and refreshes the copy instead of
  // rewriting matching strings. A NULL name reference means the place's own name.
  // ON DELETE SET NULL: removing an other name must not delete a fact; the next
  // link pass matches the fact's text again.
  for (const [table, column] of [['People', 'BirthPlaceNameId'], ['People', 'DeathPlaceNameId'], ['Families', 'MarriagePlaceNameId'], ['Events', 'PlaceNameId']] as const) {
    await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" INTEGER REFERENCES "PlaceName"("Id") ON DELETE SET NULL;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table.toLowerCase()}_${column.toLowerCase()} ON "${table}"("${column}");`);
  }

  // ── v63: two places may share a name (#1186, ADR 0036) ──────────────────────
  // "Paris" in France and "Paris" in Ontario are two places that a record may both
  // write as "Paris". The references say which one; a typed name links to the
  // place of that name the most records point at (lowest id on a tie), and failing
  // that to the place it is another name of. Other names stay unique per tree.
  // The plain index both replaces the unique one for lookups and marks that this
  // ran, which keeps the v20 dedup above from merging the places on later boots.
  await pool.query(`DROP INDEX IF EXISTS idx_places_tree_name;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_places_tree_name_lookup ON "Places"("TreeId", "Name");`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION "PlaceUseCount"(place integer) RETURNS bigint
    LANGUAGE sql STABLE AS $fn$
      SELECT (SELECT COUNT(*) FROM "People" p WHERE p."BirthPlaceId" = place)
           + (SELECT COUNT(*) FROM "People" p WHERE p."DeathPlaceId" = place)
           + (SELECT COUNT(*) FROM "Families" f WHERE f."MarriagePlaceId" = place)
           + (SELECT COUNT(*) FROM "Events" e WHERE e."PlaceId" = place)
    $fn$;
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION "PlaceIdByName"(tree integer, place_name text) RETURNS integer
    LANGUAGE sql STABLE AS $fn$
      SELECT COALESCE(
        (SELECT pl."Id" FROM "Places" pl
          WHERE pl."TreeId" = tree AND pl."Name" = place_name
          ORDER BY "PlaceUseCount"(pl."Id") DESC, pl."Id"
          LIMIT 1),
        (SELECT pn."PlaceId" FROM "PlaceName" pn WHERE pn."TreeId" = tree AND pn."Name" = place_name)
      )
    $fn$;
  `);

  // ── v64: facts keep no place text (#1186, ADR 0037) ─────────────────────────
  // The references are a fact's only record of its place; readers build the text
  // from them. A database that still has the text (one from before v64, or restored
  // from one) is linked once more, checked fact by fact, and only then loses the
  // text columns. A fact whose references don't spell its text stops the upgrade.
  if (await hasFactPlaceText(pool)) await dropFactPlaceText(pool);

  // ── v24: clear the bogus Places."Form" left by pre-fix imports (#394) ───────
  // A parser bug used to copy the HEADER's `1 GEDC / 2 FORM LINEAGE-LINKED` into
  // every place's Form, so affected databases now launder a meaningless `3 FORM
  // LINEAGE-LINKED` into every export. 'LINEAGE-LINKED' names a GEDCOM
  // transmission format, never a place jurisdiction, so it is unambiguously
  // garbage wherever it appears in this column.
  //
  // Runs in initializeSchema rather than as a server-only migration so static/
  // PGlite and Tauri users are repaired too — they have no other migration path.
  //
  // Equality-scoped, NOT a LIKE: a legitimate Form such as 'City' or
  // 'City, County' must never be touched. Idempotent — a second run matches
  // nothing. Safe despite being irreversible because "Places"."Form" has no UI
  // writer at all (lib/db/queries/places.ts FOLD_FIELDS; zero hits under
  // app/places/), so no user-typed value can exist to destroy.
  await pool.query(`UPDATE "Places" SET "Form" = NULL WHERE "Form" = 'LINEAGE-LINKED';`);

  // ── v31: one year-extraction rule, callable from SQL (#490, ADR 0016) ───────
  // Mirrors sortableYear() in lib/date-utils.ts exactly. The app stores dates as
  // strings — ISO, GEDCOM qualifiers, and parenthesised free-text phrases — and
  // derives a year when it needs to sort or subtract. That rule lived only in
  // TypeScript, so the two queries in lib/db/queries/families.ts that need a year
  // grew their own `substring(... FROM '\d{4}')` and drifted: a phrase date like
  // "(sometime in the 1850s)" yielded 1850 there and null everywhere else.
  //
  // LANGUAGE sql, not plpgsql: PGlite backs the static and Tauri builds and a
  // plain SQL function needs no procedural-language extension. IMMUTABLE because
  // the result depends on nothing but the argument.
  //
  // Branches, in the same order as splitDateQualifier (lib/date-qualifiers.ts:36):
  //   1. "(...)"          → NULL. Prose has no year; parentheses are authoritative
  //                         and tested BEFORE the prefix table, so "(abt 1850)" is
  //                         a phrase, not an ABT date.
  //   2. "BET x AND y"    → the year of x only. This is the one qualifier whose
  //                         first bound is not simply "the rest of the string", so
  //                         "BET the fire AND 1855" must be NULL rather than 1855.
  //   3. anything else    → the first 4-digit run. Every other qualifier keyword
  //                         (ABT/EST/CAL/BEF/AFT/INT/FROM/TO) is digit-free, so the
  //                         first run of the remainder IS the first run of the whole.
  await pool.query(`
    CREATE OR REPLACE FUNCTION "SortableYear"(d text) RETURNS int
    LANGUAGE sql IMMUTABLE RETURNS NULL ON NULL INPUT AS $fn$
      SELECT CASE
        WHEN btrim(d) = '' THEN NULL
        WHEN length(btrim(d)) >= 2
             AND left(btrim(d), 1) = '('
             AND right(btrim(d), 1) = ')' THEN NULL
        WHEN upper(btrim(d)) ~ '^BET\\s+.+\\s+AND\\s+.+$' THEN
          (regexp_match(
             substring(upper(btrim(d)) from '^BET\\s+(.+?)\\s+AND\\s+.+$'),
             '\\d{4}'))[1]::int
        ELSE (regexp_match(btrim(d), '\\d{4}'))[1]::int
      END
    $fn$;
  `);

  // ── #830: confirmations of unlikely data checks ─────────────────────────────
  // Only confirmations are stored, never check results (#786). A row applies
  // while its rule, threshold and "Facts" (each involved date's fact key and
  // stored string, sorted by key) still match the live problem; otherwise it
  // is stale and ignored, and the problem is back to To check. One row per
  // problem ("Rule", "PersonId"). Deleting the person removes it; an overwrite
  // import, a tree delete and a reset clear it (ADR 0008).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "DataCheckConfirmations" (
      "Id" SERIAL PRIMARY KEY,
      "UserId" INTEGER,
      "TreeId" INTEGER NOT NULL,
      "PersonId" INTEGER NOT NULL REFERENCES "People"("Id") ON DELETE CASCADE,
      "Rule" TEXT NOT NULL,
      "Threshold" INTEGER,
      "Facts" JSONB NOT NULL,
      "Reason" TEXT NOT NULL CHECK (btrim("Reason") <> ''),
      "ConfirmedBy" INTEGER NOT NULL,
      "ConfirmedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_datacheckconfirmations_problem
      ON "DataCheckConfirmations" ("TreeId", "PersonId", "Rule");
  `);

  // ── v23: normalise legacy raw-GEDCOM Events."Date" values (#400) ────────────
  // Runs last: it only needs "Events", and keeping it at the end means a failure
  // here cannot leave the DDL half-applied. Shape-gated and idempotent — see
  // backfill-event-dates.ts for why an already-ISO row must never be re-parsed.
  await backfillEventDates(pool);
}
