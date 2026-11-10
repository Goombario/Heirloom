import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { factPlaceRefChanges, factPlaceRefs, factPlaceTextColumns, factPlaceTextSql, factPlaceColumnFor, type FactPlacePick } from './place-links';

/** A family's marriage place text, built from its references (ADR 0037). */
const familyPlace = (alias: string) => factPlaceTextColumns('families', alias);
/** A person's birth and death place text. */
const personPlaces = (alias: string) => factPlaceTextColumns('people', alias);
import type { Family, NewFamily, FamilyWithRelations, FamilyEndedReason, Person } from '../schema';
import { hasEditPermission } from './sharing';
import { auditCreate, auditUpdate, auditDelete, auditFamilyChild, auditFamilyChildMove, withAuditIds, type Audited, type Queryable } from './audit-capture';
import { effectiveFirstName, primaryNickname, integratedFullName } from './people';
import { primaryPhotoJoin } from './media-tags';
import { likeContains } from './like-pattern';
import { liveChildLinkSql } from '@/lib/db/queries/live-owner';
import { childRelationshipsOf, type ChildRelationshipInput, type ChildRelationships } from '@/lib/child-relationship';

/**
 * Get all families in a specific tree
 */
export async function getAllFamilies(treeId: number): Promise<Family[]> {
    const result = await query(
        `SELECT f.*, ${familyPlace('f')} FROM "Families" f WHERE f."TreeId" = $1 ORDER BY f."Id"`,
        [treeId]
    );
    return result.rows as Family[];
}

export interface FamilyWithSpouseNames extends Family {
    /** Derived ended status — from an explicit end-event (divorce/annulment/separation),
     *  not a stored column. Death-endings stay derived from partner DeathDate on the client. */
    EndedDate: string | null;
    EndedReason: FamilyEndedReason | null;
    husbandName: string | null;
    wifeName: string | null;
    /** The partners' surnames, for the couple name and the surname sort (#1064).
     *  getAllFamiliesWithSpouses only. */
    partner1LastName?: string | null;
    partner2LastName?: string | null;
    childCount: number;
    youngDeathCount: number;
    /** Count of citable facts: the partnership record + each family event. */
    TotalFacts: number;
    /** Of those facts, how many have at least one citation. */
    SourcedFacts: number;
    husbandMediaId: number | null;
    husbandFocalX: number | null;
    husbandFocalY: number | null;
    husbandFocalRadius: number | null;
    wifeMediaId: number | null;
    wifeFocalX: number | null;
    wifeFocalY: number | null;
    wifeFocalRadius: number | null;
    // Phase 9 aliases
    partner1Sex: string | null;
    partner2Sex: string | null;
    partner1DeathDate: string | null;
    partner2DeathDate: string | null;
    /** searchFamilies only (#796). */
    partner1BirthDate?: string | null;
    partner2BirthDate?: string | null;
    // R3 — sequential marriage rank: position-of-N for each partner.
    // 1-based; null when the partner is missing on this row.
    partner1MarriageRank: number | null;
    partner1MarriageTotal: number | null;
    partner2MarriageRank: number | null;
    partner2MarriageTotal: number | null;
}

/**
 * Get all families with spouse names included, scoped to a tree.
 * Computes sequential-marriage rank per partner (e.g. "1 of 2" for remarriages),
 * young-child-death counts, and exposes Type/EndedDate/EndedReason for filter chips.
 * Scope predicates filter "TreeId"; row-to-row joins (e.g. media ownership,
 * the end-event lateral join) stay keyed on the owner columns both rows carry.
 */
