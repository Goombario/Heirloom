import { query } from '@/lib/db/connection';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { primaryPhotoJoin } from './media-tags';
import type { DbExecutor } from './media-links';
import type {
  MediaFaceCandidate, FaceMatchKind, FaceDismissReason,
} from '../schema';

export type { FaceMatchKind, FaceDismissReason };

export interface NewFaceCandidate {
  MediaId: number;
  TreeId: number;
  RegionX: number; RegionY: number; RegionW: number; RegionH: number;
  SourceName: string | null;
  SuggestedPersonId: number | null;
  MatchKind: FaceMatchKind;
}

/**
 * Folds case, accents, and repeated whitespace so "José  Álvarez" and
 * "jose alvarez" compare equal. Matching is done in JS rather than SQL because
 * no diacritic folding exists anywhere in this codebase's SQL, and adding it
 * would mean an extension or a functional index for one feature.
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining accent marks
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rows per INSERT statement. 9 parameters each, so 100 rows is 900 placeholders —
 * comfortably inside Postgres' 65535 limit while keeping one round trip per
 * hundred faces instead of one per face.
 */
const INSERT_CHUNK = 100;

/**
 * Inserts candidates, skipping any that already exist for the same photo, name,
 * and position. Returns how many rows were actually added, so an import can
 * report a truthful count on re-run.
 *
 * Multi-row INSERT rather than a statement per face: a 200-photo import with
 * four faces each was 800 sequential round trips inside upload requests.
 */
export async function insertFaceCandidates(rows: NewFaceCandidate[]): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows.slice(start, start + INSERT_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((r, i) => {
      const b = i * 9;
      values.push(
        r.MediaId, r.TreeId, r.RegionX, r.RegionY, r.RegionW, r.RegionH,
        r.SourceName, r.SuggestedPersonId, r.MatchKind,
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
    });
    const result = await query(
      `INSERT INTO "MediaFaceCandidate"
         ("MediaId", "TreeId", "RegionX", "RegionY", "RegionW", "RegionH",
          "SourceName", "SuggestedPersonId", "MatchKind")
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING "Id"`,
      // Bare ON CONFLICT DO NOTHING rather than a named target: two constraints
      // guard this table (the named-region UNIQUE and the unnamed-region partial
      // index), and a single statement has to satisfy whichever one applies.
      // Only the placeholder LIST is built here; every value stays positional.
      values,
    );
    inserted += result.rows.length;
  }
  return inserted;
}

interface PersonNameRow {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  /** Optional so the ~dozen existing snapshot fixtures stay valid unchanged. */
  BirthDate?: string | null;
  DeathDate?: string | null;
  Sex?: string | null;
  PrimaryMediaId?: number | null;
  FocalX?: number | null;
  FocalY?: number | null;
  FocalRadius?: number | null;
}
interface NameVariantRow { Id: number; Name: string | null }

/**
 * Enough about a person to tell two same-named candidates apart on a chip.
 * Years stay as raw strings, not a formatted lifespan: formatting is a
 * presentation concern and `lib/` must not reach into `app/` for it.
 */
export interface FacePersonRef {
  id: number;
  name: string;
  birthYear: string | null;
  deathYear: string | null;
  /** Drives the avatar disc colour when there is no photo. */
  sex: string | null;
  /** Primary photo, so a candidate chip shows the face you already know. */
  mediaId: number | null;
  focalX: number | null;
  focalY: number | null;
  focalRadius: number | null;
}

/** Every name in the tree, read once so matching never queries per face. */
export interface PeopleNameSnapshot {
  people: PersonNameRow[];
  variants: NameVariantRow[];
}

export interface FaceNameMatch {
  personId: number | null;
  kind: FaceMatchKind;
  candidateCount: number;
  /**
   * Every person this name resolved to at the tier that produced the verdict.
   * Always `candidateCount` long — the ambiguous card renders one chip per
   * entry, so a count that disagreed with the list would put a "2 people share
   * this name" badge above three chips.
   */
  candidateIds: number[];
}

const NO_MATCH: FaceNameMatch = { personId: null, kind: 'none', candidateCount: 0, candidateIds: [] };

/**
 * Resolves names from photos to people in the tree, against a snapshot of the
 * tree's names taken once.
 *
 * Mirrors the reach of `searchPeople` (first / last / "First Last" / NameVariant)
 * but compares on normalised strings and requires a WHOLE-name match — a queue
 * suggestion must be right, not merely plausible.
 *
 * Memoised by normalised name: a 200-photo import repeats the same handful of
 * names hundreds of times, which is the very premise the queue groups on.
 */
