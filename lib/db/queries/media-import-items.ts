import { query } from '@/lib/db/connection';
import type {
    MediaImportFailureCode,
    MediaImportItem,
    MediaImportStatus,
    NewMediaImportItem,
} from '../schema';
import type { DbExecutor } from './media-links';

function mapMediaImportItem(row: Record<string, unknown>): MediaImportItem {
    return {
        id: Number(row.Id),
        importId: String(row.ImportId),
        documentMediaId: String(row.DocumentMediaId),
        treeId: Number(row.TreeId),
        mediaId: Number(row.MediaId),
        archivePath: String(row.ArchivePath),
        originalFilename: String(row.OriginalFilename),
        status: row.Status as MediaImportStatus,
        failureCode: (row.FailureCode as MediaImportFailureCode | null) ?? null,
        skipFaceCapture: Number(row.SkipFaceCapture) === 1,
    };
}

function mapRows(rows: unknown[]): MediaImportItem[] {
    return rows.map((row) => mapMediaImportItem(row as Record<string, unknown>));
}

export async function createMediaImportItem(
    data: NewMediaImportItem,
    exec: DbExecutor = { query },
): Promise<MediaImportItem> {
    const result = await exec.query(
        `INSERT INTO "MediaImportItem"
          ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status", "FailureCode", "SkipFaceCapture")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
            data.importId,
            data.documentMediaId,
            data.treeId,
            data.mediaId,
            data.archivePath,
            data.originalFilename,
            data.status ?? 'pending',
            data.failureCode ?? null,
            data.skipFaceCapture ? 1 : 0,
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create media import item');
    return mapMediaImportItem(row as Record<string, unknown>);
}

export async function listUnresolvedMediaImportItems(
    treeId: number,
    exec: DbExecutor = { query },
): Promise<MediaImportItem[]> {
    const result = await exec.query(
        `SELECT * FROM "MediaImportItem"
         WHERE "TreeId" = $1 AND "Status" <> 'ready'
         ORDER BY "Id" ASC`,
        [treeId],
    );
    return mapRows(result.rows);
}

export async function lockMediaImportItem(
    id: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<MediaImportItem | null> {
    const result = await exec.query(
        `SELECT * FROM "MediaImportItem"
         WHERE "Id" = $1 AND "TreeId" = $2
         FOR UPDATE`,
        [id, treeId],
    );
    return result.rows[0]
        ? mapMediaImportItem(result.rows[0] as Record<string, unknown>)
        : null;
}

/** Read an import item without claiming a row lock during preflight. */
export async function getMediaImportItem(
    id: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<MediaImportItem | null> {
    const result = await exec.query(
        `SELECT * FROM "MediaImportItem"
         WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId],
    );
    return result.rows[0]
        ? mapMediaImportItem(result.rows[0] as Record<string, unknown>)
        : null;
}

export async function transitionMediaImportItem(
    id: number,
    treeId: number,
    status: MediaImportStatus,
    failureCode: MediaImportFailureCode | null,
    exec: DbExecutor = { query },
): Promise<MediaImportItem | null> {
    const result = await exec.query(
        `UPDATE "MediaImportItem"
            SET "Status" = $1, "FailureCode" = $2, "UpdatedAt" = CURRENT_TIMESTAMP
          WHERE "Id" = $3 AND "TreeId" = $4
         RETURNING *`,
        [status, failureCode, id, treeId],
    );
    return result.rows[0]
        ? mapMediaImportItem(result.rows[0] as Record<string, unknown>)
        : null;
}

