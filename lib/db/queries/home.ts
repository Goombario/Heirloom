import { query } from '@/lib/db/connection';
import { liveChildLinkSql } from '@/lib/db/queries/live-owner';

/**
 * Reads for the v1.1 desktop home (#53): the pick-up card's Next steps, the band's
 * year span and the Where they lived rail.
 */

/** One gap on the pick-up card's "Next for <name>" (#53). */
export type NextStep =
  | { kind: 'birth_date' | 'death_date' | 'birth_place' | 'death_place' }
  /** An unsourced fact, by the sourcing meter's rule: birth, death and each own event. */
  | { kind: 'source'; fact: 'birth' | 'death' | 'event'; eventId?: number; eventType?: string; year: number | null }
  | { kind: 'parents' }
  /** A known parent with no parents of their own. */
  | { kind: 'grandparents'; parentId: number; parentSex: string | null; parentName: string | null };

const cited = (table: string, factId: string) =>
  `EXISTS (SELECT 1 FROM "Citation" c WHERE c."TreeId" = $2 AND c."FactTable" = '${table}' AND c."FactId" = ${factId})`;

/**
 * The gaps worth doing next for one person, and how many there are.
 *
 * What counts (decided for #53, consistent with what the person page shows):
 * - **Vitals**: no birth date; a deceased person with no death date; a dated birth
 *   or death with no place.
 * - **Sources**: each fact the sourcing meter counts (birth, death, own events)
 *   that has no citation, oldest first.
 * - **Family**: no parents at all; else each parent who has no parents
 *   ("Mother's parents").
 *
 * The card shows three: the first gap of each group in that order (vitals,
 * sources, family), then the next of each, so one long group can't hide the
 * others. `total` counts every gap ("5 open").
 */
export async function getPersonNextSteps(personId: number, treeId: number, limit = 3): Promise<{ steps: NextStep[]; total: number }> {
  const [personRes, eventsRes, parentsRes] = await Promise.all([
    query(
      `SELECT p."BirthDate", p."DeathDate", p."BirthPlaceId", p."DeathPlaceId", p."DeathCause", p."IsDeceased",
              "SortableYear"(p."BirthDate") AS "BirthYear", "SortableYear"(p."DeathDate") AS "DeathYear",
              ${cited('PersonBirth', 'p."Id"')} AS "BirthCited",
              ${cited('PersonDeath', 'p."Id"')} AS "DeathCited"
         FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2`,
      [personId, treeId],
    ),
    query(
      `SELECT ev."Id", ev."Type", "SortableYear"(ev."Date") AS "Year", ${cited('Events', 'ev."Id"')} AS "Cited"
         FROM "Events" ev WHERE ev."PersonId" = $1 AND ev."TreeId" = $2
        ORDER BY "SortableYear"(ev."Date") NULLS LAST, ev."Id"`,
      [personId, treeId],
    ),
    // The person's parents (from every family they are a child of), each with
    // whether they have parents of their own.
    query(
      `SELECT DISTINCT par."Id", par."Sex", COALESCE(NULLIF(par."FirstName", ''), par."LastName") AS "Name",
              EXISTS (SELECT 1 FROM "FamilyPerson" gp WHERE gp."ChildrenId" = par."Id" AND ${liveChildLinkSql('gp')}
                        AND EXISTS (SELECT 1 FROM "Families" gf WHERE gf."Id" = gp."FamiliesAsChildId" AND gf."TreeId" = $2)) AS "HasParents"
         FROM "FamilyPerson" fp
         JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" AND f."TreeId" = $2
         JOIN "People" par ON par."TreeId" = $2
              AND par."Id" IN (COALESCE(f."Partner1Id", f."HusbandId"), COALESCE(f."Partner2Id", f."WifeId"))
        WHERE fp."ChildrenId" = $1
        ORDER BY par."Id"`,
      [personId, treeId],
    ),
  ]);
  const p = personRes.rows[0] as {
    BirthDate: string | null; DeathDate: string | null; BirthPlaceId: number | null; DeathPlaceId: number | null;
    DeathCause: string | null; IsDeceased: number | null; BirthYear: number | null; DeathYear: number | null;
    BirthCited: boolean; DeathCited: boolean;
  } | undefined;
  if (!p) return { steps: [], total: 0 };

  const hasBirth = p.BirthDate != null || p.BirthPlaceId != null;
  const hasDeath = p.DeathDate != null || p.DeathPlaceId != null || p.DeathCause != null || p.IsDeceased === 1;

  const vitals: NextStep[] = [];
  if (!p.BirthDate) vitals.push({ kind: 'birth_date' });
  if (hasDeath && !p.DeathDate) vitals.push({ kind: 'death_date' });
  if (p.BirthDate && p.BirthPlaceId == null) vitals.push({ kind: 'birth_place' });
  if (p.DeathDate && p.DeathPlaceId == null) vitals.push({ kind: 'death_place' });

  const sources: NextStep[] = [];
  if (hasBirth && !p.BirthCited) sources.push({ kind: 'source', fact: 'birth', year: p.BirthYear });
  if (hasDeath && !p.DeathCited) sources.push({ kind: 'source', fact: 'death', year: p.DeathYear });
  for (const ev of eventsRes.rows as Array<{ Id: number; Type: string; Year: number | null; Cited: boolean }>) {
    if (!ev.Cited) sources.push({ kind: 'source', fact: 'event', eventId: ev.Id, eventType: ev.Type, year: ev.Year });
  }

  const parents = parentsRes.rows as Array<{ Id: number; Sex: string | null; Name: string | null; HasParents: boolean }>;
  const family: NextStep[] = parents.length === 0
    ? [{ kind: 'parents' }]
    : parents.filter((par) => !par.HasParents).map((par) => ({ kind: 'grandparents', parentId: par.Id, parentSex: par.Sex, parentName: par.Name }));

  const groups = [vitals, sources, family];
  const steps: NextStep[] = [];
  for (let round = 0; steps.length < limit && groups.some((g) => g.length > round); round++) {
    for (const g of groups) if (g[round] && steps.length < limit) steps.push(g[round]);
  }
  return { steps, total: vitals.length + sources.length + family.length };
}

