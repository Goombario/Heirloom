import { getClient, query } from '@/lib/db/connection';
import { refreshPlannerStats } from '@/lib/db/queries/planner-stats';
import { safeRollback } from '@/lib/db/rollback';
import { parseGedcom, type ParsedMedia, type ParsedMediaRecord, type ParsedMediaRef, type ParsedFactCitation, type CitationPart, type ParsedPerson, type ParsedFamily, type ParsedSource, type ParsedRepository } from '@/lib/gedcom/parser';
import { markRawPointers, maskRawPointers, maskRawPointersSql, RAW_POINTER_MARKER, resolveRawPointerMarkers, type RawPointerKind } from '@/lib/gedcom/raw-pointers';
import { readGedcomText } from '@/lib/gedcom/charset';
import { MAX_GEDCOM_BYTES, MAX_SPREADSHEET_BYTES, capInMegabytes } from '@/lib/import-limits';
import { parseMediaSidecar } from '@/lib/gedcom/media-sidecar';
import { casesSidecarEvidence, parseCaseScope, parseCaseWorkspace, parseCommentLinks, type ParsedCaseWorkspace } from '@/lib/gedcom/cases-sidecar';
import { ensureFirstLead, fileComment, importWorkspace, type ImportedWorkspaceIds } from '@/lib/db/queries/case-workspace';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import type { CaseCommentKind } from '@/lib/db/schema';
import type { ParsedMediaSidecar } from '@/lib/gedcom/media-sidecar';
import { parseSourcesSidecar } from '@/lib/gedcom/sources-sidecar';
import type { SidecarSourceEntry, SidecarNameVariantEntry } from '@/lib/gedcom/sources-sidecar';
import { parsePlacesSidecar } from '@/lib/gedcom/places-sidecar';
import type { SidecarFactPlace, SidecarPlaceEntry } from '@/lib/gedcom/places-sidecar';
import { sidecarVersionWarning } from '@/lib/gedcom/sidecar-version';
import { mergeIdentityAgrees } from '@/lib/gedcom/merge-identity';
import type { GedcomImportStep } from '@/lib/gedcom/import-steps';
import { expectedMediaBasenames, externalReferenceBasename, isExternalMediaReference, mediaBasename, normalizeArchivePath, normalizeArchiveManifest, resolveInitialArchivePath } from '@/lib/gedcom/media-match';
import { cleanupMediaFilesCounting } from '@/lib/media-thumbnail';
import { parseSpreadsheet } from '@/lib/spreadsheet/parser';
import { ValidationError } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import { resolveTreeScope, type TreeScope } from '@/lib/db/queries/trees';
import { auditCreateMany, auditImport } from '@/lib/db/queries/audit-capture';
import { factPlaceColumnFor, factPlaceTextColumns, factPlaceTextSql, linkFactPlaceTexts, resolvePlaceTexts, type FactPlaceText } from '@/lib/db/queries/place-links';
import { applyFactPlaceMap, restorePlaceEntries, sharedNameFacts, upsertPlacesByName, type ImportedRecordIds, type SharedNameFact } from '@/lib/db/queries/place-import';
import { createMediaImportItem } from '@/lib/db/queries/media-import-items';
import type { MediaImportItem } from '@/lib/db/schema';
import type {
  GedcomDryRunResponse,
  GedcomImportWarning,
  GedcomImportResponse,
  SpreadsheetDryRunResponse,
  SpreadsheetImportResponse,
  SkippedRecord,
} from '@/lib/data/types';
import {
  upsertMediaLink,
  clearPrimaryMediaLinksForPerson,
  setPrimaryMediaLink,
  lockPeopleForMediaMutation,
} from '@/lib/db/queries/media-links';
import type { ParsedSpreadsheetPerson, ParsedSpreadsheetFamily } from '@/lib/spreadsheet/parser';
import { liftCitationLink } from '@/lib/gedcom/citation-link';

/** Join captured passthrough lines into a single TEXT value for storage (null when empty). */
function rawGedcom(lines: string[] | undefined): string | null {
  return lines && lines.length ? lines.join('\n') : null;
}

/**
 * Marks the pointers in every passthrough field with their record's kind, so the
 * end of the import can store each one as its record's id (#979). Returns the
 * tags of the pointer lines dropped because the app doesn't keep their record.
 */
function markPassthroughPointers(
  parsed: { people: ParsedPerson[]; families: ParsedFamily[]; sources: ParsedSource[]; repositories: ParsedRepository[]; mediaRecords: ParsedMediaRecord[] },
  recordTypes: ReadonlyMap<string, string>,
): string[] {
  const dropped: string[] = [];
  const mark = (lines: string[]): string[] => {
    const result = markRawPointers(lines, recordTypes);
    dropped.push(...result.dropped);
    return result.lines;
  };
  const markCitations = (citations: ParsedFactCitation[] | undefined) => {
    for (const c of citations ?? []) if (c.rawLines) c.rawLines = mark(c.rawLines);
  };
  for (const p of parsed.people) {
    markCitations(p.citations);
    for (const v of p.nameVariants) markCitations(v.citations);
    p.rawLines = mark(p.rawLines);
    p.birthRawLines = mark(p.birthRawLines);
    p.deathRawLines = mark(p.deathRawLines);
    p.nameRawLines = mark(p.nameRawLines);
    for (const e of p.events) {
      e.rawLines = mark(e.rawLines);
      markCitations(e.citations);
    }
  }
  for (const f of parsed.families) {
    markCitations(f.citations);
    f.rawLines = mark(f.rawLines);
    f.marriageRawLines = mark(f.marriageRawLines);
    for (const e of f.events) {
      e.rawLines = mark(e.rawLines);
      markCitations(e.citations);
    }
    for (const ref of Object.keys(f.chilRawLines)) f.chilRawLines[ref] = mark(f.chilRawLines[ref]);
    for (const ref of Object.keys(f.partnerRawLines)) f.partnerRawLines[ref] = mark(f.partnerRawLines[ref]);
    for (const ref of Object.keys(f.chilFamcRaw)) {
      const lines = mark(f.chilFamcRaw[ref].split('\n'));
      if (lines.length) f.chilFamcRaw[ref] = lines.join('\n');
      else delete f.chilFamcRaw[ref];
    }
  }
  for (const s of parsed.sources) s.rawLines = mark(s.rawLines);
  for (const r of parsed.repositories) {
    r.rawLines = mark(r.rawLines);
    r.addrRawLines = mark(r.addrRawLines);
  }
  for (const m of parsed.mediaRecords) if (m.fileRawLines) m.fileRawLines = mark(m.fileRawLines);
  return dropped;
}

/** Passthrough columns that can hold a pointer, by table (#979). FamilyPerson has its own pass. */
const PASSTHROUGH_COLUMNS: ReadonlyArray<{ table: string; columns: readonly string[] }> = [
  { table: 'People', columns: ['RawGedcom', 'BirthRawGedcom', 'DeathRawGedcom', 'NameRawGedcom'] },
  { table: 'Families', columns: ['RawGedcom', 'MarriageRawGedcom', 'Partner1RawGedcom', 'Partner2RawGedcom'] },
  { table: 'Events', columns: ['RawGedcom'] },
  { table: 'Sources', columns: ['RawGedcom'] },
  { table: 'Repository', columns: ['RawGedcom', 'AddressRawGedcom'] },
  { table: 'Citation', columns: ['RawGedcom'] },
  { table: 'Media', columns: ['FileRawGedcom'] },
];

/**
 * End of import: replaces each passthrough pointer marker this import stored with
 * its record's id, so export can name the record by its own xref (#979). Only
 * this import writes markers, so older passthrough is left as it is. Returns the
 * tags of the pointer lines dropped because their record wasn't kept.
 */
async function resolvePassthroughPointers(
  client: ImportClient,
  treeId: number,
  idOf: (kind: RawPointerKind, xref: string) => number | undefined,
): Promise<string[]> {
  const dropped: string[] = [];
  const resolveRows = (rows: Array<{ raw: string }>) => rows.map((row) => {
    const result = resolveRawPointerMarkers(row.raw, idOf);
    dropped.push(...result.dropped);
    return result.raw;
  });
  for (const { table, columns } of PASSTHROUGH_COLUMNS) {
    for (const column of columns) {
      const rows = (await client.query(
        `SELECT "Id" AS id, "${column}" AS raw FROM "${table}" WHERE "TreeId" = $1 AND POSITION($2 IN "${column}") > 0`,
        [treeId, RAW_POINTER_MARKER],
      )).rows as Array<{ id: number; raw: string }>;
      if (rows.length === 0) continue;
      await client.query(
        `UPDATE "${table}" t SET "${column}" = v.raw
           FROM unnest($1::int[], $2::text[]) AS v(id, raw)
          WHERE t."Id" = v.id AND t."TreeId" = $3`,
        [rows.map((row) => row.id), resolveRows(rows), treeId],
      );
    }
  }
  for (const column of ['FamcRawGedcom', 'ChilRawGedcom']) {
    const rows = (await client.query(
      `SELECT fp."ChildrenId" AS child, fp."FamiliesAsChildId" AS family, fp."${column}" AS raw
         FROM "FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId"
        WHERE f."TreeId" = $1 AND POSITION($2 IN fp."${column}") > 0`,
      [treeId, RAW_POINTER_MARKER],
    )).rows as Array<{ child: number; family: number; raw: string }>;
    if (rows.length === 0) continue;
    await client.query(
      `UPDATE "FamilyPerson" fp SET "${column}" = v.raw
         FROM unnest($1::int[], $2::int[], $3::text[]) AS v(child, family, raw)
        WHERE fp."ChildrenId" = v.child AND fp."FamiliesAsChildId" = v.family`,
      [rows.map((row) => row.child), rows.map((row) => row.family), resolveRows(rows)],
    );
  }
  return dropped;
}

/**
 * Persist parsed notes for one owner record into the Note + NoteLink model
 * (Slice 1). Each note becomes a `Note` row owned by the tree owner, linked to
 * the owner via `NoteLink`. GedcomXref preserves the import-time `@N@` pointer so
 * a shared NOTE record can round-trip. Runs inside the import transaction.
 */
async function insertNotes(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ Id: number }> }> },
  scope: TreeScope,
  ownerTable: 'Families' | 'Sources' | 'Events' | 'Repository' | 'People',
  ownerId: number,
  notes: Array<{ text: string | null; xref: string | null; ownerFact?: 'Birth' | 'Death' | 'Marriage' }>,
): Promise<void> {
  for (const n of notes) {
    if (!n.text || !n.text.trim()) continue;
    let noteId: number | undefined;
    if (n.xref) {
      const existing = await client.query(
        `SELECT "Id" FROM "Note" WHERE "TreeId" = $1 AND "GedcomXref" = $2 ORDER BY "Id" ASC LIMIT 1`,
        [scope.treeId, n.xref],
      );
      noteId = existing.rows[0]?.Id;
    }
    if (noteId === undefined) {
      const inserted = await client.query(
        `INSERT INTO "Note" ("OwnerId", "TreeId", "Text", "GedcomXref") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
        [scope.ownerId, scope.treeId, n.text, n.xref],
      );
      noteId = inserted.rows[0].Id;
    }
    await client.query(
      `INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "OwnerFact")
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [noteId, ownerTable, ownerId, n.ownerFact ?? null],
    );
  }
}

/**
 * The media fields the importer actually persists, common to both shapes it
 * receives: a person's media is `Media[]` (the schema row, carrying
 * `ContentType`), a family's is `ParsedMedia[]` (carrying `xref` instead).
 * Neither extra field is read on these paths, so one structural type serves both
 * and avoids a cast at the call sites.
 */
type MergeableMedia = {
  Title: string | null;
  FilePath: string | null;
  Format: string | null;
  FocalX?: number | null;
  FocalY?: number | null;
  FocalRadius?: number | null;
  ContentType?: string | null;
  legacyPrimary?: number | null;
  /** The owner's vital fact this OBJE sat under (ADR 0030). */
  ownerFact?: 'Birth' | 'Death' | 'Marriage';
};

interface ImportMediaExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

interface MediaImportContext {
  items: MediaImportItem[];
  importId: string;
  archiveManifest: string[];
  allowLegacyV1: boolean;
  modernSidecar: boolean;
  v1TaggedBasenames: Set<string>;
  v2TaggedXrefs: Set<string>;
  /** null means the v1 basename is ambiguous and must not resolve by guesswork. */
  basenameToMediaId: Map<string, number | null>;
  mediaXrefToId: Map<string, number>;
  /** Media rows this import inserted, to report the ones no bundle file fills (#960). */
  insertedMedia: number;
  /**
   * The place text of every fact this import wrote (ADR 0037). A fact keeps its place
   * only as a reference, linked from these once the import's places exist.
   */
  factPlaces: FactPlaceText[];
}

/** A sidecar timestamp as an ISO instant, or null when absent or unparseable. */
function sidecarInstant(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

const CASE_STATUS_ENTRIES: ReadonlySet<string> = new Set(['in_progress', 'on_hold', 'closed', 'reopened']);
const CASE_LEAD_ENTRIES: ReadonlySet<string> = new Set(['added', 'settled', 'reopened', 'dropped']);

/**
 * A cases.json journal entry's Kind (#801). An unknown kind, or a status line
 * whose body isn't a status, imports as a plain note so its text still shows.
 */
function caseCommentKind(kind: unknown, body: string): CaseCommentKind | null {
  if (kind === 'conclusion') return 'conclusion';
  if (kind === 'status' && CASE_STATUS_ENTRIES.has(body)) return 'status';
  // The research workspace's entries (#58, ADR 0045).
  if (kind === 'finding' || kind === 'search' || kind === 'request' || kind === 'reply') return kind;
  if (kind === 'lead' && CASE_LEAD_ENTRIES.has(body)) return 'lead';
  return null;
}

function freshUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function archivePathForMedia(filePath: string | null, xref: string | null): string | null {
  if (!filePath) return null;
  // An absolute path or URL can only match a bundle entry by its file name, the
  // legacy-v1 rule; it is never resolved as a path (#958).
  const normalized = isExternalMediaReference(filePath) ? externalReferenceBasename(filePath) : normalizeArchivePath(filePath);
  if (!normalized) return null;
  const filename = normalized.split('/').pop() ?? normalized;
  if (!filename) return null;
  // A top-level xref is document-local, but its declared path is the bundle
  // identity. App exports declare media/O<n>-... (v3) or media/O<n>/... (v2), while foreign GEDCOM bundles
  // may declare another normalized path (for example photos/a.jpg). Preserve
  // either exact path; only a legacy bare filename needs the app convention.
  if (xref && !normalized.includes('/')) return `media/${xref.replace(/^@|@$/g, '')}/${filename}`;
  return normalized;
}

function expectedMediaRef(media: { FilePath: string | null }, xref: string | null = null): { archivePath: string; originalFilename: string } | null {
  if (!media.FilePath) return null;
  const archivePath = archivePathForMedia(media.FilePath, xref);
  if (!archivePath) return null;
  const originalFilename = isExternalMediaReference(media.FilePath)
    ? mediaBasename(archivePath)
    : media.FilePath.split(/[\\/]/).pop() ?? media.FilePath;
  return { archivePath, originalFilename };
}

/** The import's rule for matching a media file by name alone; the preview hands it to the overwrite check (#1005). */
function allowsBasenameFallback(filePath: string, sidecar: { allowLegacyV1: boolean; modernSidecar: boolean }): boolean {
  return sidecar.allowLegacyV1
    || isExternalMediaReference(filePath)
    || (!sidecar.modernSidecar && !filePath.includes('/') && !filePath.includes('\\'));
}

function registerBasename(context: MediaImportContext, filename: string, mediaId: number): void {
  const current = context.basenameToMediaId.get(filename);
  if (current === undefined) {
    context.basenameToMediaId.set(filename, mediaId);
  } else if (current !== mediaId) {
    // v1 sidecars identify media only by basename. Once two distinct rows share
    // that basename, retaining either row would make tags/primary state
    // nondeterministic, so mark the identity ambiguous permanently.
    context.basenameToMediaId.set(filename, null);
  }
}

function addMediaRef(context: MediaImportContext, mediaId: number, media: MergeableMedia, xref: string | null): void {
  const archivePath = archivePathForMedia(media.FilePath, xref);
  if (!archivePath) return;
  const originalFilename = archivePath.split('/').pop() ?? archivePath;
  registerBasename(context, originalFilename, mediaId);
}

async function addMediaImportItem(
  client: ImportMediaExecutor,
  scope: TreeScope,
  context: MediaImportContext,
  mediaId: number,
  media: MergeableMedia,
  documentMediaId: string,
  xref: string | null,
): Promise<void> {
  const expected = expectedMediaRef(media, xref);
  if (!expected) return;
  const archivePath = resolveInitialArchivePath(expected, context.archiveManifest, {
    allowLegacyV1: allowsBasenameFallback(media.FilePath!, context),
  });
  const originalFilename = expected.originalFilename;
  const item = await createMediaImportItem({
    importId: context.importId,
    documentMediaId,
    treeId: scope.treeId,
    mediaId,
    archivePath,
    originalFilename,
    skipFaceCapture: Boolean(
      (xref && context.v2TaggedXrefs.has(xref)) ||
      context.v1TaggedBasenames.has(originalFilename),
  ),
  }, client);
  context.items.push(item);
}

async function linkImportedMedia(
  client: ImportMediaExecutor,
  treeId: number,
  mediaId: number,
  ownerTable: 'People' | 'Families' | 'Sources' | 'Events',
  ownerId: number,
  primary: number,
  ownerFact: 'Birth' | 'Death' | 'Marriage' | null = null,
): Promise<void> {
  await upsertMediaLink({ mediaId, ownerTable, ownerId, ownerFact }, client);
  // A fact's photo is never the portrait (ADR 0030), whatever `_PRIM` it carried.
  if (ownerTable === 'People' && primary === 1 && ownerFact === null) {
    await lockPeopleForMediaMutation([ownerId], treeId, client);
    await clearPrimaryMediaLinksForPerson(ownerId, client);
    await setPrimaryMediaLink(mediaId, ownerId, client);
  }
}

async function applyMediaRefs(
  client: ImportClient,
  context: MediaImportContext,
  treeId: number,
  ownerTable: 'People' | 'Families' | 'Sources' | 'Events',
  ownerId: number,
  refs: ParsedMediaRef[],
): Promise<void> {
  for (const ref of refs) {
    const mediaId = context.mediaXrefToId.get(ref.xref);
    if (mediaId === undefined) continue;
    await linkImportedMedia(
      client, treeId, mediaId, ownerTable, ownerId,
      ownerTable === 'People' && ref.legacyPrimary === 1 ? 1 : 0, ref.ownerFact ?? null,
    );
  }
}
/**
 * Persist parsed family/source media into the Media + MediaLink model (Slice 2).
 * Mirrors the person-media path: FilePath is inserted NULL (the actual bytes ride
 * in the zip and are matched/materialized per-file via `mediaItems`), ownership lives
 * only in MediaLink, and the basename is registered so the
 * client can match the uploaded file. Runs inside the import transaction.
 */
async function insertOwnerMedia(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ Id: number }> }> },
  scope: TreeScope,
  ownerTable: 'People' | 'Families' | 'Sources' | 'Events',
  ownerId: number,
  items: MergeableMedia[],
  context: MediaImportContext,
): Promise<void> {
  for (const m of items) {
    const primary = ownerTable === 'People' && m.legacyPrimary === 1 && !m.ownerFact;
    if (primary) await lockPeopleForMediaMutation([ownerId], scope.treeId, client);
    const res = await client.query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FocalX", "FocalY", "FocalRadius", "SourceFile")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING "Id"`,
      [scope.ownerId, scope.treeId, m.Title, null, m.Format, null, m.FocalX ?? null, m.FocalY ?? null, m.FocalRadius ?? null, m.FilePath],
    );
    const mediaId = res.rows[0].Id;
    context.insertedMedia++;
    await linkImportedMedia(client, scope.treeId, mediaId, ownerTable, ownerId, primary ? 1 : 0, m.ownerFact ?? null);
    addMediaRef(context, mediaId, m, null);
    await addMediaImportItem(client, scope, context, mediaId, m, freshUuid(), null);
  }
}
/**
 * Import every inline occurrence in this document. Media identity is local to
 * the current GEDCOM document; merge mode must not infer identity from any
 * pre-existing row's title, format, path, or basename.
 */
