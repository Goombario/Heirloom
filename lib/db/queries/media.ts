import { query } from '@/lib/db/connection';
import type { Media, MediaWithPerson, NewMedia } from '../schema';
import { auditCreate } from './audit-capture';
import { effectiveFirstName, primaryNickname } from './people';
import type { DbExecutor } from './media-links';
import { publicMediaColumns } from './media-projection';

export interface HostedMediaThumbnailBackfillRow {
    Id: number;
    UserId: number;
    FilePath: string | null;
    ContentType: string | null;
}

/**
 * Get all media in a specific tree
 */
export async function getAllMedia(treeId: number): Promise<Media[]> {
    const result = await query(
        `SELECT ${publicMediaColumns()} FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id" DESC`,
        [treeId]
    );
    return result.rows as Media[];
}

/** List hosted originals eligible for the read-only thumbnail backfill. */
export async function listHostedMediaForThumbnailBackfill(
    afterId = 0,
    limit = 100,
): Promise<HostedMediaThumbnailBackfillRow[]> {
    const result = await query(
        `SELECT "Id", "UserId", "FilePath", "ContentType"
           FROM "Media"
          WHERE "FilePath" IS NOT NULL
            AND "ContentType" LIKE 'image/%'
            AND "ContentType" NOT IN ('image/svg+xml', 'image/gif')
            AND "Id" > $1
          ORDER BY "Id" ASC
          LIMIT $2`,
        [afterId, limit],
    );
    return result.rows as HostedMediaThumbnailBackfillRow[];
}

/**
 * Every stored file name any Media row points at, across all trees (#946). The
 * orphan check needs the global set on purpose: a name shared across trees can
 * only keep a file, never condemn one.
 */
export async function listAllReferencedMediaFilePaths(): Promise<string[]> {
    const result = await query(`SELECT DISTINCT "FilePath" FROM "Media" WHERE "FilePath" IS NOT NULL`);
    return (result.rows as { FilePath: string }[]).map((row) => row.FilePath);
}

/**
 * Get all media with the linked person's name attached (for library search by name).
 */
export async function getAllMediaWithPerson(treeId: number): Promise<MediaWithPerson[]> {
    const result = await query(
        `SELECT ${publicMediaColumns('m')}, p."FirstName" AS "PersonFirstName", p."LastName" AS "PersonLastName",
                ${effectiveFirstName('p')} AS "PersonEffectiveFirstName",
                ${primaryNickname('p')} AS "PersonNickname",
                COALESCE((
                    SELECT array_agg(NULLIF(TRIM(COALESCE(tp."FirstName", '') || ' ' || COALESCE(tp."LastName", '')), ''))
                    FROM "MediaTag" mt
                    JOIN "People" tp ON tp."Id" = mt."PersonId" AND tp."TreeId" = m."TreeId"
                    WHERE mt."MediaId" = m."Id"
                ), ARRAY[]::text[]) AS "TaggedPersonNames",
                COALESCE((
                    SELECT array_agg(DISTINCT mt."PersonId" ORDER BY mt."PersonId")
                    FROM "MediaTag" mt
                    JOIN "People" tp ON tp."Id" = mt."PersonId" AND tp."TreeId" = m."TreeId"
                    WHERE mt."MediaId" = m."Id"
                ), ARRAY[]::integer[]) AS "TaggedPersonIds",
                COALESCE((
                    SELECT array_agg(DISTINCT NULLIF(TRIM(COALESCE(lp."FirstName", '') || ' ' || COALESCE(lp."LastName", '')), ''))
                    FROM "MediaLink" ml
                    JOIN "People" lp ON lp."Id" = ml."OwnerId" AND lp."TreeId" = m."TreeId"
                    WHERE ml."MediaId" = m."Id" AND ml."OwnerTable" = 'People'
                ), ARRAY[]::text[]) AS "LinkedPersonNames",
                (SELECT COUNT(DISTINCT ml."OwnerId")::int FROM "MediaLink" ml
                  WHERE ml."MediaId" = m."Id" AND ml."OwnerTable" = 'People') AS "LinkedPersonCount",
                (SELECT COUNT(*)::int FROM "MediaLink" ml WHERE ml."MediaId" = m."Id") AS "LinkCount"
         FROM "Media" m
         LEFT JOIN LATERAL (
             SELECT l."OwnerId" FROM "MediaLink" l
             JOIN "People" lp ON lp."Id" = l."OwnerId" AND lp."TreeId" = m."TreeId"
             WHERE l."MediaId" = m."Id" AND l."OwnerTable" = 'People'
             ORDER BY l."OwnerId" LIMIT 1
         ) owner_link ON true
         LEFT JOIN "People" p ON p."Id" = owner_link."OwnerId" AND p."TreeId" = m."TreeId"
         WHERE m."TreeId" = $1
         ORDER BY m."Id" DESC`,
        [treeId]
    );
    return result.rows as MediaWithPerson[];
}