/** Remove an unresolved item and return its Media identity for safe cleanup. */
export async function deleteUnresolvedMediaImportItem(
    id: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<MediaImportItem | null> {
    const result = await exec.query(
        `DELETE FROM "MediaImportItem"
          WHERE "Id" = $1 AND "TreeId" = $2 AND "Status" <> 'ready'
         RETURNING *`,
        [id, treeId],
    );
    return result.rows[0]
        ? mapMediaImportItem(result.rows[0] as Record<string, unknown>)
        : null;
}

/**
 * A photo already in the tree whose original bytes hash to `contentHash`, other
 * than the import placeholder itself (#858). `ContentHash` is only written once
 * bytes are stored, so a match always has a file or blob behind it. The lowest
 * id wins, so repeated imports converge on the same row.
 */
export async function findReusableImportMedia(
    treeId: number,
    placeholderMediaId: number,
    contentHash: string,
    exec: DbExecutor,
): Promise<number | null> {
    const result = await exec.query(
        `SELECT "Id" FROM "Media"
          WHERE "TreeId" = $1 AND "ContentHash" = $2 AND "Id" <> $3
          ORDER BY "Id" LIMIT 1`,
        [treeId, contentHash, placeholderMediaId],
    );
    const row = result.rows[0] as { Id: number } | undefined;
    return row ? Number(row.Id) : null;
}

/**
 * Photos in the tree whose stored copy is exactly `byteLength` bytes (#952). An
 * exported photo carries its stored, compressed bytes, which never hash to the
 * original upload's `ContentHash`; the caller compares these candidates' stored
 * bytes with the incoming ones. Same-size files are rare, so the list is short.
 */
export async function listStoredSizeReuseCandidates(
    treeId: number,
    placeholderMediaId: number,
    byteLength: number,
    exec: DbExecutor,
): Promise<{ Id: number; FilePath: string | null }[]> {
    const result = await exec.query(
        `SELECT "Id", "FilePath" FROM "Media"
          WHERE "TreeId" = $1 AND "FileSize" = $2 AND "ContentHash" IS NOT NULL AND "Id" <> $3
          ORDER BY "Id" LIMIT 16`,
        [treeId, byteLength, placeholderMediaId],
    );
    return (result.rows as { Id: number; FilePath: string | null }[]).map((row) => ({ Id: Number(row.Id), FilePath: row.FilePath }));
}

/**
 * The browser-mode twin of `listStoredSizeReuseCandidates` (#952): a photo in the
 * tree whose stored blob is byte-for-byte `bytes`. The lowest id wins.
 */
export async function findReusableImportMediaByBlob(
    treeId: number,
    placeholderMediaId: number,
    bytes: Uint8Array,
    exec: DbExecutor,
): Promise<number | null> {
    const result = await exec.query(
        `SELECT m."Id" FROM "Media" m
           JOIN "MediaBlob" b ON b."MediaId" = m."Id"
          WHERE m."TreeId" = $1 AND m."FileSize" = $2 AND m."ContentHash" IS NOT NULL AND m."Id" <> $3
            AND b."Data" = $4
          ORDER BY m."Id" LIMIT 1`,
        [treeId, bytes.length, placeholderMediaId, bytes],
    );
    const row = result.rows[0] as { Id: number } | undefined;
    return row ? Number(row.Id) : null;
}

/**
 * Settle an import placeholder onto an existing photo with the same bytes
 * (#858): its links, face tags and case references move to `existingMediaId`,
 * then the placeholder row is deleted (cascading its import item). The existing
 * row keeps its own title, focal point and file; only what it lacks is added:
 * - a link to an owner it isn't linked to yet moves over as is;
 * - a link it already has is dropped, but if the placeholder held that person's
 *   primary photo, the existing link takes the primary flag, so the person's
 *   primary doesn't change;
 * - a face tag moves only for a person not already tagged on the existing photo.
 * Both rows must belong to `treeId`. Runs inside the caller's transaction.
 */
export async function reuseMediaForImportItem(
    placeholderMediaId: number,
    existingMediaId: number,
    treeId: number,
    exec: DbExecutor,
): Promise<void> {
    // Every statement below keys on MediaId alone, so both rows must be this tree's.
    const inTree = await exec.query(
        `SELECT COUNT(*)::int AS "n" FROM "Media" WHERE "Id" IN ($1, $2) AND "TreeId" = $3`,
        [placeholderMediaId, existingMediaId, treeId],
    );
    if (Number((inTree.rows[0] as { n: number }).n) !== 2) throw new Error('Media reuse crosses a tree boundary');
    const dropped = await exec.query(
        `DELETE FROM "MediaLink" p
          WHERE p."MediaId" = $1
            AND EXISTS (SELECT 1 FROM "MediaLink" e
                         WHERE e."MediaId" = $2 AND e."OwnerTable" = p."OwnerTable" AND e."OwnerId" = p."OwnerId"
                           AND e."OwnerFact" IS NOT DISTINCT FROM p."OwnerFact")
          RETURNING p."OwnerTable", p."OwnerId", p."OwnerFact", p."IsPrimary"`,
        [placeholderMediaId, existingMediaId],
    );
    for (const row of dropped.rows as Array<{ OwnerTable: string; OwnerId: number; OwnerFact: string | null; IsPrimary: number }>) {
        if (Number(row.IsPrimary) !== 1) continue;
        await exec.query(
            `UPDATE "MediaLink" SET "IsPrimary" = 1
              WHERE "MediaId" = $1 AND "OwnerTable" = $2 AND "OwnerId" = $3 AND "OwnerFact" IS NULL`,
            [existingMediaId, row.OwnerTable, row.OwnerId],
        );
    }
    await exec.query(`UPDATE "MediaLink" SET "MediaId" = $2 WHERE "MediaId" = $1`, [placeholderMediaId, existingMediaId]);
    await exec.query(
        `UPDATE "MediaTag" SET "MediaId" = $2
          WHERE "MediaId" = $1
            AND "PersonId" NOT IN (SELECT "PersonId" FROM "MediaTag" WHERE "MediaId" = $2)`,
        [placeholderMediaId, existingMediaId],
    );
    await exec.query(
        `INSERT INTO "CaseMedia" ("CaseId", "MediaId")
         SELECT "CaseId", $2 FROM "CaseMedia" WHERE "MediaId" = $1
         ON CONFLICT DO NOTHING`,
        [placeholderMediaId, existingMediaId],
    );
    await exec.query(`UPDATE "CaseComments" SET "MediaId" = $2 WHERE "MediaId" = $1`, [placeholderMediaId, existingMediaId]);
    await exec.query(`DELETE FROM "Media" WHERE "Id" = $1`, [placeholderMediaId]);
}
