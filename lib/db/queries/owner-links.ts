import { query } from '@/lib/db/connection';
import {
    isLinkOwnerTable,
    isMediaOwnerTable,
    type LinkOwnerTable,
    type MediaOwnerTable,
} from '@/lib/db/fact-tables';

/** Minimal query surface shared by existence predicates and their unit tests. */
export interface DbExecutor {
    query(text: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
}

/** Cheap, tree-scoped existence check for a valid media attachment target. */
export async function ownerExistsInTree(
    table: MediaOwnerTable,
    ownerId: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<boolean> {
    if (!isMediaOwnerTable(table)) throw new Error('Invalid media owner table');
    const result = await exec.query(
        `SELECT 1 FROM "${table}" WHERE "Id" = $1 AND "TreeId" = $2`,
        [ownerId, treeId],
    );
    return (result.rowCount ?? 0) > 0;
}

/** Cheap, tree-scoped existence check for a NoteLink target. */
export async function linkOwnerExistsInTree(
    table: LinkOwnerTable,
    ownerId: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<boolean> {
    if (!isLinkOwnerTable(table)) throw new Error('Invalid link owner table');
    const result = await exec.query(
        `SELECT 1 FROM "${table}" WHERE "Id" = $1 AND "TreeId" = $2`,
        [ownerId, treeId],
    );
    return (result.rowCount ?? 0) > 0;
}
