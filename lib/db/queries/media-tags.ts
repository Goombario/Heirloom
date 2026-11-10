import { query } from '@/lib/db/connection';
import type { MediaTag, MediaTagWithPerson, NewMediaTag, PersonGalleryMedia } from '../schema';
import { auditCreate, withAuditIds, type Audited } from './audit-capture';
import { effectiveFirstName, primaryNickname } from './people';
import { NotFoundError } from '@/lib/data/errors';
import {
    ownerFactsAgg,
    setPrimaryMediaLink,
    upsertMediaLink,
    type DbExecutor,
} from './media-links';
import { publicMediaColumns } from './media-projection';

export interface FaceRegion {
    RegionX: number;
    RegionY: number;
    RegionW: number;
    RegionH: number;
}

/**
 * Clamp a face-region percent coordinate into the valid [0, 100] range. Used by
 * the tag routes before persisting. Non-numeric input yields NaN, which the
 * routes reject as an invalid (non-positive) dimension.
 */
export function clampPercent(v: unknown): number {
    return Math.max(0, Math.min(100, Number(v)));
}

/**
 * Convert a face-tag region (percent box) into ProfileImage focal values.
 * Center is exact; radius is approximated from the larger box edge (good enough
 * for avatar crops — slightly off for very non-square images). The SQL in
 * `primaryPhotoJoin` mirrors this math.
 */
export function regionToFocal(r: FaceRegion): { focalX: number; focalY: number; focalRadius: number } {
    return {
        focalX: r.RegionX + r.RegionW / 2,
        focalY: r.RegionY + r.RegionH / 2,
        focalRadius: Math.max(r.RegionW, r.RegionH),
    };
}

/**
 * SQL fragment that replaces a plain `LEFT JOIN "Media" <out> ON ...` for a
 * person's canonical primary photo. The People MediaLink owns primary state;
 * an optional tag for that same person only overrides the media focal geometry
 * and exposes columns "Id"/"FocalX"/"FocalY"/"FocalRadius" under `outAlias`, so
 * the surrounding SELECT (which reads those four columns) needs no change.
 *
 * `personAlias`/`ownerExpr` are SQL identifiers controlled by callers, never user
 * input (e.g. `primaryPhotoJoin('p', 'p."TreeId"', 'm')`). `ownerExpr` is compared
 * against the Media row's own "TreeId" — multi-tree: this closes a cross-tree
 * photo-bleed edge for two trees owned by the same user (both TreeId values are
 * backfilled, so the comparison is always well-defined).
 */
export function primaryPhotoJoin(personAlias: string, ownerExpr: string, outAlias: string): string {
    return `LEFT JOIN LATERAL (
        SELECT pm."Id",
               CASE WHEN pmt."Id" IS NOT NULL THEN pmt."RegionX" + pmt."RegionW" / 2.0 ELSE pm."FocalX" END AS "FocalX",
               CASE WHEN pmt."Id" IS NOT NULL THEN pmt."RegionY" + pmt."RegionH" / 2.0 ELSE pm."FocalY" END AS "FocalY",
               CASE WHEN pmt."Id" IS NOT NULL THEN GREATEST(pmt."RegionW", pmt."RegionH") ELSE pm."FocalRadius" END AS "FocalRadius"
        FROM "MediaLink" pml
        JOIN "Media" pm ON pm."Id" = pml."MediaId" AND pm."TreeId" = ${ownerExpr}
        LEFT JOIN "MediaTag" pmt ON pmt."MediaId" = pm."Id" AND pmt."PersonId" = ${personAlias}."Id"
        WHERE pml."OwnerTable" = 'People' AND pml."OwnerId" = ${personAlias}."Id" AND pml."IsPrimary" = 1
        LIMIT 1
    ) ${outAlias} ON true`;
}

/**
 * Scalar form of the same pick: the primary photo's media id for a person, given
 * an expression yielding that person's id.
 *
 * Exists so callers that only need the id (avatar discs, with no focal crop) use
 * the same People-link primary contract as the focal-aware projection.
 *
 * Both branches gate on the media's own "TreeId" for the same cross-tree
 * photo-bleed reason as `primaryPhotoJoin`.
 */