/** The band's "1702–1998": the earliest and latest year of any birth or death. */
export async function getTreeYearSpan(treeId: number): Promise<{ first: number | null; last: number | null }> {
  const { rows } = await query(
    `SELECT MIN(y) AS first, MAX(y) AS last FROM (
       SELECT "SortableYear"("BirthDate") AS y FROM "People" WHERE "TreeId" = $1 AND "BirthDate" IS NOT NULL
       UNION ALL
       SELECT "SortableYear"("DeathDate") FROM "People" WHERE "TreeId" = $1 AND "DeathDate" IS NOT NULL
     ) years`,
    [treeId],
  );
  const r = rows[0] as { first: number | null; last: number | null } | undefined;
  return { first: r?.first ?? null, last: r?.last ?? null };
}

/**
 * Where they lived: each place's country (its top gazetteer ancestor, else the last
 * part of a comma-written name), and how many places and countries the tree's facts
 * name in all.
 */
export async function getPlaceCountries(treeId: number, placeIds: number[]): Promise<{ countries: Map<number, string>; placeCount: number; countryCount: number }> {
  const { rows } = await query(
    `WITH RECURSIVE used AS (
         SELECT "BirthPlaceId" AS id FROM "People" WHERE "TreeId" = $1 AND "BirthPlaceId" IS NOT NULL
         UNION SELECT "DeathPlaceId" FROM "People" WHERE "TreeId" = $1 AND "DeathPlaceId" IS NOT NULL
         UNION SELECT "MarriagePlaceId" FROM "Families" WHERE "TreeId" = $1 AND "MarriagePlaceId" IS NOT NULL
         UNION SELECT "PlaceId" FROM "Events" WHERE "TreeId" = $1 AND "PlaceId" IS NOT NULL
       ),
       up AS (
         SELECT p."Id" AS start_id, p."Id" AS node_id, p."ParentId", p."Name", 0 AS depth
           FROM "Places" p WHERE p."TreeId" = $1 AND (p."Id" IN (SELECT id FROM used) OR p."Id" = ANY($2::int[]))
         UNION ALL
         SELECT up.start_id, par."Id", par."ParentId", par."Name", up.depth + 1
           FROM up JOIN "Places" par ON par."Id" = up."ParentId" AND par."TreeId" = $1
          WHERE up.depth < 20
       )
       SELECT start_id AS "Id", "Name", depth AS "Depth", (start_id IN (SELECT id FROM used)) AS "Used"
         FROM up WHERE "ParentId" IS NULL OR depth = 20`,
    [treeId, placeIds],
  );
  const countries = new Map<number, string>();
  const allCountries = new Set<string>();
  let placeCount = 0;
  for (const r of rows as Array<{ Id: number; Name: string; Depth: number; Used: boolean }>) {
    // A top-level place written out in full ("Dover, Kent, England") names its country last.
    const country = r.Depth > 0 ? r.Name : r.Name.includes(',') ? r.Name.split(',').pop()!.trim() : null;
    if (country && placeIds.includes(r.Id)) countries.set(r.Id, country);
    if (r.Used) {
      placeCount++;
      // Only a known country counts; an unparented one-word place says nothing.
      if (country) allCountries.add(country.toLocaleLowerCase());
    }
  }
  return { countries, placeCount, countryCount: allCountries.size };
}
