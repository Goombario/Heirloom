import {
  loadNameMatcher, setSuggestedPersonForCandidates,
  getPendingCandidates, getResolvedCandidates, getCandidatesByIds, getCandidateForConfirmation,
  markConfirmed, markDismissed, markPending, countPendingCandidates, countResolvedCandidates,
  restoreFaceSuggestions, filterPersonIdsInTree,
  type FaceDismissReason, type FacePersonRef, type FaceSuggestionSnapshot,
} from '@/lib/db/queries/media-faces';
import { resolveTreeScope, type TreeScope } from '@/lib/db/queries/trees';
import { AccessError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { getTagsForMedia } from '@/lib/db/queries/media-tags';
import { addTagSettingFirstPrimary, removeMediaTagCanonicalInTransaction } from '@/lib/services/media';
import { getPersonById } from '@/lib/db/queries/people';
import { NotFoundError } from '@/lib/data/errors';
import type { MediaFaceCandidate, FaceMatchKind } from '@/lib/db/schema';
import { getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';

// Compatibility export for callers that consumed the service module before
// capture orchestration was separated from queue/review operations.
export { captureFacesForMedia } from '@/lib/services/media-face-capture';

interface Ctx { requestedTreeId: number | null; requestedOwnerId: number | null; currentUserId: number }

function resolveOwner(ctx: Ctx): Promise<TreeScope> {
  return resolveTreeScope({ treeId: ctx.requestedTreeId, ownerId: ctx.requestedOwnerId }, ctx.currentUserId);
}

async function requireWrite(ctx: Ctx): Promise<TreeScope> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
  return scope;
}

/**
 * Hard cap on the candidates one mutation may name.
 *
 * Every mutating path loops per candidate doing up to two writes each, so an
 * uncapped id array is an unbounded serial write burst from a single request.
 * The UI never sends more than one group, and a group is the faces of one
 * person across an import — 500 is far beyond any real one. Enforced HERE, in
 * the service, because the static/desktop build calls these functions directly
 * and never passes through an API route.
 */
export const MAX_CANDIDATE_IDS = 500;

/** Validated against on the undo path, where the kind arrives from the client. */
const FACE_MATCH_KINDS = new Set<FaceMatchKind>(['exact', 'variant', 'ambiguous', 'none', 'chosen']);

function requireCandidateIds(ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new ValidationError('candidateIds must be a non-empty array of ids');
  }
  if (ids.length > MAX_CANDIDATE_IDS) {
    throw new ValidationError(`At most ${MAX_CANDIDATE_IDS} candidates may be changed at once`);
  }
}

export interface FaceGroup {
  /**
   * Stable identity for this group — the React key, and the reason a re-pointed
   * face can leave its name group. Groups are keyed by the name written in the
   * photo, EXCEPT for candidates a human re-pointed, which key by name + person
   * so "this one is actually the other Ada" splits off (spec §5) instead of
   * being folded back in with its siblings.
   */
  groupKey: string;
  sourceName: string | null;
  matchKind: FaceMatchKind;
  /** Matcher-loaded person detail shared with cards; null when unmatched. */
  suggestedPerson: FacePersonRef | null;
  candidateCount: number;
  candidates: MediaFaceCandidate[];
  /**
   * How many real people share `sourceName`. Set ONLY when the group really is
   * ambiguous right now — i.e. the fresh match still reports more
   * than one person — and null otherwise. Computed server-side via the same
   * function that produced the stored verdict, so the UI never has to re-derive
   * the matching rule (name-variant matches included) with a second, looser
   * client-side lookup. NOT the same number as `candidateCount`, which counts
   * FACES, not people.
   */
  ambiguousPersonCount: number | null;
  /**
   * The people this ambiguous name resolves to, one per chip on the card.
   *
   * Populated under EXACTLY the same guard as `ambiguousPersonCount`, and always
   * that long. The two must never disagree: a badge reading "2 people share this
   * name" above three chips is worse than the modal this replaces.
   */
  ambiguousCandidates: FacePersonRef[];
}

type FaceConfirmItemResult =
  | { candidateId: number; status: 'confirmed'; tagId: number | null }
  | { candidateId: number; status: 'skipped'; code: 'already_resolved' | 'not_found_or_inaccessible' }
  | { candidateId: number; status: 'failed'; code: 'confirm_failed'; retryable: true };

export interface FaceConfirmBatchResult {
  results: FaceConfirmItemResult[];
  requestedCount: number;
  confirmedCount: number;
  skippedCount: number;
  failedCount: number;
}

