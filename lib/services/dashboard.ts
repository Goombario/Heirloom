import { query } from '@/lib/db/connection';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { getAuditLog } from '@/lib/db/queries/audit';
import { effectiveFirstName, getPersonSourcing, primaryNickname } from '@/lib/db/queries/people';
import { primaryPhotoJoin } from '@/lib/db/queries/media-tags';
import { getTopPlacesByRecordCount } from '@/lib/db/queries/places';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';
import { getLikelyDuplicates } from '@/lib/db/queries/data-quality';
import { getRecentlyEditedPeople } from '@/lib/db/queries/recent-people';
import type { DashboardData, Suggestion } from '@/lib/data/types';
import { groupActivityRuns } from '@/lib/utils/activity-groups';
import { liveChildLinkSql, liveEventSql } from '@/lib/db/queries/live-owner';

const ACTIVITY_WINDOW = 200;

export interface GetDashboardParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/dashboard logic: validate access, gather stats/cases/places/audit, build resume card. */
export async function getDashboardService(params: GetDashboardParams): Promise<DashboardData> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const treeId = scope.treeId;

  // Every read here depends only on the tree, so they share one round-trip wave
  // instead of five sequential ones (#1268).
  const [statsRows, casesRows, topPlaces, auditLog, lastPersonRow] = await Promise.all([
    query(
      `SELECT
          (SELECT COUNT(*) FROM "People" WHERE "TreeId" = $1)::int AS people,
          (SELECT COUNT(*) FROM "Families" WHERE "TreeId" = $1)::int AS families,
          (SELECT COUNT(*) FROM "Events" e WHERE e."TreeId" = $1 AND ${liveEventSql('e')})::int AS events,
          (SELECT COUNT(*) FROM "Sources" WHERE "TreeId" = $1)::int AS sources,
          (SELECT COUNT(*) FROM "Cases" WHERE "TreeId" = $1 AND "Status" = 'in_progress')::int AS "casesInProgress"`,
      [treeId]
    ),
    query(
      `SELECT c."Id", c."Title", c."Status", c."Tags", c."UpdatedAt",
              (SELECT cc."Body" FROM "CaseComments" cc
               WHERE cc."CaseId" = c."Id" AND cc."StruckAt" IS NULL
               ORDER BY cc."CreatedAt" DESC LIMIT 1) AS "LastComment"
       FROM "Cases" c
       WHERE c."TreeId" = $1 AND c."Status" = 'in_progress'
       ORDER BY c."UpdatedAt" DESC
       LIMIT 5`,
      [treeId]
    ),
    getTopPlacesByRecordCount(treeId, 5),
    // A window wide enough to count a typical bulk run, grouped into five rows (#768).
    getAuditLog(treeId, { page: 1, pageSize: ACTIVITY_WINDOW }),
    // Resume the most recently edited person directly from the audit log, rather
    // than scanning only the latest few activity rows — otherwise a run of case
    // edits would hide the resume card even though a person was edited earlier.
    query(
      `SELECT "EntityId", "Action", "EntityLabel", "Changes", "CreatedAt" FROM "AuditLog"
       WHERE "TreeId" = $1 AND "EntityType" = 'person' AND "Action" <> 'delete'
       ORDER BY "CreatedAt" DESC LIMIT 1`,
      [treeId]
    ),
  ]);

  const { entries: auditWindow, total: auditTotal } = auditLog;
  const recentActivity = groupActivityRuns(auditWindow, 5, auditTotal > auditWindow.length);

  const stats = statsRows.rows[0] || { people: 0, families: 0, events: 0, sources: 0, casesInProgress: 0 };

  // Resumed person: most recent person edit, with role pills and the same
  // "X/Y sourced" tag as the person hero (Female · Spouse · Mother · 2/4 sourced).
  let resumedPerson: DashboardData['resumedPerson'] = null;

  const lastPersonAudit = lastPersonRow.rows[0];
  const lastPersonId = lastPersonAudit?.EntityId as number | undefined;
  if (lastPersonId) {
    const [r, sourcing] = await Promise.all([query(
      `SELECT
          p."Id", p."FirstName", p."LastName", p."Sex",
          ${effectiveFirstName('p')} AS "EffectiveFirstName",
          ${primaryNickname('p')} AS "Nickname",
          p."BirthDate", p."DeathDate", p."IsDeceased", ${factPlaceTextColumns('people', 'p')},
          m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius",
          (
              SELECT COUNT(*) FROM "Families" f
              WHERE f."TreeId" = $2
                AND (COALESCE(f."Partner1Id", f."HusbandId") = p."Id"
                  OR COALESCE(f."Partner2Id", f."WifeId") = p."Id")
          )::int AS "partnershipCount",
          (
              SELECT COUNT(*) FROM "FamilyPerson" fp
              WHERE ${liveChildLinkSql('fp')} AND fp."FamiliesAsChildId" IN (
                  SELECT f."Id" FROM "Families" f
                  WHERE f."TreeId" = $2
                    AND (COALESCE(f."Partner1Id", f."HusbandId") = p."Id"
                      OR COALESCE(f."Partner2Id", f."WifeId") = p."Id")
              )
          )::int AS "childrenCount"
       FROM "People" p
       ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
       WHERE p."Id" = $1 AND p."TreeId" = $2
       LIMIT 1`,
      [lastPersonId, treeId]
    ), getPersonSourcing(lastPersonId, treeId)]);
    const row = r.rows[0];
    if (row && sourcing) {
      resumedPerson = {
        ...row,
        ...sourcing,
        lastChange: {
          Action: lastPersonAudit.Action,
          EntityLabel: lastPersonAudit.EntityLabel,
          Changes: lastPersonAudit.Changes,
          CreatedAt: lastPersonAudit.CreatedAt,
        },
      };
    }
  }

  // The phone home's "Recently edited" (#1061): the next people after the resumed one.
  const recentPeople = await getRecentlyEditedPeople(treeId, resumedPerson?.Id ?? null, 4);

  return {
    stats: {
      people: stats.people,
      families: stats.families,
      events: stats.events,
      sources: stats.sources,
      casesInProgress: stats.casesInProgress,
    },
    openCases: casesRows.rows,
    recentActivity,
    places: topPlaces,
    resumedPerson,
    recentPeople,
  };
}

export interface GetSuggestionsParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * GET /api/suggestions logic: validate access, count likely duplicate pairs. Home
 * shows only work that can reach zero, so the missing-parents and no-events
 * suggestions were removed (#834); the "Dates to check" card replaces them.
 */
export async function getSuggestionsService(params: GetSuggestionsParams): Promise<Suggestion[]> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  // The same pairing the People page lists, counted in pairs (#794, #822).
  const dupCount = (await getLikelyDuplicates(scope.treeId)).pairs.length;

  // Server returns the shape only; the client picks a translated label from
  // the type+count so messages localize correctly.
  const suggestions: Suggestion[] = [];
  if (dupCount > 0) {
    suggestions.push({ type: 'duplicates', count: dupCount, href: '/people?filter=duplicates' });
  }
  return suggestions;
}
