import { query } from '@/lib/db/connection';
import {
    MEDIA_OWNER_TABLES,
    isMediaOwnerTable,
    type MediaOwnerFact,
    type MediaOwnerTable,
} from '@/lib/db/fact-tables';
import type {
    Media,
    OwnerGalleryMedia,
    GedcomEvent,
    EventWithMedia,
    MediaLinkIntegrityIssue,
    MediaLinkIntegrityReport,
    MediaLinkOwner,
} from '@/lib/db/schema';
import { publicMediaColumns } from './media-projection';
import { effectiveFirstName, primaryNickname } from './people';

/**
 * Polymorphic attachment of a `Media` row to an owner record, mirroring how
 * `NoteLink` attaches notes and `Citation` attaches sources. MediaLink is the
 * sole ownership and person-specific primary representation.
 */
export interface MediaLinkRow {
    MediaId: number;
    OwnerTable: MediaOwnerTable;
    OwnerId: number;
    /** The vital fact the link is scoped to; null for the record itself (ADR 0030). */
    OwnerFact: MediaOwnerFact | null;
    IsPrimary: number;
}

export interface DbExecutor {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

interface IntegrityLinkRow {
    MediaId: number;
    OwnerTable: string;
    OwnerId: number;
    IsPrimary: number;
}

interface IntegrityOwnerRow {
    Id: number;
    TreeId: number | null;
}

/** Every media row attached to one owner record, or to one of its facts, oldest first. */
export async function getMediaForOwner(
    ownerTable: MediaOwnerTable,
    ownerId: number,
    treeId: number,
    ownerFact: MediaOwnerFact | null = null,
): Promise<Media[]> {
    const result = await query(
        `SELECT ${publicMediaColumns('m')}
         FROM "Media" m
         JOIN "MediaLink" l ON l."MediaId" = m."Id"
         WHERE l."OwnerTable" = $1 AND l."OwnerId" = $2 AND m."TreeId" = $3
           AND l."OwnerFact" IS NOT DISTINCT FROM $4::text
         ORDER BY m."Id" ASC`,
        [ownerTable, ownerId, treeId, ownerFact],
    );
    return result.rows as Media[];
}

/**
 * Every record one media row is linked to, named for the viewer's "Linked to"
 * list (#510): people first, then families, events and sources, oldest link
 * first within each. Each owner is read in the media's own tree, so a link to a
 * record in another tree (which validation never writes) names nothing.
 */
export async function getMediaLinkOwners(mediaId: number, treeId: number): Promise<MediaLinkOwner[]> {
    const result = await query(
        `SELECT l."OwnerTable", l."OwnerId", l."OwnerFact",
                p."Id" AS "PersonId", p."FirstName", p."LastName",
                ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                p2."FirstName" AS "Partner2FirstName", p2."LastName" AS "Partner2LastName",
                s."Title" AS "SourceTitle", e."Type" AS "EventType",
                CASE
                    WHEN l."OwnerTable" = 'People' AND l."OwnerFact" = 'Birth' THEN lp."BirthDate"
                    WHEN l."OwnerTable" = 'People' AND l."OwnerFact" = 'Death' THEN lp."DeathDate"
                    WHEN l."OwnerTable" = 'Families' AND l."OwnerFact" = 'Marriage' THEN f."MarriageDate"
                    WHEN l."OwnerTable" = 'Events' THEN e."Date"
                END AS "FactDate"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId" AND m."TreeId" = $2
         LEFT JOIN "People" lp ON l."OwnerTable" = 'People' AND lp."Id" = l."OwnerId" AND lp."TreeId" = $2
         LEFT JOIN "Families" f ON l."OwnerTable" = 'Families' AND f."Id" = l."OwnerId" AND f."TreeId" = $2
         LEFT JOIN "Events" e ON l."OwnerTable" = 'Events' AND e."Id" = l."OwnerId" AND e."TreeId" = $2
         LEFT JOIN "Sources" s ON l."OwnerTable" = 'Sources' AND s."Id" = l."OwnerId" AND s."TreeId" = $2
         LEFT JOIN "People" p ON p."TreeId" = $2 AND p."Id" = COALESCE(lp."Id", f."Partner1Id", e."PersonId")
         LEFT JOIN "People" p2 ON p2."TreeId" = $2 AND p2."Id" = f."Partner2Id"
         WHERE l."MediaId" = $1
           AND COALESCE(lp."Id", f."Id", e."Id", s."Id") IS NOT NULL
         ORDER BY CASE l."OwnerTable" WHEN 'People' THEN 0 WHEN 'Families' THEN 1 WHEN 'Events' THEN 2 ELSE 3 END,
                  l."CreatedAt", l."OwnerId"`,
        [mediaId, treeId],
    );
    return result.rows as MediaLinkOwner[];
}

/**
 * List media for an owner gallery. Family galleries include photos tagged to at
 * least two distinct family members (both partners and all children); every
 * other owner is explicit-link-only. The flags are capabilities, not persisted
 * state: inferred family rows cannot be unlinked from that family context.
 *
 * With `ownerFact`, the gallery is that fact's panel and lists only its links.
 * Without it, the owner's list holds every photo once: `IsExplicit` says it has
 * a record-level link, and `OwnerFacts` names the facts it is linked to (ADR 0030).
 */
export async function getMediaGalleryForOwner(
    ownerTable: MediaOwnerTable,
    ownerId: number,
    treeId: number,
    ownerFact?: MediaOwnerFact,
): Promise<OwnerGalleryMedia[]> {
    if (ownerFact) {
        const result = await query(
            `SELECT ${publicMediaColumns('m')}, TRUE AS "IsExplicit", FALSE AS "IsInferred",
                    ARRAY[l."OwnerFact"] AS "OwnerFacts"
             FROM "Media" m
             JOIN "MediaLink" l ON l."MediaId" = m."Id"
             WHERE l."OwnerTable" = $1 AND l."OwnerId" = $2 AND m."TreeId" = $3 AND l."OwnerFact" = $4
             ORDER BY m."Id" ASC`,
            [ownerTable, ownerId, treeId, ownerFact],
        );
        return result.rows as OwnerGalleryMedia[];
    }
    if (ownerTable !== 'Families') {
        const result = await query(
            `SELECT ${publicMediaColumns('m')}, bool_or(l."OwnerFact" IS NULL) AS "IsExplicit", FALSE AS "IsInferred",
                    ${ownerFactsAgg('l')} AS "OwnerFacts"
             FROM "Media" m
             JOIN "MediaLink" l ON l."MediaId" = m."Id"
             WHERE l."OwnerTable" = $1 AND l."OwnerId" = $2 AND m."TreeId" = $3
             GROUP BY m."Id"
             ORDER BY m."Id" ASC`,
            [ownerTable, ownerId, treeId],
        );
        return result.rows as OwnerGalleryMedia[];
    }

    const result = await query(
        `WITH family_members AS (
             SELECT f."Id" AS "FamilyId", f."Partner1Id" AS "PersonId"
             FROM "Families" f
             JOIN "People" p ON p."Id" = f."Partner1Id" AND p."TreeId" = $2
             WHERE f."Id" = $1 AND f."TreeId" = $2 AND f."Partner1Id" IS NOT NULL
             UNION
             SELECT f."Id", f."Partner2Id"
             FROM "Families" f
             JOIN "People" p ON p."Id" = f."Partner2Id" AND p."TreeId" = $2
             WHERE f."Id" = $1 AND f."TreeId" = $2 AND f."Partner2Id" IS NOT NULL
             UNION
             SELECT f."Id", fp."ChildrenId"
             FROM "Families" f
             JOIN "FamilyPerson" fp ON fp."FamiliesAsChildId" = f."Id"
             JOIN "People" p ON p."Id" = fp."ChildrenId" AND p."TreeId" = $2
             WHERE f."Id" = $1 AND f."TreeId" = $2
         ), inferred AS (
             SELECT mt."MediaId"
             FROM "MediaTag" mt
             JOIN family_members fm ON fm."PersonId" = mt."PersonId"
             JOIN "Media" m ON m."Id" = mt."MediaId" AND m."TreeId" = $2
             GROUP BY mt."MediaId"
             HAVING COUNT(DISTINCT mt."PersonId") >= 2
         ), explicit AS (
             SELECT l."MediaId", bool_or(l."OwnerFact" IS NULL) AS "IsRecord",
                    ${ownerFactsAgg('l')} AS "OwnerFacts"
             FROM "MediaLink" l
             JOIN "Families" f ON f."Id" = l."OwnerId" AND f."TreeId" = $2
             JOIN "Media" m ON m."Id" = l."MediaId" AND m."TreeId" = $2
             WHERE l."OwnerTable" = 'Families' AND l."OwnerId" = $1
             GROUP BY l."MediaId"
         )
         SELECT ${publicMediaColumns('m')},
                COALESCE(e."IsRecord", FALSE) AS "IsExplicit",
                (i."MediaId" IS NOT NULL) AS "IsInferred",
                COALESCE(e."OwnerFacts", ARRAY[]::text[]) AS "OwnerFacts"
         FROM "Media" m
         LEFT JOIN explicit e ON e."MediaId" = m."Id"
         LEFT JOIN inferred i ON i."MediaId" = m."Id"
         WHERE m."TreeId" = $2 AND (e."MediaId" IS NOT NULL OR i."MediaId" IS NOT NULL)
         ORDER BY m."Id" ASC`,
        [ownerId, treeId],
    );
    return result.rows as OwnerGalleryMedia[];
}

/** SQL: the facts among a group of links, in a stable order (empty when none is scoped). */
export function ownerFactsAgg(alias: string): string {
    return `COALESCE(array_agg(DISTINCT ${alias}."OwnerFact" ORDER BY ${alias}."OwnerFact")
                FILTER (WHERE ${alias}."OwnerFact" IS NOT NULL), ARRAY[]::text[])`;
}

/**
 * Attach each event's media (MediaLink OwnerTable='Events') to it in ONE query —
 * the timeline reads photos synchronously without an N+1 per-event fetch. Events
 * with no media get `media: []`. Empty input short-circuits (no query). Reads the
 * canonical MediaLink path only.
 */
export async function attachMediaToEvents(events: GedcomEvent[], treeId: number): Promise<EventWithMedia[]> {
    if (events.length === 0) return [];
    const ids = events.map((e) => e.Id);
    const result = await query(
        `SELECT l."OwnerId" AS "EventId", ${publicMediaColumns('m')}
         FROM "MediaLink" l JOIN "Media" m ON m."Id" = l."MediaId"
         WHERE l."OwnerTable" = 'Events' AND l."OwnerId" = ANY($1) AND m."TreeId" = $2
         ORDER BY m."Id" ASC`,
        [ids, treeId],
    );
    const byEvent = new Map<number, Media[]>();
    for (const row of result.rows as (Media & { EventId: number })[]) {
        const { EventId, ...media } = row;
        const list = byEvent.get(EventId);
        if (list) list.push(media as Media);
        else byEvent.set(EventId, [media as Media]);
    }
    return events.map((e) => ({ ...e, media: byEvent.get(e.Id) ?? [] }));
}

/** All canonical media links for a tree, including owner-specific primary state. */
export async function getAllMediaLinks(treeId: number): Promise<MediaLinkRow[]> {
    const result = await query(
        `SELECT l."MediaId", l."OwnerTable", l."OwnerId", l."OwnerFact", l."IsPrimary"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId"
         WHERE m."TreeId" = $1
         ORDER BY l."MediaId" ASC, l."OwnerTable" ASC, l."OwnerId" ASC, l."OwnerFact" ASC NULLS FIRST`,
        [treeId],
    );
    return result.rows as MediaLinkRow[];
}

/** Link a media row to an owner, or to one of its facts (idempotent: the link's identity includes the fact). */
export async function upsertMediaLink(
    row: { mediaId: number; ownerTable: MediaOwnerTable; ownerId: number; ownerFact?: MediaOwnerFact | null },
    exec: DbExecutor = { query },
): Promise<void> {
    await exec.query(
        `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "OwnerFact")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [row.mediaId, row.ownerTable, row.ownerId, row.ownerFact ?? null],
    );
}

export async function clearPrimaryMediaLinksForPerson(
    personId: number,
    exec: DbExecutor = { query },
): Promise<void> {
    await exec.query(
        `UPDATE "MediaLink" SET "IsPrimary" = 0
         WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "OwnerFact" IS NULL AND "IsPrimary" <> 0`,
        [personId],
    );
}

/** A PDF document can't be a portrait (#510): drop any primary flag an import gave it. */
export async function clearPrimaryMediaLinksForMedia(
    mediaId: number,
    exec: DbExecutor = { query },
): Promise<void> {
    await exec.query(
        `UPDATE "MediaLink" SET "IsPrimary" = 0
         WHERE "MediaId" = $1 AND "OwnerTable" = 'People' AND "IsPrimary" <> 0`,
        [mediaId],
    );
}

export async function setPrimaryMediaLink(
    mediaId: number,
    personId: number,
    exec: DbExecutor = { query },
): Promise<void> {
    await exec.query(
        `UPDATE "MediaLink" SET "IsPrimary" = 1
         WHERE "MediaId" = $1 AND "OwnerTable" = 'People' AND "OwnerId" = $2 AND "OwnerFact" IS NULL`,
        [mediaId, personId],
    );
}

/** Current canonical People primary, if any, on the supplied executor. */
export async function getPrimaryMediaLinkForPerson(
    personId: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<number | null> {
    const result = await exec.query(
        `SELECT l."MediaId"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId"
         WHERE l."OwnerTable" = 'People' AND l."OwnerId" = $1 AND l."OwnerFact" IS NULL
           AND l."IsPrimary" = 1 AND m."TreeId" = $2
         ORDER BY l."MediaId" ASC LIMIT 1`,
        [personId, treeId],
    );
    return (result.rows[0] as { MediaId: number } | undefined)?.MediaId ?? null;
}

/** Lock People rows in one deterministic order before any MediaTag row lock. */
export async function lockPeopleForMediaMutation(
    personIds: number[],
    treeId: number,
    exec: DbExecutor,
): Promise<number[]> {
    const ids = [...new Set(personIds)].sort((a, b) => a - b);
    const result = await exec.query(
        `SELECT "Id" FROM "People"
         WHERE "Id" = ANY($1::integer[]) AND "TreeId" = $2
         ORDER BY "Id" FOR UPDATE`,
        [ids, treeId],
    );
    return (result.rows as Array<{ Id: number }>).map(row => row.Id);
}

export async function getLowestMediaLinkForPerson(
    personId: number,
    treeId: number,
    excludedMediaId: number | null,
    exec: DbExecutor = { query },
): Promise<number | null> {
    const result = await exec.query(
        `SELECT l."MediaId"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId"
         JOIN "People" p ON p."Id" = l."OwnerId" AND p."TreeId" = m."TreeId"
         WHERE l."OwnerTable" = 'People' AND l."OwnerId" = $1 AND l."OwnerFact" IS NULL
           AND m."TreeId" = $2 AND ($3::integer IS NULL OR l."MediaId" <> $3)
         ORDER BY l."MediaId" ASC LIMIT 1`,
        [personId, treeId, excludedMediaId],
    );
    return (result.rows[0] as { MediaId: number } | undefined)?.MediaId ?? null;
}

/** Attach an existing media row to an owner record, or to one of its facts (idempotent). */
export async function linkMedia(
    mediaId: number,
    ownerTable: MediaOwnerTable,
    ownerId: number,
    ownerFact: MediaOwnerFact | null = null,
    exec: DbExecutor = { query },
): Promise<void> {
    await upsertMediaLink({ mediaId, ownerTable, ownerId, ownerFact }, exec);
}

/**
 * Detach a media row from one owner. Deletes ONLY the `MediaLink` row — the `Media`
 * row persists in the library (independent-media model, #86): a library upload
 * attached to an event must survive being detached from that event. Explicit
 * removal is a separate library action (`deleteMediaService`). Only the link to
 * `ownerFact` goes: removing a birth's photo leaves the person's own link, and the
 * reverse (ADR 0030). Returns true if a link was removed.
 */
export async function unlinkMedia(
    mediaId: number,
    ownerTable: MediaOwnerTable,
    ownerId: number,
    treeId: number,
    ownerFact: MediaOwnerFact | null = null,
    exec: DbExecutor = { query },
): Promise<boolean> {
    const result = await exec.query(
        `DELETE FROM "MediaLink" l
         USING "Media" m
         WHERE l."MediaId" = m."Id" AND m."TreeId" = $4
           AND l."MediaId" = $1 AND l."OwnerTable" = $2 AND l."OwnerId" = $3
           AND l."OwnerFact" IS NOT DISTINCT FROM $5::text`,
        [mediaId, ownerTable, ownerId, treeId, ownerFact],
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Inspect canonical media relationships. Owner table names are interpolated
 * only from MEDIA_OWNER_TABLES;
 * every data value stays positional, and a supplied executor keeps PGlite work
 * on its caller's single connection.
 */
export async function inspectMediaLinkIntegrity(
    treeId: number,
    exec: DbExecutor = { query },
): Promise<MediaLinkIntegrityReport> {
    const linkResult = await exec.query(
        `SELECT l."MediaId", l."OwnerTable", l."OwnerId", l."IsPrimary"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId"
         WHERE m."TreeId" = $1
         ORDER BY l."MediaId", l."OwnerTable", l."OwnerId", l."OwnerFact" NULLS FIRST`,
        [treeId],
    );
    const links = linkResult.rows as IntegrityLinkRow[];
    const issues: MediaLinkIntegrityIssue[] = [];

    for (const link of links) {
        if (!isMediaOwnerTable(link.OwnerTable)) {
            issues.push({
                kind: 'invalid_owner_table',
                mediaId: link.MediaId,
                ownerTable: link.OwnerTable,
                ownerId: link.OwnerId,
            });
        }
    }

    for (const ownerTable of Object.values(MEDIA_OWNER_TABLES)) {
        const tableLinks = links.filter((link) => link.OwnerTable === ownerTable);
        const ownerIds = [...new Set(tableLinks.map((link) => link.OwnerId))];
        const ownerResult = await exec.query(
            `SELECT "Id", "TreeId" FROM "${ownerTable}"
             WHERE "Id" = ANY($1::integer[])
             ORDER BY "Id"`,
            [ownerIds],
        );
        const owners = new Map(
            (ownerResult.rows as IntegrityOwnerRow[]).map((owner) => [owner.Id, owner]),
        );

        for (const link of tableLinks) {
            const owner = owners.get(link.OwnerId);
            if (!owner) {
                issues.push({
                    kind: 'missing_owner',
                    mediaId: link.MediaId,
                    ownerTable: link.OwnerTable,
                    ownerId: link.OwnerId,
                });
            } else if (owner.TreeId !== treeId) {
                issues.push({
                    kind: 'cross_tree_owner',
                    mediaId: link.MediaId,
                    ownerTable: link.OwnerTable,
                    ownerId: link.OwnerId,
                });
            }
        }
    }

    const primaryCounts = new Map<number, number>();
    for (const link of links) {
        if (link.OwnerTable === MEDIA_OWNER_TABLES.PEOPLE && link.IsPrimary === 1) {
            primaryCounts.set(link.OwnerId, (primaryCounts.get(link.OwnerId) ?? 0) + 1);
        }
    }
    for (const link of links) {
        if (
            link.OwnerTable === MEDIA_OWNER_TABLES.PEOPLE
            && link.IsPrimary === 1
            && (primaryCounts.get(link.OwnerId) ?? 0) > 1
        ) {
            issues.push({
                kind: 'multiple_primary',
                mediaId: link.MediaId,
                ownerTable: link.OwnerTable,
                ownerId: link.OwnerId,
            });
        }
    }

    issues.sort((a, b) => (
        a.mediaId - b.mediaId
        || a.ownerTable.localeCompare(b.ownerTable)
        || (a.ownerId ?? -1) - (b.ownerId ?? -1)
        || a.kind.localeCompare(b.kind)
    ));
    return { issues };
}