/**
 * Get a single media item by ID (tree-scoped)
 */
export async function getMediaById(id: number, treeId: number, exec: DbExecutor = { query }): Promise<Media | null> {
    const result = await exec.query(
        `SELECT ${publicMediaColumns()} FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as Media) || null;
}

/** Lock a tree-scoped media row for an atomic delete transaction. */
export async function lockMediaForDelete(
    mediaId: number,
    treeId: number,
    exec: DbExecutor,
): Promise<Media | null> {
    const result = await exec.query(
        `SELECT ${publicMediaColumns()} FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2 FOR UPDATE`,
        [mediaId, treeId],
    );
    return (result.rows[0] as Media | undefined) ?? null;
}

/**
 * Get media for a specific person (tree-scoped)
 */
export async function getMediaByPersonId(personId: number, treeId: number): Promise<Media[]> {
    const result = await query(
        // One row per photo: it can be linked to the person and to their birth (ADR 0030).
        `SELECT ${publicMediaColumns('m')} FROM "Media" m
         JOIN "MediaLink" l ON l."MediaId" = m."Id"
         WHERE l."OwnerTable" = 'People' AND l."OwnerId" = $1 AND m."TreeId" = $2
         GROUP BY m."Id"
         ORDER BY MAX(l."IsPrimary") DESC, m."Id"`,
        [personId, treeId]
    );
    return result.rows as Media[];
}

/**
 * Get the canonical People-link primary for a person (tree-scoped). When that
 * media has the same person's tag, its region overrides the media focal point.
 */
export async function getPrimaryMediaForPerson(personId: number, treeId: number): Promise<Media | null> {
    const result = await query(
        `SELECT ${publicMediaColumns('m')},
                CASE WHEN mt."Id" IS NOT NULL THEN mt."RegionX" + mt."RegionW" / 2.0 ELSE m."FocalX" END AS "FocalX",
                CASE WHEN mt."Id" IS NOT NULL THEN mt."RegionY" + mt."RegionH" / 2.0 ELSE m."FocalY" END AS "FocalY",
                CASE WHEN mt."Id" IS NOT NULL THEN GREATEST(mt."RegionW", mt."RegionH") ELSE m."FocalRadius" END AS "FocalRadius"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId" AND m."TreeId" = $2
         LEFT JOIN "MediaTag" mt ON mt."MediaId" = m."Id" AND mt."PersonId" = $1
         WHERE l."OwnerTable" = 'People' AND l."OwnerId" = $1 AND l."IsPrimary" = 1
         LIMIT 1`,
        [personId, treeId]
    );
    return (result.rows[0] as Media) || null;
}

/**
 * Create a new media item
 */
export async function insertMediaRow(data: NewMedia, exec: DbExecutor): Promise<Media> {
    const result = await exec.query(
        `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash", "UploadIntentId", "UploadIntentTarget")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${publicMediaColumns()}`,
        [data.UserId, data.TreeId ?? null, data.Title, data.FilePath, data.Format, data.ContentType, data.FileSize ?? 0, data.ContentHash ?? null, data.UploadIntentId ?? null, data.UploadIntentTarget ?? null]
    );

    const newMedia = result.rows[0] as Media;
    if (!newMedia) {
        throw new Error('Failed to create media');
    }

    return newMedia;
}

/** Load a tree-scoped upload replay row on a caller-selected executor. */
export async function getMediaByUploadIntent(
    uploadIntentId: string,
    treeId: number,
    exec: DbExecutor = { query },
    lock = false,
): Promise<Media | null> {
    const result = await exec.query(
        `SELECT * FROM "Media"
          WHERE "TreeId" = $1 AND "UploadIntentId" = $2
          ${lock ? 'FOR UPDATE' : ''}`,
        [treeId, uploadIntentId],
    );
    return (result.rows[0] as Media | undefined) ?? null;
}

