import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import type { AuditLogEntry, AuditLogEntryWithUser, AuditFieldChanges, AuditSnapshotChanges } from '../schema';
import { hasEditPermission } from './sharing';
import { revertPlaceDelete, revertPlaceEdits, revertPlaceMove, revertPlaceRename, type PlaceDeleteSnapshot, type PlaceEditChange, type PlaceMoveSnapshot, type PlaceRenameSnapshot } from './places';
import { revertPlaceNames, type PlaceNamesSnapshot } from './place-names';
import { setCaseNoteStrike, type CaseNoteStrikeSnapshot } from './cases';
import { FACT_PLACE_COLUMNS, factPlaceRefs, factPlaceTextColumns, savedFactPlaceRef, type FactPlaceField } from './place-links';
import { FAMILY_PHOTO_SUMMARY, PLACE_EDIT_SUMMARY } from './audit-capture';
import { FACT_TABLES, isFactTableValue } from '@/lib/db/fact-tables';
import { ValidationError } from '@/lib/validation';
import { capturePersonDependents, restorePersonDependents, isPersonDependents } from './person-dependents';
import { likeContains } from './like-pattern';
import { isChildRelationshipType } from '@/lib/child-relationship';
import { foldToldBy } from '@/lib/utils/told-by';
import { isLinkOwnerTable } from '@/lib/db/fact-tables';
import { NOTE_OWNER_FACTS, type NoteAuditSnapshot } from './notes';
import {
    clearPrimaryMediaLinksForPerson,
    getPrimaryMediaLinkForPerson,
    lockPeopleForMediaMutation,
    setPrimaryMediaLink,
    upsertMediaLink,
    clearFamilyPhotoLinks,
    getFamilyPhotoLink,
    lockFamilyForMediaMutation,
    setFamilyPhotoLink,
} from './media-links';

const VALID_ENTITY_TYPES = new Set([
    'person', 'family', 'event', 'media', 'story', 'case',
    'source', 'citation', 'mediatag', 'namevariant', 'import', 'place', 'familychild', 'datacheck', 'note', 'casenote',
]);

const VALID_ACTIONS = new Set(['create', 'update', 'delete']);

/** Maps a client sort key to a safe, whitelisted ORDER BY column expression. */
const SORT_COLUMNS: Record<string, string> = {
    when: 'a."CreatedAt"',
    who: 'u."Name"',
    action: 'a."Action"',
    record: 'a."EntityLabel"',
    type: 'a."EntityType"',
};

export interface AuditLogFilter {
    page: number;
    pageSize: number;
    entityType?: string;
    action?: string;
    who?: number;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    sort?: string;
    dir?: string;
}

/**
 * Get paginated, filtered, and sorted audit log for a tree, joined with
 * user info. All dynamic inputs (action/sort/dir/entityType) are validated
 * against whitelists before being interpolated.
 */
export async function getAuditLog(
    treeId: number,
    options: AuditLogFilter
): Promise<{ entries: AuditLogEntryWithUser[]; total: number }> {
    const conditions = ['a."TreeId" = $1'];
    const params: unknown[] = [treeId];

    if (options.entityType) {
        if (!VALID_ENTITY_TYPES.has(options.entityType)) {
            throw new Error(`Invalid entityType: ${options.entityType}`);
        }
        params.push(options.entityType);
        conditions.push(`a."EntityType" = $${params.length}`);
    }

    if (options.action) {
        if (!VALID_ACTIONS.has(options.action)) {
            throw new Error(`Invalid action: ${options.action}`);
        }
        params.push(options.action);
        conditions.push(`a."Action" = $${params.length}`);
    }

    if (options.who != null) {
        params.push(options.who);
        conditions.push(`a."UserId" = $${params.length}`);
    }

    if (options.dateFrom) {
        params.push(options.dateFrom);
        conditions.push(`a."CreatedAt" >= $${params.length}::date`);
    }

    if (options.dateTo) {
        params.push(options.dateTo);
        conditions.push(`a."CreatedAt" < ($${params.length}::date + INTERVAL '1 day')`);
    }

    if (options.search) {
        params.push(options.search);
        conditions.push(`a."EntityLabel" ILIKE ${likeContains(`$${params.length}`)}`);
    }

    let sortCol = 'a."CreatedAt"';
    if (options.sort) {
        if (!SORT_COLUMNS[options.sort]) {
            throw new Error(`Invalid sort: ${options.sort}`);
        }
        sortCol = SORT_COLUMNS[options.sort];
    }
    let sortDir = 'DESC';
    if (options.dir) {
        if (options.dir !== 'asc' && options.dir !== 'desc') {
            throw new Error(`Invalid dir: ${options.dir}`);
        }
        sortDir = options.dir === 'asc' ? 'ASC' : 'DESC';
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
        `SELECT COUNT(*) as count FROM "AuditLog" a WHERE ${where}`,
        params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const offset = (options.page - 1) * options.pageSize;
    const dataParams = [...params, options.pageSize, offset];
    // "Id" tiebreaker: CURRENT_TIMESTAMP is transaction-stable, so rows written
    // in one transaction share a CreatedAt. When the primary sort IS the
    // timestamp, the tiebreaker follows the requested direction; otherwise ties
    // break newest-first.
    const tiebreak = sortCol === SORT_COLUMNS.when
        ? `a."Id" ${sortDir}`
        : `a."CreatedAt" DESC, a."Id" DESC`;
    const result = await query(
        `SELECT a.*, u."Name" AS "UserName", u."Email" AS "UserEmail"
         FROM "AuditLog" a
         LEFT JOIN "Users" u ON a."UserId" = u."Id"
         WHERE ${where}
         ORDER BY ${sortCol} ${sortDir} NULLS LAST, ${tiebreak}
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
    );

    return { entries: result.rows as AuditLogEntryWithUser[], total };
}

/**
 * Distinct editors (users who have any audit entry) for a tree — powers
 * the "Who" filter dropdown.
 */
/** The same entries with each editor's email removed, for view-only members (#51, L-4). */
export function withoutEditorEmails<T extends { UserEmail?: string | null }>(entries: T[]): T[] {
    return entries.map((e) => ({ ...e, UserEmail: null }));
}

export async function getAuditEditors(
    treeId: number
): Promise<{ userId: number; name: string }[]> {
    const result = await query(
        `SELECT DISTINCT a."UserId" AS "userId", u."Name" AS "name"
         FROM "AuditLog" a
         LEFT JOIN "Users" u ON a."UserId" = u."Id"
         WHERE a."TreeId" = $1 AND a."UserId" IS NOT NULL
         ORDER BY u."Name"`,
        [treeId]
    );
    return result.rows.map((r) => ({ userId: r.userId as number, name: (r.name as string) ?? '' }));
}

/**
 * Get a single audit entry by ID with tree scope check.
 */
/**
 * Names for the person and family ids a page of audit entries refers to, so
 * the log reads "Partner 1 · Tom Bracken → Ned Bracken" instead of ids (#551).
 * Tree-scoped; an id that is gone (or never was in this tree) is simply absent,
 * and the page falls back to "#id".
 */
export async function getAuditRefNames(
    treeId: number,
    personIds: number[],
    familyIds: number[],
): Promise<{ people: Record<string, string>; families: Record<string, string> }> {
    const people: Record<string, string> = {};
    const families: Record<string, string> = {};
    const fullName = (alias: string) =>
        `NULLIF(TRIM(CONCAT(COALESCE(${alias}."FirstName", ''), ' ', COALESCE(${alias}."LastName", ''))), '')`;
    if (personIds.length > 0) {
        const result = await query(
            `SELECT p."Id", ${fullName('p')} AS name FROM "People" p WHERE p."Id" = ANY($1::int[]) AND p."TreeId" = $2`,
            [personIds, treeId],
        );
        for (const row of result.rows as { Id: number; name: string | null }[]) {
            if (row.name) people[row.Id] = row.name;
        }
    }
    if (familyIds.length > 0) {
        const result = await query(
            `SELECT f."Id", ${fullName('p1')} AS p1, ${fullName('p2')} AS p2
             FROM "Families" f
             LEFT JOIN "People" p1 ON p1."Id" = COALESCE(f."Partner1Id", f."HusbandId")
             LEFT JOIN "People" p2 ON p2."Id" = COALESCE(f."Partner2Id", f."WifeId")
             WHERE f."Id" = ANY($1::int[]) AND f."TreeId" = $2`,
            [familyIds, treeId],
        );
        for (const row of result.rows as { Id: number; p1: string | null; p2: string | null }[]) {
            const names = [row.p1, row.p2].filter(Boolean);
            if (names.length > 0) families[row.Id] = names.join(' & ');
        }
    }
    return { people, families };
}

async function getAuditEntryById(id: number, treeId: number): Promise<AuditLogEntry | null> {
    const result = await query(
        `SELECT * FROM "AuditLog" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as AuditLogEntry) || null;
}

type EntityScopeKind = 'user-tree' | 'owner-tree' | 'media-tree';

interface EntityConfig {
    table: string;
    allowedFields: ReadonlySet<string>;
    scope: EntityScopeKind;
    requiredRestoreFields?: readonly string[];
    restoreFields?: readonly string[];
    /** People, families and events: which facts' places the row holds by reference (ADR 0037). */
    places?: (typeof FACT_PLACE_COLUMNS)[number]['records'];
}

// Table, allowed fields, and ownership mapping for revert operations. The scope
// metadata is deliberately kept here with the SQL table allowlist so a newly
// supported entity cannot accidentally fall through to the legacy UserId path.
const ENTITY_CONFIG: Record<string, EntityConfig> = {
    person: {
        table: '"People"',
        scope: 'user-tree',
        places: 'people',
        // 'Notes' dropped in #524 (ADR 0010) — mirrors ALLOWED_PERSON_FIELDS in people.ts.
        allowedFields: new Set(['FirstName', 'LastName', 'Sex', 'GedcomId', 'BirthDate', 'BirthPlace', 'DeathDate', 'DeathPlace', 'DeathCause', 'IsDeceased']),
    },
    family: {
        table: '"Families"',
        scope: 'user-tree',
        places: 'families',
        allowedFields: new Set(['Partner1Id', 'Partner2Id', 'MarriageDate', 'MarriagePlace', 'Type']),
    },
    event: {
        table: '"Events"',
        scope: 'user-tree',
        places: 'events',
        allowedFields: new Set(['Type', 'Date', 'Place', 'Description', 'PersonId', 'FamilyId']),
    },
    media: {
        // 'FilePath' is DELIBERATELY kept here despite being removed from
        // ALLOWED_MEDIA_FIELDS (it is no longer API-writable — traversal
        // hardening): delete-revert re-inserts allowedFields from the
        // snapshot, and dropping FilePath would restore media rows with no
        // file. Historical FilePath-bearing entries must stay revertable.
        table: '"Media"',
        scope: 'user-tree',
        allowedFields: new Set(['Title', 'FilePath', 'Format', 'ContentType', 'FocalX', 'FocalY', 'FocalRadius', 'FileSize']),
        restoreFields: ['Title', 'FilePath', 'Format', 'ContentType', 'FocalX', 'FocalY', 'FocalRadius', 'FileSize', 'ContentHash', 'UploadIntentId', 'UploadIntentTarget'],
    },
    // Retained for historical audit rows only: the "Stories" table was dropped when
    // the Stories feature was retired (issue #70). The list/label paths don't touch the
    // table, but reverting a historical 'story' entry will fail (relation does not exist) —
    // this is an accepted, intentional edge case.
    story: {
        table: '"Stories"',
        scope: 'user-tree',
        allowedFields: new Set(['Title', 'Date', 'ToldBy', 'Place', 'Contents']),
    },
    case: {
        table: '"Cases"',
        scope: 'user-tree',
        // The case's scope (#58) is audited and reverts like its title.
        allowedFields: new Set(['Title', 'Description', 'Status', 'Tags', 'FromYear', 'ToYear', 'Place', 'QuestionKind']),
    },
    source: {
        table: '"Sources"',
        scope: 'owner-tree',
        // 'ToldBy' left with its column (#470). A delete restore folds a snapshot's
        // teller into Author; an edit of the teller alone is no longer revertible.
        allowedFields: new Set(['Title', 'Author', 'PublicationInfo', 'RepositoryName', 'CallNumber', 'Text', 'Type', 'Contents', 'Abbreviation']),
        restoreFields: ['Title', 'Author', 'PublicationInfo', 'RepositoryName', 'CallNumber', 'Text', 'Type', 'Contents', 'Num', 'RawGedcom', 'RepositoryId', 'RepositoryMedi', 'Abbreviation', 'CreatedAt'],
    },
    citation: {
        table: '"Citation"',
        scope: 'owner-tree',
        allowedFields: new Set(['FactTable', 'FactId', 'SourceId', 'Page', 'Note', 'Quay', 'DataText', 'Url']),
        restoreFields: ['FactTable', 'FactId', 'SourceId', 'Page', 'Note', 'Quay', 'DataText', 'DataDate', 'Even', 'Role', 'Url', 'CreatedAt'],
    },
    mediatag: {
        table: '"MediaTag"',
        scope: 'media-tree',
        allowedFields: new Set(['PersonId', 'RegionX', 'RegionY', 'RegionW', 'RegionH']),
        restoreFields: ['RegionX', 'RegionY', 'RegionW', 'RegionH', 'CreatedAt'],
    },
    namevariant: {
        table: '"NameVariant"',
        scope: 'owner-tree',
        requiredRestoreFields: ['PersonId'],
        allowedFields: new Set(['Type', 'Name', 'FromDate', 'ToDate', 'IsPrimary']),
        restoreFields: ['Type', 'Name', 'FromDate', 'ToDate', 'IsPrimary', 'CreatedAt'],
    },
};

/**
 * Every EntityType the audit log can record. Derived from VALID_ENTITY_TYPES —
 * the set the API itself validates against — rather than from ENTITY_CONFIG,
 * which deliberately omits 'import' and 'place' (both are captured by their own
 * helpers and reverted by their own branches). Building it from the narrower set
 * would leave exactly those two unguarded.
 *
 * Exported so the audit UI's route map and its Type-column labels can be checked
 * for completeness — a new auditable entity with no entry silently renders a dead
 * link or a raw translation key.
 */
export const AUDITABLE_ENTITY_TYPES: readonly string[] = [...VALID_ENTITY_TYPES];

type AuditExecutor = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> };

