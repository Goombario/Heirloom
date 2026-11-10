import { query } from '@/lib/db/connection';
import { findLikelyDuplicates, type DuplicateCandidate, type LikelyDuplicates } from '@/lib/likely-duplicates';

/**
 * The people behind the home page's likely-duplicates suggestion (#794). The
 * dashboard counts the pairs and the People page lists their groups, from the
 * same call, so "Review" always shows the people the suggestion counted.
 */
export type PeopleFlag = 'duplicates';

/**
 * The people a likely-duplicates check considers (#822): everyone with both
 * names whose folded surname is shared with someone else in the tree, with
 * their parents, partners and whether they're in any family. The pairing
 * itself is `findLikelyDuplicates` (lib/likely-duplicates.ts).
 */
async function getDuplicateCandidates(treeId: number): Promise<DuplicateCandidate[]> {
    const result = await query(
        `WITH named AS (
             SELECT p."Id", p."FirstName", p."LastName", p."Sex", "SortableYear"(p."BirthDate") AS "year",
                    count(*) OVER (PARTITION BY "SearchFold"(btrim(p."LastName"))) AS "shared"
               FROM "People" p
              WHERE p."TreeId" = $1
                AND btrim(COALESCE(p."FirstName", '')) <> ''
                AND btrim(COALESCE(p."LastName", '')) <> ''),
         parents AS (
             SELECT fp."ChildrenId" AS "Id", array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL) AS "ids"
               FROM "FamilyPerson" fp
               JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" AND f."TreeId" = $1
              CROSS JOIN LATERAL unnest(ARRAY[COALESCE(f."Partner1Id", f."HusbandId"), COALESCE(f."Partner2Id", f."WifeId")]) AS x
              GROUP BY fp."ChildrenId"),
         partners AS (
             SELECT s."Id", array_agg(DISTINCT s."Other") FILTER (WHERE s."Other" IS NOT NULL) AS "ids"
               FROM (SELECT COALESCE("Partner1Id", "HusbandId") AS "Id", COALESCE("Partner2Id", "WifeId") AS "Other"
                       FROM "Families" WHERE "TreeId" = $1
                     UNION ALL
                     SELECT COALESCE("Partner2Id", "WifeId"), COALESCE("Partner1Id", "HusbandId")
                       FROM "Families" WHERE "TreeId" = $1) s
              WHERE s."Id" IS NOT NULL
              GROUP BY s."Id")
         SELECT n."Id", n."FirstName", n."LastName", n."Sex", n."year",
                COALESCE(pa."ids", '{}') AS "parents", COALESCE(pt."ids", '{}') AS "partners",
                (pa."Id" IS NOT NULL OR pt."Id" IS NOT NULL) AS "linked"
           FROM named n
           LEFT JOIN parents pa ON pa."Id" = n."Id"
           LEFT JOIN partners pt ON pt."Id" = n."Id"
          WHERE n."shared" > 1`,
        [treeId],
    );
    return result.rows as DuplicateCandidate[];
}

/** The likely duplicate pairs in a tree, and the groups the People filter lists (#794, #822). */
export async function getLikelyDuplicates(treeId: number): Promise<LikelyDuplicates> {
    return findLikelyDuplicates(await getDuplicateCandidates(treeId));
}