async function insertOwnerMediaMerge(
  client: ImportClient,
  scope: TreeScope,
  ownerTable: 'Sources' | 'Events',
  ownerId: number,
  items: MergeableMedia[],
  context: MediaImportContext,
): Promise<void> {
  await insertOwnerMedia(client, scope, ownerTable, ownerId, items, context);
}

/**
 * Find or create the Repository row for a source's archive name (Slice 4), so
 * sources link to a shared entity instead of a free-text string. Deduped per
 * import via `cache` (name → id). Address backfills only when currently empty.
 */
async function findOrCreateRepository(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ Id: number }> }> },
  scope: TreeScope,
  name: string | null,
  address: string | null,
  cache: Map<string, number>,
): Promise<number | null> {
  if (!name || !name.trim()) return null;
  const key = name.trim();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Single race-safe upsert on the per-tree unique index (TreeId, Name): a
  // same-named repository in a SIBLING tree no longer conflicts (the old
  // owner-level constraint aborted the whole import with 23505 in that case).
  // Address fills in only when the existing row has none — same semantics as
  // the old select-then-update branch.
  const upserted = await client.query(
    `INSERT INTO "Repository" ("OwnerId", "TreeId", "Name", "Address") VALUES ($1, $2, $3, $4)
     ON CONFLICT ("TreeId", "Name") DO UPDATE SET
       "Address" = COALESCE("Repository"."Address", EXCLUDED."Address")
     RETURNING "Id"`,
    [scope.ownerId, scope.treeId, key, address ?? null],
  );
  const id: number = upserted.rows[0].Id;
  cache.set(key, id);
  return id;
}

// ── Spreadsheet duplicate-detection helpers (extracted from the route) ─────────

async function findDuplicatePeople(
  treeId: number,
  people: ParsedSpreadsheetPerson[]
): Promise<Set<number>> {
  const candidates = people.filter((p) => p.FirstName || p.LastName);
  if (candidates.length === 0) return new Set();

  const firstNames = candidates.map((p) => p.FirstName ?? null);
  const lastNames = candidates.map((p) => p.LastName ?? null);
  const birthDates = candidates.map((p) => p.BirthDate ?? null);
  const rowIds = candidates.map((p) => p.rowId);

  const result = await query(
    `SELECT candidates.row_id::int AS row_id
     FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
          AS candidates(first_name, last_name, birth_date, row_id)
     WHERE EXISTS (
         SELECT 1 FROM "People" p
         WHERE p."TreeId" = $5
           AND LOWER(COALESCE(p."FirstName", '')) = LOWER(COALESCE(candidates.first_name, ''))
           AND LOWER(COALESCE(p."LastName", '')) = LOWER(COALESCE(candidates.last_name, ''))
           AND (candidates.birth_date IS NULL OR p."BirthDate" = candidates.birth_date)
     )`,
    [firstNames, lastNames, birthDates, rowIds, treeId]
  );

  return new Set(result.rows.map((r) => r.row_id as number));
}

async function findDuplicateFamilies(
  treeId: number,
  families: ParsedSpreadsheetFamily[],
  people: ParsedSpreadsheetPerson[]
): Promise<Set<number>> {
  const personByRowId = new Map(people.map((p) => [p.rowId, p]));

  const candidates = families.filter((f) => {
    const husband = f.husbandRowId !== null ? personByRowId.get(f.husbandRowId) : null;
    const wife = f.wifeRowId !== null ? personByRowId.get(f.wifeRowId) : null;
    return husband || wife;
  });
  if (candidates.length === 0) return new Set();

  const husbFirstNames = candidates.map((f) =>
    f.husbandRowId !== null ? (personByRowId.get(f.husbandRowId)?.FirstName ?? null) : null
  );
  const husbLastNames = candidates.map((f) =>
    f.husbandRowId !== null ? (personByRowId.get(f.husbandRowId)?.LastName ?? null) : null
  );
  const wifeFirstNames = candidates.map((f) =>
    f.wifeRowId !== null ? (personByRowId.get(f.wifeRowId)?.FirstName ?? null) : null
  );
  const wifeLastNames = candidates.map((f) =>
    f.wifeRowId !== null ? (personByRowId.get(f.wifeRowId)?.LastName ?? null) : null
  );
  const marriageDates = candidates.map((f) => f.MarriageDate ?? null);
  const familyIds = candidates.map((f) => f.familyId);

  const result = await query(
    `SELECT candidates.family_id::int AS family_id
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
          AS candidates(husb_first, husb_last, wife_first, wife_last, marriage_date, family_id)
     WHERE EXISTS (
         SELECT 1
         FROM "Families" f
         LEFT JOIN "People" h ON h."Id" = COALESCE(f."Partner1Id", f."HusbandId") AND h."TreeId" = $7
         LEFT JOIN "People" w ON w."Id" = COALESCE(f."Partner2Id", f."WifeId")    AND w."TreeId" = $7
         WHERE f."TreeId" = $7
           AND LOWER(COALESCE(h."FirstName", '')) = LOWER(COALESCE(candidates.husb_first, ''))
           AND LOWER(COALESCE(h."LastName",  '')) = LOWER(COALESCE(candidates.husb_last,  ''))
           AND LOWER(COALESCE(w."FirstName", '')) = LOWER(COALESCE(candidates.wife_first, ''))
           AND LOWER(COALESCE(w."LastName",  '')) = LOWER(COALESCE(candidates.wife_last,  ''))
           AND (candidates.marriage_date IS NULL OR f."MarriageDate" = candidates.marriage_date)
     )`,
    [husbFirstNames, husbLastNames, wifeFirstNames, wifeLastNames, marriageDates, familyIds, treeId]
  );

  return new Set(result.rows.map((r) => r.family_id as number));
}

function personIdentifier(p: ParsedSpreadsheetPerson): string {
  const name = [p.FirstName, p.LastName].filter(Boolean).join(' ') || 'Unknown';
  return p.BirthDate ? `${name} (born ${p.BirthDate})` : name;
}

function familyIdentifier(
  family: ParsedSpreadsheetFamily,
  personByRowId: Map<number, ParsedSpreadsheetPerson>
): string {
  const husband = family.husbandRowId !== null ? personByRowId.get(family.husbandRowId) : null;
  const wife = family.wifeRowId !== null ? personByRowId.get(family.wifeRowId) : null;
  const husbName = husband
    ? [husband.FirstName, husband.LastName].filter(Boolean).join(' ')
    : 'Unknown';
  const wifeName = wife
    ? [wife.FirstName, wife.LastName].filter(Boolean).join(' ')
    : 'Unknown';
  const base = `${husbName} + ${wifeName}`;
  return family.MarriageDate ? `${base} (married ${family.MarriageDate})` : base;
}

// ── GEDCOM citation helper ─────────────────────────────────────────────────────

/** SOURCE_CITATION evidence fields (Slice 3) carried from a parsed GEDCOM citation. */
interface CitationEvidence {
  quay?: string | null;
  dataText?: string | null;
  dataDate?: string | null;
  even?: string | null;
  role?: string | null;
  /** Sub-lines the app doesn't model, such as an OBJE (#976). */
  rawLines?: string[];
  /** The fact's DATE or PLAC the citation supports (#990). */
  part?: CitationPart;
  /** A record link a sidecar carries as a field; a `_LINK` in `rawLines` wins (ADR 0025). */
  url?: string | null;
}

/** The Citation fields a merge fills where they are empty, in `fill` order. */
const CITATION_FILL_COLUMNS = ['RawGedcom', 'Url', 'Quay', 'DataText', 'DataDate', 'Even', 'Role'] as const;
type CitationFillColumn = (typeof CITATION_FILL_COLUMNS)[number];

/** A stored citation, as the merge duplicate check reads it. */
type IndexedCitation = { Id: number; FactTable: string; FactId: number; SourceId: number; Page: string | null; Part: string | null; Note: string | null; Before: boolean }
  & Record<CitationFillColumn, string | null>;

/**
 * The tree's citations, read once when a merge import starts, so its duplicate
 * check doesn't cost a query per citation (#999). insertCitation keeps it in step
 * with every row it inserts or fills, and nothing else in an import writes
 * Citation rows, so a lookup sees exactly what the SQL check would.
 */
class CitationIndex {
  private readonly byFact = new Map<string, IndexedCitation[]>();

  static async load(client: ImportClient, treeId: number): Promise<CitationIndex> {
    const index = new CitationIndex();
    const res = await client.query(
      `SELECT "Id", "FactTable", "FactId", "SourceId", "Page", "Part", "Note",
              ("CreatedAt" < now()) IS TRUE AS "Before", ${CITATION_FILL_COLUMNS.map((c) => `"${c}"`).join(', ')}
         FROM "Citation" WHERE "TreeId" = $1 ORDER BY "Id"`,
      [treeId],
    );
    for (const row of res.rows as IndexedCitation[]) index.add(row);
    return index;
  }

  add(row: IndexedCitation): void {
    const key = `${row.FactTable}\u0000${row.FactId}`;
    const list = this.byFact.get(key);
    if (list) list.push(row);
    else this.byFact.set(key, [row]);
  }

  /** The SQL duplicate check in insertCitation, against the index. */
  find(tables: string[], factId: number, sourceId: number, page: string | null, part: string | null, note?: string | null): IndexedCitation | null {
    let best: IndexedCitation | null = null;
    for (const table of tables) {
      for (const row of this.byFact.get(`${table}\u0000${factId}`) ?? []) {
        if (row.SourceId !== sourceId || row.Page !== page) continue;
        if (row.Part !== part && !(row.Part === null && row.Before)) continue;
        if (note !== undefined && row.Note !== note) continue;
        // ORDER BY "Part" IS NULL: a part citation first, then the oldest.
        if (!best || (best.Part === null && row.Part !== null) || ((best.Part === null) === (row.Part === null) && row.Id < best.Id)) best = row;
      }
    }
    return best;
  }
}

/** The citation index of each client running a merge import (#999). */
const citationIndexes = new WeakMap<object, CitationIndex>();

async function insertCitation(
  client: ImportClient,
  scope: TreeScope,
  factTable: string,
  factId: number,
  sourceId: number,
  page: string | null,
  note: string | null,
  mode: 'overwrite' | 'merge',
  evidence?: CitationEvidence,
  dedupeByNote = false,
): Promise<boolean> {
  // The first `_LINK` / `_URL` / `WWW` under the citation is its record link, not passthrough (ADR 0025).
  const lifted = liftCitationLink(evidence?.rawLines ?? []);
  const link = { ...lifted, url: lifted.url ?? evidence?.url ?? null };
  const raw = rawGedcom(link.rest);
  const part = evidence?.part ?? null;
  // A missing value binds as NULL in SQL; the index compares with ===, so normalize.
  page = page ?? null;
  note = note ?? null;
  const index = citationIndexes.get(client);
  if (mode === 'merge') {
    // A tree imported before #962 holds its marriage citations as whole-family
    // ones, so merging the same file again must not add them a second time.
    const dupTables = factTable === 'FamilyMarriage' ? [factTable, 'Families'] : [factTable];
    // Likewise a tree imported before #990 holds its DATE/PLAC citations as
    // whole-fact ones, so a part citation also matches one with no part, but
    // only one stored before this import's transaction began: a whole-fact
    // citation this file has just written must not swallow its part twin.
    const dup = index
      ? index.find(dupTables, factId, sourceId, page, part, dedupeByNote ? note : undefined)
      : (await client.query(
        `SELECT "Id", ${CITATION_FILL_COLUMNS.map((c) => `"${c}"`).join(', ')} FROM "Citation"
         WHERE "TreeId" = $1 AND "FactTable" = ANY($2) AND "FactId" = $3 AND "SourceId" = $4
           AND "Page" IS NOT DISTINCT FROM $5 AND ("Part" IS NOT DISTINCT FROM $6 OR ("Part" IS NULL AND "CreatedAt" < now()))${dedupeByNote ? ' AND "Note" IS NOT DISTINCT FROM $7' : ''}
         ORDER BY "Part" IS NULL
         LIMIT 1`,
        dedupeByNote
          ? [scope.treeId, dupTables, factId, sourceId, page, part, note]
          : [scope.treeId, dupTables, factId, sourceId, page, part]
      )).rows[0] as ({ Id: number } & Record<CitationFillColumn, string | null>) | undefined;
    if (dup) {
      // A citation imported before #976 gains its media, and one without a link
      // gains this one's (ADR 0025); likewise each evidence field it lacks (#1035).
      // What it already has, it keeps.
      const fill = [raw, link.url, evidence?.quay ?? null, evidence?.dataText ?? null, evidence?.dataDate ?? null, evidence?.even ?? null, evidence?.role ?? null];
      // Skip the write when every value would land on a field the row already
      // has: it would change nothing, and a re-merge would pay for it per citation (#999).
      if (fill.some((value, i) => value !== null && dup[CITATION_FILL_COLUMNS[i]] === null)) {
        await client.query(
          `UPDATE "Citation" SET "RawGedcom" = COALESCE("RawGedcom", $3), "Url" = COALESCE("Url", $4),
             "Quay" = COALESCE("Quay", $5), "DataText" = COALESCE("DataText", $6), "DataDate" = COALESCE("DataDate", $7),
             "Even" = COALESCE("Even", $8), "Role" = COALESCE("Role", $9)
           WHERE "Id" = $1 AND "TreeId" = $2`,
          [dup.Id, scope.treeId, ...fill],
        );
        CITATION_FILL_COLUMNS.forEach((column, i) => { dup[column] ??= fill[i]; });
      }
      return false;
    }
  }
  const inserted = await client.query(
    `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page", "Note", "Quay", "DataText", "DataDate", "Even", "Role", "RawGedcom", "Part", "Url")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING "Id"`,
    [
      scope.ownerId, scope.treeId, factTable, factId, sourceId, page, note,
      evidence?.quay ?? null, evidence?.dataText ?? null, evidence?.dataDate ?? null,
      evidence?.even ?? null, evidence?.role ?? null, raw,
      part, link.url,
    ]
  );
  index?.add({
    Id: (inserted.rows[0] as { Id: number }).Id, FactTable: factTable, FactId: factId, SourceId: sourceId,
    Page: page, Part: part, Note: note, Before: false,
    RawGedcom: raw, Url: link.url, Quay: evidence?.quay ?? null, DataText: evidence?.dataText ?? null,
    DataDate: evidence?.dataDate ?? null, Even: evidence?.even ?? null, Role: evidence?.role ?? null,
  });
  return true;
}

/** Resolve an old cases.json free-text citation to the shared Source model. */
async function findOrCreateLegacyCaseCitationSource(
  client: ImportClient,
  scope: TreeScope,
  title: string,
  url: string | null,
): Promise<number> {
  const existing = await client.query(
    `SELECT "Id" FROM "Sources"
     WHERE "TreeId" = $1 AND LOWER("Title") = LOWER($2)
       AND "Text" IS NOT DISTINCT FROM $3
     ORDER BY "Id" ASC LIMIT 1`,
    [scope.treeId, title, url],
  );
  if (existing.rows[0]) return (existing.rows[0] as { Id: number }).Id;

  const inserted = await client.query(
    `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Type", "Text")
     VALUES ($1, $2, $3, 'Other', $4) RETURNING "Id"`,
    [scope.ownerId, scope.treeId, title, url],
  );
  return (inserted.rows[0] as { Id: number }).Id;
}

// ── GEDCOM event import (shared by new-entity + merge-into-existing paths) ──────

type ImportClient = Awaited<ReturnType<typeof getClient>>;

/** The subset of a parsed person/family event the importer persists. */
interface ImportableEvent {
  Type: string;
  Date: string | null;
  Place: string | null;
  Description: string | null;
  citations: ParsedFactCitation[];
  media: ParsedMedia[];
  mediaRefs: ParsedMediaRef[];
  notes: Array<{ text: string | null; xref: string | null }>;
  /** Verbatim sub-tags this parser does not model, preserved for round-trip (#423). */
  rawLines: string[];
}

