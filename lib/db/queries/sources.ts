import { query } from '@/lib/db/connection';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/db/queries/audit-capture';
import { effectiveFirstName, primaryNickname } from '@/lib/db/queries/people';
import { primaryMediaIdFor } from '@/lib/db/queries/media-tags';
import { ValidationError } from '@/lib/validation';
import { likeContains } from './like-pattern';
import { liveCitationSql } from '@/lib/db/queries/live-owner';

const SOURCE_TYPES = ['Census', 'Vital', 'Church', 'Newspaper', 'Oral', 'Document', 'Photo', 'Other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const SOURCE_TYPE_SET: ReadonlySet<string> = new Set(SOURCE_TYPES);

export function isSourceType(value: unknown): value is SourceType {
    return typeof value === 'string' && SOURCE_TYPE_SET.has(value);
}

export interface Source {
    Id: number;
    OwnerId: number;
    TreeId?: number | null;
    Title: string | null;
    Author: string | null;
    PublicationInfo: string | null;
    RepositoryName: string | null;
    CallNumber: string | null;
    Text: string | null;
    Type: SourceType | null;
    Contents: string | null;
    Num: number | null;
    /** GEDCOM `1 ABBR` — a short filing title used for sorting and retrieval (#501). */
    Abbreviation?: string | null;
    /** Slice 4 — link to the shared Repository entity (RepositoryName kept during transition). */
    RepositoryId?: number | null;
    /** Slice 4 — medium of the call number (GEDCOM CALN.MEDI). */
    RepositoryMedi?: string | null;
    /** Verbatim GEDCOM subtrees not yet modeled, preserved for lossless export round-trip (passthrough). */
    RawGedcom?: string | null;
}

export interface NewSource {
    OwnerId: number;
    TreeId?: number | null;
    Title: string;
    Author?: string | null;
    PublicationInfo?: string | null;
    RepositoryName?: string | null;
    CallNumber?: string | null;
    Text?: string | null;
    Type?: SourceType;
    Contents?: string | null;
}

const ALLOWED_SOURCE_FIELDS: ReadonlySet<string> = new Set(['Title', 'Author', 'PublicationInfo', 'RepositoryName', 'CallNumber', 'Text', 'Type', 'Contents', 'Abbreviation']);

export async function getSources(treeId: number): Promise<Source[]> {
    const result = await query(
        `SELECT * FROM "Sources" WHERE "TreeId" = $1 ORDER BY "Title" ASC`,
        [treeId]
    );
    return result.rows as Source[];
}

export interface SourceWithCitationCount extends Source {
    citationCount: number;
    citedByPeople: Array<{ Id: number; FirstName: string | null; LastName: string | null; EffectiveFirstName: string | null; Nickname: string | null; Sex: string | null; PrimaryMediaId: number | null }>;
}

/**
 * Returns all sources for owner, with citation count and a sample (up to 4) of
 * people who cite the source via Person or Event facts. Used by the Library page.
 */
export async function getSourcesWithCitationCount(treeId: number): Promise<SourceWithCitationCount[]> {
    const result = await query(
        `SELECT
            s.*,
            COALESCE(cc.cnt, 0)::int AS "citationCount",
            COALESCE(rp.sample, '[]'::jsonb) AS "citedByPeople"
         FROM "Sources" s
         LEFT JOIN (
            SELECT "SourceId", COUNT(*)::int AS cnt
            FROM "Citation" c
            WHERE c."TreeId" = $1 AND ${liveCitationSql('c')}
            GROUP BY "SourceId"
         ) cc ON cc."SourceId" = s."Id"
         LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                'Id', p."Id",
                'FirstName', p."FirstName",
                'LastName', p."LastName",
                'EffectiveFirstName', p."EffectiveFirstName",
                'Nickname', p."Nickname",
                'Sex', p."Sex",
                'PrimaryMediaId', ${primaryMediaIdFor('p."Id"', '$1')}
            )) AS sample
            FROM (
                SELECT DISTINCT ON (
                    CASE WHEN c."FactTable" IN ('People', 'PersonName', 'PersonBirth', 'PersonDeath') THEN c."FactId"
                         WHEN c."FactTable" = 'Events' THEN (SELECT "PersonId" FROM "Events" WHERE "Id" = c."FactId")
                         WHEN c."FactTable" = 'NameVariant' THEN (SELECT "PersonId" FROM "NameVariant" WHERE "Id" = c."FactId")
                         ELSE NULL
                    END
                ) p2."Id", p2."FirstName", p2."LastName",
                  ${effectiveFirstName('p2')} AS "EffectiveFirstName",
                  ${primaryNickname('p2')} AS "Nickname",
                  p2."Sex", p2."UserId"
                FROM "Citation" c
                JOIN "People" p2 ON p2."Id" = (
                    CASE WHEN c."FactTable" IN ('People', 'PersonName', 'PersonBirth', 'PersonDeath') THEN c."FactId"
                         WHEN c."FactTable" = 'Events' THEN (SELECT "PersonId" FROM "Events" WHERE "Id" = c."FactId")
                         WHEN c."FactTable" = 'NameVariant' THEN (SELECT "PersonId" FROM "NameVariant" WHERE "Id" = c."FactId")
                         ELSE NULL
                    END
                )
                WHERE c."SourceId" = s."Id" AND c."TreeId" = $1
                LIMIT 4
            ) p
         ) rp ON true
         WHERE s."TreeId" = $1
         ORDER BY s."Title" ASC`,
        [treeId]
    );
    return result.rows.map(r => ({
        ...r,
        citedByPeople: typeof r.citedByPeople === 'string' ? JSON.parse(r.citedByPeople) : (r.citedByPeople ?? []),
    })) as SourceWithCitationCount[];
}

export async function getSource(id: number, treeId: number): Promise<Source | null> {
    const result = await query(
        `SELECT * FROM "Sources" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as Source) ?? null;
}

export async function createSource(data: NewSource, actingUserId?: number): Promise<Source> {
    const result = await query(
        `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Author", "PublicationInfo", "RepositoryName", "CallNumber", "Text", "Type", "Contents")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
            data.OwnerId, data.TreeId ?? null, data.Title, data.Author ?? null, data.PublicationInfo ?? null,
            data.RepositoryName ?? null, data.CallNumber ?? null, data.Text ?? null,
            data.Type ?? 'Document', data.Contents ?? null,
        ]
    );
    const created = result.rows[0] as Source;
    await auditCreate('source', created as unknown as Record<string, unknown>, data.OwnerId, actingUserId ?? data.OwnerId);
    return created;
}