export function primaryMediaIdFor(personIdExpr: string, treeExpr: string): string {
    return `(SELECT pml."MediaId"
        FROM "MediaLink" pml
        JOIN "Media" pm ON pm."Id" = pml."MediaId" AND pm."TreeId" = ${treeExpr}
        WHERE pml."OwnerTable" = 'People' AND pml."OwnerId" = ${personIdExpr} AND pml."IsPrimary" = 1
        LIMIT 1)`;
}

/**
 * All face tags on a media item (with each tagged person's name), scoped to the
 * tree. `treeId` is the resolved tree scope; route gates permission.
 */
export async function getTagsForMedia(
    mediaId: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<MediaTagWithPerson[]> {
    const result = await exec.query(
        `SELECT mt.*, p."FirstName" AS "PersonFirstName", p."LastName" AS "PersonLastName",
                ${effectiveFirstName('p')} AS "PersonEffectiveFirstName",
                ${primaryNickname('p')} AS "PersonNickname",
                EXISTS (
                    SELECT 1 FROM "MediaLink" pml
                    WHERE pml."MediaId" = mt."MediaId"
                      AND pml."OwnerTable" = 'People'
                      AND pml."OwnerId" = mt."PersonId"
                      AND pml."IsPrimary" = 1
                ) AS "IsPersonPrimary"
         FROM "MediaTag" mt
         JOIN "Media" m ON m."Id" = mt."MediaId"
         JOIN "People" p ON p."Id" = mt."PersonId" AND p."TreeId" = m."TreeId"
         WHERE mt."MediaId" = $1 AND m."TreeId" = $2
         ORDER BY mt."Id"`,
        [mediaId, treeId]
    );
    return result.rows as MediaTagWithPerson[];
}

/** A face tag joined to its media's file path — used by the GEDCOM export sidecar. */
export interface MediaTagExport {
    MediaId: number;
    FilePath: string | null;
    PersonId: number;
    RegionX: number;
    RegionY: number;
    RegionW: number;
    RegionH: number;
}

/**
 * All face tags across the tree's media, each joined to its media's FilePath. Used to
 * build the media.json export sidecar so tags round-trip through a zip export/import.
 */
export async function getAllMediaTags(treeId: number): Promise<MediaTagExport[]> {
    const result = await query(
        `SELECT mt."MediaId", m."FilePath", mt."PersonId",
                mt."RegionX", mt."RegionY", mt."RegionW", mt."RegionH"
         FROM "MediaTag" mt
         JOIN "Media" m ON m."Id" = mt."MediaId"
         WHERE m."TreeId" = $1
         ORDER BY mt."Id"`,
        [treeId]
    );
    return result.rows as MediaTagExport[];
}

/**
 * Tag a person in a media item with a face region. Re-tagging the same person
 * moves their region (ON CONFLICT). Verifies both media and person belong to the
 * tree. Returns the resulting tag (with person name).
 *
 * MediaTag carries neither UserId nor TreeId (it's scoped purely via its MediaId
 * FK) — the audit log's TreeOwnerId is derived from the joined Media row's
 * "UserId" (the legacy owner column), not from `treeId`.
 */
export async function addMediaTag(
    data: NewMediaTag,
    treeId: number,
    actingUserId?: number,
    exec?: DbExecutor,
    /** Also make this photo the person's primary. The caller decides (#922: only
     *  when they have none) and holds the People row lock; the audit snapshot
     *  records it so removing the tag can undo it. */
    options: { setPrimary?: boolean } = {},
): Promise<Audited<MediaTagWithPerson>> {
    const run = exec ?? { query };
    // Both the media AND the person must be in the resolved tree — join People on
    // its OWN "TreeId" (not just m."UserId"), or a person from the same owner's
    // OTHER (unshared) tree would pass and leak their name via getTagsForMedia.
    const check = await run.query(
        `SELECT m."UserId"
         FROM "Media" m
         JOIN "People" p ON p."TreeId" = m."TreeId"
         WHERE m."Id" = $1 AND p."Id" = $2 AND m."TreeId" = $3`,
        [data.MediaId, data.PersonId, treeId]
    );
    const mediaOwnerRow = check.rows[0] as { UserId: number } | undefined;
    if (!mediaOwnerRow) {
        throw new NotFoundError('Media or person not found in this tree');
    }
    const ownerId = mediaOwnerRow.UserId;

    const result = await run.query(
        `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("MediaId", "PersonId") DO UPDATE SET
            "RegionX" = EXCLUDED."RegionX", "RegionY" = EXCLUDED."RegionY",
            "RegionW" = EXCLUDED."RegionW", "RegionH" = EXCLUDED."RegionH"
         RETURNING "Id"`,
        [data.MediaId, data.PersonId, data.RegionX, data.RegionY, data.RegionW, data.RegionH]
    );
    const inserted = result.rows[0] as { Id: number } | undefined;
    if (!inserted) throw new Error('Failed to create media tag');
    const id = inserted.Id;
    await upsertMediaLink({ mediaId: data.MediaId, ownerTable: 'People', ownerId: data.PersonId }, run);
    if (options.setPrimary) await setPrimaryMediaLink(data.MediaId, data.PersonId, run);
    const tags = await getTagsForMedia(data.MediaId, treeId, run);
    const created = tags.find(t => t.Id === id);
    if (!created) {
        throw new Error('Failed to create media tag');
    }
    // MediaTag has no TreeId column: stamp the tree so the entry is tree-scoped
    // and its "Photo tag — name" label can resolve (#847).
    const snapshot = { ...created, TreeId: treeId, ...(options.setPrimary ? { SetPrimary: true } : {}) };
    const auditId = await auditCreate('mediatag', snapshot as unknown as Record<string, unknown>, ownerId, actingUserId ?? ownerId, exec);
    return withAuditIds(created, [auditId]);
}

/**
 * Whether this tag made its photo the person's primary when it was created
 * (#922). Read from the tag's latest create entry, which is where `addMediaTag`
 * records it; a tag with no such entry reads as false.
 */
export async function tagSetPersonPrimary(tagId: number, personId: number, treeId: number, exec: DbExecutor): Promise<boolean> {
    // The person must still be the one tagged at creation: a tag moved to someone
    // else never set their primary.
    const result = await exec.query(
        `SELECT COALESCE(("Changes"->'snapshot'->>'SetPrimary') = 'true', false)
                AND ("Changes"->'snapshot'->>'PersonId') = $3::text AS "SetPrimary"
         FROM "AuditLog"
         WHERE "EntityType" = 'mediatag' AND "Action" = 'create' AND "EntityId" = $1 AND "TreeId" = $2
         ORDER BY "Id" DESC LIMIT 1`,
        [tagId, treeId, String(personId)],
    );
    return (result.rows[0] as { SetPrimary: boolean } | undefined)?.SetPrimary === true;
}

export const MEDIA_TAG_MUTABLE_FIELDS: ReadonlySet<string> = new Set([
    'PersonId', 'RegionX', 'RegionY', 'RegionW', 'RegionH',
]);

/** Fields the service may update after it owns the People and tag row locks. */
export type MediaTagUpdate = Partial<Pick<MediaTag, 'PersonId' | 'RegionX' | 'RegionY' | 'RegionW' | 'RegionH'>>;

/** Update the already-authorized, caller-locked tag row on one executor. */
export async function updateMediaTagRow(
    tagId: number,
    mediaId: number,
    data: MediaTagUpdate,
    treeId: number,
    exec: DbExecutor,
): Promise<{ MediaId: number; MediaOwnerId: number } | null> {
    const fields = Object.keys(data).filter(key => data[key as keyof typeof data] !== undefined);
    for (const field of fields) {
        if (!MEDIA_TAG_MUTABLE_FIELDS.has(field)) {
            throw new Error(`Invalid field name: ${field}`);
        }
    }
    if (fields.length === 0) {
        return null;
    }

    const values: unknown[] = [];
    const setClauses = fields.map((field, i) => {
        values.push(data[field as keyof typeof data]);
        return `"${field}" = $${i + 1}`;
    });
    values.push(tagId, mediaId, treeId);

    const result = await exec.query(
        `UPDATE "MediaTag" mt SET ${setClauses.join(', ')}
         FROM "Media" m
         WHERE mt."Id" = $${values.length - 2} AND mt."MediaId" = m."Id" AND m."Id" = $${values.length - 1} AND m."TreeId" = $${values.length}
         RETURNING mt."MediaId", m."UserId" AS "MediaOwnerId"`,
        values
    );
    return (result.rows[0] as { MediaId: number; MediaOwnerId: number } | undefined) ?? null;
}

export type LockedMediaTag = MediaTagWithPerson & { MediaOwnerId: number };

/** Read the person that must be locked before stabilizing this tag row. */
export async function getMediaTagMutationSnapshot(
    tagId: number,
    mediaId: number,
    treeId: number,
    exec: DbExecutor,
): Promise<LockedMediaTag | null> {
    const result = await exec.query(
        `SELECT mt.*, m."UserId" AS "MediaOwnerId"
         FROM "MediaTag" mt
         JOIN "Media" m ON m."Id" = mt."MediaId"
         JOIN "People" p ON p."Id" = mt."PersonId" AND p."TreeId" = m."TreeId"
         WHERE mt."Id" = $1 AND mt."MediaId" = $2 AND m."TreeId" = $3`,
        [tagId, mediaId, treeId],
    );
    return (result.rows[0] as LockedMediaTag | undefined) ?? null;
}

/** Lock and revalidate the tag only after its People row lock is held. */
export async function lockMediaTagForMutation(
    tagId: number,
    mediaId: number,
    treeId: number,
    expectedPersonId: number,
    exec: DbExecutor,
): Promise<LockedMediaTag | null> {
    const result = await exec.query(
        `SELECT mt.*, m."UserId" AS "MediaOwnerId"
         FROM "MediaTag" mt
         JOIN "Media" m ON m."Id" = mt."MediaId"
         JOIN "People" p ON p."Id" = mt."PersonId" AND p."TreeId" = m."TreeId"
         WHERE mt."Id" = $1 AND mt."MediaId" = $2 AND m."TreeId" = $3
           AND mt."PersonId" = $4
         FOR UPDATE OF mt`,
        [tagId, mediaId, treeId, expectedPersonId],
    );
    return (result.rows[0] as LockedMediaTag | undefined) ?? null;
}

/** Delete the already-stabilized tag row on the caller-owned executor. */
export async function deleteMediaTagRow(tagId: number, mediaId: number, exec: DbExecutor): Promise<boolean> {
    const result = await exec.query(
        `DELETE FROM "MediaTag" WHERE "Id" = $1 AND "MediaId" = $2 RETURNING "Id"`,
        [tagId, mediaId],
    );
    return Boolean(result.rows[0]);
}

/**
 * All media for a person's gallery: photos they own UNION photos they're tagged
 * in. Each row is annotated for the gallery UI: whether the person owns it, is
 * tagged in it, whether it's their (effective) primary, and their tag region (so
 * a tagged-primary can be cropped to their face). Ordered primary-first.
 *
 * A photo linked to the person and to their birth is still one row; `OwnerFacts`
 * names the facts it is linked to, for its label (ADR 0030).
 */
export async function getMediaForPerson(personId: number, treeId: number): Promise<PersonGalleryMedia[]> {
    const result = await query(
        `SELECT ${publicMediaColumns('m')},
                (pml."MediaId" IS NOT NULL) AS "IsOwned",
                (mt."Id" IS NOT NULL) AS "IsTaggedHere",
                COALESCE(pml."IsPrimary", 0) = 1 AS "IsPersonPrimary",
                COALESCE(pml."OwnerFacts", ARRAY[]::text[]) AS "OwnerFacts",
                mt."RegionX" AS "TagRegionX", mt."RegionY" AS "TagRegionY",
                mt."RegionW" AS "TagRegionW", mt."RegionH" AS "TagRegionH"
         FROM "Media" m
         LEFT JOIN LATERAL (
             SELECT l."MediaId", MAX(l."IsPrimary") AS "IsPrimary", ${ownerFactsAgg('l')} AS "OwnerFacts"
             FROM "MediaLink" l
             WHERE l."MediaId" = m."Id" AND l."OwnerTable" = 'People' AND l."OwnerId" = $1
             GROUP BY l."MediaId"
         ) pml ON true
         LEFT JOIN "MediaTag" mt ON mt."MediaId" = m."Id" AND mt."PersonId" = $1
         WHERE m."TreeId" = $2 AND (pml."MediaId" IS NOT NULL OR mt."Id" IS NOT NULL)
         ORDER BY (COALESCE(pml."IsPrimary", 0) = 1) DESC, m."Id"`,
        [personId, treeId]
    );
    return result.rows as PersonGalleryMedia[];
}