/**
 * The queue, grouped by the name written in the photo rather than by photo.
 * That grouping is the whole point: one decision resolves every photo of a
 * person, which is what makes a 200-photo import tractable.
 */
export async function listFaceQueueService(
  ctx: Ctx & { resolved?: boolean; countOnly?: boolean; mediaId?: number },
): Promise<{ groups: FaceGroup[]; pendingTotal: number; resolvedTotal: number }> {
  const scope = await resolveOwner(ctx);

  // The Library tab badge only needs the integer. Building the groups for it
  // meant reading every pending row, every person name, and one full-table
  // name match per ambiguous name — on every Library page mount. `countOnly`
  // short-circuits to the single COUNT(*) that badge actually renders.
  if (ctx.countOnly) {
    return ctx.resolved
      ? { groups: [], pendingTotal: 0, resolvedTotal: await countResolvedCandidates(scope.treeId) }
      : { groups: [], pendingTotal: await countPendingCandidates(scope.treeId), resolvedTotal: 0 };
  }

  const [rows, pendingTotal, resolvedTotal] = await Promise.all([
    ctx.resolved
      ? getResolvedCandidates(scope.treeId, undefined, ctx.mediaId)
      : getPendingCandidates(scope.treeId, ctx.mediaId),
    countPendingCandidates(scope.treeId),
    countResolvedCandidates(scope.treeId),
  ]);
  // Most photos have no candidates, and the matcher reads every person's names.
  if (rows.length === 0) return { groups: [], pendingTotal, resolvedTotal };

  // Spec §3: "Matching runs once at parse time and is re-run when the review page
  // loads (people change between import and review)." A candidate captured as
  // 'none' before its person existed must not stay 'none' for ever — creating
  // "Ada Whitcombe" in People and then opening Faces is the ordinary workflow.
  // Re-deriving for EVERY named group also settles the case where rows captured
  // at different times disagree inside one group: the live verdict is the only
  // one that matters, and it is the same for every row sharing a name.
  //
  // One snapshot of the tree's names serves the whole page, memoised per name.
  const matcher = await loadNameMatcher(scope.treeId, { withPeopleDetail: true });
  const byKey = new Map<string, FaceGroup>();
  for (const row of rows) {
    // A human's choice outranks the matcher and is never re-derived away, so a
    // re-pointed candidate keys — and therefore groups — by its chosen person.
    const chosen = row.MatchKind === 'chosen' && row.SuggestedPersonId != null;
    const key = chosen
      ? `chosen:${row.SuggestedPersonId}:${row.SourceName ?? ''}`
      : `name:${row.SourceName ?? ''}`;

    let group = byKey.get(key);
    if (!group) {
      const fresh = row.SourceName ? matcher.match(row.SourceName) : null;
      const personId = chosen ? row.SuggestedPersonId : fresh ? fresh.personId : row.SuggestedPersonId;
      const suggested = personId != null ? matcher.person(personId) : null;
      // ONE derivation for both ambiguity fields. The list is the source of
      // truth and the count is its length, so the badge ("2 people share this
      // name") can never disagree with the chips rendered beneath it. Evaluated
      // only while the name genuinely resolves to more than one person, so the
      // card can never render a nonsense "1 people share this name".
      const ambiguousCandidates =
        !chosen && fresh && fresh.kind === 'ambiguous'
          ? fresh.candidateIds
            .map(id => matcher.person(id))
            .filter((p): p is FacePersonRef => p !== null)
          : [];
      const isAmbiguous = ambiguousCandidates.length > 1;
      group = {
        groupKey: key,
        sourceName: row.SourceName,
        matchKind: chosen ? 'chosen' : fresh ? fresh.kind : row.MatchKind,
        suggestedPerson: suggested,
        candidateCount: 0,
        candidates: [],
        ambiguousPersonCount: isAmbiguous ? ambiguousCandidates.length : null,
        ambiguousCandidates: isAmbiguous ? ambiguousCandidates : [],
      };
      byKey.set(key, group);
    }
    group.candidateCount++;
    group.candidates.push(row);
  }

  return { groups: [...byKey.values()], pendingTotal, resolvedTotal };
}

/**
 * Turns candidates into real face tags.
 *
 * A person already tagged on the photo is left completely alone. `addMediaTag`
 * is ON CONFLICT DO UPDATE — it MOVES an existing tag to the incoming region —
 * so calling it blindly would drag a hand-placed box to wherever the photo's
 * metadata put it. `ConfirmedTagId` is therefore set only on a genuine insert,
 * which is exactly the condition undo needs.
 */