export async function getAllFamiliesWithSpouses(treeId: number): Promise<FamilyWithSpouseNames[]> {
    const result = await query(
        `WITH base AS (
            SELECT
                -- Named, not f.*: the window sort below would carry the notes and raw
                -- GEDCOM columns of every family for a list that shows none (#1270).
                f."Id", f."UserId", f."TreeId", f."Partner1Id", f."Partner2Id", f."HusbandId", f."WifeId",
                f."MarriageDate", f."MarriagePlaceId", f."Type", f."UpdatedAt", ${familyPlace('f')},
                COALESCE(f."Partner1Id", f."HusbandId") AS "p1Id",
                COALESCE(f."Partner2Id", f."WifeId") AS "p2Id"
            FROM "Families" f
            WHERE f."TreeId" = $1
        ),
        ranked AS (
            SELECT
                b.*,
                ROW_NUMBER() OVER (
                    PARTITION BY b."p1Id"
                    ORDER BY COALESCE(b."MarriageDate", ''), b."Id"
                ) AS "p1Rank",
                COUNT(*) OVER (PARTITION BY b."p1Id") AS "p1Total",
                ROW_NUMBER() OVER (
                    PARTITION BY b."p2Id"
                    ORDER BY COALESCE(b."MarriageDate", ''), b."Id"
                ) AS "p2Rank",
                COUNT(*) OVER (PARTITION BY b."p2Id") AS "p2Total"
            FROM base b
        ),
        child_counts AS (
            SELECT fp."FamiliesAsChildId" AS family_id,
                   COUNT(*)::int AS child_count,
                   COUNT(*) FILTER (
                       WHERE cp."BirthDate" IS NOT NULL AND cp."DeathDate" IS NOT NULL
                         AND "SortableYear"(cp."DeathDate") - "SortableYear"(cp."BirthDate") < 18
                   )::int AS young_death_count
              FROM "FamilyPerson" fp
              -- Inner join: a deleted child's stranded link doesn't count (#881).
              JOIN "People" cp ON cp."Id" = fp."ChildrenId"
             WHERE fp."FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "TreeId" = $1)
             GROUP BY fp."FamiliesAsChildId"
        ),
        family_event_agg AS (
            SELECT ev."FamilyId" AS family_id,
                   COUNT(*)::int AS event_count,
                   COUNT(*) FILTER (WHERE ec."FactId" IS NOT NULL)::int AS sourced_event_count
              FROM "Events" ev
              LEFT JOIN (
                  SELECT DISTINCT c."FactId" FROM "Citation" c
                   WHERE c."TreeId" = $1 AND c."FactTable" = 'Events'
              ) ec ON ec."FactId" = ev."Id"
             WHERE ev."TreeId" = $1 AND ev."FamilyId" IS NOT NULL
             GROUP BY ev."FamilyId"
        ),
        family_citation_agg AS (
            SELECT c."FactId" AS family_id, true AS has_marriage_citation
              FROM "Citation" c
             WHERE c."TreeId" = $1 AND c."FactTable" IN ('Families', 'FamilyMarriage')
             GROUP BY c."FactId"
        )
        SELECT
            r."Id", r."UserId", r."Partner1Id", r."Partner2Id", r."HusbandId", r."WifeId",
            r."MarriageDate", r."MarriagePlace", r."Type", r."UpdatedAt",
            -- Ended status is derived from an explicit end-event (divorce/annulment/
            -- separation). Death-endings stay derived from partner DeathDate on the client.
            ee."endDate" AS "EndedDate",
            CASE ee."endType"
                WHEN 'DIV' THEN 'Divorce'
                WHEN 'DIVF' THEN 'Divorce'
                WHEN 'ANUL' THEN 'Annulment'
                WHEN 'SEPA' THEN 'Separation'
                ELSE NULL
            END AS "EndedReason",
            CASE WHEN p1."Id" IS NOT NULL THEN ${integratedFullName('p1')} ELSE NULL END AS "husbandName",
            CASE WHEN p2."Id" IS NOT NULL THEN ${integratedFullName('p2')} ELSE NULL END AS "wifeName",
            p1."LastName" AS "partner1LastName",
            p2."LastName" AS "partner2LastName",
            p1."Sex" AS "partner1Sex",
            p2."Sex" AS "partner2Sex",
            p1."DeathDate" AS "partner1DeathDate",
            p2."DeathDate" AS "partner2DeathDate",
            COALESCE(cc.child_count, 0) AS "childCount",
            COALESCE(cc.young_death_count, 0) AS "youngDeathCount",
            -- Total citable facts: the partnership record (marriage/ended) + each family event.
            (CASE WHEN (r."MarriageDate" IS NOT NULL OR r."MarriagePlaceId" IS NOT NULL) THEN 1 ELSE 0 END
             + COALESCE(fea.event_count, 0)) AS "TotalFacts",
            -- Of those facts, how many have at least one citation.
            (CASE WHEN (r."MarriageDate" IS NOT NULL OR r."MarriagePlaceId" IS NOT NULL) AND COALESCE(fca.has_marriage_citation, false) THEN 1 ELSE 0 END
             + COALESCE(fea.sourced_event_count, 0)) AS "SourcedFacts",
            p1m."Id" AS "husbandMediaId", p1m."FocalX" AS "husbandFocalX", p1m."FocalY" AS "husbandFocalY", p1m."FocalRadius" AS "husbandFocalRadius",
            p2m."Id" AS "wifeMediaId", p2m."FocalX" AS "wifeFocalX", p2m."FocalY" AS "wifeFocalY", p2m."FocalRadius" AS "wifeFocalRadius",
            CASE WHEN r."p1Id" IS NULL THEN NULL ELSE r."p1Rank"::int END AS "partner1MarriageRank",
            CASE WHEN r."p1Id" IS NULL THEN NULL ELSE r."p1Total"::int END AS "partner1MarriageTotal",
            CASE WHEN r."p2Id" IS NULL THEN NULL ELSE r."p2Rank"::int END AS "partner2MarriageRank",
            CASE WHEN r."p2Id" IS NULL THEN NULL ELSE r."p2Total"::int END AS "partner2MarriageTotal"
        FROM ranked r
        LEFT JOIN "People" p1 ON r."p1Id" = p1."Id"
        LEFT JOIN "People" p2 ON r."p2Id" = p2."Id"
        LEFT JOIN child_counts cc ON cc.family_id = r."Id"
        LEFT JOIN family_event_agg fea ON fea.family_id = r."Id"
        LEFT JOIN family_citation_agg fca ON fca.family_id = r."Id"
        LEFT JOIN LATERAL (
            SELECT ev."Date" AS "endDate", ev."Type" AS "endType"
            FROM "Events" ev
            WHERE ev."UserId" = r."UserId" AND ev."FamilyId" = r."Id"
              AND ev."Type" IN ('DIV', 'DIVF', 'ANUL', 'SEPA')
            -- Sort by the shared year rule (#490, ADR 0016) so mixed date formats
            -- and qualifiers compare chronologically rather than lexically, and a
            -- phrase date — which has no year at all — sinks to the end instead of
            -- being ordered by a digit run inside its prose. Id breaks ties.
            ORDER BY "SortableYear"(ev."Date") DESC NULLS LAST, ev."Id" DESC
            LIMIT 1
        ) ee ON true
        ${primaryPhotoJoin('p1', 'r."TreeId"', 'p1m')}
        ${primaryPhotoJoin('p2', 'r."TreeId"', 'p2m')}
        ORDER BY r."Id"`,
        [treeId]
    );
    return result.rows as FamilyWithSpouseNames[];
}

