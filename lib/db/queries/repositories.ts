import { query } from '@/lib/db/connection';

/**
 * An archive/repository that holds sources (GEDCOM REPO record). Activated in
 * Slice 4 — previously the table existed but nothing wrote to it (audit ADH-3).
 * Sources link via `Sources."RepositoryId"`; one repository → many sources.
 */
export interface Repository {
    Id: number;
    OwnerId: number;
    TreeId?: number | null;
    Name: string;
    Address: string | null;
    /** The first `WWW`, `PHON` and `EMAIL` of its GEDCOM record (#40, ADR 0049). */
    Website?: string | null;
    Phone?: string | null;
    Email?: string | null;
    CreatedAt: string;
    /** A GEDCOM REPO record's lines the app doesn't model, re-emitted on export (#966). */
    RawGedcom?: string | null;
    /** The ADDR's structured lines (ADR1, CITY, …); cleared when the address is edited (#966). */
    AddressRawGedcom?: string | null;
}

/** A repository plus the number of sources linked to it (by `RepositoryId`). */
export interface RepositoryWithCount extends Repository {
    SourceCount: number;
}

/** All repositories for a tree, alphabetical. */
export async function getRepositories(treeId: number): Promise<Repository[]> {
    const result = await query(
        `SELECT * FROM "Repository" WHERE "TreeId" = $1 ORDER BY "Name" ASC`,
        [treeId],
    );
    return result.rows as Repository[];
}

/** All repositories with their linked-source counts, alphabetical (for the management list). */
export async function getRepositoriesWithCounts(treeId: number): Promise<RepositoryWithCount[]> {
    const result = await query(
        `SELECT r.*, COUNT(s."Id")::int AS "SourceCount"
           FROM "Repository" r
           LEFT JOIN "Sources" s ON s."RepositoryId" = r."Id" AND s."TreeId" = r."TreeId"
          WHERE r."TreeId" = $1
          GROUP BY r."Id"
          ORDER BY r."Name" ASC`,
        [treeId],
    );
    return result.rows as RepositoryWithCount[];
}

/** Find a repository by exact (tree, name), creating it if absent. Used to keep the
 *  `Repository` entity in sync when a source is saved with a free-text repository name.
 *  Relies on the per-tree unique index `idx_repository_tree_name` (see init-schema):
 *  the upsert closes the check-then-insert race two concurrent saves of the same new
 *  name would otherwise hit. DO UPDATE (a no-op rewrite of "Name") — not DO NOTHING —
 *  so RETURNING always yields the row even when it already existed. Keyed per TREE so
 *  a same-named repository in a sibling tree is never cross-linked. */
async function findOrCreateRepository(ownerId: number, treeId: number, name: string): Promise<Repository> {
    const result = await query(
        `INSERT INTO "Repository" ("OwnerId", "TreeId", "Name") VALUES ($1, $2, $3)
         ON CONFLICT ("TreeId", "Name") DO UPDATE SET
           "Name" = EXCLUDED."Name"
         RETURNING *`,
        [ownerId, treeId, name],
    );
    return result.rows[0] as Repository;
}

/** Point a source at the right `Repository` row for its (trimmed) repository name,
 *  or clear the link when the name is blank. Idempotent; safe to call on every write. */
export async function syncSourceRepository(sourceId: number, ownerId: number, treeId: number, repositoryName: string | null | undefined): Promise<void> {
    const name = repositoryName?.trim();
    if (!name) {
        await query(`UPDATE "Sources" SET "RepositoryId" = NULL WHERE "Id" = $1 AND "TreeId" = $2`, [sourceId, treeId]);
        return;
    }
    const repo = await findOrCreateRepository(ownerId, treeId, name);
    await query(`UPDATE "Sources" SET "RepositoryId" = $1 WHERE "Id" = $2 AND "TreeId" = $3`, [repo.Id, sourceId, treeId]);
}

/** A repository's contact fields, as create and update take them (ADR 0049). */
type ContactFields = { Website?: string | null; Phone?: string | null; Email?: string | null };
const CONTACT_COLUMNS = ['Website', 'Phone', 'Email'] as const;

