import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';

/**
 * Guard: the static (PGlite) build skips re-running `initializeSchema` when a
 * persisted local database already records the current `SCHEMA_VERSION` (see the
 * gate in `lib/db/connection.pglite.ts`). So if you change the schema but forget
 * to bump `SCHEMA_VERSION`, the change silently never reaches existing local
 * databases and the app breaks against the new query code with no init-time error.
 *
 * This test fingerprints the `initializeSchema` body. Any edit to it fails this
 * test on purpose. To make it pass after an INTENTIONAL schema change:
 *   1. Bump `SCHEMA_VERSION` in `lib/db/init-schema.ts`.
 *   2. Paste the new fingerprint printed in the failure message into
 *      `EXPECTED_FINGERPRINT` below.
 *
 * (The fingerprint hashes only the function body — `SCHEMA_VERSION` is declared
 * above it and is deliberately excluded — so a version bump alone won't make a
 * real schema change pass without also updating the fingerprint here.)
 *
 * A pure unit test can't read git history to *prove* the version was bumped, so
 * this is a deliberate conscious-stop guard rather than an absolute lock.
 */
// NB: the fingerprint hashes the whole function body incl. comments, so a
// comment-only edit trips it too. Last bump: Events gains a RawGedcom passthrough
// column, and People/Families gain BirthRawGedcom/DeathRawGedcom/MarriageRawGedcom
// — dedicated columns (not the general RawGedcom) so an unmodeled BIRT/DEAT/MARR
// sub-tag (e.g. CAUS) re-emits nested under its own line instead of dangling at
// record end (SCHEMA_VERSION 20 → 21, #423).
// v22 — NoteLink."IsPrimary" + idx_notelink_one_primary, and the backfilled-note
// tree repair (ADR 0010/0012/0013).
// v23 — no DDL: the one-time Events."Date" normalisation for #400. Legacy rows
// stored raw GEDCOM ("26 AUG 1819") where the promoted columns stored ISO, which
// both rendered literally and mis-ordered timelines (ORDER BY "Date" on TEXT).
// v24 — no DDL either: the one-time Places."Form" = 'LINEAGE-LINKED' remediation
// for #394. Equality-scoped so a real jurisdiction ('City') is never touched.
// v25 — Sources."Abbreviation" for GEDCOM `1 ABBR` (#501). Additive and nullable.
// v26 — People."Notes" is DROPPED (#524 / ADR 0010). Unlike every bump above this
// one is DESTRUCTIVE and irreversible: nothing restores the column's contents but
// the Note rows the backfill writes from it a few statements earlier, in the same
// initializeSchema run. The backfill's SELECT is guarded by a column-exists check
// so the second and every later boot is a no-op instead of a hard startup failure
// — see the '#524 drop guard' tests in notes-backfill.pglite.test.ts.
// v27 — block that destructive drop when a legacy person note has no owner. A
// first-class Note requires OwnerId, so retaining the column is the only safe
// outcome until that person is assigned; re-run init then mirrors and drops it.
// v30 — NoteLink identity includes nullable OwnerFact, allowing one shared note
// to attach to multiple promoted facts on the same owner (#512).
// v31 — "SortableYear"(text) SQL function, mirroring sortableYear() in
// lib/date-utils.ts so the year-extraction rule is defined once and callable
// from SQL as well as TypeScript (#490, ADR 0016).
// v32 — MediaFaceCandidate table for staging face regions from photo metadata
// (#487). Separate from MediaTag since candidates have no confirmed person.
// v33 — Media."ContentHash" + idx_media_tree_hash for the duplicate-upload guard
// (#592). Additive, nullable, non-UNIQUE; existing rows stay NULL and never
// match. The bump matters more than usual here: without it a persisted local
// PGlite database would skip the migration and then fail every createMedia,
// which now writes the column.
// v34 — MediaLink."IsPrimary", its People-only check and one-primary-per-person
// index, plus same-tree canonical People-link and deterministic primary
// reconciliation. Additive and idempotent; invalid/cross-tree legacy rows are
// deliberately skipped for the integrity audit rather than canonicalized. The
// compatibility pass then mirrors lowest linked PersonId and canonical primary
// state back to Media/MediaTag without making those legacy fields authoritative.
// PR A review correction (no DDL): repeated init preserves canonical primaries,
// and invalid legacy owner/primary evidence remains available to the audit.
// Fix round 2 adds only aggregate startup diagnostics for that preserved state.
// v36 — durable MediaImportItem lineage and materialization state for resumable
// imported media recovery, with status/failure/path/flag invariants.
// v37 — nullable, tree-scoped Media.UploadIntentId and its partial unique index,
// plus nullable operational UploadIntentTarget (excluded from GEDCOM export).
// make create-time staged file retries idempotent without deduplicating content.
// v39 — keep retired case citations in their case tree and reconcile v38 copies.
// v42 — "SearchFold"() and the generated People/NameVariant."SearchName" columns
// behind accent- and ё-insensitive search (#792).
// v43 — CaseComments."Kind": the journal's status-change and conclusion entries (#801).
// v44 — Media."Date": when a photo was taken, carried in media.json (#802).
// v45 — "DataCheckConfirmations" and the 'datacheck' audit entity type (#830).
// v46 — Media."SourceFile": the FILE text a GEDCOM import declared (#958).
// v47 — FamilyPerson."FamcRawGedcom": a child link's GEDCOM passthrough (#954).
// v48 — FamilyPerson."ChilRawGedcom": the same link's sub-lines under CHIL (#961).
// v49 — People."NameRawGedcom": the primary NAME's unmodeled sub-lines (#964).
// v50 — Families."MarriageRecorded": a bare `1 MARR` with no date or place (#965).
// v51 — Repository."RawGedcom" / "AddressRawGedcom": a REPO record's passthrough (#966).
// v53 — Citation."RawGedcom" and Media."FileRawGedcom": citation media and FILE sub-lines (#976).
// v54 — Citation."Part": a citation of a fact's DATE or PLAC line (#990).
// v55 — Families."Partner1RawGedcom" / "Partner2RawGedcom": sub-lines under HUSB / WIFE (#989).
// v56 — Citation."Url": the link to the record a citation points at (#1023), lifted out of
//       citation passthrough on the boot that adds it (#1024, ADR 0025).
// v57 — NoteLink."AddedInApp": a note written in the app, not imported (#902).
// v58 — Note."UpdatedAt" (backfilled from CreatedAt) and the 'note' audit entity type (#1045).
// v59 — FamilyPerson."Partner1Relationship" / "Partner2Relationship" replace "RelationshipType"
//       (#982, ADR 0027). DESTRUCTIVE: the old column is copied to both, FTM `_FREL` / `_MREL`
//       lines in "ChilRawGedcom" set each partner, and the column is dropped, once.
// v60 — MediaLink."OwnerFact" (#905, ADR 0030). The primary key becomes the
//       idx_medialink_identity expression index, a check ties each fact to its owner
//       table, and a primary must be record-level. Additive: existing links stay NULL.
// v61 — facts point at their place by id (#1167, ADR 0031): People."BirthPlaceId" /
// "DeathPlaceId", Families."MarriagePlaceId" and Events."PlaceId" (FKs, ON DELETE SET
// NULL) plus the "PlaceName" table of other names. The referenced-places backfill
// becomes linkFactPlaces, which also links every fact on every init.
// v62 — facts also point at which name they use (#1186): People."BirthPlaceNameId" /
// "DeathPlaceNameId", Families."MarriagePlaceNameId" and Events."PlaceNameId" (FKs to
// "PlaceName", ON DELETE SET NULL). The references become the truth and the text a copy;
// the every-init link pass fills them and re-matches only facts whose text disagrees.
// v63 — two places may share a name (#1186, ADR 0036): idx_places_tree_name is dropped for
// the plain idx_places_tree_name_lookup, whose presence keeps the v20 dedup from running,
// and "PlaceUseCount" / "PlaceIdByName" resolve a name to the most-used place of it.
// v64 — facts keep no place text (#1186, ADR 0037): People."BirthPlace" / "DeathPlace",
// Families."MarriagePlace" and Events."Place" are dropped, with their indexes, once a
// last link pass and a check that every fact's references spell its text pass.
// v65 — Sources."ToldBy" is DROPPED (#470, ADR 0038) after folding into "Author" in
// the same DO block, guarded on the column, so the fold can never apply twice.
// v66 — "PendingShares" (#1228): a tree shared with an address that has no account
// yet, moved into "TreeSharing" at that address's first verified sign-in. Additive.
// v67 — AuditLog EntityType adds 'casenote' (#1227): case journal note edits and
// deletes are audited and revertible. Widens a CHECK; additive.
// v68 — journal entries are append-only (#1251, ADR 0042): CaseComments."StruckAt",
// "StruckBy" (FK, ON DELETE SET NULL) and "StruckReason", with casecomments_struck_check
// (a marker only on a note, never on a status or conclusion line). Additive.
// v69 — the research workspace (#58, ADR 0045): "CaseLeads", "CaseLeadPerson",
// "CaseRequests", "CaseFindings", "CaseFindingLead", "CaseClaims", "CaseCommentLead";
// "Cases" gains FromYear/ToYear/Place/QuestionKind/Outcome/ClosedAt and "CaseComments"
// FindingId/RequestId; the Kind check becomes casecomments_kind_check with the new
// kinds; every case gets its question as a first lead. Additive.
// v70 — Answer and close (#58, ADR 0046): "CaseClaims"."AppliedCitationAuditId", the audit
// entry of the citation an applied claim put on the tree, so Undo reverts it too. Additive.
const EXPECTED_FINGERPRINT = 'cb7ec1f6ce14392da8af5b03b3b593fada11b1df59754ad2fc7b1cacd8769362';

function schemaFingerprint(): string {
  const src = readFileSync(
    path.join(process.cwd(), 'lib', 'db', 'init-schema.ts'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  // The function is the last export in the file; hash from its declaration to EOF.
  const start = src.indexOf('export async function initializeSchema');
  if (start === -1) throw new Error('Could not locate initializeSchema in init-schema.ts');
  return createHash('sha256').update(src.slice(start)).digest('hex');
}

describe('schema version guard', () => {
  it('SCHEMA_VERSION must be bumped whenever initializeSchema changes', () => {
    const actual = schemaFingerprint();
    if (actual !== EXPECTED_FINGERPRINT) {
      throw new Error(
        `\ninitializeSchema (lib/db/init-schema.ts) changed.\n` +
          `If this is an intentional schema change you MUST:\n` +
          `  1. bump SCHEMA_VERSION in lib/db/init-schema.ts (currently ${SCHEMA_VERSION}) — ` +
          `otherwise existing local PGlite databases will never re-run the migration;\n` +
          `  2. set EXPECTED_FINGERPRINT in this test to:\n     ${actual}\n`
      );
    }
    // A version is always recorded; keep it a positive integer.
    expect(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 1).toBe(true);
  });
});
