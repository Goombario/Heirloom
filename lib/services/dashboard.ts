import { query } from '@/lib/db/connection';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { getAuditLog, withoutEditorEmails } from '@/lib/db/queries/audit';
import { effectiveFirstName, getPersonSourcing, primaryNickname } from '@/lib/db/queries/people';
import { primaryPhotoJoin } from '@/lib/db/queries/media-tags';
import { getTopPlacesByRecordCount } from '@/lib/db/queries/places';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';
import { getLikelyDuplicates } from '@/lib/db/queries/data-quality';
import { getRecentlyEditedPeople } from '@/lib/db/queries/recent-people';
import { getDefaultRootPersonId, getPersonNextSteps, getPlaceCountries, getTreeYearSpan } from '@/lib/db/queries/home';
import type { CardPerson, DashboardData, Suggestion } from '@/lib/data/types';
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
  const [statsRows, casesRows, topPlaces, auditLog, lastPersonRow, yearSpan] = await Promise.all([
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
              lc."Body" AS "LastComment", lc."CreatedAt" AS "LastCommentAt",
              lc."UserId" AS "LastCommentUserId", lc."UserName" AS "LastCommentAuthor"
       FROM "Cases" c
       -- The case's last comment and who wrote it (#53: author, time, quote).
       LEFT JOIN LATERAL (
         SELECT cc."Body", cc."CreatedAt", cc."UserId", u."Name" AS "UserName"
           FROM "CaseComments" cc LEFT JOIN "Users" u ON u."Id" = cc."UserId"
          WHERE cc."CaseId" = c."Id" AND cc."StruckAt" IS NULL
          ORDER BY cc."CreatedAt" DESC LIMIT 1
       ) lc ON TRUE
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
    getTreeYearSpan(treeId),
  ]);

  const { total: auditTotal } = auditLog;
  // View-only members see editors' display names, never their emails (#51, L-4).
  const auditWindow = scope.permission === 'view' ? withoutEditorEmails(auditLog.entries) : auditLog.entries;
  const recentActivity = groupActivityRuns(auditWindow, 5, auditTotal > auditWindow.length);

  const stats = statsRows.rows[0] || { people: 0, families: 0, events: 0, sources: 0, casesInProgress: 0 };

  // Resumed person: most recent person edit, with role pills and the same
  // "X/Y sourced" tag as the person hero (Female · Spouse · Mother · 2/4 sourced).
  let resumedPerson: DashboardData['resumedPerson'] = null;
  let startPerson: DashboardData['startPerson'] = null;

  const lastPersonAudit = lastPersonRow.rows[0];
  const lastPersonId = lastPersonAudit?.EntityId as number | undefined;
  if (lastPersonId) {
    const card = await getCardPerson(lastPersonId, treeId);
    if (card) {
      resumedPerson = {
        ...card,
        lastChange: {
          Action: lastPersonAudit.Action,
          EntityLabel: lastPersonAudit.EntityLabel,
          Changes: lastPersonAudit.Changes,
          CreatedAt: lastPersonAudit.CreatedAt,
        },
      };
    }
  }
  // Nobody edited yet (a fresh import, say): the desktop card shows the person the
  // tree opens at instead of disappearing (Heirloom #127). The phone keeps its rule.
  if (!resumedPerson && stats.people > 0) {
    const rootId = await getDefaultRootPersonId(treeId);
    if (rootId !== undefined) startPerson = await getCardPerson(rootId, treeId);
  }

  // "Recently edited" (#1061 phone, four; #53 desktop, six in two columns): the
  // next people after the resumed one. The phone shows the first four.
  const [recentPeople, placeCountries] = await Promise.all([
    getRecentlyEditedPeople(treeId, resumedPerson?.Id ?? null, 6),
    getPlaceCountries(treeId, topPlaces.map((p) => p.place_id)),
  ]);

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
    places: topPlaces.map((p) => ({ ...p, country: placeCountries.countries.get(p.place_id) ?? null })),
    placeTotals: { places: placeCountries.placeCount, countries: placeCountries.countryCount },
    yearSpan,
    resumedPerson,
    startPerson,
    recentPeople,
  };
}

/** The pick-up card's person: names, vitals, photo, family counts, sourcing and Next steps. */
async function getCardPerson(personId: number, treeId: number): Promise<CardPerson | null> {
  const [r, sourcing, nextSteps] = await Promise.all([query(
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
    [personId, treeId]
  ), getPersonSourcing(personId, treeId), getPersonNextSteps(personId, treeId)]);
  const row = r.rows[0];
  if (!row || !sourcing) return null;
  return { ...row, ...sourcing, nextSteps } as CardPerson;
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