export interface NameMatcher {
  match(name: string): FaceNameMatch;
  /** "First Last" for a person id, for the queue's suggestion labels. */
  displayName(id: number): string | null;
  /** Name + years for a person id, for the queue's suggestion and chip labels. */
  person(id: number): FacePersonRef | null;
}

/**
 * One verdict from the ids a tier matched. `candidateCount` is DERIVED from the
 * list rather than passed alongside it, so the two cannot drift apart — the
 * ambiguous card renders one chip per id under a badge that states the count.
 * The list is copied because the caller's bucket belongs to the matcher's index.
 */
function verdict(ids: number[], singleKind: FaceMatchKind): FaceNameMatch {
  if (ids.length === 0) return NO_MATCH;
  const candidateIds = [...ids];
  return ids.length === 1
    ? { personId: ids[0], kind: singleKind, candidateCount: 1, candidateIds }
    : { personId: null, kind: 'ambiguous', candidateCount: ids.length, candidateIds };
}

export function createNameMatcher(snapshot: PeopleNameSnapshot): NameMatcher {
  const byFullName = new Map<string, number[]>();
  const display = new Map<number, string>();
  const refs = new Map<number, FacePersonRef>();
  for (const row of snapshot.people) {
    const raw = `${row.FirstName ?? ''} ${row.LastName ?? ''}`;
    const name = raw.trim();
    display.set(row.Id, name);
    // Years come from the snapshot the matcher already reads — no extra query.
    // `formatYearOrEmpty` returns '' for a missing/unparseable date; that
    // becomes null rather than an empty string so callers cannot render " – ".
    refs.set(row.Id, {
      id: row.Id,
      name,
      birthYear: formatYearOrEmpty(row.BirthDate) || null,
      deathYear: formatYearOrEmpty(row.DeathDate) || null,
      sex: row.Sex ?? null,
      mediaId: row.PrimaryMediaId ?? null,
      focalX: row.FocalX ?? null,
      focalY: row.FocalY ?? null,
      focalRadius: row.FocalRadius ?? null,
    });
    const full = normalizeName(raw);
    if (!full) continue;
    const bucket = byFullName.get(full);
    if (bucket) bucket.push(row.Id);
    else byFullName.set(full, [row.Id]);
  }

  const byVariant = new Map<string, Set<number>>();
  for (const row of snapshot.variants) {
    if (!row.Name) continue;
    const key = normalizeName(row.Name);
    if (!key) continue;
    const bucket = byVariant.get(key);
    if (bucket) bucket.add(row.Id);
    else byVariant.set(key, new Set([row.Id]));
  }

  function compute(needle: string): FaceNameMatch {
    const exact = byFullName.get(needle) ?? [];
    if (exact.length) return verdict(exact, 'exact');

    // Name variants: nicknames, maiden names, aliases.
    const viaVariant = byVariant.get(needle);
    if (viaVariant?.size) return verdict([...viaVariant], 'variant');

    // First + last ignoring middle names: "Ada Mary Whitcombe" -> "Ada Whitcombe".
    const parts = needle.split(' ');
    if (parts.length > 2) {
      const loose = byFullName.get(`${parts[0]} ${parts[parts.length - 1]}`) ?? [];
      if (loose.length) return verdict(loose, 'variant');
    }

    return NO_MATCH;
  }

  const memo = new Map<string, FaceNameMatch>();
  return {
    match(name: string): FaceNameMatch {
      const needle = normalizeName(name);
      if (!needle) return NO_MATCH;
      const cached = memo.get(needle);
      if (cached) return cached;
      const result = compute(needle);
      memo.set(needle, result);
      return result;
    },
    displayName(id: number): string | null {
      return display.get(id) ?? null;
    },
    person(id: number): FacePersonRef | null {
      return refs.get(id) ?? null;
    },
  };
}

/** One-shot pure match against a snapshot — the unit-testable core. */
export function matchNameInSnapshot(name: string, snapshot: PeopleNameSnapshot): FaceNameMatch {
  return createNameMatcher(snapshot).match(name);
}

/** Reads the tree's names (two queries, once) and returns a memoised matcher. */
export async function loadNameMatcher(
  treeId: number,
  options?: { withPeopleDetail?: boolean },
): Promise<NameMatcher> {
  // The photo LATERAL is opt-in because `captureFacesForMedia` calls this ONCE
  // PER IMPORTED PHOTO and uses none of it — a 500-photo import into a
  // 5,000-person tree would run 500 x 5,000 primary-photo lookups and discard
  // every one. Only the review queue, which renders candidate chips, asks for it.
  const detail = options?.withPeopleDetail === true;
  const people = await query(
    detail
      ? `SELECT p."Id", p."FirstName", p."LastName", p."BirthDate", p."DeathDate", p."Sex",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
           FROM "People" p
           ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
          WHERE p."TreeId" = $1`
      : `SELECT "Id", "FirstName", "LastName" FROM "People" WHERE "TreeId" = $1`,
    [treeId],
  );
  const variants = await query(
    `SELECT nv."PersonId" AS "Id", nv."Name"
       FROM "NameVariant" nv
       JOIN "People" p ON p."Id" = nv."PersonId"
      WHERE p."TreeId" = $1`,
    [treeId],
  );
  return createNameMatcher({
    people: people.rows as PersonNameRow[],
    variants: variants.rows as NameVariantRow[],
  });
}