export async function confirmFacesService(
  ctx: Ctx & { candidateIds: number[]; personId: number },
): Promise<FaceConfirmBatchResult> {
  const candidateIds = [...new Set(ctx.candidateIds)];
  requireCandidateIds(candidateIds);
  if (candidateIds.length === 0 || candidateIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new ValidationError('candidateIds must be a non-empty array of ids');
  }
  const scope = await requireWrite(ctx);
  if (!Number.isInteger(ctx.personId) || ctx.personId <= 0) {
    throw new ValidationError('A valid personId is required');
  }
  // Validate up front, before the loop: a cross-tree or nonexistent personId
  // must not surface mid-batch as a bare Error from addMediaTag after earlier
  // candidates in the batch have already committed their tags.
  if (!(await getPersonById(ctx.personId, scope.treeId))) {
    throw new NotFoundError('Person not found in this tree');
  }
  const results: FaceConfirmItemResult[] = [];
  for (const candidateId of candidateIds) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const candidate = await getCandidateForConfirmation(candidateId, scope.treeId, client);
      if (!candidate) {
        await client.query('COMMIT');
        results.push({ candidateId, status: 'skipped', code: 'not_found_or_inaccessible' });
        continue;
      }
      if (candidate.Status !== 'pending') {
        await client.query('COMMIT');
        results.push({ candidateId, status: 'skipped', code: 'already_resolved' });
        continue;
      }

      const existing = (await getTagsForMedia(candidate.MediaId, scope.treeId, client))
        .find(tag => tag.PersonId === ctx.personId);
      let tagId: number | null = null;
      if (!existing) {
        // The first face confirmed for someone with no profile picture becomes
        // it; later ones in the batch see that primary and leave it (#922).
        const tag = await addTagSettingFirstPrimary({
          MediaId: candidate.MediaId,
          PersonId: ctx.personId,
          RegionX: candidate.RegionX,
          RegionY: candidate.RegionY,
          RegionW: candidate.RegionW,
          RegionH: candidate.RegionH,
        }, scope.treeId, ctx.currentUserId, client);
        tagId = tag.Id;
      }
      if (!await markConfirmed(candidate.Id, tagId, scope.treeId, client)) {
        throw new Error('Candidate changed during confirmation');
      }
      await client.query('COMMIT');
      results.push({ candidateId, status: 'confirmed', tagId });
    } catch {
      await safeRollback(client);
      results.push({ candidateId, status: 'failed', code: 'confirm_failed', retryable: true });
    } finally {
      client.release();
    }
  }

  return {
    results,
    requestedCount: candidateIds.length,
    confirmedCount: results.filter(result => result.status === 'confirmed').length,
    skippedCount: results.filter(result => result.status === 'skipped').length,
    failedCount: results.filter(result => result.status === 'failed').length,
  };
}

/**
 * Points candidates at a person the user chose, WITHOUT confirming them
 * (spec §5: "opens PersonPicker, re-points the group, stays pending").
 *
 * This is what an `ambiguous` group's picker does, and it is why picking a
 * person there cannot silently tag every face in the group: the candidates
 * become `chosen`, the card then offers an ordinary Confirm, and nothing
 * reaches `MediaTag` without that second, explicit click.
 */
export async function repointFacesService(
  ctx: Ctx & { candidateIds: number[]; personId: number },
): Promise<{ repointed: number; personName: string | null; previous: FaceSuggestionSnapshot[] }> {
  requireCandidateIds(ctx.candidateIds);
  const scope = await requireWrite(ctx);
  if (!Number.isInteger(ctx.personId) || ctx.personId <= 0) {
    throw new ValidationError('A valid personId is required');
  }
  const person = await getPersonById(ctx.personId, scope.treeId);
  if (!person) throw new NotFoundError('Person not found in this tree');

  // Re-fetch by id AND tree so an id from another tree simply is not returned.
  const candidates = await getCandidatesByIds(ctx.candidateIds, scope.treeId);
  const pendingRows = candidates.filter(c => c.Status === 'pending');
  // Captured BEFORE the write: re-pointing overwrites the suggestion in place on
  // a row that stays pending, so there is no status transition to walk back and
  // the old values are gone the moment the UPDATE lands. One mis-click on a
  // candidate chip is otherwise unrecoverable.
  const previous: FaceSuggestionSnapshot[] = pendingRows.map(c => ({
    id: c.Id,
    personId: c.SuggestedPersonId,
    kind: c.MatchKind,
  }));
  const repointed = await setSuggestedPersonForCandidates(
    pendingRows.map(c => c.Id), ctx.personId, 'chosen', scope.treeId,
  );
  return {
    repointed,
    personName: `${person.FirstName ?? ''} ${person.LastName ?? ''}`.trim() || null,
    previous,
  };
}

