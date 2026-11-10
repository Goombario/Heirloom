import { query } from '@/lib/db/connection';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import type { TreeCounts } from '@/lib/data/types';

export interface GetTreeCountsParams {
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
}

/**
 * Record counts for a tree, one per table that a GEDCOM `overwrite` import
 * deletes. Read before the destructive confirm so the warning can describe the
 * tree that is actually about to be replaced — and so an import into a wholly
 * empty tree can skip the confirm entirely.
 *
 * **This must stay in lockstep with the `mode === 'overwrite'` DELETE block in
 * `lib/services/gedcom.ts`.** A table deleted there but missing here reads as
 * "nothing to lose" and its rows are destroyed without ever prompting the user.
 * `FamilyPerson` is intentionally absent: it is a junction cleared alongside
 * `Families`, and cannot hold rows on its own.
 *
 * Counted in one round-trip; every count is scoped to the resolved tree via
 * `"TreeId" = $1` — matching the overwrite DELETE block in
 * `lib/services/gedcom.ts`, which is likewise fully TreeId-scoped.
 */
export async function getTreeCountsService(params: GetTreeCountsParams): Promise<TreeCounts> {
    const { requestedTreeId, requestedOwnerId, currentUserId } = params;

    const scope = await resolveTreeScope(
        { treeId: requestedTreeId, ownerId: requestedOwnerId },
        currentUserId
    );

    const result = await query(
        `SELECT
            (SELECT COUNT(*) FROM "People"     WHERE "TreeId" = $1)::int AS people,
            (SELECT COUNT(*) FROM "Families"   WHERE "TreeId" = $1)::int AS families,
            (SELECT COUNT(*) FROM "Events"     WHERE "TreeId" = $1)::int AS events,
            (SELECT COUNT(*) FROM "Media"      WHERE "TreeId" = $1)::int AS media,
            (SELECT COUNT(*) FROM "Cases"      WHERE "TreeId" = $1)::int AS cases,
            (SELECT COUNT(*) FROM "Places"     WHERE "TreeId" = $1)::int AS places,
            (SELECT COUNT(*) FROM "Sources"    WHERE "TreeId" = $1)::int AS sources,
            (SELECT COUNT(*) FROM "Repository" WHERE "TreeId" = $1)::int AS repositories,
            (SELECT COUNT(*) FROM "Note"       WHERE "TreeId" = $1)::int AS notes,
            (SELECT COUNT(*) FROM "Citation"   WHERE "TreeId" = $1)::int AS citations,
            (SELECT COUNT(*) FROM "DataCheckConfirmations" WHERE "TreeId" = $1)::int AS "dataCheckConfirmations"`,
        [scope.treeId]
    );

    return result.rows[0] as TreeCounts;
}
