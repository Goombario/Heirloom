import { query } from '@/lib/db/connection';

/** A member's saved advanced search (#247, ADR 0054). `Query` is JSON, read through normalizeQuery. */
export interface SavedSearchRow {
    Id: number;
    Name: string;
    Query: string;
    CreatedAt: string | Date;
}

/** The member's own saved searches for one page of one tree, oldest first. */
export async function listSavedSearches(userId: number, treeId: number, page: string): Promise<SavedSearchRow[]> {
    const res = await query(
        `SELECT "Id", "Name", "Query", "CreatedAt" FROM "SavedSearch"
          WHERE "UserId" = $1 AND "TreeId" = $2 AND "Page" = $3
          ORDER BY "CreatedAt", "Id"`,
        [userId, treeId, page],
    );
    return res.rows as SavedSearchRow[];
}

export async function insertSavedSearch(userId: number, treeId: number, page: string, name: string, queryJson: string): Promise<SavedSearchRow> {
    const res = await query(
        `INSERT INTO "SavedSearch" ("UserId", "TreeId", "Page", "Name", "Query") VALUES ($1, $2, $3, $4, $5)
         RETURNING "Id", "Name", "Query", "CreatedAt"`,
        [userId, treeId, page, name, queryJson],
    );
    return res.rows[0] as SavedSearchRow;
}

/** Deletes one of the member's own saved searches; false when there was none to delete. */
export async function deleteSavedSearch(userId: number, treeId: number, id: number): Promise<boolean> {
    const res = await query(
        `DELETE FROM "SavedSearch" WHERE "Id" = $1 AND "UserId" = $2 AND "TreeId" = $3 RETURNING "Id"`,
        [id, userId, treeId],
    );
    return res.rows.length > 0;
}