/** Normalized, non-empty set of shared-note texts. */
function noteTextSet(texts: Array<string | null>): Set<string> {
  return new Set(texts.map((text) => (text ?? '').trim()).filter(Boolean));
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Find an existing event on the same owner that a merge import should treat as
 * the SAME event, so re-importing the same file doesn't fork duplicate rows.
 * The natural key is Type + Date + Description + the set of attached shared-note
 * texts — per the merge design, two same-type/same-date events with different
 * descriptions or notes stay distinct (the note check is why a stray same-day
 * event isn't collapsed). Date/Description use IS NOT DISTINCT FROM so NULLs
 * match. Returns the matched event Id, or null to insert a fresh row.
 */
async function findDuplicateEvent(
  client: ImportClient,
  treeId: number,
  ownerCol: 'PersonId' | 'FamilyId',
  ownerId: number,
  event: ImportableEvent,
  claimed: ReadonlySet<number>,
): Promise<number | null> {
  // Each candidate comes with its attached note texts, so one query decides (#999).
  const candidates = await client.query(
    `SELECT e."Id",
            COALESCE((SELECT ARRAY_AGG(n."Text") FROM "NoteLink" nl JOIN "Note" n ON n."Id" = nl."NoteId"
                       WHERE nl."OwnerTable" = 'Events' AND nl."OwnerId" = e."Id"), '{}') AS "NoteTexts"
       FROM "Events" e
      WHERE e."TreeId" = $1 AND e."${ownerCol}" = $2 AND e."Type" = $3
        AND e."Date" IS NOT DISTINCT FROM $4
        AND e."Description" IS NOT DISTINCT FROM $5
      ORDER BY e."Id"`,
    [treeId, ownerId, event.Type, event.Date, event.Description],
  );
  const rows = candidates.rows as Array<{ Id: number; NoteTexts: Array<string | null> }>;
  if (rows.length === 0) return null;
  const incomingNotes = noteTextSet(event.notes.map((n) => n.text));
  for (const row of rows) {
    if (claimed.has(row.Id)) continue;
    if (sameStringSet(incomingNotes, noteTextSet(row.NoteTexts))) return row.Id;
  }
  return null;
}

/**
 * Persist one parsed event (row + its citations, media, and notes) under a
 * person or family, and return how many citations were newly inserted.
 *
 * `claimedEvents` is passed only by the merge-into-EXISTING-owner paths: they may
 * hit an event already in the DB, so we reuse it (via findDuplicateEvent) and
 * merge in only its citations, which insertCitation dedups. Notes remain part of
 * the event identity; inline media is always imported for the current document,
 * including when the event row is reused. The set holds the events this import
 * already reused or created, so two identical events in the file never fold into
 * one, moving the second one's citations onto the first (#960). New-entity paths
 * pass null to keep their historical always-insert behavior byte-for-byte.
 */
async function importEvent(
  client: ImportClient,
  scope: TreeScope,
  ownerCol: 'PersonId' | 'FamilyId',
  ownerId: number,
  event: ImportableEvent,
  mode: 'overwrite' | 'merge',
  claimedEvents: Set<number> | null,
  sourceXrefToId: Map<string, number>,
  context: MediaImportContext,
): Promise<number> {
  const existingId = claimedEvents ? await findDuplicateEvent(client, scope.treeId, ownerCol, ownerId, event, claimedEvents) : null;

  let eventId: number;
  if (existingId !== null) {
    eventId = existingId;
  } else {
    const evtRes = await client.query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "Description", "${ownerCol}", "RawGedcom")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING "Id"`,
      [scope.ownerId, scope.treeId, event.Type, event.Date, event.Description, ownerId, rawGedcom(event.rawLines)],
    );
    eventId = (evtRes.rows[0] as { Id: number }).Id;
    context.factPlaces.push({ field: 'Place', recordId: eventId, text: event.Place });
  }
  claimedEvents?.add(eventId);

  let importedCitations = 0;
  for (const c of event.citations) {
    const sid = sourceXrefToId.get(c.sourceXref);
    if (sid && await insertCitation(client, scope, 'Events', eventId, sid, c.page, c.note, mode, c)) importedCitations++;
  }

  // Reused events still receive every inline media occurrence from this import.
  if (existingId === null) {
    await insertOwnerMedia(client, scope, 'Events', eventId, event.media, context);
    await insertNotes(client, scope, 'Events', eventId, event.notes);
  } else {
    await insertOwnerMediaMerge(client, scope, 'Events', eventId, event.media, context);
  }
    await applyMediaRefs(client, context, scope.treeId, 'Events', eventId, event.mediaRefs);

  return importedCitations;
}

// ── Service parameter types ────────────────────────────────────────────────────

export interface PreviewGedcomParams {
  file: File;
  mode: 'overwrite' | 'merge';
  mediaJson?: string | null;
  sourcesJson?: string | null;
  currentUserId: number;
}

export interface ImportGedcomParams {
  file: File;
  mode: 'overwrite' | 'merge';
  casesJson?: string | null;
  mediaJson?: string | null;
  sourcesJson?: string | null;
  /** places.json — the gazetteer (#402). Primary for what it carries; the .ged has no PLACE record. */
  placesJson?: string | null;
  /** Normalized archive entries selected from the uploaded bundle. */
  archiveManifest?: string[];
  currentUserId: number;
  /** Tree requested via ?treeId, or null/omitted (→ default-tree resolution). */
  requestedTreeId?: number | null;
  /** Legacy ?ownerId (deep-link compat): that user's default tree. */
  requestedOwnerId?: number | null;
  /** Called as each phase starts, for the browser build's progress bar (ST-1). */
  onProgress?: (step: GedcomImportStep) => void;
}

export interface PreviewSpreadsheetParams {
  file: File;
  dateFormat: 'MDY' | 'DMY';
  currentUserId: number;
  /** Tree requested via ?treeId, or null/omitted (→ default-tree resolution). */
  requestedTreeId?: number | null;
  /** Legacy ?ownerId (deep-link compat): that user's default tree. */
  requestedOwnerId?: number | null;
}

export interface ImportSpreadsheetParams {
  file: File;
  dateFormat: 'MDY' | 'DMY';
  currentUserId: number;
  /** Tree requested via ?treeId, or null/omitted (→ default-tree resolution). */
  requestedTreeId?: number | null;
  /** Legacy ?ownerId (deep-link compat): that user's default tree. */
  requestedOwnerId?: number | null;
}

export interface ResetParams {
  currentUserId: number;
}

// ── Service functions ──────────────────────────────────────────────────────────

/**
 * Refuse a `.ged` above the import cap before it is read, so one request can't
 * hold several copies of a huge file in memory (#1222, audit M-1).
 */
function assertGedcomWithinCap(file: File): void {
  if (file.size > MAX_GEDCOM_BYTES) {
    throw new ValidationError(`File too large. Maximum GEDCOM size is ${capInMegabytes(MAX_GEDCOM_BYTES)} MB.`);
  }
}

/** Parse a GEDCOM file and return a preview of what would be imported, without writing to the DB. */
export async function previewGedcomService(params: PreviewGedcomParams): Promise<GedcomDryRunResponse> {
  const { file, mode, mediaJson } = params;

  const filename = file.name.toLowerCase();
  if (!filename.endsWith('.ged')) {
    throw new ValidationError('Only .ged files are accepted. Extract your zip in the browser first.');
  }
  assertGedcomWithinCap(file);
  if (mode !== 'overwrite' && mode !== 'merge') {
    throw new ValidationError('Invalid mode. Use "overwrite" or "merge"');
  }

  let mediaSidecar: ParsedMediaSidecar | null = null;
  if (mediaJson) {
    try {
      mediaSidecar = parseMediaSidecar(mediaJson);
    } catch (parseErr) {
      throw new ValidationError(`mediaJson is not valid JSON: ${(parseErr as Error).message}`);
    }
  }

  const { text: gedcomContent } = await readGedcomText(file);
  const { people, families, sources, mediaRecords } = parseGedcom(gedcomContent);

  const skipped: { type: 'person' | 'family'; identifier: string; reason: string }[] = [];
  const personGedcomIds = new Set(people.map((p) => p.gedcomId));
  let childrenLinkCount = 0;
  let mediaCount = 0;

  mediaCount += mediaRecords.length;
  for (const p of people) {
    mediaCount += p.media.length;
    for (const e of p.events) mediaCount += e.media.length;
  }
  for (const f of families) {
    mediaCount += f.media.length;
    for (const e of f.events) mediaCount += e.media.length;
  }
  for (const s of sources) mediaCount += s.media.length;
  mediaCount += mediaSidecar?.libraryMedia.length ?? 0;

  let citationsCount = 0;
  for (const p of people) {
    citationsCount += p.citations.length;
    for (const e of p.events) citationsCount += e.citations.length;
  }
  for (const f of families) {
    citationsCount += f.citations.length;
    // Family-event citations (§4.3) now bind to the event, not the family — count
    // them here too so the dry-run total matches what the import will persist.
    for (const e of f.events) citationsCount += e.citations.length;
  }

  for (const f of families) {
    for (const childRef of f.chilRefs) {
      if (personGedcomIds.has(childRef)) childrenLinkCount++;
      else skipped.push({ type: 'family', identifier: f.gedcomId, reason: `child ${childRef} not found` });
    }
    if (f.husbRef && !personGedcomIds.has(f.husbRef)) {
      skipped.push({ type: 'family', identifier: f.gedcomId, reason: `husband ${f.husbRef} not found` });
    }
    if (f.wifeRef && !personGedcomIds.has(f.wifeRef)) {
      skipped.push({ type: 'family', identifier: f.gedcomId, reason: `wife ${f.wifeRef} not found` });
    }
  }

  // Every media file the client must supply (person media + library photos), by
  // basename, so it can warn about files missing from the zip before running a
  // destructive overwrite import.
  const expectedMediaFilenames = expectedMediaBasenames(
    [
      ...people.flatMap((p) => p.media),
      ...people.flatMap((p) => p.events.flatMap((e) => e.media)),
      ...families.flatMap((f) => f.media),
      ...families.flatMap((f) => f.events.flatMap((e) => e.media)),
      ...sources.flatMap((s) => s.media),
      ...mediaRecords,
    ],
    mediaSidecar?.libraryMedia.map((l) => l.file) ?? [],
  );
  const sidecarRule = { allowLegacyV1: mediaSidecar?.version === 1, modernSidecar: (mediaSidecar?.version ?? 0) >= 2 };
  const ruledRef = (m: { FilePath: string | null }, xref: string | null = null) => {
    const ref = expectedMediaRef(m, xref);
    return ref && { ...ref, basenameFallback: allowsBasenameFallback(m.FilePath!, sidecarRule) };
  };
  const expectedMediaRefs = [
    ...people.flatMap((p) => p.media.map((m) => ruledRef(m))),
    ...people.flatMap((p) => p.events.flatMap((e) => e.media.map((m) => ruledRef(m)))),
    ...families.flatMap((f) => f.media.map((m) => ruledRef(m))),
    ...families.flatMap((f) => f.events.flatMap((e) => e.media.map((m) => ruledRef(m)))),
    ...sources.flatMap((s) => s.media.map((m) => ruledRef(m))),
    ...mediaRecords.map((m) => ruledRef(m, m.xref)),
    ...(mediaSidecar?.libraryMedia.map((m) => ({ archivePath: `media/library/${m.file}`, originalFilename: m.file })) ?? []),
  ].filter((ref): ref is { archivePath: string; originalFilename: string; basenameFallback?: boolean } => ref !== null);

  return {
    dryRun: true,
    mode,
    toImport: {
      peopleCount: people.length,
      familiesCount: families.length,
      childrenCount: childrenLinkCount,
      mediaCount,
      sourcesCount: sources.length,
      citationsCount,
    },
    expectedMediaFilenames,
    expectedMediaRefs,
    skipped,
  };
}

/** Bind parameters per batched statement: under PGlite's 32,767 ceiling (see batchInsert). */
const CHUNK_PARAMS = 30000;

/**
 * Chunked multi-row INSERT. Collapses N single-row inserts into ~ceil(N / chunk)
 * statements — the win that matters in the browser static build, where every
 * statement is a main-thread↔PGlite-worker round-trip.
 *
 * With `returning: true` it appends `RETURNING "Id"` and returns the new ids in
 * VALUES order: PostgreSQL (and PGlite, the same executor compiled to WASM) emit
 * RETURNING rows in insertion order for a plain multi-row VALUES insert, so
 * callers can zip ids back to their input rows by index. A length assertion
 * guards against any surprise (e.g. a silently dropped row). Without it (for
 * junction tables that have no serial Id, e.g. FamilyPerson) it returns [].
 *
 * Chunk size is derived from a bind-parameter ceiling so arbitrarily large files
 * never exceed it. That ceiling is 32,767 (2^15 - 1), not Postgres's documented
 * 65,535 — PGlite's WASM wire-protocol implementation silently returns zero rows
 * (no thrown error) past 32,767 params in one statement, consistent with a signed
 * Int16 parameter-count field overflowing. Found via #423: adding two columns to
 * the People bulk insert (13 → 15) pushed a real 2,294-person import from 29,822
 * params (safe) to 34,410 (silently dropped every row). Verified empirically:
 * 32,760 params round-trips correctly, 33,000 returns 0 rows. Runs inside the
 * caller's transaction.
 */
async function batchInsert(
  client: ImportClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  opts?: { returning?: boolean; onConflictDoNothing?: boolean },
): Promise<number[]> {
  if (rows.length === 0) return [];
  const returning = opts?.returning ?? false;
  const cols = columns.map((c) => `"${c}"`).join(', ');
  // Leave headroom under PGlite's real ~32,767 bind-param ceiling (see doc comment
  // above — NOT Postgres's documented 65,535); at least one row per chunk.
  const perChunk = Math.max(1, Math.floor(CHUNK_PARAMS / columns.length));
  const ids: number[] = [];
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => `(${row.map((value) => `$${params.push(value)}`).join(', ')})`);
    const res = await client.query(
      `INSERT INTO "${table}" (${cols}) VALUES ${tuples.join(', ')}${opts?.onConflictDoNothing ? ' ON CONFLICT DO NOTHING' : ''}${returning ? ' RETURNING "Id"' : ''}`,
      params,
    );
    if (returning) {
      if (res.rows.length !== chunk.length) {
        throw new Error(`batchInsert("${table}"): expected ${chunk.length} ids, got ${res.rows.length}`);
      }
      for (const r of res.rows) ids.push((r as { Id: number }).Id);
    }
  }
  return ids;
}

/**
 * The existing source a merged SOUR is the same as, or null. A titled source
 * matches by title, preferring one whose content is identical too; an untitled
 * one only by identical content, and only when it has some. `claimed` holds the
 * sources this import already matched or created: sources the file keeps apart
 * (TMG titles every source the same) must not fold into one (#960).
 */
async function findMergeSource(
  client: ImportClient,
  treeId: number,
  source: { Title: string | null; Author: string | null; PublicationInfo: string | null; Text: string | null; Abbreviation?: string | null },
  raw: string | null,
  claimed: ReadonlySet<number>,
): Promise<number | null> {
  // Passthrough pointers are masked: stored ones are record ids, incoming ones
  // file xrefs (#979).
  const content = [source.Author, source.PublicationInfo, source.Text, source.Abbreviation ?? null, maskRawPointers(raw)];
  const sameContent = (first: number) => ['Author', 'PublicationInfo', 'Text', 'Abbreviation', 'RawGedcom']
    .map((column, i) => `${column === 'RawGedcom' ? maskRawPointersSql(`"${column}"`) : `"${column}"`} IS NOT DISTINCT FROM $${first + i}`).join(' AND ');
  let rows: Array<{ Id: number }>;
  if (source.Title) {
    rows = (await client.query(
      `SELECT "Id" FROM "Sources" WHERE "TreeId" = $1 AND LOWER("Title") = LOWER($2)
        ORDER BY (${sameContent(3)}) DESC, "Id"`,
      [treeId, source.Title, ...content],
    )).rows as Array<{ Id: number }>;
  } else {
    if (content.every((value) => value === null || value === '')) return null;
    rows = (await client.query(
      `SELECT "Id" FROM "Sources" WHERE "TreeId" = $1 AND "Title" IS NULL AND ${sameContent(2)} ORDER BY "Id"`,
      [treeId, ...content],
    )).rows as Array<{ Id: number }>;
  }
  return rows.find((row) => !claimed.has(row.Id))?.Id ?? null;
}

/** The stored facts an empty family (no partners, no children) is matched on (#960). */
interface MergeFamilyFacts {
  marriageDate: string | null;
  marriagePlace: string | null;
  type: string;
  rawGedcom: string | null;
  marriageRawGedcom: string | null;
}

/**
 * Link a merged family's children in one statement (#999), skipping links that
 * already exist. Returns how many CHIL pointers named no imported person.
 */
async function insertChildLinks(
  client: ImportClient,
  familyId: number,
  family: ParsedFamily,
  personIdMap: ReadonlyMap<string, number>,
): Promise<number> {
  const rows: unknown[][] = [];
  let skipped = 0;
  for (const childRef of family.chilRefs) {
    const childId = personIdMap.get(childRef);
    if (childId) {
      rows.push([childId, familyId, ...childRelationshipValues(family, childRef), family.chilFamcRaw[childRef] ?? null, rawGedcom(family.chilRawLines[childRef])]);
    } else {
      skipped++;
    }
  }
  await batchInsert(client, 'FamilyPerson', ['ChildrenId', 'FamiliesAsChildId', 'Partner1Relationship', 'Partner2Relationship', 'FamcRawGedcom', 'ChilRawGedcom'], rows, { onConflictDoNothing: true });
  return skipped;
}

/** An existing person a merged INDI's xref nominates (#871), with every name it carries. */
interface MergeHolder {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  Sex: string | null;
  Variants: string[];
}

/**
 * The people in the tree holding each GEDCOM xref, in Id order: every xref's, or
 * only `xref`'s when given (#999).
 */
async function mergeHoldersByXref(
  client: ImportClient,
  treeId: number,
  xref?: string,
): Promise<Map<string, MergeHolder[]>> {
  const res = await client.query(
    `SELECT p."Id", p."GedcomId", p."FirstName", p."LastName", p."Sex",
            COALESCE(ARRAY_AGG(nv."Name") FILTER (WHERE nv."Name" IS NOT NULL), '{}') AS "Variants"
       FROM "People" p
       LEFT JOIN "NameVariant" nv ON nv."PersonId" = p."Id" AND nv."TreeId" = p."TreeId"
      WHERE p."TreeId" = $1 AND ${xref === undefined ? 'p."GedcomId" IS NOT NULL' : 'p."GedcomId" = $2'}
      GROUP BY p."Id"
      ORDER BY p."Id"`,
    xref === undefined ? [treeId] : [treeId, xref],
  );
  const byXref = new Map<string, MergeHolder[]>();
  for (const row of res.rows as Array<MergeHolder & { GedcomId: string }>) {
    const list = byXref.get(row.GedcomId);
    if (list) list.push(row);
    else byXref.set(row.GedcomId, [row]);
  }
  return byXref;
}

/**
 * The existing family a merged FAM is the same as (#880), or null. Partners match
 * in either order, and among one couple's families the one sharing the most
 * children wins. A family with no partners matches one with no partners and
 * exactly the same children; with neither, one with the same stored facts.
 *
 * `claimed` holds the families this import already matched or created, which
 * are never matched again: two FAMs the file keeps apart must not fold into one
 * family, moving the second one's children onto the first (#960).
 */
async function findMergeFamily(
  client: ImportClient,
  treeId: number,
  partnerA: number | null,
  partnerB: number | null,
  childIds: number[],
  facts: MergeFamilyFacts,
  claimed: ReadonlySet<number>,
): Promise<number | null> {
  if (partnerA !== null || partnerB !== null) {
    const existing = await client.query(
      `SELECT f."Id", COALESCE((SELECT array_agg(fp."ChildrenId") FROM "FamilyPerson" fp
                                 WHERE fp."FamiliesAsChildId" = f."Id"), '{}') AS "Children"
         FROM "Families" f
        WHERE f."TreeId" = $1
          AND ((COALESCE(f."Partner1Id", f."HusbandId") IS NOT DISTINCT FROM $2
                AND COALESCE(f."Partner2Id", f."WifeId") IS NOT DISTINCT FROM $3)
            OR (COALESCE(f."Partner1Id", f."HusbandId") IS NOT DISTINCT FROM $3
                AND COALESCE(f."Partner2Id", f."WifeId") IS NOT DISTINCT FROM $2))
        ORDER BY f."Id"`,
      [treeId, partnerA, partnerB],
    );
    const incoming = new Set(childIds);
    let best: { id: number; shared: number } | null = null;
    for (const row of existing.rows as Array<{ Id: number; Children: number[] }>) {
      if (claimed.has(row.Id)) continue;
      const shared = row.Children.filter((id) => incoming.has(id)).length;
      if (!best || shared > best.shared) best = { id: row.Id, shared };
    }
    return best?.id ?? null;
  }
  const existing = childIds.length > 0
    ? await client.query(
      `SELECT f."Id" FROM "Families" f
        WHERE f."TreeId" = $1
          AND COALESCE(f."Partner1Id", f."HusbandId") IS NULL
          AND COALESCE(f."Partner2Id", f."WifeId") IS NULL
          AND (SELECT array_agg(fp."ChildrenId" ORDER BY fp."ChildrenId")
                 FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id") = $2::int[]
        ORDER BY f."Id"`,
      [treeId, [...new Set(childIds)].sort((a, b) => a - b)],
    )
    : await client.query(
      `SELECT f."Id" FROM "Families" f
        WHERE f."TreeId" = $1
          AND COALESCE(f."Partner1Id", f."HusbandId") IS NULL
          AND COALESCE(f."Partner2Id", f."WifeId") IS NULL
          AND NOT EXISTS (SELECT 1 FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id")
          AND f."MarriageDate" IS NOT DISTINCT FROM $2
          AND ${factPlaceTextSql(factPlaceColumnFor('MarriagePlace'), 'f')} IS NOT DISTINCT FROM $3
          AND f."Type" IS NOT DISTINCT FROM $4
          AND ${maskRawPointersSql('f."RawGedcom"')} IS NOT DISTINCT FROM $5
          AND ${maskRawPointersSql('f."MarriageRawGedcom"')} IS NOT DISTINCT FROM $6
        ORDER BY f."Id"`,
      [treeId, facts.marriageDate, facts.marriagePlace, facts.type, maskRawPointers(facts.rawGedcom), maskRawPointers(facts.marriageRawGedcom)],
    );
  const row = (existing.rows as Array<{ Id: number }>).find((r) => !claimed.has(r.Id));
  return row?.Id ?? null;
}

/**
 * 1 for a `1 BIRT` with nothing under it the app keeps, so it still exports
 * (#968). A birth with a date, place, citation, note or passthrough exports
 * from those, so the column stays NULL and a round trip leaves it unchanged.
 */
function bareBirth(person: ParsedPerson): number | null {
  const bare = person.BirthRecorded === 1 && !person.BirthDate && !person.BirthPlace
    && person.birthRawLines.length === 0
    && !person.citations.some((c) => c.factTable === 'PersonBirth')
    && !person.notes.some((n) => n.ownerFact === 'Birth');
  return bare ? 1 : null;
}

/**
 * Each partner's `1 HUSB` / `1 WIFE` sub-lines, in the family's Partner1 / Partner2
 * order (#989). Keyed by pointer, so they follow the partner the parser put in
 * each slot.
 */
function partnerRawGedcom(family: ParsedFamily): [string | null, string | null] {
  const of = (ref: string | undefined) => (ref ? rawGedcom(family.partnerRawLines[ref]) : null);
  return [of(family.husbRef), of(family.wifeRef)];
}

/** A child link's `Partner1Relationship` and `Partner2Relationship` (#982); unstated is Birth. */
function childRelationshipValues(family: ParsedFamily, childRef: string): [string, string] {
  const rel = family.chilRelationships[childRef];
  return [rel?.partner1 ?? 'Birth', rel?.partner2 ?? 'Birth'];
}

/** The same for a family's `1 MARR` (#965). */
function bareMarriage(family: ParsedFamily): number | null {
  const bare = family.MarriageRecorded === 1 && !family.MarriageDate && !family.MarriagePlace
    && family.marriageRawLines.length === 0
    && !family.citations.some((c) => c.factTable === 'FamilyMarriage')
    && !family.notes.some((n) => n.ownerFact === 'Marriage');
  return bare ? 1 : null;
}

/**
 * Persist a person's NICK / _AKA tags and non-first `1 NAME` records as
 * `NameVariant` rows, with any `2 SOUR` under such a NAME (#872). The parser
 * promotes those tags into `person.nameVariants` rather than appending them to
 * `Notes`, so this is what makes an imported nickname visible in the app at all.
 *
 * `dedupe` is set on the merge-into-existing path, where the same file may be
 * imported repeatedly and must not accumulate duplicate nicknames. Returns the
 * number of citations imported.
 */
async function insertNameVariants(
  client: ImportClient,
  scope: TreeScope,
  personId: number,
  person: ParsedPerson,
  dedupe: boolean,
  sourceXrefToId: Map<string, number>,
): Promise<number> {
  let citations = 0;
  for (const nv of person.nameVariants) {
    let variantId: number | undefined;
    if (dedupe) {
      const existing = await client.query(
        `SELECT "Id" FROM "NameVariant"
          WHERE "PersonId" = $1 AND "TreeId" = $2 AND "Type" = $3 AND "Name" = $4
          ORDER BY "Id" LIMIT 1`,
        [personId, scope.treeId, nv.Type, nv.Name],
      );
      variantId = existing.rows[0]?.Id as number | undefined;
    }
    if (variantId === undefined) {
      const inserted = await client.query(
        `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name")
         VALUES ($1, $2, $3, $4, $5)
         RETURNING "Id"`,
        [scope.ownerId, scope.treeId, personId, nv.Type, nv.Name],
      );
      variantId = inserted.rows[0].Id as number;
    }
    for (const c of nv.citations ?? []) {
      const sid = sourceXrefToId.get(c.sourceXref);
      if (sid && await insertCitation(client, scope, 'NameVariant', variantId, sid, c.page, c.note, dedupe ? 'merge' : 'overwrite', c)) citations++;
    }
  }
  return citations;
}

/**
 * Persist a newly-created person's events, fact citations, and media placeholder
 * rows. Extracted verbatim from the per-person import loop so the batched
 * overwrite path and the merge new-person branch share one implementation.
 * Returns the number of citations imported.
 */
async function insertPersonTail(
  client: ImportClient,
  scope: TreeScope,
  personId: number,
  person: ParsedPerson,
  mode: 'overwrite' | 'merge',
  sourceXrefToId: Map<string, number>,
  context: MediaImportContext,
  // Overwrite path: defer events to a single batched Events insert instead of one
  // round-trip each. When absent (merge), events insert inline as before.
  eventSink?: EventSink,
  // Overwrite path: defer notes to the batched Note/NoteLink flush, as families do.
  noteSink?: NoteSink,
): Promise<number> {
  let citations = 0;
  citations += await insertNameVariants(client, scope, personId, person, false, sourceXrefToId);
  // People are first-class note owners now (ADR 0010) — their notes no longer fold
  // into the People."Notes" column, which forked a note shared with a family in two.
  if (noteSink) {
    noteSink('People', personId, person.notes);
  } else {
    await insertNotes(client, scope, 'People', personId, person.notes);
  }
  for (const event of person.events) {
    if (eventSink) {
      eventSink('PersonId', personId, event);
    } else {
      citations += await importEvent(
        client, scope, 'PersonId', personId, event, mode, null, sourceXrefToId, context,
      );
    }
  }
  for (const c of person.citations) {
    const sid = sourceXrefToId.get(c.sourceXref);
    if (sid && await insertCitation(client, scope, c.factTable, personId, sid, c.page, c.note, mode, c)) citations++;
  }
  for (const media of person.media) {
    // See note at original call site: FilePath is intentionally NULL here (a
    // placeholder row the client fills via a separate per-file upload; stays
    // null in local PGlite mode where bytes live in MediaBlob).
    const primary = media.legacyPrimary === 1 && !media.ownerFact;
    if (primary) await lockPeopleForMediaMutation([personId], scope.treeId, client);
    const mediaResult = await client.query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FocalX", "FocalY", "FocalRadius", "SourceFile")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING "Id"`,
      [
        scope.ownerId, scope.treeId, media.Title, null, media.Format, null,
        media.FocalX ?? null, media.FocalY ?? null, media.FocalRadius ?? null, media.FilePath,
      ],
    );
    const mediaId = mediaResult.rows[0].Id as number;
    context.insertedMedia++;
    await linkImportedMedia(client, scope.treeId, mediaId, 'People', personId, primary ? 1 : 0, media.ownerFact ?? null);
    addMediaRef(context, mediaId, media, null);
    await addMediaImportItem(client, scope, context, mediaId, media, freshUuid(), null);
  }
  await applyMediaRefs(client, context, scope.treeId, 'People', personId, person.mediaRefs);
  return citations;
}

/**
 * Persist a newly-created family's notes, media, life-cycle events, and fact
 * citations (everything EXCEPT the FamilyPerson child links, which the batched
 * overwrite path collects and inserts in bulk separately). Extracted so the
 * batched overwrite path and the merge new-family branch share one
 * implementation. Returns the number of citations imported.
 */
async function insertFamilyTail(
  client: ImportClient,
  scope: TreeScope,
  familyId: number,
  family: ParsedFamily,
  mode: 'overwrite' | 'merge',
  sourceXrefToId: Map<string, number>,
  context: MediaImportContext,
  // Overwrite path: defer notes/events to their batched flushes. When absent
  // (merge), both insert inline as before.
  eventSink?: EventSink,
  noteSink?: NoteSink,
): Promise<number> {
  let citations = 0;
  if (noteSink) {
    noteSink('Families', familyId, family.notes);
  } else {
    await insertNotes(client, scope, 'Families', familyId, family.notes);
  }
  await insertOwnerMedia(client, scope, 'Families', familyId, family.media, context);
  for (const event of family.events) {
    if (eventSink) {
      eventSink('FamilyId', familyId, event);
    } else {
      citations += await importEvent(
        client, scope, 'FamilyId', familyId, event, mode, null, sourceXrefToId, context,
      );
    }
  }
  for (const c of family.citations) {
    const sid = sourceXrefToId.get(c.sourceXref);
    if (sid && await insertCitation(client, scope, c.factTable ?? 'Families', familyId, sid, c.page, c.note, mode, c)) citations++;
  }
  await applyMediaRefs(client, context, scope.treeId, 'Families', familyId, family.mediaRefs);
  return citations;
}

/**
 * Merge a record's notes and media onto a row that ALREADY exists in the target
 * tree (#492 finding 3).
 *
 * `insertPersonTail`/`insertFamilyTail` own notes + media and are only reachable
 * from the new-record branch, so before this existed a merge into a tree that
 * already contained the person dropped every note and photo on them. The loss was
 * stable rather than racy — never re-attempted — which is why no error surfaced.
 *
 * Keys are the best stable identity each model offers:
 * - notes: `GedcomXref` when the file carries one (a shared `@N@` pointer is the
 *   real identity), else the note text.
 * - media: document-local occurrence; no existing Media row is consulted.
 */
async function mergeNotesAndMediaIntoExisting(
  client: ImportClient,
  scope: TreeScope,
  ownerTable: 'People' | 'Families',
  ownerId: number,
  notes: Array<{ text: string | null; xref: string | null; ownerFact?: 'Birth' | 'Death' | 'Marriage' }>,
  media: MergeableMedia[],
  context: MediaImportContext,
): Promise<void> {
  // Notes use a text/xref multiset; media is always document-local.
  const take = (seen: Map<string, number>, key: string): boolean => {
    const n = seen.get(key) ?? 0;
    if (n <= 0) return false;
    seen.set(key, n - 1);
    return true;
  };

  if (notes.length > 0) {
    const existing = await client.query(
      `SELECT n."Text", n."GedcomXref", nl."OwnerFact" FROM "Note" n
         JOIN "NoteLink" nl ON nl."NoteId" = n."Id"
        WHERE nl."OwnerTable" = $1 AND nl."OwnerId" = $2 AND n."TreeId" = $3`,
      [ownerTable, ownerId, scope.treeId],
    );
    const seen = new Map<string, number>();
    for (const r of existing.rows as Array<{
      Text: string | null;
      GedcomXref: string | null;
      OwnerFact: 'Birth' | 'Death' | 'Marriage' | null;
    }>) {
      const key = `${r.GedcomXref ?? r.Text ?? ''}\0${r.OwnerFact ?? ''}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const n of notes) {
      if (!n.text || !n.text.trim()) continue;
      if (take(seen, `${n.xref ?? n.text}\0${n.ownerFact ?? ''}`)) continue;
      await insertNotes(client, scope, ownerTable, ownerId, [n]);
    }
  }

  // Inline media is document-local too. Every occurrence supplied by this
  // merge is inserted and linked; no pre-existing Media row is consulted here.
  // Identity comes from the bytes instead: materialization settles a placeholder
  // onto an existing photo with the same content hash (#858).
  await insertOwnerMedia(client, scope, ownerTable, ownerId, media, context);
}

/** Defers an owner's notes to a single batched flush (overwrite path). */
type NoteSink = (ownerTable: 'Families' | 'Sources' | 'Events' | 'People', ownerId: number, notes: Array<{ text: string | null; xref: string | null; ownerFact?: 'Birth' | 'Death' | 'Marriage' }>) => void;
/** Defers an event to a single batched Events insert (overwrite path). */
type EventSink = (ownerCol: 'PersonId' | 'FamilyId', ownerId: number, event: ImportableEvent) => void;

/**
 * Buffers notes across all owners (families, sources, events) so they insert as
 * two batched statements — one Note batch, one NoteLink batch — instead of two
 * round-trips per note. Overwrite only: the tree was just wiped, so every note is
 * new and no ON CONFLICT is needed. Replicates insertNotes' empty-text filtering.
 */
class NoteBatch {
  private buf: Array<{ text: string; xref: string | null }> = [];
  private links: Array<{ noteIndex: number; ownerTable: string; ownerId: number; ownerFact?: 'Birth' | 'Death' | 'Marriage' }> = [];
  private xrefToNoteIndex = new Map<string, number>();
  private linkKeys = new Set<string>();
  add: NoteSink = (ownerTable, ownerId, notes) => {
    for (const n of notes) {
      if (!n.text || !n.text.trim()) continue;
      let noteIndex = n.xref ? this.xrefToNoteIndex.get(n.xref) : undefined;
      if (noteIndex === undefined) {
        noteIndex = this.buf.length;
        this.buf.push({ text: n.text, xref: n.xref });
        if (n.xref) this.xrefToNoteIndex.set(n.xref, noteIndex);
      }
      const linkKey = `${noteIndex}\u0000${ownerTable}\u0000${ownerId}\u0000${n.ownerFact ?? ''}`;
      if (this.linkKeys.has(linkKey)) continue;
      this.linkKeys.add(linkKey);
      this.links.push({ noteIndex, ownerTable, ownerId, ownerFact: n.ownerFact });
    }
  };
  async flush(client: ImportClient, scope: TreeScope): Promise<void> {
    if (this.buf.length === 0) return;
    const noteIds = await batchInsert(
      client, 'Note', ['OwnerId', 'TreeId', 'Text', 'GedcomXref'],
      this.buf.map((n) => [scope.ownerId, scope.treeId, n.text, n.xref]),
      { returning: true },
    );
    // NoteLink ids zip back to the Note batch by index (same RETURNING order).
    await batchInsert(
      client, 'NoteLink', ['NoteId', 'OwnerTable', 'OwnerId', 'OwnerFact'],
      this.links.map((l) => [noteIds[l.noteIndex], l.ownerTable, l.ownerId, l.ownerFact ?? null]),
      { onConflictDoNothing: true },
    );
  }
}

/**
 * Batch-insert every deferred event (person + family) in one statement, then run
 * each event's per-row tails (fact citations, media, notes). Person events set
 * FamilyId null and family events set PersonId null, so both unify into one Events
 * batch. Event notes route to the shared NoteBatch (flushed after this). Returns
 * the number of event-scoped citations imported. Overwrite only (no claimedEvents
 * there, so no per-event existence check is needed).
 */
async function flushEvents(
  client: ImportClient,
  scope: TreeScope,
  buf: Array<{ ownerCol: 'PersonId' | 'FamilyId'; ownerId: number; event: ImportableEvent }>,
  sourceXrefToId: Map<string, number>,
  context: MediaImportContext,
  noteSink: NoteSink,
): Promise<number> {
  if (buf.length === 0) return 0;
  // "RawGedcom" must stay in lockstep with importEvent's inline INSERT (:379).
  // Omitting it here dropped every event's passthrough on the OVERWRITE path while
  // merge kept it — #525, and the same "one entity, two insert paths" hazard #423
  // caught for People/Families but missed here.
  const eventRows = buf.map(({ ownerCol, ownerId, event }) => [
    scope.ownerId, scope.treeId, event.Type, event.Date, event.Description,
    ownerCol === 'PersonId' ? ownerId : null,
    ownerCol === 'FamilyId' ? ownerId : null,
    rawGedcom(event.rawLines),
  ]);
  const eventIds = await batchInsert(
    client, 'Events',
    ['UserId', 'TreeId', 'Type', 'Date', 'Description', 'PersonId', 'FamilyId', 'RawGedcom'],
    eventRows, { returning: true },
  );
  buf.forEach(({ event }, i) => context.factPlaces.push({ field: 'Place', recordId: eventIds[i], text: event.Place }));
  let citations = 0;
  for (let i = 0; i < buf.length; i++) {
    const { event } = buf[i];
    const eventId = eventIds[i];
    for (const c of event.citations) {
      const sid = sourceXrefToId.get(c.sourceXref);
      if (sid && await insertCitation(client, scope, 'Events', eventId, sid, c.page, c.note, 'overwrite', c)) citations++;
    }
    await insertOwnerMedia(client, scope, 'Events', eventId, event.media, context);
    await applyMediaRefs(client, context, scope.treeId, 'Events', eventId, event.mediaRefs);
    noteSink('Events', eventId, event.notes);
  }
  return citations;
}

/** The import report's list of records linked to one of several same-name places (#1186). */
function sharedPlaceNamesValues(facts: SharedNameFact[]) {
  const people = [...new Set(facts.map((f) => f.person).filter(Boolean))];
  const shown = people.slice(0, 10);
  return {
    count: facts.length,
    places: [...new Set(facts.map((f) => f.place))].join('; '),
    people: shown.join(', '),
    more: people.length - shown.length,
  };
}

/** Parse a GEDCOM file and import its data into the DB, scoped to one resolved tree. */
export async function importGedcomService(params: ImportGedcomParams): Promise<GedcomImportResponse> {
  const { file, mode, casesJson, mediaJson, sourcesJson, placesJson, archiveManifest: rawArchiveManifest, currentUserId, requestedTreeId, requestedOwnerId, onProgress } = params;
  // A progress listener must never be able to fail the import.
  const reportStep = (step: GedcomImportStep) => { try { onProgress?.(step); } catch { /* UI only */ } };

  const filename = file.name.toLowerCase();
  if (!filename.endsWith('.ged')) {
    throw new ValidationError('Only .ged files are accepted. Extract your zip in the browser first.');
  }
  assertGedcomWithinCap(file);
  if (mode !== 'overwrite' && mode !== 'merge') {
    throw new ValidationError('Invalid mode. Use "overwrite" or "merge"');
  }

  let archiveManifest: string[];
  try {
    archiveManifest = normalizeArchiveManifest(rawArchiveManifest ?? []);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : 'Invalid archive manifest');
  }

  // Fields past `note` are read by casesSidecarEvidence (#1035).
  type CasesJsonCitation = { source: string; page: string | null; note: string | null };
  type CasesJsonData = {
    version: number;
    cases: Array<{
      Title: string;
      Description: string | null;
      Status: string;
      Tags: string[];
      CreatedAt: string;
      UpdatedAt?: string;
      citations: Array<{ Title: string; Url: string | null; Notes: string | null; CreatedAt: string }>;
      comments: Array<{ Body: string; CreatedAt: string; Kind?: string; media?: string; citation?: CasesJsonCitation; StruckAt?: string; StruckReason?: string }>;
      linkedPersonGedcomIds: string[];
      sourceCitations?: CasesJsonCitation[];
      media?: string[];
    }>;
  } | null;

  // Sidecars are additive-only, so `version` never selects a parse path — its one
  // use is telling the user when a bundle came from a NEWER build than this one
  // reads, which is the only case where the tolerant parsers drop data silently.
  // Warns; never rejects. See ADR 0009 and lib/gedcom/sidecar-version.ts.
  const sidecarWarnings: GedcomImportWarning[] = [];

  let casesJsonData: CasesJsonData = null;
  if (casesJson) {
    try {
      casesJsonData = JSON.parse(casesJson);
    } catch (parseErr) {
      throw new ValidationError(`casesJson is not valid JSON: ${(parseErr as Error).message}`);
    }
    const warning = sidecarVersionWarning('cases.json', casesJsonData);
    if (warning) sidecarWarnings.push(warning);
  }

  let mediaSidecar: ParsedMediaSidecar | null = null;
  if (mediaJson) {
    try {
      mediaSidecar = parseMediaSidecar(mediaJson);
      const warning = sidecarVersionWarning('media.json', JSON.parse(mediaJson));
      if (warning) sidecarWarnings.push(warning);
    } catch (parseErr) {
      throw new ValidationError(`mediaJson is not valid JSON: ${(parseErr as Error).message}`);
    }
  }

  let sourcesSidecar: { sources: SidecarSourceEntry[]; nameVariants: SidecarNameVariantEntry[] } | null = null;
  if (sourcesJson) {
    try {
      sourcesSidecar = parseSourcesSidecar(sourcesJson);
      const warning = sidecarVersionWarning('sources.json', JSON.parse(sourcesJson));
      if (warning) sidecarWarnings.push(warning);
    } catch (parseErr) {
      throw new ValidationError(`sourcesJson is not valid JSON: ${(parseErr as Error).message}`);
    }
  }

  let placesSidecar: { places: SidecarPlaceEntry[]; facts: SidecarFactPlace[] } | null = null;
  if (placesJson) {
    try {
      placesSidecar = parsePlacesSidecar(placesJson);
      const warning = sidecarVersionWarning('places.json', JSON.parse(placesJson));
      if (warning) sidecarWarnings.push(warning);
    } catch (parseErr) {
      throw new ValidationError(`placesJson is not valid JSON: ${(parseErr as Error).message}`);
    }
  }

  reportStep('reading');
  const decoded = await readGedcomText(file);
  const gedcomContent = decoded.text;
  // #875: a file that didn't say (or misstated) its encoding was read with a
  // guess; say which, so mojibake isn't silent.
  if (decoded.guessed) sidecarWarnings.push({ code: 'charset_guessed', values: { charset: decoded.charset } });
  const {
    people, families, placeCoords, places, placeNotes, sources, repositoryNotes, repositories, mediaRecords,
    danglingPointers, duplicateXrefs, unmappedChildRelationships, inlineCitationsKept, citationsUnplaced, customRecordsDropped, mediaBlobsDropped, notesUnattached, placeLinesDropped,
    recordTypes,
  } = parseGedcom(gedcomContent);
  const rawPointersDropped = markPassthroughPointers({ people, families, sources, repositories, mediaRecords }, recordTypes);

  // Reject every unsafe FILE path before resolving a tree or opening the
  // destructive transaction. A no-FILE OBJE remains a structural Media row. An
  // absolute path or URL is a reference to keep, not a path (#958); a relative
  // path must stay inside the bundle, so `..` still refuses the file.
  const declaredMedia: Array<{ FilePath: string | null }> = [
    ...mediaRecords,
    ...people.flatMap((person) => [
      ...person.media,
      ...person.events.flatMap((event) => event.media),
    ]),
    ...families.flatMap((family) => [
      ...family.media,
      ...family.events.flatMap((event) => event.media),
    ]),
    ...sources.flatMap((source) => source.media),
  ];
  let externalMediaReferences = 0;
  for (const media of declaredMedia) {
    if (media.FilePath === null) continue;
    if (isExternalMediaReference(media.FilePath)) externalMediaReferences++;
    else if (!normalizeArchivePath(media.FilePath)) throw new ValidationError('GEDCOM contains an unsafe or empty media FILE path');
  }
  // media.json is our own sidecar: its library paths are always bundle paths.
  for (const media of mediaSidecar?.libraryMedia ?? []) {
    if (!normalizeArchivePath(media.file)) throw new ValidationError('GEDCOM contains an unsafe or empty media FILE path');
  }

  // Safety guard (GED-1): never let an overwrite wipe the user's tree and replace it
  // with nothing. A non-empty file that parses to zero records is almost always a
  // failed parse (e.g. an unsupported encoding), not an intentional empty import —
  // refuse it before the destructive DELETE rather than silently erasing everything.
  // Merge refuses too (#880): it used to report "success" for an empty file, a
  // non-GEDCOM file or one with lowercase tags, having imported nothing.
  if (people.length === 0 && families.length === 0 && sources.length === 0 && mediaRecords.length === 0) {
    throw new ValidationError(
      mode === 'overwrite'
        ? 'This file contains no importable records, so overwriting would erase your existing tree. ' +
          'Import was cancelled. Check that the file is a valid GEDCOM.'
        : 'This file contains no importable records, so there is nothing to merge. ' +
          'Check that the file is a valid GEDCOM.'
    );
  }

  // Resolve the target tree ONCE (after the parse guard, so the no-DB fast tests
  // and the pure parse-failure paths never touch the database). Every row this
  // import writes stamps scope.treeId alongside the legacy owner column
  // (scope.ownerId = the tree's owning user), and overwrite wipes ONLY this tree.
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId ?? null, ownerId: requestedOwnerId ?? null },
    currentUserId
  );
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  // Overwrite is a full-tree wipe (not restorable — bypasses audit capture), so
  // it demands owner/edit, exactly like every other delete path rejects
  // 'contribute'. Merge only adds/updates, so 'contribute' is sufficient there.
  if (mode === 'overwrite' && scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to overwrite this tree');
  }

  let importedPeopleCount = 0;
  let mergeIdentityMismatches = 0;
  const extraPartnerFamilies = families.filter((f) => f.extraPartnerRefs.length > 0).length;
  let importedFamiliesCount = 0;
  let importedCasesCount = 0;
  let importedTagsCount = 0;
  let importedLibraryMediaCount = 0;
  let importedSourcesCount = 0;
  let importedCitationsCount = 0;
  // 4.2 import summary: records that carried unmodeled GEDCOM preserved verbatim
  // via raw passthrough (Slice 0p), and relationship links dropped because the
  // referenced person was not present in the file.
  let preservedCount = 0;
  let skippedCount = 0;
  // #880: merge used to say nothing about records it matched and left alone.
  let matchedPeopleCount = 0;
  let matchedFamiliesCount = 0;

  const mediaContext: MediaImportContext = {
    items: [],
    importId: freshUuid(),
    archiveManifest,
    allowLegacyV1: mediaSidecar?.version === 1,
    modernSidecar: (mediaSidecar?.version ?? 0) >= 2,
    v1TaggedBasenames: new Set((mediaSidecar?.version === 1 ? mediaSidecar.tags : []).map((tag) => tag.file.split(/[\\/]/).pop() ?? tag.file)),
    v2TaggedXrefs: new Set((mediaSidecar?.version !== 1 ? mediaSidecar?.v2Tags ?? [] : []).map((tag) => tag.media)),
    basenameToMediaId: new Map<string, number | null>(),
    mediaXrefToId: new Map<string, number>(),
    insertedMedia: 0,
    factPlaces: [],
  };
  const basenameToMediaId = mediaContext.basenameToMediaId;
  // Files to unlink AFTER a successful commit. Overwrite deletes the user's Media
  // rows, so the old files on disk would otherwise be orphaned forever and
  // accumulate across round-trips. Collected pre-delete, removed post-commit
  // (never before, so a rollback can't strand us with deleted files + live rows).
  let orphanedMediaFiles: string[] = [];

  // The records this import wrote, by file xref, for the places.json record map
  // applied once its facts are linked (#1186).
  const importedRecords: ImportedRecordIds = { people: new Map(), families: new Map(), matched: new Set() };
  // Facts of a name two places share, for the import report (#1186).
  let sharedPlaceNames: SharedNameFact[] = [];
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Shared NOTE xrefs are resolved with a select-then-insert sequence during
    // merge imports. Serialize imports targeting this tree so concurrent
    // requests cannot create duplicate Note rows for the same xref. The lock
    // is transaction-scoped and released automatically on commit/rollback.
    await client.query('SELECT pg_advisory_xact_lock($1)', [scope.treeId]);
    if (mode === 'merge') citationIndexes.set(client, await CitationIndex.load(client, scope.treeId));

    if (mode === 'overwrite') {
      // Overwrite wipes ONLY the resolved tree's rows — a user's other trees
      // must survive an overwrite import into this one.
      const existingMedia = await client.query<{ FilePath: string }>(
        'SELECT "FilePath" FROM "Media" WHERE "TreeId" = $1 AND "FilePath" IS NOT NULL',
        [scope.treeId]
      );
      orphanedMediaFiles = existingMedia.rows.map((r) => r.FilePath);
      await client.query('DELETE FROM "Citation" WHERE "TreeId" = $1', [scope.treeId]);
      // Confirmations name the replaced tree's people and dates (#830).
      await client.query('DELETE FROM "DataCheckConfirmations" WHERE "TreeId" = $1', [scope.treeId]);
      // NoteLink rows cascade when their Note is deleted (FK ON DELETE CASCADE).
      await client.query('DELETE FROM "Note" WHERE "TreeId" = $1', [scope.treeId]);
      await client.query('DELETE FROM "Sources" WHERE "TreeId" = $1', [scope.treeId]);
      // Repository rows are owned by the tree; clear them too (sources already gone).
      await client.query('DELETE FROM "Repository" WHERE "TreeId" = $1', [scope.treeId]);
      await client.query('DELETE FROM "Events" WHERE "TreeId" = $1', [scope.treeId]);
      await client.query('DELETE FROM "Media" WHERE "TreeId" = $1', [scope.treeId]);
      await client.query(
        'DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "TreeId" = $1)',
        [scope.treeId]
      );
      await client.query('DELETE FROM "Families" WHERE "TreeId" = $1', [scope.treeId]);
      await client.query('DELETE FROM "People" WHERE "TreeId" = $1', [scope.treeId]);
      await client.query('DELETE FROM "Cases" WHERE "TreeId" = $1', [scope.treeId]);
      // Clear the geocoding gazetteer too, so coordinates from the replaced tree
      // don't re-attach to same-named places in the imported one. Any PLAC.MAP
      // coordinates in the file are re-upserted after the transaction commits.
      await client.query('DELETE FROM "Places" WHERE "TreeId" = $1', [scope.treeId]);
    }

    const personIdMap = new Map<string, number>();
    const familyIdMap = new Map<string, number>();
    importedRecords.people = personIdMap;
    importedRecords.families = familyIdMap;

    // Overwrite defers every event and every note to one batched flush each (the
    // dominant per-row cost on a big import). Merge keeps inserting them inline
    // (it needs per-row existence checks and per-event dedup), so these stay unused.
    const batchTails = mode === 'overwrite';
    const noteBatch = new NoteBatch();
    const eventBuf: Array<{ ownerCol: 'PersonId' | 'FamilyId'; ownerId: number; event: ImportableEvent }> = [];
    const eventSink: EventSink | undefined = batchTails
      ? (ownerCol, ownerId, event) => { eventBuf.push({ ownerCol, ownerId, event }); }
      : undefined;
    const noteSink: NoteSink | undefined = batchTails ? noteBatch.add : undefined;

    // Materialize every standalone OBJE exactly once inside this document.
    // Owner pointers below only resolve IDs from this import-local map; xrefs
    // are document-local and must never match pre-existing Media rows.
    for (const record of mediaRecords) {
      const inserted = await client.query(
        `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FocalX", "FocalY", "FocalRadius", "SourceFile", "FileRawGedcom")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING "Id"`,
        [scope.ownerId, scope.treeId, record.Title, null, record.Format, null, record.FocalX ?? null, record.FocalY ?? null, record.FocalRadius ?? null, record.FilePath, rawGedcom(record.fileRawLines)],
      );
      const mediaId = (inserted.rows[0] as { Id: number }).Id;
      mediaContext.insertedMedia++;
      mediaContext.mediaXrefToId.set(record.xref, mediaId);
      addMediaRef(mediaContext, mediaId, record, record.xref);
      await addMediaImportItem(client, scope, mediaContext, mediaId, record, record.xref, record.xref);
    }

    // Build source xref → DB id map (needed by Task 9 citation attachment)
    const sourceXrefToId = new Map<string, number>();
    // Merge: sources and events this import already matched or created (#960).
    const claimedSourceIds = new Set<number>();
    const claimedEvents = new Set<number>();
    reportStep('sources');
    // Repository name → id cache for this import (Slice 4 — one row per archive).
    const repoNameToId = new Map<string, number>();
    // A kept pointer to a REPO record resolves to its repository (#985).
    const repoXrefToId = new Map<string, number>();
    // Every named REPO record, cited or not, with what the app doesn't model (#966).
    // A merge fills the passthrough only where the row has none, so it stays put.
    for (const r of repositories) {
      const repositoryId = await findOrCreateRepository(client, scope, r.name, r.address, repoNameToId);
      if (repositoryId !== null) repoXrefToId.set(r.xref, repositoryId);
      if (repositoryId === null || (r.rawLines.length === 0 && r.addrRawLines.length === 0)) continue;
      await client.query(
        `UPDATE "Repository" SET "RawGedcom" = COALESCE("RawGedcom", $2), "AddressRawGedcom" = COALESCE("AddressRawGedcom", $3)
          WHERE "Id" = $1 AND "TreeId" = $4`,
        [repositoryId, rawGedcom(r.rawLines), rawGedcom(r.addrRawLines), scope.treeId],
      );
    }
    // Repository mirror from the sidecar (fills fields the .ged lacked).
    const repoMirror = new Map<string, { repositoryName: string | null; callNumber: string | null }>();
    for (const s of sourcesSidecar?.sources ?? []) {
      repoMirror.set(s.xref, { repositoryName: s.repositoryName, callNumber: s.callNumber });
    }
    for (const s of sources) {
      const mirror = repoMirror.get(s.xref);
      const repositoryName = s.RepositoryName ?? mirror?.repositoryName ?? null;
      const callNumber = s.CallNumber ?? mirror?.callNumber ?? null;

      if (mode === 'merge') {
        const sourceId = await findMergeSource(client, scope.treeId, s, rawGedcom(s.rawLines), claimedSourceIds);
        if (sourceId !== null) {
          claimedSourceIds.add(sourceId);
          sourceXrefToId.set(s.xref, sourceId);
          await insertOwnerMediaMerge(client, scope, 'Sources', sourceId, s.media, mediaContext);
          await applyMediaRefs(client, mediaContext, scope.treeId, 'Sources', sourceId, s.mediaRefs);
          continue;
        }
      }

      // Slice 4: link the source to a shared Repository entity (and keep the
      // free-text RepositoryName during the expand/contract transition).
      const repositoryId = await findOrCreateRepository(
        client, scope, repositoryName, s.RepositoryAddress ?? null, repoNameToId,
      );

      const inserted = await client.query(
        `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Author", "PublicationInfo", "RepositoryName", "CallNumber", "Text", "Type", "Contents", "Num", "RawGedcom", "RepositoryId", "RepositoryMedi", "Abbreviation")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING "Id"`,
        [
          scope.ownerId, scope.treeId, s.Title, s.Author, s.PublicationInfo, repositoryName, callNumber,
          s.Text, s.Type ?? 'Document', s.Contents, s.Num, rawGedcom(s.rawLines),
          repositoryId, s.Medi ?? null, s.Abbreviation ?? null,
        ]
      );
      const newSourceId = (inserted.rows[0] as { Id: number }).Id;
      claimedSourceIds.add(newSourceId);
      sourceXrefToId.set(s.xref, newSourceId);
      if (noteSink) noteSink('Sources', newSourceId, s.notes);
      else await insertNotes(client, scope, 'Sources', newSourceId, s.notes);
      await insertOwnerMedia(client, scope, 'Sources', newSourceId, s.media, mediaContext);
      await applyMediaRefs(client, mediaContext, scope.treeId, 'Sources', newSourceId, s.mediaRefs);
      importedSourcesCount++;
      if (s.rawLines.length > 0) preservedCount++;
    }

    // Repository notes (REPOSITORY_RECORD +1 <<NOTE_STRUCTURE>>, ADR 0012). Runs
    // after the source loop so repoNameToId is populated. A REPO record carrying a
    // note that no source references still gets its repository created — the record
    // is real data in the file, and dropping it is the loss this exists to fix.
    for (const { name, notes } of repositoryNotes) {
      const repositoryId = await findOrCreateRepository(client, scope, name, null, repoNameToId);
      if (repositoryId === null) continue;
      // findOrCreateRepository is idempotent on (TreeId, Name), so unlike the
      // source loop above — which skips an existing source before inserting its
      // notes — a repeated merge import would keep stacking copies of the same
      // note onto the same repository. Skip the ones already attached.
      const existing = await client.query(
        `SELECT n."Text" FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"
         WHERE l."OwnerTable" = 'Repository' AND l."OwnerId" = $1 AND n."TreeId" = $2`,
        [repositoryId, scope.treeId],
      );
      const already = new Set((existing.rows as Array<{ Text: string }>).map((r) => r.Text));
      const fresh = notes.filter((n) => !n.text || !already.has(n.text));
      if (fresh.length > 0) await insertNotes(client, scope, 'Repository', repositoryId, fresh);
    }

    reportStep('people');
    if (mode === 'overwrite') {
      // Overwrite just wiped the tree, so every person is new — batch-insert them
      // all in a handful of statements instead of one round-trip each, then zip
      // the returned ids back to each person by index (see batchInsertReturningIds).
      // No 'Notes' column — dropped in #524 / ADR 0010. A person's NOTEs arrive as
      // first-class Note + NoteLink rows via insertPersonTail's noteSink below.
      const personColumns = [
        'UserId', 'TreeId', 'FirstName', 'LastName', 'Sex', 'GedcomId', 'BirthDate',
        'DeathDate', 'DeathCause', 'IsDeceased', 'RawGedcom',
        'BirthRawGedcom', 'DeathRawGedcom', 'NameRawGedcom', 'BirthRecorded',
      ];
      const personRows = people.map((person) => [
        scope.ownerId, scope.treeId, person.FirstName, person.LastName, person.Sex, person.GedcomId,
        person.BirthDate, person.DeathDate, person.DeathCause, person.IsDeceased,
        rawGedcom(person.rawLines),
        rawGedcom(person.birthRawLines), rawGedcom(person.deathRawLines), rawGedcom(person.nameRawLines),
        bareBirth(person),
      ]);
      const personIds = await batchInsert(client, 'People', personColumns, personRows, { returning: true });
      people.forEach((person, i) => {
        personIdMap.set(person.gedcomId, personIds[i]);
        mediaContext.factPlaces.push(
          { field: 'BirthPlace', recordId: personIds[i], text: person.BirthPlace },
          { field: 'DeathPlace', recordId: personIds[i], text: person.DeathPlace },
        );
        importedPeopleCount++;
        if (person.rawLines.length > 0) preservedCount++;
      });
      // Second pass: per-person fact citations + media placeholders (per-row);
      // events are collected into eventBuf and batch-inserted after families exist.
      for (let i = 0; i < people.length; i++) {
        importedCitationsCount += await insertPersonTail(
          client, scope, personIds[i], people[i], mode, sourceXrefToId, mediaContext, eventSink, noteSink,
      );
    }

    } else {
    // #999: every xref's candidates, read once instead of one query per person
    // (People has no GedcomId index, so each lookup scanned the tree). Only the
    // person this loop is on writes rows holding its xref, so the snapshot stays
    // exact for an xref until the loop first reaches it; an xref the file repeats
    // falls back to a live lookup, which sees what this import has written since.
    const holdersByXref = await mergeHoldersByXref(client, scope.treeId);
    const visitedXrefs = new Set<string>();
    for (const person of people) {
        if (person.GedcomId) {
          // Xrefs are document-local (#871): the xref only nominates candidates,
          // and one is accepted only when its name agrees. A holder that disagrees
          // belongs to some other file, so this person is imported as new.
          const holders = visitedXrefs.has(person.GedcomId)
            ? (await mergeHoldersByXref(client, scope.treeId, person.GedcomId)).get(person.GedcomId) ?? []
            : holdersByXref.get(person.GedcomId) ?? [];
          visitedXrefs.add(person.GedcomId);
          const match = holders.find((row) => mergeIdentityAgrees(person, row));
          if (!match && holders.length > 0) mergeIdentityMismatches++;
          if (match) {
            matchedPeopleCount++;
            const existingPersonId = match.Id;
            personIdMap.set(person.gedcomId, existingPersonId);
            importedRecords.matched.add(`person:${existingPersonId}`);
            for (const c of person.citations) {
              const sid = sourceXrefToId.get(c.sourceXref);
              if (sid && await insertCitation(client, scope, c.factTable, existingPersonId, sid, c.page, c.note, mode, c)) importedCitationsCount++;
            }
            // Deduped so a repeated merge does not accumulate duplicate nicknames.
            importedCitationsCount += await insertNameVariants(client, scope, existingPersonId, person, true, sourceXrefToId);
            // Merge the person's events (and their event-scoped citations) into the
            // existing record, deduping so a repeated merge stays idempotent.
            for (const event of person.events) {
              importedCitationsCount += await importEvent(
                client, scope, 'PersonId', existingPersonId, event, mode, claimedEvents, sourceXrefToId, mediaContext,
              );
            }
            // #492 finding (3): notes and media live in insertPersonTail, which
            // this branch never reaches — so before this call a merge into a tree
            // that already held this person dropped both, silently and for good.
            await mergeNotesAndMediaIntoExisting(
              client, scope, 'People', existingPersonId, person.notes, person.media, mediaContext,
            );
            await applyMediaRefs(client, mediaContext, scope.treeId, 'People', existingPersonId, person.mediaRefs);
            continue;
          }
        }

        const result = await client.query(
          `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex", "GedcomId", "BirthDate", "DeathDate", "DeathCause", "IsDeceased", "RawGedcom", "BirthRawGedcom", "DeathRawGedcom", "NameRawGedcom", "BirthRecorded")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING "Id"`,
          [
            scope.ownerId,
            scope.treeId,
            person.FirstName,
            person.LastName,
            person.Sex,
            person.GedcomId,
            person.BirthDate,
            person.DeathDate,
            person.DeathCause,
            person.IsDeceased,
            rawGedcom(person.rawLines),
            rawGedcom(person.birthRawLines),
            rawGedcom(person.deathRawLines),
            rawGedcom(person.nameRawLines),
            bareBirth(person),
          ]
        );

        const personId = result.rows[0].Id;
        personIdMap.set(person.gedcomId, personId);
        mediaContext.factPlaces.push(
          { field: 'BirthPlace', recordId: personId, text: person.BirthPlace },
          { field: 'DeathPlace', recordId: personId, text: person.DeathPlace },
        );
        importedPeopleCount++;
        if (person.rawLines.length > 0) preservedCount++;

        importedCitationsCount += await insertPersonTail(
          client, scope, personId, person, mode, sourceXrefToId, mediaContext,
        );
      }
    }

    // Top-level `_PRIM @I...@` is owner-specific canonical state. Resolve it
    // only after every imported person xref is available; legacy inline `_PRIM
    // Y` is handled in the People media path above.
    for (const record of mediaRecords) {
      const mediaId = mediaContext.mediaXrefToId.get(record.xref);
      if (mediaId === undefined) continue;
      for (const personXref of record.primaryPersonXrefs) {
        const personId = personIdMap.get(personXref);
        if (personId !== undefined) await linkImportedMedia(client, scope.treeId, mediaId, 'People', personId, 1);
      }
    } // Primary owner links are idempotent through MediaLink uniqueness.
    // v2 geometry is keyed by document-local media xref. Never resolve it via a
    // tree/library lookup: only rows inserted by this import are eligible.
    for (const geometry of mediaSidecar?.focalGeometry ?? []) {
      const mediaId = mediaContext.mediaXrefToId.get(geometry.media);
      if (mediaId === undefined) continue;
      await client.query(
        `UPDATE "Media" SET "FocalX" = $1, "FocalY" = $2, "FocalRadius" = $3
         WHERE "Id" = $4 AND "TreeId" = $5`,
        [geometry.x, geometry.y, geometry.radius, mediaId, scope.treeId],
      );
    }
    for (const entry of mediaSidecar?.dates ?? []) {
      const mediaId = mediaContext.mediaXrefToId.get(entry.media);
      if (mediaId === undefined) continue;
      await client.query(
        `UPDATE "Media" SET "Date" = $1 WHERE "Id" = $2 AND "TreeId" = $3`,
        [entry.date, mediaId, scope.treeId],
      );
    }
    if (mediaSidecar) {
      for (const lib of mediaSidecar.libraryMedia) {
        // Sidecar library entries are document-local as well. Never reconcile
        // them against a pre-existing row or a top-level row by inferred metadata.
        const mediaResult = await client.query(
          `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FocalX", "FocalY", "FocalRadius")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING "Id"`,
          [scope.ownerId, scope.treeId, lib.title, null, lib.format, null, lib.focalX, lib.focalY, lib.focalRadius]
        );
        const mediaId = mediaResult.rows[0].Id as number;
        mediaContext.insertedMedia++;
        importedLibraryMediaCount++;
        const libraryRefPath = `media/library/${lib.file}`;
        const libraryMedia: MergeableMedia = {
          Title: lib.title,
          FilePath: libraryRefPath,
          Format: lib.format,
          FocalX: lib.focalX,
          FocalY: lib.focalY,
          FocalRadius: lib.focalRadius,
        };
        registerBasename(mediaContext, mediaBasename(lib.file), mediaId);
        await addMediaImportItem(client, scope, mediaContext, mediaId, libraryMedia, freshUuid(), null);
      }
    }

    reportStep('families');
    if (mode === 'overwrite') {
      // Every family is new after an overwrite wipe. Batch-insert them (Partner*
      // and legacy Husband/Wife columns both take the resolved person ids), zip
      // ids back by index, run the per-family tails, then bulk-insert all child
      // links in one batched statement.
      const familyColumns = [
        'UserId', 'TreeId', 'Partner1Id', 'Partner2Id', 'HusbandId', 'WifeId',
        'MarriageDate', 'Type', 'RawGedcom', 'MarriageRawGedcom', 'MarriageRecorded',
        'Partner1RawGedcom', 'Partner2RawGedcom',
      ];
      const familyRows = families.map((family) => {
        const husbandId = family.husbRef ? (personIdMap.get(family.husbRef) ?? null) : null;
        const wifeId = family.wifeRef ? (personIdMap.get(family.wifeRef) ?? null) : null;
        return [
          scope.ownerId, scope.treeId, husbandId, wifeId, husbandId, wifeId,
          family.MarriageDate, family.Type ?? 'Marriage', rawGedcom(family.rawLines),
          rawGedcom(family.marriageRawLines), bareMarriage(family), ...partnerRawGedcom(family),
        ];
      });
      const familyIds = await batchInsert(client, 'Families', familyColumns, familyRows, { returning: true });
      families.forEach((family, i) => {
        familyIdMap.set(family.gedcomId, familyIds[i]);
        mediaContext.factPlaces.push({ field: 'MarriagePlace', recordId: familyIds[i], text: family.MarriagePlace });
        importedFamiliesCount++;
        if (family.rawLines.length > 0) preservedCount++;
      });
      for (let i = 0; i < families.length; i++) {
        importedCitationsCount += await insertFamilyTail(
          client, scope, familyIds[i], families[i], mode, sourceXrefToId, mediaContext, eventSink, noteSink,
        );
      }
      // Collect every resolvable child link across all families, then one batch.
      const childLinkRows: unknown[][] = [];
      families.forEach((family, i) => {
        for (const childRef of family.chilRefs) {
          const childId = personIdMap.get(childRef);
          if (childId) {
            childLinkRows.push([
              childId, familyIds[i], ...childRelationshipValues(family, childRef),
              family.chilFamcRaw[childRef] ?? null, rawGedcom(family.chilRawLines[childRef]),
            ]);
          } else {
            skippedCount++;
          }
        }
      });
      await batchInsert(client, 'FamilyPerson', ['ChildrenId', 'FamiliesAsChildId', 'Partner1Relationship', 'Partner2Relationship', 'FamcRawGedcom', 'ChilRawGedcom'], childLinkRows, { onConflictDoNothing: true });

      // All person + family ids now exist, so batch-insert every collected event
      // (person and family, unified) and run each event's per-row tails; event
      // notes join the note buffer. Then flush all notes (family/source/event) as
      // one Note batch + one NoteLink batch. Order matters: events before notes.
      reportStep('events');
      importedCitationsCount += await flushEvents(
        client, scope, eventBuf, sourceXrefToId, mediaContext, noteBatch.add,
      );
      await noteBatch.flush(client, scope);
    } else {
      const claimedFamilyIds = new Set<number>();
      for (const family of families) {
        const husbandId = family.husbRef ? (personIdMap.get(family.husbRef) ?? null) : null;
        const wifeId = family.wifeRef ? (personIdMap.get(family.wifeRef) ?? null) : null;

        // #880: partner order doesn't matter, and a family with no partners is
        // the same family when it has the same children. Both used to create a
        // second family on every merge.
        const childIds = family.chilRefs.map((ref) => personIdMap.get(ref)).filter((id): id is number => id !== undefined);
        const existingFamilyId = await findMergeFamily(client, scope.treeId, husbandId, wifeId, childIds, {
          marriageDate: family.MarriageDate,
          marriagePlace: family.MarriagePlace,
          type: family.Type ?? 'Marriage',
          rawGedcom: rawGedcom(family.rawLines),
          marriageRawGedcom: rawGedcom(family.marriageRawLines),
        }, claimedFamilyIds);
        if (existingFamilyId !== null) {
          const familyId = existingFamilyId;
          claimedFamilyIds.add(familyId);
          matchedFamiliesCount++;
          familyIdMap.set(family.gedcomId, familyId);
          importedRecords.matched.add(`family:${familyId}`);
          skippedCount += await insertChildLinks(client, familyId, family, personIdMap);
          for (const c of family.citations) {
            const sid = sourceXrefToId.get(c.sourceXref);
            if (sid && await insertCitation(client, scope, c.factTable ?? 'Families', familyId, sid, c.page, c.note, mode, c)) importedCitationsCount++;
          }
          // Merge the family's life-cycle events (divorce/annulment/…) and their
          // event-scoped citations into the existing family, deduping to stay
          // idempotent across repeated merges.
          for (const event of family.events) {
            importedCitationsCount += await importEvent(
              client, scope, 'FamilyId', familyId, event, mode, claimedEvents, sourceXrefToId, mediaContext,
              );
          }
          // #492 finding (3), family half — same gap as the person branch:
          // insertFamilyTail owns notes + media and is unreachable from here.
          await mergeNotesAndMediaIntoExisting(
            client, scope, 'Families', familyId, family.notes, family.media, mediaContext,
            );
          await applyMediaRefs(client, mediaContext, scope.treeId, 'Families', familyId, family.mediaRefs);
          continue;
        }

        const result = await client.query(
          `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id", "HusbandId", "WifeId", "MarriageDate", "Type", "RawGedcom", "MarriageRawGedcom", "MarriageRecorded", "Partner1RawGedcom", "Partner2RawGedcom")
           VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING "Id"`,
          [
            scope.ownerId,
            scope.treeId,
            husbandId,
            wifeId,
            family.MarriageDate,
            family.Type ?? 'Marriage',
            rawGedcom(family.rawLines),
            rawGedcom(family.marriageRawLines),
            bareMarriage(family),
            ...partnerRawGedcom(family),
          ]
        );

        const familyId = result.rows[0].Id;
        claimedFamilyIds.add(familyId);
        familyIdMap.set(family.gedcomId, familyId);
        mediaContext.factPlaces.push({ field: 'MarriagePlace', recordId: familyId, text: family.MarriagePlace });
        if (family.rawLines.length > 0) preservedCount++;
        importedFamiliesCount++;
        importedCitationsCount += await insertFamilyTail(
          client, scope, familyId, family, mode, sourceXrefToId, mediaContext,
        );

        skippedCount += await insertChildLinks(client, familyId, family, personIdMap);
      }
    }

    // Face tags map a media basename → its Media row, so they must run AFTER every
    // media insert — including deferred person/family EVENT media, which the
    // overwrite path only registers during flushEvents above. Resolving tags inside
    // the mediaSidecar block (before events) would silently drop tags on event
    // photos. By here, all people/family ids and all media basenames exist.
    if (mediaSidecar) {
      // A v1 tag is only safe to use when its basename resolves to exactly one
      // imported row. If a later record made that basename ambiguous, undo the
      // provisional face-capture skip on every affected item as well: the
      // sidecar tag will be skipped below, but XMP capture can still recover a
      // face from each distinct file.
      if (mediaSidecar.version === 1) {
        for (const item of mediaContext.items) {
          if (basenameToMediaId.get(mediaBasename(item.originalFilename)) !== null) continue;
          await client.query(
            `UPDATE "MediaImportItem" SET "SkipFaceCapture" = 0 WHERE "Id" = $1 AND "TreeId" = $2`,
            [item.id, scope.treeId],
          );
          item.skipFaceCapture = false;
        }
      }
      for (const tag of mediaSidecar.tags) {
        const mediaId = basenameToMediaId.get(mediaBasename(tag.file));
        const personId = personIdMap.get(tag.person);
        if (mediaId === undefined || mediaId === null || personId === undefined) continue;
        const [rx, ry, rw, rh] = tag.region;
        // v1 primary is the legacy tag-owned avatar signal. Convert it to the
        // canonical owner link; the tag itself stores geometry only.
        if (tag.primary) {
          await linkImportedMedia(client, scope.treeId, mediaId, 'People', personId, 1);
        }
        const inserted = await client.query(
          `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT ("MediaId", "PersonId") DO NOTHING`,
          [mediaId, personId, rx, ry, rw, rh]
        );
        if ((inserted.rowCount ?? 0) > 0) importedTagsCount++;
      }
      for (const tag of mediaSidecar.v2Tags ?? []) {
        const mediaId = mediaContext.mediaXrefToId.get(tag.media);
        const personId = personIdMap.get(tag.person);
        if (mediaId === undefined || personId === undefined) continue;
        const [rx, ry, rw, rh] = tag.region;
        const inserted = await client.query(
          `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT ("MediaId", "PersonId") DO NOTHING`,
          [mediaId, personId, rx, ry, rw, rh],
        );
        if ((inserted.rowCount ?? 0) > 0) importedTagsCount++;
      }
    }

    if (sourcesSidecar) {
      // A NameVariant is identified by its VALUE — (PersonId, Type, Name,
      // FromDate, ToDate) — per ADR 0009. Two consequences drive this loop:
      //
      //  1. The `1 NICK` / `1 _AKA` line path has ALREADY inserted a row for
      //     every Nickname/Alias on this person. Inserting again here doubled
      //     nickname lists on every round trip (#398). Reuse that row instead,
      //     and attach the sidecar's citations to it rather than to a second.
      //  2. Two sidecar entries with the same full tuple are the SAME variant
      //     with two citations, so they collapse onto one row.
      //
      // The line path cannot carry dates or the primary flag (no GEDCOM tag for
      // either), so it leaves them NULL/0 and the sidecar fills them in. That is
      // why a dated entry also accepts a null-dated row as its match: that row is
      // the incomplete line-path version of this same variant.
      //
      // That fallback is recorded as ADR 0011 — do NOT tighten it into an exact
      // tuple match. It looks redundant only because FromDate/ToDate have no UI
      // write path yet; removing it reintroduces #398 for every dated variant the
      // day that write path lands.
      const claimedIds = new Set<number>();
      const resolvedByValue = new Map<string, number>();
      // Rows the .ged line path created. Since #963 that line carries the variant's
      // citations too, so this entry's copies dedupe against them.
      const lineRowIds = new Set<number>();

      for (const v of sourcesSidecar.nameVariants) {
        const personId = personIdMap.get(v.person);
        if (personId === undefined) continue;
        const type = v.type ?? 'Alias';
        const valueKey = JSON.stringify([personId, type, v.name, v.fromDate ?? null, v.toDate ?? null]);

        let nameVariantId: number;
        const alreadyResolved = resolvedByValue.get(valueKey);

        if (alreadyResolved !== undefined) {
          nameVariantId = alreadyResolved;
        } else {
          // Candidates for this person+type+name, preferring an exact date match
          // over a null-dated (line-path) row so two variants differing only by
          // date range do not steal each other's row.
          const candidates = await client.query(
            `SELECT "Id", "FromDate", "ToDate" FROM "NameVariant"
              WHERE "PersonId" = $1 AND "TreeId" = $2 AND "Type" = $3 AND "Name" = $4
              ORDER BY "Id" ASC`,
            [personId, scope.treeId, type, v.name],
          );
          const rows = candidates.rows as Array<{ Id: number; FromDate: string | null; ToDate: string | null }>;
          const unclaimed = rows.filter((r) => !claimedIds.has(r.Id));
          const exact = unclaimed.find(
            (r) => (r.FromDate ?? null) === (v.fromDate ?? null) && (r.ToDate ?? null) === (v.toDate ?? null),
          );
          const match = exact ?? unclaimed.find((r) => r.FromDate === null && r.ToDate === null);

          if (match) {
            nameVariantId = match.Id;
            lineRowIds.add(nameVariantId);
            // Fill in what the .ged line could not carry.
            await client.query(
              `UPDATE "NameVariant" SET "FromDate" = $2, "ToDate" = $3 WHERE "Id" = $1`,
              [nameVariantId, v.fromDate, v.toDate],
            );
          } else {
            const nvRes = await client.query(
              `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name", "FromDate", "ToDate")
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING "Id"`,
              [scope.ownerId, scope.treeId, personId, type, v.name, v.fromDate, v.toDate],
            );
            nameVariantId = nvRes.rows[0].Id as number;
          }
          claimedIds.add(nameVariantId);
          resolvedByValue.set(valueKey, nameVariantId);
        }

        // At most one primary per person (idx_namevariant_one_primary is a partial
        // UNIQUE index), so set it only when no other row already holds the flag —
        // a second UPDATE would abort the whole import transaction.
        if (v.isPrimary) {
          await client.query(
            `UPDATE "NameVariant" SET "IsPrimary" = 1
              WHERE "Id" = $1
                AND NOT EXISTS (
                  SELECT 1 FROM "NameVariant"
                   WHERE "PersonId" = $2 AND "IsPrimary" = 1 AND "Id" <> $1
                )`,
            [nameVariantId, personId],
          );
        }

        for (const c of v.citations) {
          const sid = sourceXrefToId.get(c.source);
          const citationMode = lineRowIds.has(nameVariantId) ? 'merge' : mode;
          // Dedupe by note too: two citations of one source and page can differ by note.
          if (sid && await insertCitation(client, scope, 'NameVariant', nameVariantId, sid, c.page, c.note, citationMode, undefined, true)) importedCitationsCount++;
        }
      }
    }

    if (casesJsonData?.cases) {
      for (const c of casesJsonData.cases) {
        if (!c.Title) continue;
        const title = String(c.Title).slice(0, 500);

        // Same dedup gap #492 closed for notes and media: a case carries no xref,
        // so every merge forked a fresh "Cases" row — and with it a fresh FactId,
        // which defeated insertCitation's (FactTable, FactId) dedup and grew one
        // duplicate Citation per pass. Title is the only stable identity a case has.
        const existingCaseId = mode === 'merge'
          ? (await client.query(
              `SELECT "Id" FROM "Cases" WHERE "TreeId" = $1 AND "Title" = $2 ORDER BY "Id" LIMIT 1`,
              [scope.treeId, title]
            )).rows[0]?.Id
          : undefined;
        let caseId: number;
        // The workspace (#58) comes in only with a case this import creates: a
        // merge into a case the tree already has keeps that case's own research.
        let workspace: ParsedCaseWorkspace | null = null;
        let workspaceIds: ImportedWorkspaceIds | null = null;
        let createdHere = false;
        if (existingCaseId !== undefined) {
          caseId = existingCaseId;
        } else {
          // Keep the exported instants so a backup restore round-trips them (#789).
          const createdAt = sidecarInstant(c.CreatedAt);
          const caseScope = parseCaseScope(c);
          const status = c.Status ?? 'in_progress';
          const caseResult = await client.query(
            `INSERT INTO "Cases" ("UserId", "TreeId", "Title", "Description", "Status", "Tags", "CreatedAt", "UpdatedAt",
                                  "FromYear", "ToYear", "Place", "QuestionKind", "Outcome", "ClosedAt")
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, CURRENT_TIMESTAMP), COALESCE($8::timestamptz, $7::timestamptz, CURRENT_TIMESTAMP),
                     $9, $10, $11, $12, $13, $14::timestamptz)
             RETURNING "Id"`,
            [
              scope.ownerId,
              scope.treeId,
              title,
              c.Description ? String(c.Description).slice(0, 5000) : null,
              status,
              c.Tags ?? [],
              createdAt,
              sidecarInstant(c.UpdatedAt),
              caseScope.FromYear,
              caseScope.ToYear,
              caseScope.Place,
              caseScope.QuestionKind,
              // How it closed belongs to a closed case only.
              status === 'closed' ? caseScope.Outcome : null,
              status === 'closed' ? caseScope.ClosedAt : null,
            ]
          );
          caseId = caseResult.rows[0].Id;
          importedCasesCount++;
          createdHere = true;
          workspace = parseCaseWorkspace(c);
          // Behind a savepoint: a workspace the database still refuses is dropped,
          // and the case comes in without it rather than failing the import.
          await client.query('SAVEPOINT import_case_workspace');
          try {
            workspaceIds = await importWorkspace(client, caseId, scope.treeId, currentUserId, workspace, {
              person: (xref) => personIdMap.get(xref),
              media: (xref) => mediaContext.mediaXrefToId.get(xref),
              cite: async (findingId, cit) => {
                const sid = sourceXrefToId.get(cit.source);
                if (sid !== undefined && await insertCitation(
                  client, scope, FACT_TABLES.CASE_FINDINGS, findingId, sid, cit.page, cit.note, mode, cit.evidence, true,
                )) importedCitationsCount++;
              },
            });
            await client.query('RELEASE SAVEPOINT import_case_workspace');
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT import_case_workspace');
            console.warn('[gedcom import] a case\'s research could not be imported', err);
            workspace = null;
            workspaceIds = null;
          }
        }

        // Older bundles can carry both the free-text and structured arrays.
        // The structured pointer wins for an identical source/page identity;
        // distinct legacy notes remain separate Citation rows.
        const structuredCaseKeys = new Set(
          (c.sourceCitations ?? [])
            .map(sc => sourceXrefToId.get(sc.source) === undefined
              ? null
              : JSON.stringify([sourceXrefToId.get(sc.source), sc.page ?? null]))
            .filter((key): key is string => key !== null),
        );
        const seenCaseCitationKeys = new Set<string>();
        const insertCaseCitation = async (sourceId: number, page: string | null, note: string | null, evidence?: CitationEvidence) => {
          const key = JSON.stringify([sourceId, page, note]);
          if (seenCaseCitationKeys.has(key)) return;
          seenCaseCitationKeys.add(key);
          if (await insertCitation(client, scope, 'Cases', caseId, sourceId, page, note, mode, evidence, true)) {
            importedCitationsCount++;
          }
        };

        for (const cit of c.citations ?? []) {
          if (!cit.Title) continue;
          const citTitle = String(cit.Title).slice(0, 500);
          const citUrl = cit.Url ? String(cit.Url).slice(0, 2000) : null;
          const sourceId = await findOrCreateLegacyCaseCitationSource(client, scope, citTitle, citUrl);
          const note = cit.Notes ? String(cit.Notes).slice(0, 5000) : null;
          if (!structuredCaseKeys.has(JSON.stringify([sourceId, null]))) {
            await insertCaseCitation(sourceId, null, note);
          }
        }

        for (const cmt of c.comments ?? []) {
          if (!cmt.Body) continue;
          const body = String(cmt.Body).slice(0, 10000);
          const kind = caseCommentKind(cmt.Kind, body);
          const createdAt = sidecarInstant(cmt.CreatedAt);
          // The entry's photo (#1068), when its media came in with this bundle.
          const mediaId = typeof cmt.media === 'string' ? mediaContext.mediaXrefToId.get(cmt.media) ?? null : null;
          // A struck-out note (#1251) keeps when and why; who struck it stays behind,
          // so the entry shows no name. Only a plain note can be struck.
          const struckAt = kind === null ? sidecarInstant(cmt.StruckAt) : null;
          const struckReason = struckAt && typeof cmt.StruckReason === 'string' && cmt.StruckReason.trim()
            ? cmt.StruckReason.replace(/\s+/g, ' ').trim().slice(0, 500) : null;
          let commentId: number | undefined;
          if (mode === 'merge') {
            // Status lines repeat ("On hold" twice), so they match on time as well.
            const dupe = await client.query(
              `SELECT "Id" FROM "CaseComments"
               WHERE "CaseId" = $1 AND "Body" = $2 AND "Kind" IS NOT DISTINCT FROM $3
                 AND ($3::text IS DISTINCT FROM 'status' OR "CreatedAt" = $4::timestamptz)
               ORDER BY "Id" LIMIT 1`,
              [caseId, body, kind, createdAt]
            );
            commentId = dupe.rows[0]?.Id;
            // A matched entry without a photo gains this one's; one it has, it keeps.
            if (commentId !== undefined && mediaId !== null) {
              await client.query(
                `UPDATE "CaseComments" SET "MediaId" = $2 WHERE "Id" = $1 AND "MediaId" IS NULL`,
                [commentId, mediaId]
              );
            }
            // A matched note that still stands takes the bundle's strike when it was
            // written at the same moment (a body alone could match another note), and
            // never on a closed case.
            if (commentId !== undefined && struckAt !== null) {
              await client.query(
                `UPDATE "CaseComments" SET "StruckAt" = $2::timestamptz, "StruckReason" = $3
                 WHERE "Id" = $1 AND "StruckAt" IS NULL AND "Kind" IS NULL AND "CreatedAt" = $4::timestamptz
                   AND NOT EXISTS (SELECT 1 FROM "Cases" WHERE "Id" = "CaseComments"."CaseId" AND "Status" = 'closed')`,
                [commentId, struckAt, struckReason, createdAt]
              );
            }
          }
          if (commentId === undefined) {
            // Its filing, finding and request (#58), in a case whose workspace came in with it.
            const links = workspace && workspaceIds ? parseCommentLinks(cmt, workspace) : null;
            const findingId = links?.finding == null ? null : workspaceIds!.findings[links.finding] ?? null;
            const requestId = links?.request == null ? null : workspaceIds!.requests[links.request] ?? null;
            commentId = (await client.query(
              `INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "CreatedAt", "Kind", "MediaId", "StruckAt", "StruckReason", "FindingId", "RequestId")
               VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP), $5, $6, $7::timestamptz, $8, $9, $10) RETURNING "Id"`,
              [caseId, currentUserId, body, createdAt, kind, mediaId, struckAt, struckReason, findingId, requestId]
            )).rows[0].Id as number;
            const leadIds = (links?.leads ?? []).map((i) => workspaceIds!.leads[i]).filter((n): n is number => n !== undefined);
            await fileComment(client, commentId, leadIds);
          }
          // The entry's citation (#1035). An entry shows one, so a merge whose
          // matched entry already has one leaves it alone.
          const cmtSourceId = cmt.citation ? sourceXrefToId.get(cmt.citation.source) : undefined;
          if (cmt.citation && cmtSourceId !== undefined) {
            const existing = mode === 'merge'
              ? (await client.query(
                  `SELECT 1 FROM "Citation" WHERE "TreeId" = $1 AND "FactTable" = 'CaseComments' AND "FactId" = $2 LIMIT 1`,
                  [scope.treeId, commentId]
                )).rows.length > 0
              : false;
            if (!existing && await insertCitation(
              client, scope, 'CaseComments', commentId, cmtSourceId, cmt.citation.page ?? null, cmt.citation.note ?? null,
              mode, casesSidecarEvidence(cmt.citation), true,
            )) importedCitationsCount++;
          }
        }

        // The case's photos (#1068). A photo whose media isn't in the bundle is skipped.
        const caseMediaIds = [...new Set((Array.isArray(c.media) ? c.media : [])
          .map((ref) => typeof ref === 'string' ? mediaContext.mediaXrefToId.get(ref) : undefined)
          .filter((id): id is number => id !== undefined))];
        if (caseMediaIds.length > 0) {
          await client.query(
            `INSERT INTO "CaseMedia" ("CaseId", "MediaId")
             SELECT $1, m."Id" FROM "Media" m WHERE m."Id" = ANY($2) AND m."TreeId" = $3
             ON CONFLICT DO NOTHING`,
            [caseId, caseMediaIds, scope.treeId]
          );
        }

        const personIds = (c.linkedPersonGedcomIds ?? [])
          .map((ref: string) => personIdMap.get(ref))
          .filter((id): id is number => id !== undefined);
        if (personIds.length > 0) {
          const vals = personIds.map((_: number, i: number) => `($1, $${i + 2})`).join(', ');
          await client.query(
            `INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ${vals} ON CONFLICT DO NOTHING`,
            [caseId, ...personIds]
          );
        }

        for (const sc of c.sourceCitations ?? []) {
          const sid = sourceXrefToId.get(sc.source);
          if (sid) await insertCaseCitation(sid, sc.page ?? null, sc.note ?? null, casesSidecarEvidence(sc));
        }

        // A case from a bundle without leads gets its question as its first lead,
        // with its people, as v69 gave every case (ADR 0045 §1).
        if (createdHere) await ensureFirstLead(client, caseId, currentUserId);
      }
    }

    // Last, once every record this import keeps has its id (#979).
    const noteIdByXref = new Map<string, number>();
    for (const row of (await client.query(
      `SELECT "GedcomXref", MIN("Id") AS "Id" FROM "Note" WHERE "TreeId" = $1 AND "GedcomXref" IS NOT NULL GROUP BY "GedcomXref"`,
      [scope.treeId],
    )).rows as Array<{ GedcomXref: string; Id: number }>) noteIdByXref.set(row.GedcomXref, row.Id);
    const idMaps: Record<RawPointerKind, ReadonlyMap<string, number>> = {
      S: sourceXrefToId, N: noteIdByXref, O: mediaContext.mediaXrefToId, I: personIdMap, F: familyIdMap, R: repoXrefToId,
    };
    rawPointersDropped.push(...await resolvePassthroughPointers(client, scope.treeId, (kind, xref) => idMaps[kind].get(xref)));

    reportStep('places');
    // #402: restore the gazetteer from places.json FIRST — before the PLAC.MAP
    // coordinate upsert and before the promotion pass, both below.
    //
    // Order is the whole design, and it is load-bearing in a way that is easy to get
    // wrong: BOTH of those passes create Places rows by name. If either runs first,
    // the row already exists by the time the sidecar is applied, so the sidecar matches
    // it — and the existing row deliberately wins — and restores nothing. That is not hypothetical: it silently reverted PinSuppressed on every
    // overwrite until this block was moved above the coordinate upsert.
    //
    // Running first means overwrite (which wiped "Places") inserts each row complete,
    // and the only matches left are genuine merge-mode collisions with a gazetteer
    // the user already curated.
    //
    // Best-effort, like the passes below: a malformed sidecar must never fail the
    // import (ADR 0009: warn, never reject). Each pass runs behind a savepoint, so a
    // failed one is undone and the rest of the transaction carries on.
    // The place each places.json entry became, by its key (#1186).
    const placeByKey = new Map<string, number>();
    if (placesSidecar && placesSidecar.places.length > 0) {
      try {
        await client.query('SAVEPOINT import_places');
        // On merge, a name the tree already holds as another place's name (#1167)
        // stays that; it does not become a place of its own.
        const heldNames = await client.query(`SELECT "Name" FROM "PlaceName" WHERE "TreeId" = $1`, [scope.treeId]);
        const held = new Set((heldNames.rows as { Name: string }[]).map((r) => r.Name));
        // EXISTING VALUE WINS for a place the tree already has. Overwrite wipes
        // "Places" first, so a match can only happen in MERGE mode, where the target
        // tree's gazetteer is the user's own curation and the incoming bundle is the
        // stranger. Filling a NULL is safe; replacing a set value is not.
        const entries = placesSidecar.places;
        const placeByEntry = await restorePlaceEntries(client, scope.treeId, scope.ownerId, entries, held);
        for (const [index, id] of placeByEntry) {
          const key = entries[index].key;
          if (key) placeByKey.set(key, id);
        }
        // A parent named only by name (an older bundle) is the entry of that name
        // when the bundle has just one, else the tree's most-used place of it.
        const entryByName = new Map<string, number | null>();
        for (const [index, id] of placeByEntry) {
          const name = entries[index].name;
          entryByName.set(name, entryByName.has(name) ? null : id);
        }
        const parentOf = async (entry: SidecarPlaceEntry): Promise<number | null> => {
          if (entry.parentKey && placeByKey.has(entry.parentKey)) return placeByKey.get(entry.parentKey)!;
          if (!entry.parent) return null;
          const byName = entryByName.get(entry.parent);
          if (byName != null) return byName;
          const row = await client.query(`SELECT "PlaceIdByName"($1, $2) AS "Id"`, [scope.treeId, entry.parent]);
          return (row.rows[0] as { Id: number | null } | undefined)?.Id ?? null;
        };

        // Drop any parent edge that would close a CYCLE before applying it. Nothing
        // in the app can create one (renamePlace guards it), but a hand-edited
        // bundle, or one merged from another source, can: two entries naming each
        // other as parent both pass a naive self-link check. A cycle does not hang
        // anything — getPlaceAncestors and the descendant walk are both depth-capped
        // — but it silently corrupts every breadcrumb and rollup that follows
        // ParentId. Edges are accepted incrementally, so the accepted set is acyclic
        // by construction.
        const acceptedParent = new Map<number, number>();
        for (const [index, childId] of placeByEntry) {
          const parentId = await parentOf(entries[index]);
          if (parentId == null || parentId === childId) continue;
          const seen = new Set<number>([childId]);
          let cursor: number | undefined = parentId;
          let closesCycle = false;
          while (cursor != null) {
            if (seen.has(cursor)) { closesCycle = true; break; }
            seen.add(cursor);
            cursor = acceptedParent.get(cursor);
          }
          if (!closesCycle) acceptedParent.set(childId, parentId);
        }

        // In a second pass so every row exists first: a parent may appear after its
        // child in the sidecar array. `ParentId IS NULL` matches the promotion pass
        // below: on merge, a place the user has deliberately re-parented (or
        // detached) keeps their decision.
        for (const [childId, parentId] of acceptedParent) {
          await client.query(
            `UPDATE "Places" SET "ParentId" = $3
              WHERE "TreeId" = $1 AND "Id" = $2 AND "ParentId" IS NULL
                AND EXISTS (SELECT 1 FROM "Places" parent WHERE parent."Id" = $3 AND parent."TreeId" = $1)`,
            [scope.treeId, childId, parentId],
          );
        }

        // A place's other names (#1167), after every row exists. A name the target
        // tree already uses, as a place of its own or another place's name, stays
        // what the tree has: the same existing-value-wins rule as above.
        for (const [index, placeId] of placeByEntry) {
          for (const n of entries[index].names ?? []) {
            await client.query(
              `INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name", "Language", "FromDate", "ToDate")
               SELECT $3, $1, $2, $4, $5, $6, $7
                WHERE NOT EXISTS (SELECT 1 FROM "Places" x WHERE x."TreeId" = $2 AND x."Name" = $4)
               ON CONFLICT ("TreeId", "Name") DO NOTHING`,
              [scope.ownerId, scope.treeId, placeId, n.name, n.language, n.fromDate, n.toDate],
            );
          }
        }
        await client.query('RELEASE SAVEPOINT import_places');
      } catch (placesErr) {
        await client.query('ROLLBACK TO SAVEPOINT import_places');
        console.error('GEDCOM import: failed to restore places.json gazetteer (the rest of the import is kept):', placesErr);
      }
    }

    // Best-effort: upsert place coordinates from PLAC.MAP sub-structures into the
    // gazetteer. A failure here must NOT fail the import.
    // Runs AFTER the places.json restore above (see the ordering note there).
    if (placeCoords.length > 0) {
      try {
        await client.query('SAVEPOINT import_places');
        // Dedup by name (last coordinate wins, matching the prior per-row upsert
        // order) so the batched multi-row ON CONFLICT never sees a name twice.
        // Per-tree conflict key ("TreeId","Name") — an import can only ever touch
        // the TARGET tree's gazetteer rows (see lib/services/places.ts).
        const coordByName = new Map<string, { lat: number; lng: number }>();
        for (const { name, lat, lng } of placeCoords) coordByName.set(name, { lat, lng });
        // Another name of a place (#1167) is not a row of its own; its place has the pin.
        // A name two places share (#1186) can't say which of them the pin is for.
        const otherNames = await client.query(
          `SELECT "Name" FROM "PlaceName" WHERE "TreeId" = $1
           UNION SELECT "Name" FROM "Places" WHERE "TreeId" = $1 GROUP BY "Name" HAVING COUNT(*) > 1`,
          [scope.treeId],
        );
        for (const { Name } of otherNames.rows as { Name: string }[]) coordByName.delete(Name);
        const coordRows = [...coordByName].map(([name, { lat, lng }]) => [scope.ownerId, scope.treeId, name, lat, lng]);
        await upsertPlacesByName(
          client,
          ['UserId', 'TreeId', 'Name', 'Latitude', 'Longitude'],
          coordRows,
          // EXISTING VALUE WINS, same rule as the places.json restore above. This
          // pass used to write EXCLUDED unconditionally, which silently undid that
          // restore a few hundred lines later: a bundle's own .ged encodes MAP for
          // the same places its sidecar describes, so the commonest input there is
          // reverted a hand-corrected coordinate to whatever the file happened to
          // carry. The round-trip fixture could not see it because there the two
          // sources hold the SAME coordinate — a regression test has to make them
          // disagree (gedcom-places-sidecar-merge.test.ts).
          //
          // Applies with or without a sidecar: a plain .ged merged into a curated
          // tree got the same clobber, so the guard belongs here rather than being
          // conditional on places.json.
          `"Latitude" = COALESCE("Places"."Latitude", v."Latitude"),
           "Longitude" = COALESCE("Places"."Longitude", v."Longitude"),
           "UpdatedAt" = CURRENT_TIMESTAMP`,
        );
        await client.query('RELEASE SAVEPOINT import_places');
      } catch (coordErr) {
        await client.query('ROLLBACK TO SAVEPOINT import_places');
        console.error('GEDCOM import: failed to upsert place coordinates (the rest of the import is kept):', coordErr);
      }
    }

    // Slice 5: promote referenced places to real Places rows (with PLAC.FORM) and
    // link the jurisdiction hierarchy ("City, County, State" → parent "County,
    // State" → …). Best-effort: never fails the import.
    if (places.length > 0) {
      try {
        await client.query('SAVEPOINT import_places');
        // 1) Ensure a row exists for every referenced place AND every parent segment
        //    of a comma-delimited name, recording the form where known. The `seen`
        //    set both avoids redundant work and — critically — dedups the batch by
        //    name so the multi-row ON CONFLICT DO UPDATE never touches a name twice
        //    (each segment keeps the form of its FIRST encounter, as before).
        //    A segment that is another name of a place (#1167, from places.json) is
        //    not a place of its own and gets no row.
        const otherNames = await client.query(`SELECT "Name" FROM "PlaceName" WHERE "TreeId" = $1`, [scope.treeId]);
        const seen = new Set<string>((otherNames.rows as { Name: string }[]).map((r) => r.Name));
        const segmentRows: unknown[][] = [];
        for (const { name, form } of places) {
          let segment: string | null = name.trim();
          let isLeaf = true;
          while (segment && !seen.has(segment)) {
            seen.add(segment);
            segmentRows.push([scope.ownerId, scope.treeId, segment, isLeaf ? form : null]);
            const comma = segment.indexOf(', ');
            segment = comma >= 0 ? segment.slice(comma + 2).trim() : null;
            isLeaf = false;
          }
        }
        await upsertPlacesByName(
          client,
          ['UserId', 'TreeId', 'Name', 'Form'],
          segmentRows,
          // EXISTING VALUE WINS. The operand order here was the exact inverse of the
          // places.json restore's — EXCLUDED won whenever the .ged carried any FORM —
          // so a Form the user had corrected in the UI was reverted by the next merge
          // that happened to encode PLAC.FORM for that name. Filling a NULL is still
          // safe and still happens; replacing a set value is not.
          '"Form" = COALESCE("Places"."Form", v."Form")',
        );
        // 2) Link each multi-segment place to its parent (idempotent — only when unset).
        // Keyed on TreeId: the gazetteer is per-tree (v20), so an import must only
        // ever wire up the TARGET tree's hierarchy, never another tree's rows.
        // A parent name two places share links to the most-used of them (#1186).
        await client.query(
          `UPDATE "Places" child
           SET "ParentId" = parent."Id"
           FROM "Places" parent
           WHERE child."TreeId" = $1 AND parent."TreeId" = $1
             AND child."ParentId" IS NULL
             AND POSITION(', ' IN child."Name") > 0
             AND parent."Name" = SUBSTRING(child."Name" FROM POSITION(', ' IN child."Name") + 2)
             AND parent."Id" = "PlaceIdByName"($1, parent."Name")
             AND parent."Id" <> child."Id"`,
          [scope.treeId]
        );
        await client.query('RELEASE SAVEPOINT import_places');
      } catch (placeErr) {
        await client.query('ROLLBACK TO SAVEPOINT import_places');
        console.error('GEDCOM import: failed to upsert places/hierarchy (the rest of the import is kept):', placeErr);
      }
    }

    // #1167, #1186: point the facts this import wrote at the places their text
    // names. Last, so the places.json restore, the PLAC.MAP pass and promotion have
    // all created their rows by name first: linking creates bare rows for any name
    // still missing, and a bare row made before the sidecar ran would have been
    // matched first and restored nothing. Not best-effort: the references are the
    // facts' only record of their place (ADR 0037), so a failure fails the import.
    await linkFactPlaceTexts(client, scope.treeId, scope.ownerId, mediaContext.factPlaces);

    // #1186: a name two places share was linked to the most-used of them. places.json
    // says which one each record means; the rest are listed in the import report so
    // the user can move them.
    await client.query('SAVEPOINT import_places');
    try {
      const mapped = placesSidecar && placesSidecar.facts.length > 0
        ? await applyFactPlaceMap(client, scope.treeId, placesSidecar.facts, placeByKey, importedRecords)
        : new Set<string>();
      // Only records this import added: a record it matched keeps the places the tree gave it.
      const ids = (map: ReadonlyMap<string, number>, kind: string) => [...new Set(map.values())].filter((id) => !importedRecords.matched.has(`${kind}:${id}`));
      sharedPlaceNames = (await sharedNameFacts(client, scope.treeId, ids(importedRecords.people, 'person'), ids(importedRecords.families, 'family')))
        .filter((f) => !mapped.has(f.key));
      await client.query('RELEASE SAVEPOINT import_places');
    } catch (sharedErr) {
      await client.query('ROLLBACK TO SAVEPOINT import_places');
      sharedPlaceNames = [];
      console.error('GEDCOM import: failed to place records of shared place names (the rest of the import is kept):', sharedErr);
    }

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }

  // After linking (#1186): a name two places share gets its notes on the place most
  // records use, which needs the facts pointing at their places first.
  // Best-effort: attach PLAC-level notes (GEDCOM PLACE_STRUCTURE's NOTE_STRUCTURE)
  // to the Places row the block above just ensured exists for that name. A
  // failure here must NOT fail the import — the data is already committed.
  if (placeNotes.length > 0) {
    try {
      for (const { name, text } of placeNotes) {
        if (!text || !text.trim()) continue;
        // Lookup by TreeId+Name (the gazetteer's per-tree conflict key — see above),
        // so the note attaches to the TARGET tree's row and round-trips on export.
        // A name two places share gets the note on the most-used of them (#1186).
        const placeRow = await query(
          `SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2 AND "Id" = "PlaceIdByName"($1, $2)`,
          [scope.treeId, name],
        );
        const placeId = (placeRow.rows[0] as { Id: number } | undefined)?.Id;
        if (!placeId) continue; // unresolvable place name — skip, not fatal
        // Same dedup gap as #492's owned notes: place notes have no xref to key
        // on and were re-inserted verbatim by every merge, so re-importing a
        // bundle grew one duplicate place note per pass. Text is the only stable
        // identity available here.
        const dupe = await query(
          `SELECT 1 FROM "Note" n
             JOIN "NoteLink" nl ON nl."NoteId" = n."Id" AND nl."OwnerTable" = 'Places'
            WHERE nl."OwnerId" = $1 AND n."TreeId" = $2 AND n."Text" = $3`,
          [placeId, scope.treeId, text],
        );
        if (dupe.rows.length > 0) continue;
        const inserted = await query(
          `INSERT INTO "Note" ("OwnerId", "TreeId", "Text", "GedcomXref") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
          [scope.ownerId, scope.treeId, text, null],
        );
        await query(
          // Bare ON CONFLICT (as in queries/notes.ts linkNote): the unique index is
          // over (NoteId, OwnerTable, OwnerId, COALESCE(OwnerFact,'')), an expression
          // index a three-column conflict target cannot infer — naming the columns
          // raised 42P10 and silently dropped every place note.
          `INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId") VALUES ($1, 'Places', $2)
           ON CONFLICT DO NOTHING`,
          [(inserted.rows[0] as { Id: number }).Id, placeId],
        );
      }
    } catch (noteErr) {
      console.error('GEDCOM import: failed to import place notes (data was committed):', noteErr);
    }
  }

  // Commit succeeded: remove the now-orphaned files (and their thumbnails).
  // Best-effort — a failed unlink never fails the import the user just
  // completed, but it is counted and reported as a warning (#945). In local
  // (PGlite) mode the list is empty: media lives in the MediaBlob bytea table,
  // so "FilePath" is null and nothing is collected — cleanupMediaFiles (server-
  // only, fs/promises browser-stubbed) is never invoked client-side.
  // Files on disk live under the tree OWNER's uploads dir, not the importer's.
  const cleanupWarningCount = orphanedMediaFiles.length > 0
    ? await cleanupMediaFilesCounting(scope.ownerId, orphanedMediaFiles)
    : 0;

  // FUNC-5: record the import as a single summary audit entry so it shows in the
  // Audit Log + activity feed. Post-commit (outside the transaction — safe for the
  // PGlite single connection) and best-effort: never fail the committed import.
  try {
    await auditImport(
      mode,
      { people: importedPeopleCount, families: importedFamiliesCount, sources: importedSourcesCount },
      scope.ownerId,
      currentUserId,
      undefined,
      scope.treeId,
    );
  } catch (auditErr) {
    console.error('GEDCOM import: audit summary failed (data was committed):', auditErr);
  }

  // A bulk load changes every row count the planner relies on; PGlite has no
  // autovacuum to notice (#1268). Best-effort: the import is already committed.
  try {
    await refreshPlannerStats();
  } catch (statsErr) {
    console.error('GEDCOM import: planner statistics refresh failed (data was committed):', statsErr);
  }

  const manifestPaths = new Set(mediaContext.archiveManifest);
  const mediaWithoutFiles = mediaContext.insertedMedia
    - mediaContext.items.filter((item) => manifestPaths.has(item.archivePath)).length;

  return {
    success: true,
    mode,
    peopleCount: importedPeopleCount,
    familiesCount: importedFamiliesCount,
    casesCount: importedCasesCount,
    tagsCount: importedTagsCount,
    libraryMediaCount: importedLibraryMediaCount,
    sourcesCount: importedSourcesCount,
    citationsCount: importedCitationsCount,
    preservedCount,
    skippedCount,
    mediaItems: mediaContext.items,
    cleanupWarningCount,
    warnings: [
      ...sidecarWarnings,
      ...(cleanupWarningCount > 0
        ? [{ code: 'media_cleanup_failed' as const, values: { count: cleanupWarningCount } }]
        : []),
      ...(mergeIdentityMismatches > 0
        ? [{ code: 'merge_xref_name_mismatch' as const, values: { count: mergeIdentityMismatches } }]
        : []),
      ...(extraPartnerFamilies > 0
        ? [{ code: 'family_extra_partners' as const, values: { count: extraPartnerFamilies } }]
        : []),
      // #880: pointers to records missing from the file import as nothing.
      ...(Object.entries(danglingPointers) as Array<[keyof typeof danglingPointers, number]>)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => ({ code: 'dropped_links' as const, values: { kind, count } })),
      ...(duplicateXrefs > 0
        ? [{ code: 'duplicate_xrefs' as const, values: { count: duplicateXrefs } }]
        : []),
      // #963: citations with no Citation home — inline text kept as passthrough,
      // and ones on a NOTE or OBJE record, which weren't imported.
      ...(inlineCitationsKept > 0
        ? [{ code: 'inline_citations_kept' as const, values: { count: inlineCitationsKept } }]
        : []),
      ...(citationsUnplaced > 0
        ? [{ code: 'citations_unplaced' as const, values: { count: citationsUnplaced } }]
        : []),
      // #954: child links whose pedigree value has no RelationshipType. The value
      // is kept on the link and exported again, but the app doesn't show it.
      ...(unmappedChildRelationships.count > 0
        ? [{
          code: 'child_relationship_unmapped' as const,
          values: { count: unmappedChildRelationships.count, values: unmappedChildRelationships.values.join(', ') },
        }]
        : []),
      // #967: vendor level-0 records (event definitions, place records) aren't kept.
      ...(customRecordsDropped.count > 0
        ? [{
          code: 'custom_records_dropped' as const,
          values: { count: customRecordsDropped.count, tags: customRecordsDropped.tags.join(', ') },
        }]
        : []),
      // #977: a GEDCOM 5.5 BLOB image imports as media with no file.
      ...(mediaBlobsDropped > 0 ? [{ code: 'media_blobs_dropped' as const, values: { count: mediaBlobsDropped } }] : []),
      // #995: a NOTE record nothing points at (Gramps' tree description) has no owner.
      ...(notesUnattached > 0 ? [{ code: 'notes_unattached' as const, values: { count: notesUnattached } }] : []),
      // #992: lines under a place the app doesn't model (ArkivDigital's `_ADPL`).
      ...(placeLinesDropped.count > 0
        ? [{
          code: 'place_lines_dropped' as const,
          values: { count: placeLinesDropped.count, tags: placeLinesDropped.tags.join(', ') },
        }]
        : []),
      // #979: passthrough pointers to records the app doesn't keep (SUBM, a vendor
      // record, a missing one) can't be pointed at after export.
      ...(rawPointersDropped.length > 0
        ? [{
          code: 'raw_pointers_dropped' as const,
          values: { count: rawPointersDropped.length, tags: [...new Set(rawPointersDropped)].join(', ') },
        }]
        : []),
      // #1186: records naming a place two places share, linked to the most-used.
      ...(sharedPlaceNames.length > 0
        ? [{
          code: 'places_shared_name' as const,
          values: sharedPlaceNamesValues(sharedPlaceNames),
        }]
        : []),
      ...(externalMediaReferences > 0
        ? [{ code: 'external_media_references' as const, values: { count: externalMediaReferences } }]
        : []),
      // #960: media identity is the bytes (#858), so a merge can't match media
      // whose file isn't in this bundle and adds it again. Say so.
      ...(mode === 'merge' && mediaWithoutFiles > 0
        ? [{ code: 'merge_media_without_files' as const, values: { count: mediaWithoutFiles } }]
        : []),
    ],
    matchedPeopleCount,
    matchedFamiliesCount,
    message: `Successfully imported GEDCOM file in ${mode} mode`,
  };
}

/** Parse a spreadsheet file and return a preview of what would be imported, without writing to the DB. */
export async function previewSpreadsheetService(params: PreviewSpreadsheetParams): Promise<SpreadsheetDryRunResponse> {
  const { file, dateFormat, currentUserId, requestedTreeId, requestedOwnerId } = params;

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new ValidationError('Only .xlsx files are accepted for spreadsheet import.');
  }
  if (file.size > MAX_SPREADSHEET_BYTES) {
    throw new ValidationError(`File too large. Maximum spreadsheet size is ${capInMegabytes(MAX_SPREADSHEET_BYTES)} MB.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseSpreadsheet(buffer, dateFormat);
  const { people, families, children } = parsed;

  // Duplicate detection reads scope by the resolved tree.
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId ?? null, ownerId: requestedOwnerId ?? null },
    currentUserId
  );

  const skippedPeopleRowIds = await findDuplicatePeople(scope.treeId, people);
  const skippedFamilyIds = await findDuplicateFamilies(scope.treeId, families, people);
  const personByRowId = new Map(people.map((p) => [p.rowId, p]));

  const skipped: SkippedRecord[] = [
    ...people
      .filter((p) => skippedPeopleRowIds.has(p.rowId))
      .map((p) => ({
        type: 'person' as const,
        identifier: personIdentifier(p),
        reason: 'Duplicate: a person with this name and birth date already exists.',
      })),
    ...families
      .filter((f) => skippedFamilyIds.has(f.familyId))
      .map((f) => ({
        type: 'family' as const,
        identifier: familyIdentifier(f, personByRowId),
        reason: 'Duplicate: a family with these spouses and marriage date already exists.',
      })),
  ];

  const toImportPeople = people.filter((p) => !skippedPeopleRowIds.has(p.rowId));
  const toImportFamilies = families.filter((f) => !skippedFamilyIds.has(f.familyId));
  const toImportChildren = children.filter(
    (c) => !skippedFamilyIds.has(c.familyId) && !skippedPeopleRowIds.has(c.childRowId)
  );

  return {
    dryRun: true,
    toImport: {
      peopleCount: toImportPeople.length,
      familiesCount: toImportFamilies.length,
      childrenCount: toImportChildren.length,
    },
    skipped,
  };
}

/** Parse a spreadsheet file and import its data into the DB, scoped to one resolved tree. */
export async function importSpreadsheetService(params: ImportSpreadsheetParams): Promise<SpreadsheetImportResponse> {
  const { file, dateFormat, currentUserId, requestedTreeId, requestedOwnerId } = params;

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new ValidationError('Only .xlsx files are accepted for spreadsheet import.');
  }
  if (file.size > MAX_SPREADSHEET_BYTES) {
    throw new ValidationError(`File too large. Maximum spreadsheet size is ${capInMegabytes(MAX_SPREADSHEET_BYTES)} MB.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseSpreadsheet(buffer, dateFormat);
  const { people, families, children } = parsed;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId ?? null, ownerId: requestedOwnerId ?? null },
    currentUserId
  );
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const skippedPeopleRowIds = await findDuplicatePeople(scope.treeId, people);
  const skippedFamilyIds = await findDuplicateFamilies(scope.treeId, families, people);
  const personByRowId = new Map(people.map((p) => [p.rowId, p]));

  const skipped: SkippedRecord[] = [
    ...people
      .filter((p) => skippedPeopleRowIds.has(p.rowId))
      .map((p) => ({
        type: 'person' as const,
        identifier: personIdentifier(p),
        reason: 'Duplicate: a person with this name and birth date already exists.',
      })),
    ...families
      .filter((f) => skippedFamilyIds.has(f.familyId))
      .map((f) => ({
        type: 'family' as const,
        identifier: familyIdentifier(f, personByRowId),
        reason: 'Duplicate: a family with these spouses and marriage date already exists.',
      })),
  ];

  const toImportPeople = people.filter((p) => !skippedPeopleRowIds.has(p.rowId));
  const toImportFamilies = families.filter((f) => !skippedFamilyIds.has(f.familyId));
  const toImportChildren = children.filter(
    (c) => !skippedFamilyIds.has(c.familyId) && !skippedPeopleRowIds.has(c.childRowId)
  );

  let importedChildrenCount = 0;
  const createdPeopleRecords: Record<string, unknown>[] = [];
  const createdFamilyRecords: Record<string, unknown>[] = [];

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Every place the sheet names, matched (or created) once (#1186, ADR 0037).
    const placeRefs = await resolvePlaceTexts(client, scope.treeId, scope.ownerId, [
      ...toImportPeople.flatMap((p) => [p.BirthPlace, p.DeathPlace]),
      ...toImportFamilies.map((f) => f.MarriagePlace),
    ]);
    const placeRef = (text: string | null | undefined) => (text ? placeRefs.get(text) : undefined) ?? { id: null, nameId: null };

    const rowIdToDbId = new Map<number, number>();
    for (const person of toImportPeople) {
      const birth = placeRef(person.BirthPlace);
      const death = placeRef(person.DeathPlace);
      const result = await client.query(
        // No "Notes" column — dropped in #524 / ADR 0010; the spreadsheet's notes
        // column is written as a first-class Note below.
        `INSERT INTO "People"
           ("UserId", "TreeId", "FirstName", "LastName", "Sex", "BirthDate", "BirthPlaceId", "BirthPlaceNameId",
            "DeathDate", "DeathPlaceId", "DeathPlaceNameId", "IsDeceased", "UpdatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)
         RETURNING *, ${factPlaceTextColumns('people', '"People"')}`,
        [
          scope.ownerId,
          scope.treeId,
          person.FirstName,
          person.LastName,
          person.Sex,
          person.BirthDate,
          birth.id,
          birth.nameId,
          person.DeathDate,
          death.id,
          death.nameId,
          person.IsDeceased,
        ]
      );
      const row = result.rows[0] as Record<string, unknown>;
      rowIdToDbId.set(person.rowId, row.Id as number);
      createdPeopleRecords.push(row);
      // The spreadsheet's notes column used to land in People."Notes", dropped in
      // #524. Route it to the first-class model instead — without this, every
      // spreadsheet import would silently discard its notes column.
      if (person.Notes && person.Notes.trim()) {
        await insertNotes(client, scope, 'People', row.Id as number, [{ text: person.Notes, xref: null }]);
      }
    }

    const familyRowIdToDbId = new Map<number, number>();
    for (const family of toImportFamilies) {
      const husbandDbId =
        family.husbandRowId !== null ? (rowIdToDbId.get(family.husbandRowId) ?? null) : null;
      const wifeDbId =
        family.wifeRowId !== null ? (rowIdToDbId.get(family.wifeRowId) ?? null) : null;

      const marriage = placeRef(family.MarriagePlace);
      const result = await client.query(
        `INSERT INTO "Families"
           ("UserId", "TreeId", "Partner1Id", "Partner2Id", "HusbandId", "WifeId", "MarriageDate", "MarriagePlaceId", "MarriagePlaceNameId", "UpdatedAt")
         VALUES ($1,$2,$3,$4,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
         RETURNING *, ${factPlaceTextColumns('families', '"Families"')}`,
        [scope.ownerId, scope.treeId, husbandDbId, wifeDbId, family.MarriageDate, marriage.id, marriage.nameId]
      );
      const row = result.rows[0] as Record<string, unknown>;
      familyRowIdToDbId.set(family.familyId, row.Id as number);
      createdFamilyRecords.push(row);
    }

    for (const child of toImportChildren) {
      const familyDbId = familyRowIdToDbId.get(child.familyId);
      const childDbId = rowIdToDbId.get(child.childRowId);
      if (!familyDbId || !childDbId) continue;

      const result = await client.query(
        `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId")
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [familyDbId, childDbId]
      );
      importedChildrenCount += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }

  try {
    // One INSERT per 200 records, not a round trip per record (#1270).
    await auditCreateMany(
      [
        ...createdPeopleRecords.map((record) => ({ entityType: 'person' as const, record })),
        ...createdFamilyRecords.map((record) => ({ entityType: 'family' as const, record })),
      ],
      scope.ownerId,
      currentUserId,
    );
  } catch (auditErr) {
    console.error('Spreadsheet import: audit logging failed (data was committed):', auditErr);
  }

  try {
    await refreshPlannerStats();
  } catch (statsErr) {
    console.error('Spreadsheet import: planner statistics refresh failed (data was committed):', statsErr);
  }

  return {
    dryRun: false,
    peopleImported: createdPeopleRecords.length,
    familiesImported: createdFamilyRecords.length,
    childrenLinked: importedChildrenCount,
    skipped,
  };
}

/**
 * Delete ALL genealogy data for the current user — every tree, deliberately
 * account-wide (guarded by the X-Confirm-Reset header at the route). Keyed on
 * the legacy owner columns, so rows from all of the user's trees (and any
 * pre-backfill TreeId-NULL strays) are removed. The user's "Trees" rows go
 * LAST — the next request lazily recreates a default tree (resolveDefaultTree).
 */
export async function resetService(params: ResetParams): Promise<{ success: true; message: string }> {
  const { currentUserId } = params;

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM "Cases" WHERE "UserId" = $1', [currentUserId]);
    await client.query('DELETE FROM "DataCheckConfirmations" WHERE "UserId" = $1', [currentUserId]);
    await client.query('DELETE FROM "AuditLog" WHERE "TreeOwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "TreeSharing" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "PendingShares" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "Citation" WHERE "OwnerId" = $1', [currentUserId]);
    // NoteLink rows cascade when their Note is deleted (FK ON DELETE CASCADE).
    await client.query('DELETE FROM "Note" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "Repository" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "Events" WHERE "UserId" = $1', [currentUserId]);
    await client.query('DELETE FROM "Media" WHERE "UserId" = $1', [currentUserId]);
    await client.query(
      'DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "UserId" = $1)',
      [currentUserId]
    );
    await client.query('DELETE FROM "Families" WHERE "UserId" = $1', [currentUserId]);
    await client.query('DELETE FROM "NameVariant" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('DELETE FROM "People" WHERE "UserId" = $1', [currentUserId]);
    await client.query('DELETE FROM "Places" WHERE "UserId" = $1', [currentUserId]);
    // Trees rows go last, after every row that referenced them is gone.
    await client.query('DELETE FROM "Trees" WHERE "OwnerId" = $1', [currentUserId]);
    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }

  return { success: true, message: 'Your data has been erased successfully' };
}