/**
 * How many people the photo shows, for the queue's photo peek (#1156): its face tags
 * plus the faces still waiting in this queue. Confirmed candidates are already tags.
 */
const PHOTO_PEOPLE_COUNT = `(
         (SELECT COUNT(*) FROM "MediaTag" t WHERE t."MediaId" = c."MediaId")
       + (SELECT COUNT(*) FROM "MediaFaceCandidate" o WHERE o."MediaId" = c."MediaId" AND o."Status" = 'pending')
       )::int AS "MediaPeopleCount"`;

/** Every pending candidate in the tree, oldest first. */
export async function getPendingCandidates(treeId: number, mediaId?: number): Promise<MediaFaceCandidate[]> {
  const result = await query(
    `SELECT c.*, m."Title" AS "MediaTitle", m."Date" AS "MediaDate", ${PHOTO_PEOPLE_COUNT}
       FROM "MediaFaceCandidate" c
       LEFT JOIN "Media" m ON m."Id" = c."MediaId" AND m."TreeId" = c."TreeId"
      WHERE c."TreeId" = $1 AND c."Status" = 'pending'
        AND ($2::int IS NULL OR c."MediaId" = $2)
      ORDER BY c."SourceName" NULLS LAST, c."Id"`,
    [treeId, mediaId ?? null],
  );
  return result.rows as MediaFaceCandidate[];
}

/** Resolved candidates from the last `days` days, newest first. */
export async function getResolvedCandidates(treeId: number, days = 7, mediaId?: number): Promise<MediaFaceCandidate[]> {
  const result = await query(
    `SELECT c.*, m."Title" AS "MediaTitle", m."Date" AS "MediaDate", ${PHOTO_PEOPLE_COUNT}
       FROM "MediaFaceCandidate" c
       LEFT JOIN "Media" m ON m."Id" = c."MediaId" AND m."TreeId" = c."TreeId"
      WHERE c."TreeId" = $1 AND c."Status" <> 'pending'
        AND c."ResolvedAt" > CURRENT_TIMESTAMP - ($2 || ' days')::interval
        AND ($3::int IS NULL OR c."MediaId" = $3)
      ORDER BY c."ResolvedAt" DESC, c."Id" DESC`,
    [treeId, String(days), mediaId ?? null],
  );
  return result.rows as MediaFaceCandidate[];
}

/** Candidates by id, restricted to the tree — the IDOR guard for every mutation. */
export async function getCandidatesByIds(ids: number[], treeId: number): Promise<MediaFaceCandidate[]> {
  if (ids.length === 0) return [];
  const result = await query(
    `SELECT * FROM "MediaFaceCandidate" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`,
    [ids, treeId],
  );
  return result.rows as MediaFaceCandidate[];
}

/** Lock one tree-visible candidate so tag creation and status transition are atomic. */
export async function getCandidateForConfirmation(
  id: number,
  treeId: number,
  exec: DbExecutor,
): Promise<MediaFaceCandidate | null> {
  const result = await exec.query(
    `SELECT * FROM "MediaFaceCandidate"
      WHERE "Id" = $1 AND "TreeId" = $2
      FOR UPDATE`,
    [id, treeId],
  );
  return (result.rows[0] as MediaFaceCandidate | undefined) ?? null;
}

/**
 * Every status write carries `treeId` as well as the row id. Callers already
 * derive their ids from the tree-scoped `getCandidatesByIds`, so this changes
 * nothing today — it is the second barrier the rest of this codebase keeps, so
 * that a future caller passing raw client ids cannot become a cross-tree write.
 */