/**
 * Read an entity only when its row belongs to the audit entry's tree. MediaTag
 * has no scope column of its own, so both its Media and Person relationships
 * must resolve to the same tree.
 */
async function getScopedEntity(
    config: EntityConfig,
    entityId: number,
    treeId: number,
    treeOwnerId: number,
    exec: AuditExecutor,
): Promise<Record<string, unknown> | null> {
    const result = config.scope === 'media-tree'
        ? await exec.query(
            `SELECT mt.*
             FROM "MediaTag" mt
             JOIN "Media" m ON m."Id" = mt."MediaId"
             JOIN "People" p ON p."Id" = mt."PersonId"
                            AND p."TreeId" = m."TreeId" AND p."UserId" = m."UserId"
             WHERE mt."Id" = $1 AND m."TreeId" = $2 AND m."UserId" = $3`,
            [entityId, treeId, treeOwnerId],
        )
        : await exec.query(
            `SELECT *${config.places ? `, ${factPlaceTextColumns(config.places, config.table)}` : ''} FROM ${config.table}
             WHERE "Id" = $1 AND "TreeId" = $2
               AND "${config.scope === 'owner-tree' ? 'OwnerId' : 'UserId'}" = $3`,
            [entityId, treeId, treeOwnerId],
        );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

/** Ensure a MediaTag restore cannot attach a person from another tree. */
async function assertMediaTagRelationships(
    mediaId: unknown,
    personId: unknown,
    treeId: number,
    treeOwnerId: number,
    exec: AuditExecutor,
): Promise<void> {
    const result = await exec.query(
        `SELECT 1
         FROM "Media" m
         JOIN "People" p ON p."Id" = $2 AND p."TreeId" = m."TreeId" AND p."UserId" = m."UserId"
         WHERE m."Id" = $1 AND m."TreeId" = $3 AND m."UserId" = $4`,
        [mediaId, personId, treeId, treeOwnerId],
    );
    if (result.rows.length === 0) {
        throw new Error('MediaTag relationships are not in the selected tree');
    }
}

/** Ensure a citation's source and polymorphic fact both belong to the tree. */
async function assertCitationRelationships(
    sourceId: unknown,
    factTable: unknown,
    factId: unknown,
    treeId: number,
    treeOwnerId: number,
    exec: AuditExecutor,
): Promise<void> {
    const normalizedFactTable = factTable === 'family' ? FACT_TABLES.FAMILIES : factTable;
    if (!isFactTableValue(normalizedFactTable) || sourceId == null || factId == null) {
        throw new Error('Citation has incomplete or invalid relationship scope');
    }

    const source = await exec.query(
        `SELECT 1 FROM "Sources" WHERE "Id" = $1 AND "TreeId" = $2 AND "OwnerId" = $3`,
        [sourceId, treeId, treeOwnerId],
    );
    if (source.rows.length === 0) {
        throw new Error('Citation source is not in the selected tree');
    }

    let fact: { sql: string; params: unknown[] };
    switch (normalizedFactTable) {
        case FACT_TABLES.PEOPLE:
        case FACT_TABLES.PERSON_BIRTH:
        case FACT_TABLES.PERSON_DEATH:
        case FACT_TABLES.PERSON_NAME:
            fact = {
                sql: `SELECT 1 FROM "People" WHERE "Id" = $1 AND "TreeId" = $2 AND "UserId" = $3`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
        case FACT_TABLES.FAMILIES:
        case FACT_TABLES.FAMILY_MARRIAGE:
            fact = {
                sql: `SELECT 1
                      FROM "Families" f
                      LEFT JOIN "People" p1
                        ON p1."Id" = COALESCE(f."Partner1Id", f."HusbandId")
                       AND p1."TreeId" = f."TreeId" AND p1."UserId" = f."UserId"
                      LEFT JOIN "People" p2
                        ON p2."Id" = COALESCE(f."Partner2Id", f."WifeId")
                       AND p2."TreeId" = f."TreeId" AND p2."UserId" = f."UserId"
                      WHERE f."Id" = $1 AND f."TreeId" = $2 AND f."UserId" = $3
                        AND (COALESCE(f."Partner1Id", f."HusbandId") IS NULL OR p1."Id" IS NOT NULL)
                        AND (COALESCE(f."Partner2Id", f."WifeId") IS NULL OR p2."Id" IS NOT NULL)`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
        case FACT_TABLES.EVENTS:
            fact = {
                sql: `SELECT 1
                      FROM "Events" e
                      LEFT JOIN "People" p
                        ON p."Id" = e."PersonId" AND p."TreeId" = e."TreeId" AND p."UserId" = e."UserId"
                      LEFT JOIN "Families" f
                        ON f."Id" = e."FamilyId" AND f."TreeId" = e."TreeId" AND f."UserId" = e."UserId"
                      LEFT JOIN "People" p1
                        ON p1."Id" = COALESCE(f."Partner1Id", f."HusbandId")
                       AND p1."TreeId" = f."TreeId" AND p1."UserId" = f."UserId"
                      LEFT JOIN "People" p2
                        ON p2."Id" = COALESCE(f."Partner2Id", f."WifeId")
                       AND p2."TreeId" = f."TreeId" AND p2."UserId" = f."UserId"
                      WHERE e."Id" = $1 AND e."TreeId" = $2 AND e."UserId" = $3
                        AND (e."PersonId" IS NULL OR p."Id" IS NOT NULL)
                        AND (e."FamilyId" IS NULL OR (
                          f."Id" IS NOT NULL
                          AND (COALESCE(f."Partner1Id", f."HusbandId") IS NULL OR p1."Id" IS NOT NULL)
                          AND (COALESCE(f."Partner2Id", f."WifeId") IS NULL OR p2."Id" IS NOT NULL)
                        ))`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
        case FACT_TABLES.NAME_VARIANT:
            fact = {
                sql: `SELECT 1
                      FROM "NameVariant" nv
                      JOIN "People" p ON p."Id" = nv."PersonId"
                       AND p."TreeId" = nv."TreeId" AND p."UserId" = nv."OwnerId"
                      WHERE nv."Id" = $1 AND nv."TreeId" = $2 AND nv."OwnerId" = $3`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
        case FACT_TABLES.CASES:
            fact = {
                sql: `SELECT 1 FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2 AND "UserId" = $3`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
        case FACT_TABLES.CASE_COMMENTS:
            fact = {
                sql: `SELECT 1
                      FROM "CaseComments" cc
                      JOIN "Cases" c ON c."Id" = cc."CaseId"
                      WHERE cc."Id" = $1 AND c."TreeId" = $2 AND c."UserId" = $3`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
        case FACT_TABLES.CASE_FINDINGS:
            fact = {
                sql: `SELECT 1
                      FROM "CaseFindings" cf
                      JOIN "Cases" c ON c."Id" = cf."CaseId"
                      WHERE cf."Id" = $1 AND c."TreeId" = $2 AND c."UserId" = $3`,
                params: [factId, treeId, treeOwnerId],
            };
            break;
    }
    const factResult = await exec.query(fact.sql, fact.params);
    if (factResult.rows.length === 0) {
        throw new Error('Citation fact is not in the selected tree');
    }
}

async function assertNameVariantRelationship(
    personId: unknown,
    treeId: number,
    treeOwnerId: number,
    exec: AuditExecutor,
): Promise<void> {
    const result = await exec.query(
        `SELECT 1 FROM "People" WHERE "Id" = $1 AND "TreeId" = $2 AND "UserId" = $3`,
        [personId, treeId, treeOwnerId],
    );
    if (result.rows.length === 0) {
        throw new Error('NameVariant person is not in the selected tree');
    }
}

async function assertSourceRelationships(
    repositoryId: unknown,
    treeId: number,
    treeOwnerId: number,
    exec: AuditExecutor,
): Promise<void> {
    if (repositoryId == null) return;
    const result = await exec.query(
        `SELECT 1 FROM "Repository" WHERE "Id" = $1 AND "TreeId" = $2 AND "OwnerId" = $3`,
        [repositoryId, treeId, treeOwnerId],
    );
    if (result.rows.length === 0) {
        throw new Error('Source repository is not in the selected tree');
    }
}

async function assertEventOrFamilyRelationships(
    entityType: string,
    row: Record<string, unknown>,
    treeId: number,
    treeOwnerId: number,
    exec: AuditExecutor,
): Promise<void> {
    const references = entityType === 'event'
        ? [
            { id: row.PersonId, table: 'People' },
            { id: row.FamilyId, table: 'Families' },
        ]
        : [
            { id: row.Partner1Id, table: 'People' },
            { id: row.Partner2Id, table: 'People' },
        ];
    for (const reference of references) {
        if (reference.id == null) continue;
        const result = await exec.query(
            `SELECT 1 FROM "${reference.table}" WHERE "Id" = $1 AND "TreeId" = $2 AND "UserId" = $3`,
            [reference.id, treeId, treeOwnerId],
        );
        if (result.rows.length === 0) {
            throw new Error(`${entityType} relationship is not in the selected tree`);
        }
    }
}

function scopedUpdateSql(config: EntityConfig): string {
    if (config.scope === 'media-tree') {
        return `UPDATE "MediaTag" mt SET`;
    }
    return `UPDATE ${config.table} SET`;
}

function scopedUpdateWhere(config: EntityConfig, idParam: number, treeParam: number, ownerParam: number): string {
    if (config.scope === 'media-tree') {
        return ` WHERE mt."Id" = $${idParam}
                   AND mt."MediaId" = m."Id"
                   AND m."TreeId" = $${treeParam}
                   AND m."UserId" = $${ownerParam}
                   AND EXISTS (
                       SELECT 1 FROM "People" p
                       WHERE p."Id" = mt."PersonId" AND p."TreeId" = m."TreeId"
                   )`;
    }
    const ownerColumn = config.scope === 'owner-tree' ? 'OwnerId' : 'UserId';
    return ` WHERE "Id" = $${idParam} AND "TreeId" = $${treeParam} AND "${ownerColumn}" = $${ownerParam}`;
}

function scopedDeleteSql(config: EntityConfig, idParam: number, treeParam: number, ownerParam: number): string {
    if (config.scope === 'media-tree') {
        return `DELETE FROM "MediaTag" mt USING "Media" m
                WHERE mt."Id" = $${idParam}
                  AND mt."MediaId" = m."Id"
                  AND m."TreeId" = $${treeParam}
                  AND m."UserId" = $${ownerParam}
                  AND EXISTS (
                      SELECT 1 FROM "People" p
                      WHERE p."Id" = mt."PersonId" AND p."TreeId" = m."TreeId"
                  )`;
    }
    const ownerColumn = config.scope === 'owner-tree' ? 'OwnerId' : 'UserId';
    return `DELETE FROM ${config.table} WHERE "Id" = $${idParam} AND "TreeId" = $${treeParam} AND "${ownerColumn}" = $${ownerParam}`;
}

/** The place fields ("BirthPlace") of an entity whose row holds its places by reference. */
function placeFieldsOf(config: EntityConfig): FactPlaceField[] {
    return FACT_PLACE_COLUMNS.filter((c) => c.records === config.places).map((c) => c.name.slice(1, -1) as FactPlaceField);
}

/** One place a revert puts back: the text the entry recorded, and the place it pointed at. */
interface RevertedPlace {
    field: FactPlaceField;
    text: string | null;
    ref?: { id: number | null; nameId: number | null } | null;
}

/**
 * The reference columns that put reverted facts back on their places, as
 * [quoted column, value] pairs: the place each pointed at when it still spells the
 * recorded text, else the text matched as a save matches it. Entries from before
 * v64 recorded text only, so they always take the second path.
 */
async function revertedPlaceColumns(
    executor: AuditExecutor,
    treeId: number,
    treeOwnerId: number,
    places: readonly RevertedPlace[],
): Promise<[string, unknown][]> {
    const out: [string, unknown][] = [];
    const texts: Partial<Record<FactPlaceField, string | null>> = {};
    for (const p of places) {
        const saved = p.text && p.ref ? await savedFactPlaceRef(executor, treeId, p.text, p.ref) : null;
        const col = FACT_PLACE_COLUMNS.find((c) => c.name === `"${p.field}"`)!;
        if (saved) out.push([col.id, saved.id], [col.nameId, saved.nameId]);
        else texts[p.field] = p.text;
    }
    return [...out, ...await factPlaceRefs(executor, treeId, treeOwnerId, texts)];
}

/** A snapshot row's reference to one of its places, by the field ("BirthPlace"). */
function snapshotPlaceRef(row: Record<string, unknown>, field: FactPlaceField): { id: number | null; nameId: number | null } {
    const col = FACT_PLACE_COLUMNS.find((c) => c.name === `"${field}"`)!;
    return {
        id: (row[col.id.slice(1, -1)] as number | null | undefined) ?? null,
        nameId: (row[col.nameId.slice(1, -1)] as number | null | undefined) ?? null,
    };
}

/**
 * Revert a single audit entry. Creates a new audit entry for the revert action.
 */
async function revertSingleEntry(
    entry: AuditLogEntry,
    treeOwnerId: number,
    userId: number,
    clientOrQuery?: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }
): Promise<void> {
    const executor: AuditExecutor = clientOrQuery ?? { query };
    const exec = (sql: string, params: unknown[]) => executor.query(sql, params);

    // Multi-tree: entries are fetched via a TreeId-scoped read, so TreeId is
    // present on every revertable entry (the init backfill stamps legacy rows).
    const treeId = entry.TreeId;
    if (treeId == null) {
        throw new Error(`Audit entry #${entry.Id} has no tree scope; cannot revert`);
    }

    const summary = (entry.Changes as { summary?: { kind?: unknown } } | null)?.summary;
    if (entry.EntityType === 'media' && entry.Action === 'update') {
        if (summary?.kind === 'canonical_primary') {
            await revertCanonicalPrimary(entry, treeId, treeOwnerId, userId, executor);
            return;
        }
        if (summary?.kind === FAMILY_PHOTO_SUMMARY) {
            await revertFamilyPhoto(entry, treeId, treeOwnerId, userId, executor);
            return;
        }
        if (summary?.kind === 'canonical_ownership') {
            throw new Error(`Audit entry #${entry.Id} canonical ownership summary is not revertible`);
        }
    }

    // A place geocode, coordinate or hierarchy edit (#924) carries each touched
    // row's before/after columns, so revert restores exactly those rows. Its trail
    // marker swaps the readable details so the log shows what the revert did.
    if (entry.EntityType === 'place' && summary?.kind === PLACE_EDIT_SUMMARY) {
        const places = (entry.Changes as { places?: unknown }).places;
        const wellFormed = (p: unknown) => {
            const c = p as Partial<PlaceEditChange> | null;
            return !!c && typeof c.id === 'number' && typeof c.after === 'object' && c.after !== null
                && (c.before === null || typeof c.before === 'object');
        };
        if (!Array.isArray(places) || places.length === 0 || !places.every(wellFormed)) {
            throw new Error(`Audit entry #${entry.Id} is not a revertable place edit`);
        }
        await revertPlaceEdits({ query: exec }, treeId, places as PlaceEditChange[]);
        const fields = 'fields' in entry.Changes
            ? Object.fromEntries(Object.entries(entry.Changes.fields).map(([f, d]) => [f, { old: d.new, new: d.old }]))
            : {};
        await exec(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'update', 'place', $4, $5, $6)`,
            [treeOwnerId, userId, treeId, entry.EntityId, `Reverted: ${entry.EntityLabel ?? ''}`.trim(), JSON.stringify({ fields, snapshot: { revertOf: entry.Id } })]
        );
        return;
    }

    // Place rename/merge (CRUD §1.2) is not a single-row entity, so it is handled
    // before the generic ENTITY_CONFIG path. The snapshot carries the exact affected
    // record ids, so reverting a merge pulls back only the records that originally
    // held `from`. Revert is idempotent (guarded UPDATEs / ON CONFLICT), so a
    // double-revert is a safe no-op. A trail marker (snapshot.revertOf, no `affected`)
    // records that a revert happened; it is itself not revertable (the audit UI hides
    // its revert button).
    if (entry.EntityType === 'place') {
        const snap = ('snapshot' in entry.Changes ? entry.Changes.snapshot : null) as PlaceRenameSnapshot | null;
        // "Move records to another place" (#1186) names both places by id.
        const move = snap as unknown as Partial<PlaceMoveSnapshot> | null;
        // A save of a place's other names (#1185).
        const names = snap as unknown as Partial<PlaceNamesSnapshot> | null;
        // Deleting an unused place (#1229) kept the whole row.
        const deleted = snap as unknown as Partial<PlaceDeleteSnapshot> | null;
        if (deleted?.deleted === true) {
            if (typeof deleted.name !== 'string' || !deleted.place || typeof deleted.place !== 'object' || !Array.isArray(deleted.names)) {
                throw new Error(`Audit entry #${entry.Id} is not a revertable place delete`);
            }
            await revertPlaceDelete({ query: exec }, treeId, deleted as PlaceDeleteSnapshot);
        } else if (names?.names === true) {
            if (typeof names.placeId !== 'number' || !Array.isArray(names.added) || !Array.isArray(names.changed) || !Array.isArray(names.removed)) {
                throw new Error(`Audit entry #${entry.Id} is not a revertable change of other names`);
            }
            await revertPlaceNames({ query: exec }, treeId, names as PlaceNamesSnapshot);
        } else if (move?.move === true) {
            if (typeof move.fromId !== 'number' || typeof move.toId !== 'number' || !Array.isArray(move.affected)) {
                throw new Error(`Audit entry #${entry.Id} is not a revertable place move`);
            }
            await revertPlaceMove({ query: exec }, treeId, move as PlaceMoveSnapshot);
        } else {
            if (!snap || !Array.isArray(snap.affected) || typeof snap.from !== 'string' || typeof snap.to !== 'string') {
                throw new Error(`Audit entry #${entry.Id} is not a revertable place rename`);
            }
            // NOT YET FULLY TREE-SCOPED (flagged for the audit slice of the multi-tree
            // refactor): revertSingleEntry only has treeOwnerId in scope, not a resolved
            // TreeScope. renamePlaceService now stamps entry.TreeId on new place-rename
            // audit rows, so prefer that; historical entries predating the stamp fall
            // back to the owner's default tree (pre-existing single-tree-per-user
            // behavior, not a regression here).
            await revertPlaceRename({ query: exec }, treeId, snap);
        }
        await exec(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'update', 'place', $4, $5, $6)`,
            [treeOwnerId, userId, treeId, entry.EntityId, `Reverted: ${entry.EntityLabel ?? ''}`.trim(), JSON.stringify({ snapshot: { revertOf: entry.Id } })]
        );
        return;
    }

    // A child link (FamilyPerson) has no Id of its own, so it is not in
    // ENTITY_CONFIG either (#788).
    if (entry.EntityType === 'familychild') {
        await revertFamilyChild(entry, treeId, treeOwnerId, userId, executor);
        return;
    }

    // A note is a Note row plus its NoteLink rows to one record (#1045).
    if (entry.EntityType === 'note') {
        await revertNote(entry, treeId, treeOwnerId, userId, executor);
        return;
    }

    // A case journal note struck out or its strike undone (#1251).
    if (entry.EntityType === 'casenote') {
        await revertCaseNote(entry, treeId, treeOwnerId, userId, executor);
        return;
    }

    // Resolve the live row through its entity-specific tree boundary before any
    // mutation. This is the authorization check for the four entities whose
    // ownership is not represented by a legacy UserId column.
    const config = ENTITY_CONFIG[entry.EntityType];
    // e.g. a `datacheck` confirmation: recorded for the log, not revertible here (#51, L-1).
    if (!config) throw new ValidationError(`Changes of type ${entry.EntityType} can't be reverted`);

    const current = await getScopedEntity(config, entry.EntityId, treeId, treeOwnerId, executor);
    if (current && config.scope === 'owner-tree' && current.OwnerId !== treeOwnerId) {
        throw new Error(`Audit entry #${entry.Id} has insufficient ownership scope; cannot modify`);
    }
    if (current && config.scope === 'media-tree') {
        await assertMediaTagRelationships(
            current.MediaId,
            current.PersonId,
            treeId,
            treeOwnerId,
            executor,
        );
    }

    if (entry.Action === 'update') {
        // Revert by applying old values
        if (!('fields' in entry.Changes)) {
            throw new Error(`Audit entry #${entry.Id} has unexpected structure for update action`);
        }
        const changes = entry.Changes as AuditFieldChanges;
        const fields = Object.keys(changes.fields).filter(f => config.allowedFields.has(f));
        if (fields.length === 0) {
            throw new Error(`Audit entry #${entry.Id} has no revertible fields`);
        }

        if (!current) {
            throw new Error(`Record ${entry.EntityType} #${entry.EntityId} no longer exists`);
        }

        if (config.scope === 'owner-tree' && entry.EntityType === 'citation') {
            const restored = { ...current };
            for (const field of ['SourceId', 'FactTable', 'FactId']) {
                if (fields.includes(field)) restored[field] = changes.fields[field].old;
            }
            await assertCitationRelationships(
                restored.SourceId,
                restored.FactTable,
                restored.FactId,
                treeId,
                treeOwnerId,
                executor,
            );
        }

        if (entry.EntityType === 'event' || entry.EntityType === 'family') {
            const restored = { ...current };
            const relationshipFields = entry.EntityType === 'event'
                ? ['PersonId', 'FamilyId']
                : ['Partner1Id', 'Partner2Id'];
            for (const field of relationshipFields) {
                if (fields.includes(field)) restored[field] = changes.fields[field].old;
            }
            await assertEventOrFamilyRelationships(entry.EntityType, restored, treeId, treeOwnerId, executor);
        }

        if (config.scope === 'media-tree' && fields.includes('PersonId')) {
            await assertMediaTagRelationships(
                current.MediaId,
                changes.fields.PersonId.old,
                treeId,
                treeOwnerId,
                executor,
            );
        }

        // A fact's place is its references (ADR 0037): put back the place it pointed at,
        // not the text alone.
        const placeFields = placeFieldsOf(config);
        const revertedPlaces = placeFields
            .filter((f) => fields.includes(f) || changes.places?.[f])
            .map((f): RevertedPlace => ({
                field: f,
                text: (fields.includes(f) ? changes.fields[f].old : current[f]) as string | null,
                ref: changes.places?.[f]?.old ?? null,
            }));
        const columns: [string, unknown][] = [
            ...fields.filter((f) => !placeFields.includes(f as FactPlaceField)).map((f) => [`"${f}"`, changes.fields[f].old] as [string, unknown]),
            ...await revertedPlaceColumns(executor, treeId, treeOwnerId, revertedPlaces),
        ];
        const values: unknown[] = columns.map(([, v]) => v);
        const setClauses = columns.map(([c], i) => `${c} = $${i + 1}`);
        // A family partner's imported GEDCOM sub-lines describe that person, so
        // they go when a revert puts someone else in the slot, as in updateFamily (#989).
        if (entry.EntityType === 'family') {
            for (const slot of ['Partner1', 'Partner2']) {
                const i = columns.findIndex(([c]) => c === `"${slot}Id"`);
                if (i >= 0) setClauses.push(`"${slot}RawGedcom" = CASE WHEN "${slot}Id" IS NOT DISTINCT FROM $${i + 1} THEN "${slot}RawGedcom" END`);
            }
        }
        // Build the revert diff (swap old/new)
        const revertFields: Record<string, { old: unknown; new: unknown }> = {};
        for (const field of fields) {
            revertFields[field] = { old: changes.fields[field].new, new: changes.fields[field].old };
        }

        const hasUpdatedAt = entry.EntityType === 'person' || entry.EntityType === 'family' || entry.EntityType === 'story' || entry.EntityType === 'case';
        const updateSuffix = hasUpdatedAt ? `, "UpdatedAt" = CURRENT_TIMESTAMP` : '';
        const idParam = values.length + 1;
        const treeParam = values.length + 2;
        const updatePrefix = scopedUpdateSql(config);
        const updateFrom = config.scope === 'media-tree' ? ' FROM "Media" m' : '';
        const updateResult = await exec(
            `${updatePrefix} ${setClauses.join(', ')}${updateSuffix}${updateFrom}${scopedUpdateWhere(config, idParam, treeParam, idParam + 2)}`,
            [...values, entry.EntityId, treeId, treeOwnerId],
        );
        if ((updateResult.rowCount ?? 0) === 0) {
            throw new Error(`Record ${entry.EntityType} #${entry.EntityId} is outside the selected tree`);
        }

        // Audit the revert, with the places it moved the facts between.
        const revertPlaces = changes.places
            ? Object.fromEntries(Object.entries(changes.places).map(([f, d]) => [f, { old: d.new, new: d.old }]))
            : undefined;
        await exec(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'update', $4, $5, $6, $7)`,
            [treeOwnerId, userId, treeId, entry.EntityType, entry.EntityId, entry.EntityLabel, JSON.stringify(revertPlaces ? { fields: revertFields, places: revertPlaces } : { fields: revertFields })]
        );

    } else if (entry.Action === 'create') {
        // Revert a create = delete the record. `current` was read through the
        // entity-specific scope boundary above, so a row in another tree cannot
        // be deleted even if the audit entry is forged.
        if (!current) {
            throw new Error(`Record ${entry.EntityType} #${entry.EntityId} no longer exists`);
        }

        // Deleting a person cascades its dependents away, so this delete's own
        // entry carries them, the same as an ordinary person delete (#788).
        const dependents = entry.EntityType === 'person'
            ? await capturePersonDependents(executor, entry.EntityId)
            : undefined;

        // MediaLink is a separate canonical ownership/workflow record. A tag
        // revert intentionally restores only the audited MediaTag row; this
        // matches the ordinary tag-delete path and avoids deleting a link that
        // may have existed independently of the tag. A profile picture the tag
        // set (#922) is cleared too, if it's still that photo and the tag still
        // names the same person: the person had none before.
        const createdSnapshot = 'snapshot' in entry.Changes ? (entry.Changes as AuditSnapshotChanges).snapshot : null;
        if (entry.EntityType === 'mediatag' && createdSnapshot?.SetPrimary === true
            && Number(createdSnapshot.PersonId) === Number(current.PersonId)) {
            await exec(
                `UPDATE "MediaLink" SET "IsPrimary" = 0
                 WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "MediaId" = $2 AND "IsPrimary" <> 0`,
                [current.PersonId, current.MediaId],
            );
        }
        const deleteResult = await exec(scopedDeleteSql(config, 1, 2, 3), [entry.EntityId, treeId, treeOwnerId]);
        if ((deleteResult.rowCount ?? 0) === 0) {
            throw new Error(`Record ${entry.EntityType} #${entry.EntityId} is outside the selected tree`);
        }

        // Audit as delete
        await exec(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'delete', $4, $5, $6, $7)`,
            [treeOwnerId, userId, treeId, entry.EntityType, entry.EntityId, entry.EntityLabel, JSON.stringify(dependents ? { snapshot: current, dependents } : { snapshot: current })]
        );

    } else if (entry.Action === 'delete') {
        // Revert a delete = re-insert from snapshot
        if (!('snapshot' in entry.Changes)) {
            throw new Error(`Audit entry #${entry.Id} has unexpected structure for delete action`);
        }
        const snapshot = (entry.Changes as AuditSnapshotChanges).snapshot;

        // Check that the original record doesn't already exist (prevents duplicate key)
        if (snapshot.Id != null) {
            const existing = await exec(
                `SELECT "Id" FROM ${config.table} WHERE "Id" = $1`,
                [snapshot.Id]
            );
            if (existing.rows.length > 0) {
                throw new Error(`A ${entry.EntityType} record already exists with ID ${snapshot.Id}; cannot restore`);
            }
        }

        const restoreSnapshot = { ...snapshot };
        if (restoreSnapshot.TreeId != null && restoreSnapshot.TreeId !== treeId) {
            throw new Error(`Audit entry #${entry.Id} has a mismatched tree scope; cannot restore`);
        }
        if (config.scope === 'user-tree' && restoreSnapshot.TreeId == null) {
            // Keep the legacy fallback for entities whose pre-multi-tree audit
            // snapshots never carried a TreeId. New owner-scoped entities fail
            // closed below because their historical scope cannot be proven.
            restoreSnapshot.TreeId = treeId;
        }

        if (config.scope === 'owner-tree' && (
            restoreSnapshot.OwnerId !== treeOwnerId || restoreSnapshot.TreeId !== treeId
        )) {
            throw new Error(`Audit entry #${entry.Id} has insufficient ownership scope; cannot restore`);
        }
        if (config.scope === 'user-tree' && restoreSnapshot.UserId !== treeOwnerId) {
            throw new Error(`Audit entry #${entry.Id} has insufficient ownership scope; cannot restore`);
        }

        if (config.scope === 'media-tree') {
            if (restoreSnapshot.MediaId == null || restoreSnapshot.PersonId == null) {
                throw new Error(`Audit entry #${entry.Id} has incomplete MediaTag scope; cannot restore`);
            }
            await assertMediaTagRelationships(
                restoreSnapshot.MediaId,
                restoreSnapshot.PersonId,
                treeId,
                treeOwnerId,
                executor,
            );
        }
        if (entry.EntityType === 'citation') {
            await assertCitationRelationships(
                restoreSnapshot.SourceId,
                restoreSnapshot.FactTable,
                restoreSnapshot.FactId,
                treeId,
                treeOwnerId,
                executor,
            );
        }
        if (entry.EntityType === 'namevariant') {
            await assertNameVariantRelationship(restoreSnapshot.PersonId, treeId, treeOwnerId, executor);
        }
        if (entry.EntityType === 'source') {
            restoreSnapshot.Author = foldToldBy(
                (restoreSnapshot.Author as string | null | undefined) ?? null,
                restoreSnapshot.ToldBy as string | null | undefined,
            );
            await assertSourceRelationships(restoreSnapshot.RepositoryId, treeId, treeOwnerId, executor);
        }

        // Include the entity's actual scope columns and preserve its Id. MediaTag
        // has neither owner column nor TreeId; its MediaId/PersonId relationship
        // is the scope instead.
        const scopeFields = config.scope === 'media-tree'
            ? ['Id', 'MediaId', 'PersonId']
            : ['Id', config.scope === 'owner-tree' ? 'OwnerId' : 'UserId', 'TreeId'];
        const insertFields = [...new Set([
            ...scopeFields,
            ...(config.requiredRestoreFields ?? []),
            ...(config.restoreFields ?? Array.from(config.allowedFields)),
        ])]
            .filter(f => Object.prototype.hasOwnProperty.call(restoreSnapshot, f) && restoreSnapshot[f] !== undefined);
        // The row's places go back by reference (ADR 0037): the place each fact pointed
        // at while it still spells the recorded text, else the text matched again.
        const placeFields = placeFieldsOf(config);
        const placeColumns = await revertedPlaceColumns(
            executor, treeId, treeOwnerId,
            placeFields.map((f) => ({ field: f, text: (restoreSnapshot[f] as string | null | undefined) ?? null, ref: snapshotPlaceRef(restoreSnapshot, f) })),
        );
        const plainFields = insertFields.filter((f) => !placeFields.includes(f as FactPlaceField));
        const values = [...plainFields.map(f => restoreSnapshot[f]), ...placeColumns.map(([, v]) => v)];
        const placeholders = values.map((_, i) => `$${i + 1}`);
        const quotedFields = [...plainFields.map(f => `"${f}"`), ...placeColumns.map(([c]) => c)];

        await exec(
            `INSERT INTO ${config.table} (${quotedFields.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${placeholders.join(', ')})`,
            values
        );

        // Audit as create with the restored EntityId
        const restoredId = (snapshot.Id as number) ?? entry.EntityId;

        // A person's name variants, face tags, case, note and media links (#788).
        // Entries written before #788 have no dependents and restore the row alone.
        const dependents = (entry.Changes as AuditSnapshotChanges).dependents;
        if (entry.EntityType === 'person' && dependents !== undefined) {
            if (!isPersonDependents(dependents)) {
                throw new Error(`Audit entry #${entry.Id} has malformed dependents; cannot restore`);
            }
            await restorePersonDependents(executor, restoredId, treeId, treeOwnerId, dependents);
        }
        await exec(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'create', $4, $5, $6, $7)`,
            [treeOwnerId, userId, treeId, entry.EntityType, restoredId, entry.EntityLabel, JSON.stringify({ snapshot: restoreSnapshot })]
        );
    }
}

/**
 * Revert a profile-picture change (#1044): the person gets the entry's earlier
 * primary back, or none. The photo stays linked to them either way; only the
 * choice is undone. The trail entry carries `revertOf`, like a place revert's.
 */
async function revertCanonicalPrimary(
    entry: AuditLogEntry,
    treeId: number,
    treeOwnerId: number,
    userId: number,
    executor: AuditExecutor,
): Promise<void> {
    const changes = entry.Changes as {
        personId?: unknown;
        fields?: { CanonicalPrimaryMediaId?: { old?: unknown } };
    };
    const personId = changes.personId;
    const earlier = changes.fields?.CanonicalPrimaryMediaId?.old;
    if (typeof personId !== 'number' || !(earlier === null || typeof earlier === 'number')) {
        throw new Error(`Audit entry #${entry.Id} is not a revertable profile picture change`);
    }
    const locked = await lockPeopleForMediaMutation([personId], treeId, executor);
    if (locked.length === 0) {
        throw new Error(`Audit entry #${entry.Id}: the person is no longer in this tree`);
    }
    if (earlier != null) {
        const media = await executor.query(
            `SELECT 1 FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2`,
            [earlier, treeId],
        );
        if (media.rows.length === 0) {
            throw new Error(`Audit entry #${entry.Id}: the earlier profile picture no longer exists`);
        }
    }
    const current = await getPrimaryMediaLinkForPerson(personId, treeId, executor);
    await clearPrimaryMediaLinksForPerson(personId, executor);
    if (earlier != null) {
        await upsertMediaLink({ mediaId: earlier, ownerTable: 'People', ownerId: personId }, executor);
        await setPrimaryMediaLink(earlier, personId, executor);
    }
    await executor.query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $2, $3, 'update', 'media', $4, $5, $6)`,
        [
            treeOwnerId, userId, treeId, entry.EntityId, `Reverted: ${entry.EntityLabel ?? ''}`.trim(),
            JSON.stringify({
                summary: { kind: 'canonical_primary' },
                personId,
                fields: { CanonicalPrimaryMediaId: { old: current, new: earlier } },
                snapshot: { revertOf: entry.Id },
            }),
        ],
    );
}

/**
 * Revert a family photo choice (#119, ADR 0047): the family gets its earlier photo
 * back, or none. The photos stay linked either way; only the choice is undone.
 */
async function revertFamilyPhoto(
    entry: AuditLogEntry,
    treeId: number,
    treeOwnerId: number,
    userId: number,
    executor: AuditExecutor,
): Promise<void> {
    const changes = entry.Changes as {
        familyId?: unknown;
        fields?: { FamilyPhotoMediaId?: { old?: unknown } };
    };
    const familyId = changes.familyId;
    const earlier = changes.fields?.FamilyPhotoMediaId?.old;
    if (typeof familyId !== 'number' || !(earlier === null || typeof earlier === 'number')) {
        throw new Error(`Audit entry #${entry.Id} is not a revertable family photo change`);
    }
    if (!await lockFamilyForMediaMutation(familyId, treeId, executor)) {
        throw new Error(`Audit entry #${entry.Id}: the family is no longer in this tree`);
    }
    if (earlier != null) {
        const media = await executor.query(
            `SELECT 1 FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2`,
            [earlier, treeId],
        );
        if (media.rows.length === 0) {
            throw new Error(`Audit entry #${entry.Id}: the earlier family photo no longer exists`);
        }
    }
    const current = await getFamilyPhotoLink(familyId, treeId, executor);
    await clearFamilyPhotoLinks(familyId, executor);
    if (earlier != null) {
        await upsertMediaLink({ mediaId: earlier, ownerTable: 'Families', ownerId: familyId }, executor);
        await setFamilyPhotoLink(earlier, familyId, executor);
    }
    await executor.query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $2, $3, 'update', 'media', $4, $5, $6)`,
        [
            treeOwnerId, userId, treeId, entry.EntityId, `Reverted: ${entry.EntityLabel ?? ''}`.trim(),
            JSON.stringify({
                summary: { kind: FAMILY_PHOTO_SUMMARY },
                familyId,
                fields: { FamilyPhotoMediaId: { old: current, new: earlier } },
                snapshot: { revertOf: entry.Id },
            }),
        ],
    );
}

/**
 * Revert a child-link entry (#788): undo an add by removing the link, a removal
 * by re-adding it with its relationship type, a type change by restoring the
 * old type, and a move (#796) by moving the link back. Both the family and the
 * child must still be in this tree.
 */
async function revertFamilyChild(
    entry: AuditLogEntry,
    treeId: number,
    treeOwnerId: number,
    userId: number,
    executor: AuditExecutor,
): Promise<void> {
    const snap = (entry.Changes as { snapshot?: Record<string, unknown> } | null)?.snapshot;
    const familyId = snap?.FamilyId;
    const childId = snap?.ChildId;
    if (!Number.isInteger(familyId) || !Number.isInteger(childId) || familyId !== entry.EntityId) {
        throw new Error(`Audit entry #${entry.Id} is not a revertable child link`);
    }
    if (snap?.TreeId != null && snap.TreeId !== treeId) {
        throw new Error(`Audit entry #${entry.Id} has a mismatched tree scope; cannot revert`);
    }
    const inTree = await executor.query(
        `SELECT 1
         FROM "Families" f
         JOIN "People" p ON p."Id" = $2 AND p."TreeId" = f."TreeId" AND p."UserId" = f."UserId"
         WHERE f."Id" = $1 AND f."TreeId" = $3 AND f."UserId" = $4`,
        [familyId, childId, treeId, treeOwnerId],
    );
    if (inTree.rows.length === 0) {
        throw new Error('Child link is not in the selected tree');
    }
    const currentResult = await executor.query(
        `SELECT "Partner1Relationship", "Partner2Relationship" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
        [familyId, childId],
    );
    const current = currentResult.rows[0] as { Partner1Relationship: string; Partner2Relationship: string } | undefined;
    const link = { FamilyId: familyId, ChildId: childId, TreeId: treeId };
    const typeOf = (value: unknown): string => {
        if (value == null) return 'Birth';
        // The columns are unchecked TEXT, so a revert writes only values in the set.
        if (!isChildRelationshipType(value)) throw new Error(`Audit entry #${entry.Id} has a malformed relationship type`);
        return value;
    };
    // An entry from before #982 holds one `RelationshipType` for both partners.
    const legacy = snap?.RelationshipType;
    const snapshotPair = {
        Partner1Relationship: typeOf(snap?.Partner1Relationship ?? legacy),
        Partner2Relationship: typeOf(snap?.Partner2Relationship ?? legacy),
    };

    let action: 'create' | 'delete' | 'update';
    let changes: unknown;
    if (entry.Action === 'create') {
        if (!current) throw new Error(`Child link on family #${familyId} no longer exists`);
        await executor.query(
            `DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
            [familyId, childId],
        );
        action = 'delete';
        changes = { snapshot: { ...link, ...current } };
    } else if (entry.Action === 'delete') {
        if (current) throw new Error(`The child is already in family #${familyId}; cannot restore`);
        await executor.query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId", "Partner1Relationship", "Partner2Relationship") VALUES ($1, $2, $3, $4)`,
            [familyId, childId, snapshotPair.Partner1Relationship, snapshotPair.Partner2Relationship],
        );
        action = 'create';
        changes = { snapshot: { ...link, ...snapshotPair } };
    } else if ((entry.Changes as AuditFieldChanges).fields?.FamilyId) {
        // A move (#796): the link now sits in this family; put it back in the old one.
        const move = (entry.Changes as AuditFieldChanges).fields.FamilyId;
        const fromFamilyId = move.old;
        if (!Number.isInteger(fromFamilyId) || move.new !== familyId || fromFamilyId === familyId) {
            throw new Error(`Audit entry #${entry.Id} is not a revertable child move`);
        }
        const fromInTree = await executor.query(
            `SELECT 1 FROM "Families" WHERE "Id" = $1 AND "TreeId" = $2 AND "UserId" = $3`,
            [fromFamilyId, treeId, treeOwnerId],
        );
        if (fromInTree.rows.length === 0) throw new Error(`Family #${fromFamilyId} is not in the selected tree`);
        if (!current) throw new Error(`Child link on family #${familyId} no longer exists`);
        const back = await executor.query(
            `SELECT 1 FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
            [fromFamilyId, childId],
        );
        if (back.rows.length > 0) throw new Error(`The child is already in family #${fromFamilyId}; cannot move back`);
        await executor.query(
            `DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
            [familyId, childId],
        );
        await executor.query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId", "Partner1Relationship", "Partner2Relationship") VALUES ($1, $2, $3, $4)`,
            [fromFamilyId, childId, current.Partner1Relationship, current.Partner2Relationship],
        );
        await executor.query(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'update', 'familychild', $4, $5, $6)`,
            [treeOwnerId, userId, treeId, fromFamilyId, entry.EntityLabel, JSON.stringify({
                fields: { FamilyId: { old: familyId, new: fromFamilyId } },
                snapshot: { FamilyId: fromFamilyId, ChildId: childId, TreeId: treeId, ...current },
            })],
        );
        return;
    } else {
        const fields = (entry.Changes as AuditFieldChanges).fields ?? {};
        // A pre-#982 entry changed one type, which applied to both partners.
        const legacyField = fields.RelationshipType;
        const partner1Field = fields.Partner1Relationship ?? legacyField;
        const partner2Field = fields.Partner2Relationship ?? legacyField;
        if (!partner1Field && !partner2Field) throw new Error(`Audit entry #${entry.Id} has no revertible fields`);
        if (!current) throw new Error(`Child link on family #${familyId} no longer exists`);
        const restored = {
            Partner1Relationship: partner1Field ? typeOf(partner1Field.old) : current.Partner1Relationship,
            Partner2Relationship: partner2Field ? typeOf(partner2Field.old) : current.Partner2Relationship,
        };
        await executor.query(
            `UPDATE "FamilyPerson" SET "Partner1Relationship" = $1, "Partner2Relationship" = $2 WHERE "FamiliesAsChildId" = $3 AND "ChildrenId" = $4`,
            [restored.Partner1Relationship, restored.Partner2Relationship, familyId, childId],
        );
        action = 'update';
        const revertFields: Record<string, { old: unknown; new: unknown }> = {};
        for (const key of ['Partner1Relationship', 'Partner2Relationship'] as const) {
            if (current[key] !== restored[key]) revertFields[key] = { old: current[key], new: restored[key] };
        }
        changes = { fields: revertFields, snapshot: { ...link, ...restored } };
    }

    await executor.query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $2, $3, $4, 'familychild', $5, $6, $7)`,
        [treeOwnerId, userId, treeId, action, familyId, entry.EntityLabel, JSON.stringify(changes)],
    );
}

/** A note entry's snapshot, checked field by field before a revert trusts it (#1045). */
function noteSnapshotOf(entry: AuditLogEntry, treeId: number): NoteAuditSnapshot {
    const snap = (entry.Changes as { snapshot?: Record<string, unknown> } | null)?.snapshot;
    const bad = () => new Error(`Audit entry #${entry.Id} is not a revertable note change`);
    if (!snap) throw bad();
    const { NoteId, NoteOwnerId, RecordId, OwnerTable, Text, Links } = snap;
    if (!Number.isInteger(NoteId) || NoteId !== entry.EntityId || !Number.isInteger(RecordId) || !Number.isInteger(NoteOwnerId)) throw bad();
    if (typeof OwnerTable !== 'string' || !isLinkOwnerTable(OwnerTable)) throw bad();
    if (typeof Text !== 'string' || !Array.isArray(Links) || Links.length === 0) throw bad();
    if (snap.TreeId !== treeId) {
        throw new Error(`Audit entry #${entry.Id} has a mismatched tree scope; cannot revert`);
    }
    const facts = new Set<unknown>([null, ...NOTE_OWNER_FACTS]);
    const links = Links.map((l) => {
        const link = l as Record<string, unknown> | null;
        if (!link || !facts.has(link.OwnerFact ?? null)) throw bad();
        return {
            OwnerFact: (link.OwnerFact ?? null) as NoteAuditSnapshot['Links'][number]['OwnerFact'],
            IsPrimary: link.IsPrimary === 1 ? 1 : 0,
            AddedInApp: link.AddedInApp === 1 ? 1 : 0,
        };
    });
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
        NoteId: NoteId as number,
        TreeId: treeId,
        NoteOwnerId: NoteOwnerId as number,
        Text,
        GedcomXref: text(snap.GedcomXref),
        CreatedAt: text(snap.CreatedAt),
        UpdatedAt: text(snap.UpdatedAt),
        OwnerTable,
        RecordId: RecordId as number,
        Links: links,
    };
}