/**
 * Undo for a re-point: puts back the suggestions captured by `repointFacesService`.
 *
 * The snapshot round-trips through the client, so NOTHING in it is trusted. Ids
 * are re-scoped to the tree by `restoreFaceSuggestions`' own WHERE clause, every
 * person id is checked to exist in this tree (otherwise undo would be a writable
 * path for pointing a face at someone else's person row), and every kind is
 * checked against the known set.
 */
export async function restoreFaceSuggestionsService(
  ctx: Ctx & { previous: FaceSuggestionSnapshot[] },
): Promise<{ restored: number }> {
  const snapshots = Array.isArray(ctx.previous) ? ctx.previous : [];
  requireCandidateIds(snapshots.map(s => s.id));
  const scope = await requireWrite(ctx);
  if (snapshots.length === 0) return { restored: 0 };

  for (const s of snapshots) {
    if (!Number.isInteger(s.id) || s.id <= 0) throw new ValidationError('A valid candidate id is required');
    if (!FACE_MATCH_KINDS.has(s.kind)) throw new ValidationError('Unknown match kind');
    if (s.personId != null && (!Number.isInteger(s.personId) || s.personId <= 0)) {
      throw new ValidationError('A valid personId is required');
    }
  }

  const wantedPeople = [...new Set(snapshots.map(s => s.personId).filter((id): id is number => id != null))];
  const allowed = await filterPersonIdsInTree(wantedPeople, scope.treeId);
  if (wantedPeople.some(id => !allowed.has(id))) {
    throw new NotFoundError('Person not found in this tree');
  }

  return { restored: await restoreFaceSuggestions(snapshots, scope.treeId) };
}

export async function dismissFacesService(
  ctx: Ctx & { candidateIds: number[]; reason: FaceDismissReason },
): Promise<{ dismissed: number }> {
  requireCandidateIds(ctx.candidateIds);
  const scope = await requireWrite(ctx);
  if (ctx.reason !== 'not-a-face' && ctx.reason !== 'unidentified') {
    throw new ValidationError('Unknown dismiss reason');
  }
  let dismissed = 0;
  for (const candidateId of ctx.candidateIds) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const candidate = await getCandidateForConfirmation(candidateId, scope.treeId, client);
      if (!candidate || candidate.Status !== 'pending') {
        await client.query('COMMIT');
        continue;
      }
      if (await markDismissed(candidate.Id, ctx.reason, scope.treeId, client)) dismissed++;
      await client.query('COMMIT');
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
  return { dismissed };
}

/**
 * Returns candidates to the queue, removing only tags this feature created and
 * only while they still look as they were left. A region the user has since
 * dragged is their work now. Primary removal is delegated to the media service,
 * which repairs the person's canonical fallback atomically.
 */
export async function undoFacesService(
  ctx: Ctx & { candidateIds: number[] },
): Promise<{ restored: number; skipped: number }> {
  requireCandidateIds(ctx.candidateIds);
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  if (scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
  let restored = 0;
  let skipped = 0;
  for (const candidateId of ctx.candidateIds) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const candidate = await getCandidateForConfirmation(candidateId, scope.treeId, client);
      if (!candidate || candidate.Status === 'pending') {
        await client.query('COMMIT');
        continue;
      }
      if (candidate.ConfirmedTagId != null) {
        const tag = (await getTagsForMedia(candidate.MediaId, scope.treeId, client))
          .find(t => t.Id === candidate.ConfirmedTagId);
        if (tag) {
          const moved = !closeEnough(tag.RegionX, candidate.RegionX)
            || !closeEnough(tag.RegionY, candidate.RegionY)
            || !closeEnough(tag.RegionW, candidate.RegionW)
            || !closeEnough(tag.RegionH, candidate.RegionH);
          if (moved) {
            await client.query('COMMIT');
            skipped++;
            continue;
          }
          await removeMediaTagCanonicalInTransaction({
            tagId: tag.Id,
            mediaId: candidate.MediaId,
            treeId: scope.treeId,
            actingUserId: ctx.currentUserId,
          }, client);
        }
      }
      await markPending(candidate.Id, scope.treeId, client);
      await client.query('COMMIT');
      restored++;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
  return { restored, skipped };
}

/** REAL columns round-trip with float error; compare with a tolerance. */
function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}