/**
 * Get a single family by ID (tree-scoped)
 */
export async function getFamilyById(id: number, treeId: number): Promise<Family | null> {
    const result = await query(
        `SELECT f.*, ${familyPlace('f')} FROM "Families" f WHERE f."Id" = $1 AND f."TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as Family) || null;
}

/**
 * Get a family with all related data (husband, wife, children), tree-scoped
 */
export async function getFamilyWithRelations(id: number, treeId: number): Promise<FamilyWithRelations | null> {
    const family = await getFamilyById(id, treeId);
    if (!family) return null;

    const p1Id = family.Partner1Id;
    const p2Id = family.Partner2Id;

    // Get partner 1 (with primary media)
    let husband: (Person & { PrimaryMediaId?: number; FocalX?: number; FocalY?: number; FocalRadius?: number | null }) | null = null;
    if (p1Id) {
        const result = await query(
            `SELECT p.*, ${personPlaces('p')}, ${effectiveFirstName('p')} AS "EffectiveFirstName", ${primaryNickname('p')} AS "Nickname", m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
             FROM "People" p
             ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
             WHERE p."Id" = $1 AND p."TreeId" = $2`,
            [p1Id, treeId]
        );
        husband = result.rows[0] || null;
    }

    // Get partner 2 (with primary media)
    let wife: (Person & { PrimaryMediaId?: number; FocalX?: number; FocalY?: number; FocalRadius?: number | null }) | null = null;
    if (p2Id) {
        const result = await query(
            `SELECT p.*, ${personPlaces('p')}, ${effectiveFirstName('p')} AS "EffectiveFirstName", ${primaryNickname('p')} AS "Nickname", m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
             FROM "People" p
             ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
             WHERE p."Id" = $1 AND p."TreeId" = $2`,
            [p2Id, treeId]
        );
        wife = result.rows[0] || null;
    }

    // Get children (with primary media + their relationship to each partner)
    const childrenResult = await query(
        `SELECT p.*, ${personPlaces('p')}, ${effectiveFirstName('p')} AS "EffectiveFirstName", ${primaryNickname('p')} AS "Nickname", m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius", fp."Partner1Relationship", fp."Partner2Relationship"
         FROM "People" p
         INNER JOIN "FamilyPerson" fp ON p."Id" = fp."ChildrenId"
         ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
         WHERE fp."FamiliesAsChildId" = $1 AND p."TreeId" = $2
         ORDER BY p."BirthDate"`,
        [id, treeId]
    );
    const children = childrenResult.rows as (Person & { PrimaryMediaId?: number; FocalX?: number; FocalY?: number; FocalRadius?: number | null; Partner1Relationship?: string; Partner2Relationship?: string })[];

    return {
        ...family,
        husband,
        wife,
        children,
    };
}

/**
 * Create a new family
 */
export async function createFamily(data: NewFamily, actingUserId?: number, placePicks: readonly FactPlacePick[] = []): Promise<Audited<Family>> {
    // HusbandId/WifeId columns are kept in the DB for backward compat with any
    // historical readers; we mirror Partner1Id/Partner2Id into them at insert.
    const p1 = data.Partner1Id ?? null;
    const p2 = data.Partner2Id ?? null;
    // The marriage place, matched to the tree's places once, here.
    const places = data.TreeId != null
        ? await factPlaceRefs({ query }, data.TreeId, data.UserId, { MarriagePlace: data.MarriagePlace ?? null }, placePicks)
        : [];
    const values = [data.UserId, data.TreeId ?? null, p1, p2, data.MarriageDate, data.Type ?? 'Marriage', ...places.map(([, v]) => v)];
    const result = await query(
        `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id", "HusbandId", "WifeId", "MarriageDate", "Type", ${places.map(([c]) => `${c}, `).join('')}"UpdatedAt")
         VALUES ($1, $2, $3, $4, $3, $4, $5, $6, ${places.map((_, i) => `$${i + 7}, `).join('')}CURRENT_TIMESTAMP)
         RETURNING *, ${familyPlace('"Families"')}`,
        values
    );

    const newFamily = result.rows[0] as Family;
    if (!newFamily) {
        throw new Error('Failed to create family');
    }

    const auditId = await auditCreate('family', newFamily as unknown as Record<string, unknown>, data.UserId, actingUserId ?? data.UserId);

    return withAuditIds(newFamily, [auditId]);
}

const ALLOWED_FAMILY_FIELDS: ReadonlySet<string> = new Set([
    'Partner1Id', 'Partner2Id', 'MarriageDate', 'MarriagePlace', 'Type',
]);

/**
 * Update an existing family. Authorization = the tree-scoped SELECT (the row
 * must be in the caller's resolved tree) + the user-keyed edit check kept as
 * defense in depth. `actingUserId` defaults to the tree owner for callers that
 * predate the scope split.
 */
export async function updateFamily(id: number, data: Partial<NewFamily>, treeId: number, actingUserId?: number, placePicks: readonly FactPlacePick[] = []): Promise<Audited<Family>> {
    const family = await getFamilyById(id, treeId);
    if (!family) {
        throw new Error('Family not found');
    }

    const actor = actingUserId ?? family.UserId;
    if (!(await hasEditPermission(family.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const fields = Object.keys(data).filter(key => data[key as keyof NewFamily] !== undefined && key !== 'UserId' && key !== 'TreeId');
    for (const field of fields) {
        if (!ALLOWED_FAMILY_FIELDS.has(field)) {
            throw new Error(`Invalid field name: ${field}`);
        }
    }

    // Build the field list directly; HusbandId/WifeId DB columns are mirrored
    // below from any Partner1Id/Partner2Id update so legacy readers still see
    // current values.
    const normalizedData: Partial<NewFamily> = { ...data };
    const normalizedFields = Object.keys(normalizedData).filter(key => normalizedData[key as keyof NewFamily] !== undefined && key !== 'UserId' && key !== 'TreeId');
    // The marriage place is matched again only when its text changed or a place
    // was picked for it: an unchanged "Paris" stays on whichever Paris it points at.
    // A pick sent without the text applies to the text the fact shows now.
    const placeSent = normalizedFields.includes('MarriagePlace');
    const placePicked = placePicks.some((p) => p.kind === 'marriage');
    const placeChanged = placeSent ? normalizedData.MarriagePlace !== family.MarriagePlace || placePicked : placePicked;
    const placeText = placeSent ? normalizedData.MarriagePlace : family.MarriagePlace;
    const places = placeChanged
        ? await factPlaceRefs({ query }, treeId, family.UserId, { MarriagePlace: placeText ?? null }, placePicks)
        : [];
    const allowedNormalized = normalizedFields.filter(f => ALLOWED_FAMILY_FIELDS.has(f) && f !== 'MarriagePlace');

    if (allowedNormalized.length === 0 && places.length === 0) {
        await query(`UPDATE "Families" SET "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`, [id]);
    } else {
        const values: unknown[] = [];
        const setClauses = allowedNormalized.map((field, i) => {
            values.push(normalizedData[field as keyof NewFamily]);
            return `"${field}" = $${i + 1}`;
        });
        for (const [column, value] of places) {
            values.push(value);
            setClauses.push(`${column} = $${values.length}`);
        }
        // Mirror Partner1Id/Partner2Id writes into the legacy HusbandId/WifeId
        // columns so any DB-level reader that still queries them stays current.
        // An imported partner's GEDCOM sub-lines describe that person, so they go
        // when another person takes the slot (#989).
        if ('Partner1Id' in normalizedData) {
            values.push(normalizedData.Partner1Id ?? null);
            setClauses.push(`"HusbandId" = $${values.length}`);
            setClauses.push(`"Partner1RawGedcom" = CASE WHEN "Partner1Id" IS NOT DISTINCT FROM $${values.length} THEN "Partner1RawGedcom" END`);
        }
        if ('Partner2Id' in normalizedData) {
            values.push(normalizedData.Partner2Id ?? null);
            setClauses.push(`"WifeId" = $${values.length}`);
            setClauses.push(`"Partner2RawGedcom" = CASE WHEN "Partner2Id" IS NOT DISTINCT FROM $${values.length} THEN "Partner2RawGedcom" END`);
        }
        values.push(id);
        await query(
            `UPDATE "Families" SET ${setClauses.join(', ')}, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $${values.length}`,
            values
        );
    }

    const updatedFamily = await getFamilyById(id, treeId);
    if (!updatedFamily) {
        throw new Error('Failed to update family');
    }

    const auditId = await auditUpdate(
        'family', family as unknown as Record<string, unknown>, updatedFamily as unknown as Record<string, unknown>, ALLOWED_FAMILY_FIELDS, family.UserId, actor,
        undefined, factPlaceRefChanges('families', family as unknown as Record<string, unknown>, updatedFamily as unknown as Record<string, unknown>),
    );

    return withAuditIds(updatedFamily, [auditId]);
}