export async function createMedia(
    data: NewMedia,
    actingUserId?: number,
    exec?: DbExecutor,
): Promise<Media> {
    const run = exec ?? { query };
    const newMedia = await insertMediaRow(data, run);
    await auditCreate(
        'media',
        newMedia as unknown as Record<string, unknown>,
        data.UserId,
        actingUserId ?? data.UserId,
        exec,
    );
    return newMedia;
}

/**
 * Which of these content hashes the tree already holds (#592).
 *
 * Tree-scoped deliberately: the same photo in another tree is not a duplicate
 * here, and reporting that it exists elsewhere would leak across the isolation
 * boundary. `DISTINCT ON` collapses several copies of one hash to the earliest
 * row, so the title shown to the user is stable rather than arbitrary.
 *
 * `ContentHash IS NOT NULL` is redundant against `= ANY` but states the intent:
 * rows predating the guard are unhashed and must never match.
 */
export async function findMediaByHashes(
    hashes: string[],
    treeId: number
): Promise<{ ContentHash: string; Id: number; Title: string | null }[]> {
    if (hashes.length === 0) return [];
    const result = await query(
        `SELECT DISTINCT ON ("ContentHash") "ContentHash", "Id", "Title"
           FROM "Media"
          WHERE "TreeId" = $1 AND "ContentHash" IS NOT NULL AND "ContentHash" = ANY($2)
          ORDER BY "ContentHash", "Id" ASC`,
        [treeId, hashes]
    );
    return result.rows as { ContentHash: string; Id: number; Title: string | null }[];
}

/** What a local photo tile can be drawn from: its stored thumbnail, if any, and whether it has a file at all. */
export interface MediaThumbState {
    thumb: Uint8Array | null;
    hasBlob: boolean;
}

/**
 * Stored thumbnails (local `MediaThumb`) for many media in one tree, keyed by
 * media id, with whether each one has a `MediaBlob` at all. Media in another
 * tree, or that don't exist, are absent from the map. One round trip for a whole
 * photo grid instead of one per tile (#1160), and a tile whose media has no file
 * (an import's unresolved reference) learns that here rather than by reading
 * the blob it doesn't have (#1266).
 */
export async function getMediaThumbStatesByIds(ids: number[], treeId: number): Promise<Map<number, MediaThumbState>> {
    if (ids.length === 0) return new Map();
    const result = await query(
        `SELECT m."Id", t."Data",
                EXISTS (SELECT 1 FROM "MediaBlob" b WHERE b."MediaId" = m."Id") AS "HasBlob"
           FROM "Media" m
           LEFT JOIN "MediaThumb" t ON t."MediaId" = m."Id"
          WHERE m."Id" = ANY($1::int[]) AND m."TreeId" = $2`,
        [ids, treeId]
    );
    const rows = result.rows as { Id: number; Data: Uint8Array | null; HasBlob: boolean }[];
    return new Map(rows.map((row) => [row.Id, {
        thumb: row.Data ? new Uint8Array(row.Data) : null,
        hasBlob: row.HasBlob,
    }]));
}

/**
 * Full local file bytes (`MediaBlob`) for a few media in one tree, keyed by media
 * id. Media with no file, or in another tree, are absent from the map. Callers
 * keep the id list short: every original in it is held in memory at once.
 */
export async function getMediaBlobsByIds(
    ids: number[],
    treeId: number,
): Promise<Map<number, { bytes: Uint8Array; contentType: string }>> {
    if (ids.length === 0) return new Map();
    const result = await query(
        `SELECT b."MediaId", b."Data", m."ContentType"
           FROM "MediaBlob" b
           JOIN "Media" m ON m."Id" = b."MediaId"
          WHERE b."MediaId" = ANY($1::int[]) AND m."TreeId" = $2`,
        [ids, treeId]
    );
    const rows = result.rows as { MediaId: number; Data: Uint8Array; ContentType: string | null }[];
    return new Map(rows.map((row) => [row.MediaId, {
        bytes: new Uint8Array(row.Data),
        contentType: row.ContentType || 'application/octet-stream',
    }]));
}

