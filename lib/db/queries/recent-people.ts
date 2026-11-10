import { query } from '@/lib/db/connection';
import { effectiveFirstName, primaryNickname } from '@/lib/db/queries/people';
import { primaryPhotoJoin } from '@/lib/db/queries/media-tags';
import type { RecentPerson } from '@/lib/data/types';

/** How many recent person edits to look through for distinct people. */
const PERSON_EDIT_WINDOW = 200;

/**
 * The people edited most recently, newest first, each once with their latest change
 * (#1061, the phone home's "Recently edited"). Deleted people drop out. `excludeId`
 * leaves out the person the "Pick up where you left off" row already shows.
 */
export async function getRecentlyEditedPeople(treeId: number, excludeId: number | null, limit: number): Promise<RecentPerson[]> {
    const result = await query(
        `SELECT p."Id", p."FirstName", p."LastName", p."Sex",
                ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius",
                a."Action", a."Changes", a."CreatedAt"
           FROM (
                SELECT DISTINCT ON (w."EntityId") w."EntityId", w."Action", w."Changes", w."CreatedAt", w."Id" AS "AuditId"
                  FROM (
                        SELECT "EntityId", "Action", "Changes", "CreatedAt", "Id" FROM "AuditLog"
                         WHERE "TreeId" = $1 AND "EntityType" = 'person' AND "Action" <> 'delete'
                         ORDER BY "CreatedAt" DESC, "Id" DESC
                         LIMIT $4
                  ) w
                 ORDER BY w."EntityId", w."CreatedAt" DESC, w."Id" DESC
           ) a
           JOIN "People" p ON p."Id" = a."EntityId" AND p."TreeId" = $1
           ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
          WHERE ($2::int IS NULL OR p."Id" <> $2)
          ORDER BY a."CreatedAt" DESC, a."AuditId" DESC
          LIMIT $3`,
        [treeId, excludeId, limit, PERSON_EDIT_WINDOW]
    );
    return result.rows.map((row) => {
        const { Action, Changes, CreatedAt, ...person } = row;
        return { ...person, lastChange: { Action, Changes, CreatedAt } } as RecentPerson;
    });
}