/**
 * Revert a note entry (#1045): undo an add by removing the note's links to the
 * record (and the note, once nothing else links it), a delete by restoring the
 * note and its links, a text edit by restoring the old text, and a preferred-note
 * change by restoring the link's flag. The record must still be in this tree.
 */
async function revertNote(
    entry: AuditLogEntry,
    treeId: number,
    treeOwnerId: number,
    userId: number,
    executor: AuditExecutor,
): Promise<void> {
    const snap = noteSnapshotOf(entry, treeId);
    if (snap.NoteOwnerId !== treeOwnerId) {
        throw new Error(`Audit entry #${entry.Id} has insufficient ownership scope; cannot modify`);
    }
    // OwnerTable passed the isLinkOwnerTable whitelist in noteSnapshotOf.
    const record = await executor.query(`SELECT 1 FROM "${snap.OwnerTable}" WHERE "Id" = $1 AND "TreeId" = $2`, [snap.RecordId, treeId]);
    if (record.rows.length === 0) {
        throw new Error('The note\'s record is not in the selected tree');
    }
    const noteResult = await executor.query(
        `SELECT "Id", "TreeId", "OwnerId", "Text" FROM "Note" WHERE "Id" = $1`,
        [snap.NoteId],
    );
    const note = noteResult.rows[0] as { TreeId: number | null; OwnerId: number; Text: string } | undefined;
    if (note && (note.TreeId !== treeId || note.OwnerId !== treeOwnerId)) {
        throw new Error('Note is not in the selected tree');
    }
    const linkCount = async () => {
        const r = await executor.query(
            `SELECT COUNT(*)::int AS n FROM "NoteLink" WHERE "NoteId" = $1 AND "OwnerTable" = $2 AND "OwnerId" = $3`,
            [snap.NoteId, snap.OwnerTable, snap.RecordId],
        );
        return Number((r.rows[0] as { n: number }).n);
    };

    let action: 'create' | 'delete' | 'update';
    let changes: unknown;
    if (entry.Action === 'create') {
        if (!note || (await linkCount()) === 0) throw new Error(`Note #${snap.NoteId} is no longer on this record`);
        await executor.query(
            `DELETE FROM "NoteLink" WHERE "NoteId" = $1 AND "OwnerTable" = $2 AND "OwnerId" = $3`,
            [snap.NoteId, snap.OwnerTable, snap.RecordId],
        );
        await executor.query(
            `DELETE FROM "Note" n WHERE n."Id" = $1 AND n."TreeId" = $2
               AND NOT EXISTS (SELECT 1 FROM "NoteLink" l WHERE l."NoteId" = n."Id")`,
            [snap.NoteId, treeId],
        );
        action = 'delete';
        changes = { snapshot: { ...snap, Text: note.Text } };
    } else if (entry.Action === 'delete') {
        if (note && (await linkCount()) > 0) throw new Error(`Note #${snap.NoteId} is already on this record; cannot restore`);
        if (!note) {
            await executor.query(
                `INSERT INTO "Note" ("Id", "OwnerId", "TreeId", "Text", "GedcomXref", "CreatedAt", "UpdatedAt")
                 VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP), COALESCE($7::timestamptz, $6::timestamptz, CURRENT_TIMESTAMP))`,
                [snap.NoteId, treeOwnerId, treeId, snap.Text, snap.GedcomXref, snap.CreatedAt, snap.UpdatedAt],
            );
        }
        // The record may have a new preferred note since; it keeps it.
        const primary = await executor.query(
            `SELECT 1 FROM "NoteLink" WHERE "OwnerTable" = $1 AND "OwnerId" = $2 AND "IsPrimary" = 1`,
            [snap.OwnerTable, snap.RecordId],
        );
        let primaryFree = primary.rows.length === 0;
        for (const link of snap.Links) {
            const isPrimary = link.IsPrimary === 1 && primaryFree ? 1 : 0;
            if (isPrimary) primaryFree = false;
            await executor.query(
                `INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "OwnerFact", "IsPrimary", "AddedInApp")
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [snap.NoteId, snap.OwnerTable, snap.RecordId, link.OwnerFact, isPrimary, link.AddedInApp],
            );
        }
        action = 'create';
        changes = { snapshot: { ...snap, Text: note?.Text ?? snap.Text } };
    } else {
        const fields = (entry.Changes as AuditFieldChanges).fields ?? {};
        if (!note || (await linkCount()) === 0) throw new Error(`Note #${snap.NoteId} is no longer on this record`);
        if (fields.Text) {
            if (typeof fields.Text.old !== 'string' || !fields.Text.old.trim()) {
                throw new Error(`Audit entry #${entry.Id} has a malformed note text`);
            }
            await executor.query(
                `UPDATE "Note" SET "Text" = $1, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $2 AND "TreeId" = $3`,
                [fields.Text.old, snap.NoteId, treeId],
            );
            action = 'update';
            changes = { fields: { Text: { old: note.Text, new: fields.Text.old } }, snapshot: { ...snap, Text: fields.Text.old } };
        } else if (fields.IsPrimary) {
            const flag = fields.IsPrimary.old === 1 ? 1 : 0;
            if (flag === 1) {
                const other = await executor.query(
                    `SELECT 1 FROM "NoteLink"
                     WHERE "OwnerTable" = $1 AND "OwnerId" = $2 AND "IsPrimary" = 1 AND "NoteId" <> $3`,
                    [snap.OwnerTable, snap.RecordId, snap.NoteId],
                );
                if (other.rows.length > 0) throw new Error('Another note is now preferred on this record');
            }
            await executor.query(
                `UPDATE "NoteLink" SET "IsPrimary" = $1 WHERE "NoteId" = $2 AND "OwnerTable" = $3 AND "OwnerId" = $4`,
                [flag, snap.NoteId, snap.OwnerTable, snap.RecordId],
            );
            action = 'update';
            changes = { fields: { IsPrimary: { old: fields.IsPrimary.new, new: flag } }, snapshot: snap };
        } else if (fields.OwnerFact) {
            // A note moved between facts on one record (ADR 0043): move it back.
            const fact = (v: unknown) => (v == null ? null : (NOTE_OWNER_FACTS as readonly unknown[]).includes(v) ? v as string : undefined);
            const was = fact(fields.OwnerFact.old);
            const now = fact(fields.OwnerFact.new);
            if (was === undefined || now === undefined) throw new Error(`Audit entry #${entry.Id} has a malformed note scope`);
            const moved = await executor.query(
                `UPDATE "NoteLink" SET "OwnerFact" = $1
                 WHERE "NoteId" = $2 AND "OwnerTable" = $3 AND "OwnerId" = $4 AND COALESCE("OwnerFact", '') = COALESCE($5, '')`,
                [was, snap.NoteId, snap.OwnerTable, snap.RecordId, now],
            );
            if ((moved.rowCount ?? 0) === 0) throw new Error(`Note #${snap.NoteId} has moved again since`);
            action = 'update';
            changes = {
                fields: { OwnerFact: { old: now, new: was } },
                snapshot: { ...snap, Links: snap.Links.map((l) => (l.OwnerFact === now ? { ...l, OwnerFact: was as NoteAuditSnapshot['Links'][number]['OwnerFact'] } : l)) },
            };
        } else {
            throw new Error(`Audit entry #${entry.Id} has no revertible fields`);
        }
    }

    await executor.query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $2, $3, $4, 'note', $5, $6, $7)`,
        [treeOwnerId, userId, treeId, action, snap.NoteId, entry.EntityLabel, JSON.stringify(changes)],
    );
}

/**
 * A strike's snapshot (#1251). The edits and deletes #1227 logged no longer revert:
 * the journal is append-only (ADR 0042), so putting old text back or bringing a
 * deleted entry back would change it again. They still display in the log.
 */
function caseNoteStrikeOf(entry: AuditLogEntry, treeId: number): CaseNoteStrikeSnapshot {
    const snap = (entry.Changes as Partial<AuditSnapshotChanges>).snapshot as Partial<CaseNoteStrikeSnapshot> | undefined;
    if (!snap || typeof snap.struck !== 'boolean') {
        throw new ValidationError('Journal entries are append-only, so this change to one can\'t be reverted');
    }
    if (typeof snap.CommentId !== 'number' || typeof snap.CaseId !== 'number' || !snap.before || typeof snap.before !== 'object') {
        throw new Error(`Audit entry #${entry.Id} is not a revertable strike-out`);
    }
    if (snap.TreeId !== treeId || snap.CommentId !== entry.EntityId) {
        throw new Error(`Audit entry #${entry.Id} is not in the selected tree`);
    }
    return snap as CaseNoteStrikeSnapshot;
}