// 'FilePath' is intentionally absent: it is only ever written by the upload
// route via direct SQL. Making it API-writable would let a crafted value
// (e.g. "../../etc/passwd") reach the export-zip and delete-cleanup path joins.
// 'ContentHash' is absent for the same reason: it is derived from the uploaded
// bytes, never supplied by a client (#592).
export const MEDIA_MUTABLE_FIELDS: ReadonlySet<string> = new Set([
    'Title', 'Date', 'Format', 'ContentType', 'FocalX', 'FocalY', 'FocalRadius', 'FileSize',
]);

/** Update allowed metadata on a caller-owned executor, without policy or audit orchestration. */
export async function updateMediaRow(
    id: number,
    data: Partial<NewMedia>,
    treeId: number,
    exec: DbExecutor,
): Promise<Media | null> {
    const fields = Object.keys(data).filter(
        key => data[key as keyof NewMedia] !== undefined && key !== 'UserId' && key !== 'TreeId',
    );
    for (const field of fields) {
        if (!MEDIA_MUTABLE_FIELDS.has(field)) {
            throw new Error(`Invalid field name: ${field}`);
        }
    }
    if (fields.length > 0) {
        const values: unknown[] = [];
        const setClauses = fields.map((field, i) => {
            values.push(data[field as keyof NewMedia]);
            return `"${field}" = $${i + 1}`;
        });
        values.push(id, treeId);
        await exec.query(
            `UPDATE "Media" SET ${setClauses.join(', ')}
             WHERE "Id" = $${values.length - 1} AND "TreeId" = $${values.length}`,
            values,
        );
    }
    return getMediaById(id, treeId, exec);
}

/**
 * Get total count of media in a specific tree
 */
export async function getMediaCount(treeId: number): Promise<number> {
    const result = await query(
        `SELECT COUNT(*) as count FROM "Media" WHERE "TreeId" = $1`,
        [treeId]
    );
    return parseInt(result.rows[0].count, 10);
}

/**
 * Get total bytes stored for a tree's media. Placeholder records (FileSize = 0 or NULL)
 * contribute zero to the sum, so they do not count against the storage limit.
 */
export async function getMediaStorageUsed(treeId: number, exec: DbExecutor = { query }): Promise<number> {
    const result = await exec.query(
        `SELECT COALESCE(SUM("FileSize"), 0) AS total FROM "Media" WHERE "TreeId" = $1`,
        [treeId]
    );
    return parseInt(String((result.rows[0] as { total: unknown }).total), 10);
}

/** Sets a media row's title. Used to fill an empty title from photo metadata. */
export async function patchMediaTitle(id: number, treeId: number, title: string): Promise<void> {
    await query(
        `UPDATE "Media" SET "Title" = $3 WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId, title],
    );
}

/** Set a photo's date from its own metadata, never over a date already set. */
export async function patchMediaDateIfUnset(id: number, treeId: number, date: string): Promise<boolean> {
    const result = await query(
        `UPDATE "Media" SET "Date" = $3 WHERE "Id" = $1 AND "TreeId" = $2 AND "Date" IS NULL`,
        [id, treeId, date],
    );
    return (result.rowCount ?? 0) > 0;
}

/** Patch a placeholder Media row with the uploaded file's real metadata. */
export async function patchMediaFile(
    mediaId: number,
    treeId: number,
    file: { FilePath: string | null; ContentType: string; Format: string; FileSize: number; ContentHash?: string | null },
    exec: DbExecutor = { query },
): Promise<void> {
    await exec.query(
        `UPDATE "Media" SET "FilePath" = $1, "ContentType" = $2, "Format" = $3, "FileSize" = $4, "ContentHash" = $5 WHERE "Id" = $6 AND "TreeId" = $7`,
        [file.FilePath, file.ContentType, file.Format, file.FileSize, file.ContentHash ?? null, mediaId, treeId]
    );
}

/** Delete a tree-scoped Media row using the caller's transaction executor. */
export async function deleteMediaRow(
    mediaId: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<boolean> {
    const result = await exec.query(
        `DELETE FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2`,
        [mediaId, treeId],
    );
    return (result.rowCount ?? 0) > 0;
}