export async function markConfirmed(
  id: number,
  tagId: number | null,
  treeId: number,
  exec: DbExecutor = { query },
): Promise<boolean> {
  const result = await exec.query(
    `UPDATE "MediaFaceCandidate"
        SET "Status" = 'confirmed', "ConfirmedTagId" = $2,
            "DismissReason" = NULL, "ResolvedAt" = CURRENT_TIMESTAMP
      WHERE "Id" = $1 AND "TreeId" = $3 AND "Status" = 'pending'`,
    [id, tagId, treeId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markDismissed(
  id: number,
  reason: FaceDismissReason,
  treeId: number,
  exec: DbExecutor = { query },
): Promise<boolean> {
  const result = await exec.query(
    `UPDATE "MediaFaceCandidate"
        SET "Status" = 'dismissed', "DismissReason" = $2, "ResolvedAt" = CURRENT_TIMESTAMP
      WHERE "Id" = $1 AND "TreeId" = $3 AND "Status" = 'pending'`,
    [id, reason, treeId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markPending(id: number, treeId: number, exec: DbExecutor = { query }): Promise<boolean> {
  const result = await exec.query(
    `UPDATE "MediaFaceCandidate"
        SET "Status" = 'pending', "ConfirmedTagId" = NULL,
            "DismissReason" = NULL, "ResolvedAt" = NULL
      WHERE "Id" = $1 AND "TreeId" = $2`,
    [id, treeId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Re-points candidates at a person the user chose, without resolving them.
 * They stay `pending`; only the suggestion changes, which is what lets an
 * ambiguous group become confirmable through the ordinary matched path.
 * Only pending rows are touched — a resolved candidate's suggestion is history.
 */
export async function setSuggestedPersonForCandidates(
  ids: number[],
  personId: number,
  kind: FaceMatchKind,
  treeId: number,
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await query(
    `UPDATE "MediaFaceCandidate"
        SET "SuggestedPersonId" = $2, "MatchKind" = $3
      WHERE "Id" = ANY($1::int[]) AND "TreeId" = $4 AND "Status" = 'pending'
      RETURNING "Id"`,
    [ids, personId, kind, treeId],
  );
  return result.rows.length;
}

/**
 * What a candidate's suggestion looked like before a re-point overwrote it.
 *
 * Re-pointing is destructive in place — it replaces `SuggestedPersonId` and
 * `MatchKind` on a row that stays pending — so unlike confirm and dismiss there
 * is no status transition for `markPending` to walk back. Undo therefore needs
 * the prior values captured before the write.
 */
export interface FaceSuggestionSnapshot {
  id: number;
  personId: number | null;
  kind: FaceMatchKind;
}

/**
 * Puts previously-captured suggestions back on rows that are still pending.
 *
 * Set-based rather than a loop: undo is one user gesture and may cover a whole
 * group. `Status = 'pending'` is re-checked here, so undoing after the group was
 * confirmed in another tab silently no-ops on those rows instead of resurrecting
 * a suggestion behind a decision the user already made.
 */
export async function restoreFaceSuggestions(
  snapshots: FaceSuggestionSnapshot[],
  treeId: number,
): Promise<number> {
  if (snapshots.length === 0) return 0;
  const result = await query(
    `UPDATE "MediaFaceCandidate" AS c
        SET "SuggestedPersonId" = v.person_id, "MatchKind" = v.kind
       FROM (SELECT * FROM unnest($1::int[], $2::int[], $3::text[]) AS t(id, person_id, kind)) AS v
      WHERE c."Id" = v.id AND c."TreeId" = $4 AND c."Status" = 'pending'
      RETURNING c."Id"`,
    [
      snapshots.map(s => s.id),
      snapshots.map(s => s.personId),
      snapshots.map(s => s.kind),
      treeId,
    ],
  );
  return result.rows.length;
}

/** Which of these person ids actually exist in this tree — the IDOR guard for restore. */
export async function filterPersonIdsInTree(personIds: number[], treeId: number): Promise<Set<number>> {
  if (personIds.length === 0) return new Set();
  const result = await query(
    `SELECT "Id" FROM "People" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`,
    [personIds, treeId],
  );
  return new Set((result.rows as { Id: number }[]).map(r => r.Id));
}

/** Count of pending candidates — drives the Faces tab badge. */
export async function countPendingCandidates(treeId: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS "n" FROM "MediaFaceCandidate" WHERE "TreeId" = $1 AND "Status" = 'pending'`,
    [treeId],
  );
  return (result.rows[0] as { n: number }).n;
}

/**
 * EVERY resolved candidate, deliberately unwindowed.
 *
 * This is the review-progress numerator, and `countPendingCandidates` — its
 * denominator partner — counts all pending rows with no window at all. Matching
 * `getResolvedCandidates`' 7-day listing window here instead made progress run
 * BACKWARDS with no user action: "100 of 110 reviewed" became "0 of 10" once
 * those decisions aged out of the window while the pending side never moved.
 *
 * The Recently-resolved LIST stays windowed; only this counter is all-time.
 */
export async function countResolvedCandidates(treeId: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS "n" FROM "MediaFaceCandidate"
      WHERE "TreeId" = $1 AND "Status" <> 'pending'`,
    [treeId],
  );
  return (result.rows[0] as { n: number }).n;
}