/**
 * Revert a strike or an undone strike (#1251): the note's marker goes back to what
 * it was, logged as a strike change of its own so the revert can be undone in turn.
 */
async function revertCaseNote(
    entry: AuditLogEntry,
    treeId: number,
    treeOwnerId: number,
    userId: number,
    executor: AuditExecutor,
): Promise<void> {
    const exec = { query: (sql: string, params: unknown[]) => executor.query(sql, params) };
    const snap = caseNoteStrikeOf(entry, treeId);
    const { StruckAt, StruckBy, StruckReason } = snap.before;
    const changed = await setCaseNoteStrike(exec, treeId, snap.CaseId, snap.CommentId,
        StruckAt === null ? null : { at: StruckAt, by: StruckBy, reason: StruckReason });
    await executor.query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $2, $3, 'update', 'casenote', $4, $5, $6)`,
        [treeOwnerId, userId, treeId, snap.CommentId, entry.EntityLabel, JSON.stringify({ snapshot: changed })],
    );
}

/**
 * Revert a single audit entry (public API). `treeId` scopes the entry lookup;
 * `treeOwnerId` (the tree's owning user) keys the defense-in-depth edit check
 * and the revert-audit rows.
 */
export async function revertAuditEntry(id: number, treeId: number, treeOwnerId: number, userId: number): Promise<void> {
    if (!(await hasEditPermission(treeOwnerId, userId, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const entry = await getAuditEntryById(id, treeId);
    if (!entry) throw new Error('Audit entry not found');

    // Wrap in a transaction so a multi-statement revert (e.g. a place merge:
    // recreate gazetteer row + re-point children + re-null fields + rewrite N
    // records + trail marker) is atomic — a mid-way failure rolls back cleanly
    // instead of leaving a half-reverted record.
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await revertSingleEntry(entry, treeOwnerId, userId, client);
        await client.query('COMMIT');
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Revert multiple audit entries in a transaction (newest first).
 */
export async function revertAuditEntries(ids: number[], treeId: number, treeOwnerId: number, userId: number): Promise<number> {
    if (!(await hasEditPermission(treeOwnerId, userId, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    // Fetch all entries and sort newest first (tree-scoped)
    const result = await query(
        // "Id" tiebreaker: CURRENT_TIMESTAMP is transaction-stable, so multiple
        // audit rows from one transaction share a CreatedAt — without the
        // tiebreaker a batch revert could apply same-timestamp rows in
        // arbitrary order.
        `SELECT * FROM "AuditLog" WHERE "Id" = ANY($1) AND "TreeId" = $2 ORDER BY "CreatedAt" DESC, "Id" DESC`,
        [ids, treeId]
    );
    const entries = result.rows as AuditLogEntry[];

    const requestedIds = new Set(ids);
    if (entries.length === 0) throw new Error('No valid audit entries found');
    if (entries.length !== requestedIds.size) {
        throw new Error('Every audit entry must belong to the selected tree');
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');
        for (const entry of entries) {
            await revertSingleEntry(entry, treeOwnerId, userId, client);
        }
        await client.query('COMMIT');
        return entries.length;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Revert audit entries inside the caller's transaction, newest first: Undo on a
 * closed case (#58, ADR 0046) puts back what Answer and close changed. The caller
 * checks permission and locks what it needs; each revert is logged as usual.
 */
export async function revertAuditEntriesWith(
    exec: AuditExecutor,
    ids: number[],
    treeId: number,
    treeOwnerId: number,
    userId: number,
): Promise<void> {
    if (ids.length === 0) return;
    const result = await exec.query(
        `SELECT * FROM "AuditLog" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2 ORDER BY "CreatedAt" DESC, "Id" DESC`,
        [ids, treeId],
    );
    const entries = result.rows as AuditLogEntry[];
    if (entries.length !== new Set(ids).size) throw new Error('Audit entry not found');
    for (const entry of entries) await revertSingleEntry(entry, treeOwnerId, userId, exec);
}