/**
 * Delete a family (tree-scoped authorizing SELECT + user-keyed edit check)
 */
export async function deleteFamily(id: number, treeId: number, actingUserId?: number): Promise<{ deleted: boolean; auditId: number | null }> {
    const family = await getFamilyById(id, treeId);
    if (!family) {
        return { deleted: false, auditId: null };
    }

    const actor = actingUserId ?? family.UserId;
    if (!(await hasEditPermission(family.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    // The family's child links and events have no FK to "Families", so they
    // survive the delete and come back when the audit entry is reverted.
    return inTransaction(async (client) => {
        const auditId = await auditDelete('family', family as unknown as Record<string, unknown>, family.UserId, actor, client);
        const result = await client.query('DELETE FROM "Families" WHERE "Id" = $1', [id]);
        return { deleted: (result.rowCount ?? 0) > 0, auditId };
    });
}

async function inTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * A newline-sensitive regex for one `2 <tag>` line and the deeper lines under it.
 * The tag must end at a space or the line end, so `2 PEDIGREE` is left alone.
 */
function relationshipLine(tag: string): string {
    return `^2 ${tag}( [^\\n]*)?(\\n[3-9][^\\n]*)*(\\n|$)`;
}

/**
 * SET clauses that drop the relationship lines from a child link's passthrough: a
 * `2 PEDI` under FAMC (#954) and FTM's `2 _FREL` / `2 _MREL` under CHIL (#961).
 * Once a user picks the link's type, those values would contradict it on export.
 * The reads are table-qualified: inside ON CONFLICT DO UPDATE a bare column name
 * is ambiguous with `excluded`.
 */
const CLEAR_RAW_RELATIONSHIP = `"FamcRawGedcom" = NULLIF(rtrim(regexp_replace("FamilyPerson"."FamcRawGedcom", '${relationshipLine('PEDI')}', '', 'gn'), chr(10)), ''),
                 "ChilRawGedcom" = NULLIF(rtrim(regexp_replace("FamilyPerson"."ChilRawGedcom", '${relationshipLine('_[FM]REL')}', '', 'gn'), chr(10)), '')`;

interface ChildLinkRow {
    Partner1Relationship: string | null;
    Partner2Relationship: string | null;
}

async function currentChildLink(client: Queryable, familyId: number, childId: number): Promise<ChildLinkRow | null> {
    const result = await client.query(
        `SELECT "Partner1Relationship", "Partner2Relationship" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
        [familyId, childId],
    );
    return (result.rows[0] as ChildLinkRow | undefined) ?? null;
}

function sameLink(row: ChildLinkRow, next: ChildRelationships): boolean {
    return row.Partner1Relationship === next.partner1 && row.Partner2Relationship === next.partner2;
}

/**
 * Add a child to a family. Authorization = the tree-scoped SELECT + the
 * user-keyed edit check kept as defense in depth. `actingUserId` defaults to
 * the tree owner for callers that predate the scope split.
 */
export async function addChildToFamily(
    familyId: number,
    childId: number,
    treeId: number,
    relationship: ChildRelationshipInput = 'Birth',
    actingUserId?: number,
): Promise<number | null> {
    const next = childRelationshipsOf(relationship);
    const family = await getFamilyById(familyId, treeId);
    if (!family) {
        throw new Error('Family not found');
    }

    const actor = actingUserId ?? family.UserId;
    if (!(await hasEditPermission(family.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    // Child-membership check: the child must be a People row in the same tree.
    const childResult = await query(
        `SELECT * FROM "People" WHERE "Id" = $1 AND "TreeId" = $2`,
        [childId, treeId]
    );

    if (!childResult.rows[0]) {
        throw new Error('Child not found or not accessible');
    }

    // Every child-link change is audited and revertible (#788). Re-adding an
    // existing child only changes its type, so it is audited as an update.
    return inTransaction(async (client) => {
        const existing = await currentChildLink(client, familyId, childId);
        if (existing && sameLink(existing, next)) return null;
        await client.query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId", "Partner1Relationship", "Partner2Relationship")
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("FamiliesAsChildId", "ChildrenId") DO UPDATE SET
                 "Partner1Relationship" = EXCLUDED."Partner1Relationship",
                 "Partner2Relationship" = EXCLUDED."Partner2Relationship",
                 ${CLEAR_RAW_RELATIONSHIP}`,
            [familyId, childId, next.partner1, next.partner2]
        );
        const link = { FamilyId: familyId, ChildId: childId, Partner1Relationship: next.partner1, Partner2Relationship: next.partner2, TreeId: treeId };
        return existing
            ? auditFamilyChild('update', link, family.UserId, actor, client, existing)
            : auditFamilyChild('create', link, family.UserId, actor, client);
    });
}

/**
 * Update a child's relationship to one or both partners within a family.
 */
export async function updateChildRelationshipType(
    familyId: number,
    childId: number,
    relationship: ChildRelationshipInput,
    treeId: number,
    actingUserId?: number,
): Promise<number | null> {
    const next = childRelationshipsOf(relationship);
    const family = await getFamilyById(familyId, treeId);
    if (!family) {
        throw new Error('Family not found');
    }

    const actor = actingUserId ?? family.UserId;
    if (!(await hasEditPermission(family.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    return inTransaction(async (client) => {
        const existing = await currentChildLink(client, familyId, childId);
        if (!existing || sameLink(existing, next)) return null;
        await client.query(
            `UPDATE "FamilyPerson" SET "Partner1Relationship" = $1, "Partner2Relationship" = $2, ${CLEAR_RAW_RELATIONSHIP}
             WHERE "FamiliesAsChildId" = $3 AND "ChildrenId" = $4`,
            [next.partner1, next.partner2, familyId, childId]
        );
        return auditFamilyChild(
            'update',
            { FamilyId: familyId, ChildId: childId, Partner1Relationship: next.partner1, Partner2Relationship: next.partner2, TreeId: treeId },
            family.UserId, actor, client, existing,
        );
    });
}

/**
 * Remove a child from a family (tree-scoped authorizing SELECT + user-keyed edit check)
 */
export async function removeChildFromFamily(familyId: number, childId: number, treeId: number, actingUserId?: number): Promise<number | null> {
    const family = await getFamilyById(familyId, treeId);
    if (!family) {
        throw new Error('Family not found');
    }

    const actor = actingUserId ?? family.UserId;
    if (!(await hasEditPermission(family.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    // Audited with the removed link so the log (and Undo) can restore it (#788, ED-8).
    return inTransaction(async (client) => {
        const existing = await currentChildLink(client, familyId, childId);
        if (!existing) return null;
        await client.query(
            `DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
            [familyId, childId]
        );
        return auditFamilyChild(
            'delete',
            { FamilyId: familyId, ChildId: childId, ...existing, TreeId: treeId },
            family.UserId, actor, client,
        );
    });
}

/**
 * Move a child's link from one family to another in one step (#796, ED-8): the
 * link keeps its relationship type, and one audit entry records the move so a
 * single Undo puts it back. Both families must be in this tree; the child must
 * be in `fromFamilyId` and not already in `toFamilyId`.
 */
export async function moveChildToFamily(
    fromFamilyId: number,
    toFamilyId: number,
    childId: number,
    treeId: number,
    actingUserId?: number,
): Promise<number | null> {
    if (fromFamilyId === toFamilyId) throw new Error('The child is already in that family');
    const [from, to] = await Promise.all([getFamilyById(fromFamilyId, treeId), getFamilyById(toFamilyId, treeId)]);
    if (!from || !to) {
        throw new Error('Family not found');
    }

    const actor = actingUserId ?? from.UserId;
    if (!(await hasEditPermission(from.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    return inTransaction(async (client) => {
        const existing = await currentChildLink(client, fromFamilyId, childId);
        if (!existing) throw new Error('Child link not found');
        if (await currentChildLink(client, toFamilyId, childId)) {
            throw new Error('The child is already in that family');
        }
        await client.query(
            `DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1 AND "ChildrenId" = $2`,
            [fromFamilyId, childId]
        );
        await client.query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId", "Partner1Relationship", "Partner2Relationship") VALUES ($1, $2, $3, $4)`,
            [toFamilyId, childId, existing.Partner1Relationship, existing.Partner2Relationship]
        );
        return auditFamilyChildMove(
            { FamilyId: toFamilyId, ChildId: childId, ...existing, TreeId: treeId },
            fromFamilyId, from.UserId, actor, client,
        );
    });
}

/**
 * Search families by parent name, tree-scoped
 */
// Words that join two partners in a query ("Alder & Delphine", "A and B") and so
// never match a name. The display form is "A & B" in every UI language (#910).
const FAMILY_SEARCH_SEPARATORS = new Set(['and', 'et', 'и']);

/** Splits a family query into name tokens, dropping "&", "+" and joining words. */
function familySearchTokens(searchQuery: string): string[] {
    return searchQuery.slice(0, 100)
        .split(/[\s&+]+/)
        .filter((tok) => tok && !FAMILY_SEARCH_SEPARATORS.has(tok.toLocaleLowerCase()));
}

export async function searchFamilies(searchQuery: string, treeId: number): Promise<FamilyWithSpouseNames[]> {
    const tokens = familySearchTokens(searchQuery);
    // A query of only separators ("&") names no one, so it finds no family.
    if (tokens.length === 0) return [];

    // Like searchPeople: every token must match somewhere, here in either partner's
    // full name or one of either partner's name variants. Both sides are folded
    // (#792) and "%"/"_" match only themselves (#849). Couples where both partners
    // matched a token rank first.
    const partnerMatch = (alias: 'h' | 'w', param: number) => {
        const term = likeContains(`"SearchFold"($${param})`);
        return `(${alias}."SearchName" LIKE ${term}
          OR EXISTS (SELECT 1 FROM "NameVariant" nv WHERE nv."PersonId" = ${alias}."Id" AND nv."SearchName" LIKE ${term}))`;
    };
    const params = tokens.map((_, i) => i + 2);
    const tokenConditions = params.map((n) => `(${partnerMatch('h', n)} OR ${partnerMatch('w', n)})`);
    const anyToken = (alias: 'h' | 'w') => params.map((n) => partnerMatch(alias, n)).join(' OR ');

    const result = await query(
        `SELECT
            f.*, ${familyPlace('f')},
            CASE WHEN h."Id" IS NOT NULL THEN ${integratedFullName('h')} ELSE NULL END as "husbandName",
            CASE WHEN w."Id" IS NOT NULL THEN ${integratedFullName('w')} ELSE NULL END as "wifeName",
            h."Sex" AS "partner1Sex",
            w."Sex" AS "partner2Sex",
            -- Partner years, so a picker can tell same-named couples apart (#796).
            h."BirthDate" AS "partner1BirthDate", h."DeathDate" AS "partner1DeathDate",
            w."BirthDate" AS "partner2BirthDate", w."DeathDate" AS "partner2DeathDate",
            -- Spouse primary photos, matching the shape getAllFamiliesWithSpouses
            -- returns. FamilyWithSpouseNames already declared these fields, so
            -- until now this query returned undefined for every one of them.
            hm."Id" AS "husbandMediaId", hm."FocalX" AS "husbandFocalX", hm."FocalY" AS "husbandFocalY", hm."FocalRadius" AS "husbandFocalRadius",
            wm."Id" AS "wifeMediaId", wm."FocalX" AS "wifeFocalX", wm."FocalY" AS "wifeFocalY", wm."FocalRadius" AS "wifeFocalRadius",
            (SELECT COUNT(*) FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id" AND ${liveChildLinkSql('fp')}) as "childCount"
        FROM "Families" f
        LEFT JOIN "People" h ON COALESCE(f."Partner1Id", f."HusbandId") = h."Id"
        LEFT JOIN "People" w ON COALESCE(f."Partner2Id", f."WifeId") = w."Id"
        ${primaryPhotoJoin('h', 'f."TreeId"', 'hm')}
        ${primaryPhotoJoin('w', 'f."TreeId"', 'wm')}
        WHERE f."TreeId" = $1
        AND ${tokenConditions.join(' AND ')}
        ORDER BY (CASE WHEN ${anyToken('h')} THEN 1 ELSE 0 END) + (CASE WHEN ${anyToken('w')} THEN 1 ELSE 0 END) DESC, f."Id"
        LIMIT 20`,
        [treeId, ...tokens]
    );
    return result.rows as FamilyWithSpouseNames[];
}

export interface FamilySuggestionCandidate {
    Id: number;
    Partner1Id: number | null;
    Partner2Id: number | null;
    MarriageDate: string | null;
    MarriagePlace: string | null;
    husbandName: string | null;
    wifeName: string | null;
    husbandLastName: string | null;
    wifeLastName: string | null;
    husbandBirthDate: string | null;
    wifeBirthDate: string | null;
    husbandBirthPlace: string | null;
    wifeBirthPlace: string | null;
    childrenBirthDates: string[];
    childCount: number;
    familyUpdatedAt: string | null;
}

/**
 * Find families where a spouse's last name matches, for family suggestion scoring.
 * Returns families enriched with spouse birth dates and children birth dates.
 */
export async function suggestFamiliesForPerson(treeId: number, lastName: string): Promise<FamilySuggestionCandidate[]> {

    const result = await query(
        `SELECT
            f."Id", COALESCE(f."Partner1Id", f."HusbandId") AS "HusbandId", COALESCE(f."Partner2Id", f."WifeId") AS "WifeId",
            f."MarriageDate", ${familyPlace('f')},
            f."UpdatedAt" AS "familyUpdatedAt",
            CASE WHEN h."Id" IS NOT NULL THEN ${integratedFullName('h')} ELSE NULL END AS "husbandName",
            CASE WHEN w."Id" IS NOT NULL THEN ${integratedFullName('w')} ELSE NULL END AS "wifeName",
            h."LastName" AS "husbandLastName",
            w."LastName" AS "wifeLastName",
            h."BirthDate" AS "husbandBirthDate",
            w."BirthDate" AS "wifeBirthDate",
            ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'h')} AS "husbandBirthPlace",
            ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'w')} AS "wifeBirthPlace",
            COALESCE(
                ARRAY_AGG(c."BirthDate" ORDER BY c."BirthDate") FILTER (WHERE c."Id" IS NOT NULL),
                ARRAY[]::text[]
            ) AS "childrenBirthDates",
            COUNT(c."Id") AS "childCount"
        FROM "Families" f
        LEFT JOIN "People" h ON COALESCE(f."Partner1Id", f."HusbandId") = h."Id"
        LEFT JOIN "People" w ON COALESCE(f."Partner2Id", f."WifeId") = w."Id"
        LEFT JOIN "FamilyPerson" fp ON fp."FamiliesAsChildId" = f."Id"
        LEFT JOIN "People" c ON c."Id" = fp."ChildrenId"
        WHERE f."TreeId" = $1
        AND ("SearchFold"(h."LastName") LIKE ${likeContains('"SearchFold"($2)')} OR "SearchFold"(w."LastName") LIKE ${likeContains('"SearchFold"($2)')})
        GROUP BY f."Id", h."Id", w."Id"
        ORDER BY f."UpdatedAt" DESC NULLS LAST
        LIMIT 50`,
        [treeId, lastName.slice(0, 100)]
    );
    return result.rows as FamilySuggestionCandidate[];
}

/**
 * Get total count of families in a specific tree
 */
export async function getFamiliesCount(treeId: number): Promise<number> {
    const result = await query(
        `SELECT COUNT(*) as count FROM "Families" WHERE "TreeId" = $1`,
        [treeId]
    );
    return parseInt(result.rows[0].count, 10);
}