/** Create a new repository. Returns null when a repository with the same
 *  (tree, name) already exists — the per-tree unique index makes the ON CONFLICT
 *  a no-op, so the caller can surface a duplicate-name error. A same-named
 *  repository in ANOTHER tree of the same owner is allowed. */
export async function createRepository(
    ownerId: number,
    treeId: number,
    fields: { Name: string; Address?: string | null } & ContactFields,
): Promise<Repository | null> {
    const result = await query(
        `INSERT INTO "Repository" ("OwnerId", "TreeId", "Name", "Address", "Website", "Phone", "Email")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("TreeId", "Name") DO NOTHING
         RETURNING *`,
        [ownerId, treeId, fields.Name, fields.Address ?? null, fields.Website ?? null, fields.Phone ?? null, fields.Email ?? null],
    );
    return (result.rows[0] as Repository | undefined) ?? null;
}

/** Update a repository's name, address and contact fields. Renaming dual-writes the legacy
 *  `Sources."RepositoryName"` text so the two stay consistent during migration. */
export async function updateRepository(
    id: number,
    treeId: number,
    fields: { Name?: string; Address?: string | null } & ContactFields,
): Promise<Repository | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (fields.Name !== undefined) { sets.push(`"Name" = $${i++}`); values.push(fields.Name); }
    if (fields.Address !== undefined) {
        // ADR1/CITY/… described the old address, so a changed address drops them (#966).
        sets.push(`"AddressRawGedcom" = CASE WHEN "Address" IS DISTINCT FROM $${i} THEN NULL ELSE "AddressRawGedcom" END`);
        sets.push(`"Address" = $${i++}`);
        values.push(fields.Address);
    }
    for (const column of CONTACT_COLUMNS) {
        if (fields[column] !== undefined) { sets.push(`"${column}" = $${i++}`); values.push(fields[column]); }
    }
    if (sets.length === 0) return getRepositoryById(id, treeId);

    values.push(id, treeId);
    const result = await query(
        `UPDATE "Repository" SET ${sets.join(', ')} WHERE "Id" = $${i++} AND "TreeId" = $${i} RETURNING *`,
        values,
    );
    const repo = (result.rows[0] as Repository | undefined) ?? null;
    if (!repo) return null;

    if (fields.Name !== undefined) {
        await query(
            `UPDATE "Sources" SET "RepositoryName" = $1 WHERE "RepositoryId" = $2 AND "TreeId" = $3`,
            [fields.Name, id, treeId],
        );
    }
    return repo;
}

/** Delete a repository, detaching its sources first (clears both the link and the
 *  legacy text name). Returns false when nothing was deleted (not found / not owned). */
export async function deleteRepository(id: number, treeId: number): Promise<boolean> {
    await query(
        `UPDATE "Sources" SET "RepositoryName" = NULL, "RepositoryId" = NULL WHERE "RepositoryId" = $1 AND "TreeId" = $2`,
        [id, treeId],
    );
    const result = await query(`DELETE FROM "Repository" WHERE "Id" = $1 AND "TreeId" = $2`, [id, treeId]);
    return (result.rowCount ?? 0) > 0;
}

/** One repository scoped to its tree (null if not found / not in this tree). */
export async function getRepositoryById(id: number, treeId: number): Promise<Repository | null> {
    const result = await query(
        `SELECT * FROM "Repository" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId],
    );
    return (result.rows[0] as Repository | undefined) ?? null;
}

/** Every source attached to one repository (the "one archive → many sources" view). */
export async function getSourcesForRepository(repositoryId: number, treeId: number): Promise<{ Id: number; Title: string | null }[]> {
    const result = await query(
        `SELECT "Id", "Title" FROM "Sources" WHERE "RepositoryId" = $1 AND "TreeId" = $2 ORDER BY "Title" ASC`,
        [repositoryId, treeId],
    );
    return result.rows as { Id: number; Title: string | null }[];
}