export async function updateSource(id: number, treeId: number, fields: Partial<NewSource>, actingUserId?: number): Promise<Source | null> {
    // Runtime guard against a bad Type value sneaking past the static check
    // (e.g. via an `as` cast at the route boundary).
    if (fields.Type !== undefined && fields.Type !== null && !isSourceType(fields.Type)) {
        throw new ValidationError(`Invalid Source.Type: ${String(fields.Type)}`);
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
        if (ALLOWED_SOURCE_FIELDS.has(key)) {
            updates.push(`"${key}" = $${idx++}`);
            values.push(val);
        }
    }
    if (updates.length === 0) return getSource(id, treeId);

    const before = await getSource(id, treeId);
    if (!before) return null;

    values.push(id, treeId);
    const result = await query(
        `UPDATE "Sources" SET ${updates.join(', ')} WHERE "Id" = $${idx++} AND "TreeId" = $${idx} RETURNING *`,
        values
    );
    const after = (result.rows[0] as Source) ?? null;
    if (after) {
        await auditUpdate(
            'source',
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
            ALLOWED_SOURCE_FIELDS,
            before.OwnerId,
            actingUserId ?? before.OwnerId,
        );
    }
    return after;
}

export async function deleteSource(id: number, treeId: number, actingUserId?: number): Promise<boolean> {
    const before = await getSource(id, treeId);
    if (!before) return false;

    const result = await query(
        `DELETE FROM "Sources" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId]
    );
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
        await auditDelete('source', before as unknown as Record<string, unknown>, before.OwnerId, actingUserId ?? before.OwnerId);
    }
    return deleted;
}

/**
 * The sources this tree cited most recently, newest first (#799). The Attach
 * drawer lists them before any search, so citing one census on a household
 * doesn't mean finding it again for every member.
 */
export async function getRecentlyCitedSources(treeId: number, limit: number): Promise<Source[]> {
    const result = await query(
        `SELECT s.*
         FROM "Sources" s
         JOIN (
           SELECT "SourceId", MAX(c."Id") AS "LastCitationId"
           FROM "Citation" c
           WHERE c."TreeId" = $1 AND ${liveCitationSql('c')}
           GROUP BY "SourceId"
         ) r ON r."SourceId" = s."Id"
         WHERE s."TreeId" = $1
         ORDER BY r."LastCitationId" DESC
         LIMIT $2`,
        [treeId, limit]
    );
    return result.rows as Source[];
}

export async function searchSources(treeId: number, q: string): Promise<Source[]> {
    const contains = likeContains('$2');
    // Folded, so the LIMIT keeps the same 20 on both engines (#882).
    const result = await query(
        `SELECT * FROM "Sources"
         WHERE "TreeId" = $1
           AND ("Title" ILIKE ${contains} OR "Author" ILIKE ${contains} OR "RepositoryName" ILIKE ${contains})
         ORDER BY "SearchFold"("Title"), "Id"
         LIMIT 20`,
        [treeId, q]
    );
    return result.rows as Source[];
}
