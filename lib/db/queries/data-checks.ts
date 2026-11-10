import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { auditDataCheckConfirmation } from './audit-capture';
import type { DataCheckInput } from '@/lib/data-checks/rules';

export interface DataCheckPersonName {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    DeathDate: string | null;
}

/**
 * Everything the data checks read for one tree (#828): each person's vitals,
 * the dated events, and each family's partners, start and children. Undated
 * events are left out, since no check can use them.
 */
export async function getDataCheckInput(treeId: number): Promise<DataCheckInput & { names: DataCheckPersonName[] }> {
    // The four reads go to the database together, not one after another. In the
    // static build every query queues in the one PGlite worker, and on Home each
    // awaited read went to the back of the queue behind the dashboard's, which
    // made the card wait about four times as long as on /data-checks (#852).
    const [people, events, families, children] = await Promise.all([
        query(
          `SELECT "Id", "FirstName", "LastName", "Sex", "BirthDate", "DeathDate", "IsDeceased"
             FROM "People"
            WHERE "TreeId" = $1`,
          [treeId],
        ),
        query(
          `SELECT "Id", "Type", "Date", "PersonId", "FamilyId"
             FROM "Events"
            WHERE "TreeId" = $1
              AND btrim(COALESCE("Date", '')) <> ''`,
          [treeId],
        ),
        query(
          `SELECT "Id",
                  COALESCE("Partner1Id", "HusbandId") AS "Partner1Id",
                  COALESCE("Partner2Id", "WifeId") AS "Partner2Id",
                  "MarriageDate"
             FROM "Families"
            WHERE "TreeId" = $1`,
          [treeId],
        ),
        query(
          `SELECT fp."FamiliesAsChildId" AS "FamilyId", fp."ChildrenId" AS "ChildId",
                  fp."Partner1Relationship" <> 'Birth' AS "NonBirth1",
                  fp."Partner2Relationship" <> 'Birth' AS "NonBirth2"
             FROM "FamilyPerson" fp
             JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId"
            WHERE f."TreeId" = $1`,
          [treeId],
        ),
    ]);

    const childIds = new Map<number, number[]>();
    const nonBirth1 = new Map<number, number[]>();
    const nonBirth2 = new Map<number, number[]>();
    const push = (map: Map<number, number[]>, familyId: number, childId: number) => {
        const list = map.get(familyId);
        if (list) list.push(childId); else map.set(familyId, [childId]);
    };
    for (const r of children.rows as { FamilyId: number; ChildId: number; NonBirth1: boolean; NonBirth2: boolean }[]) {
        push(childIds, r.FamilyId, r.ChildId);
        if (r.NonBirth1) push(nonBirth1, r.FamilyId, r.ChildId);
        if (r.NonBirth2) push(nonBirth2, r.FamilyId, r.ChildId);
    }

    const personRows = people.rows as Array<DataCheckPersonName & { IsDeceased: number | null }>;
    return {
        people: personRows.map(({ Id, Sex, BirthDate, DeathDate, IsDeceased }) => ({ Id, Sex, BirthDate, DeathDate, IsDeceased })),
        names: personRows.map(({ Id, FirstName, LastName, Sex, BirthDate, DeathDate }) => ({ Id, FirstName, LastName, Sex, BirthDate, DeathDate })),
        events: events.rows as DataCheckInput['events'],
        families: (families.rows as Array<Omit<DataCheckInput['families'][number], 'childIds'>>)
            .map((f) => {
                const partner1 = nonBirth1.get(f.Id);
                const partner2 = nonBirth2.get(f.Id);
                return {
                    ...f,
                    childIds: childIds.get(f.Id) ?? [],
                    ...(partner1 ? { partner1NonBirthChildIds: partner1 } : {}),
                    ...(partner2 ? { partner2NonBirthChildIds: partner2 } : {}),
                };
            }),
    };
}

/** One involved date as a confirmation stores it: its fact key and the stored string. */
export interface ConfirmedFact {
    key: string;
    date: string;
}

export interface DataCheckConfirmationRow {
    Id: number;
    UserId: number | null;
    TreeId: number;
    PersonId: number;
    Rule: string;
    Threshold: number | null;
    Facts: ConfirmedFact[];
    Reason: string;
    ConfirmedBy: number;
    /** A Date from PGlite, an ISO string once serialized; the service normalizes it. */
    ConfirmedAt: string | Date;
}

/** Every confirmation in a tree, live or stale, with the confirming user's name. */
export async function listDataCheckConfirmations(treeId: number): Promise<Array<DataCheckConfirmationRow & { ConfirmedByName: string | null }>> {
    const result = await query(
        `SELECT c.*, u."Name" AS "ConfirmedByName"
           FROM "DataCheckConfirmations" c
           LEFT JOIN "Users" u ON u."Id" = c."ConfirmedBy"
          WHERE c."TreeId" = $1`,
        [treeId],
    );
    return result.rows as Array<DataCheckConfirmationRow & { ConfirmedByName: string | null }>;
}

/**
 * Confirm an unlikely problem as correct (#830). A problem has at most one row,
 * so this replaces any earlier one, stale or not, and audits the new one.
 */
export async function upsertDataCheckConfirmation(params: {
    treeId: number;
    ownerId: number;
    userId: number;
    personId: number;
    rule: string;
    threshold: number | null;
    facts: ConfirmedFact[];
    reason: string;
}): Promise<DataCheckConfirmationRow> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO "DataCheckConfirmations"
                ("UserId", "TreeId", "PersonId", "Rule", "Threshold", "Facts", "Reason", "ConfirmedBy", "ConfirmedAt")
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, CURRENT_TIMESTAMP)
             ON CONFLICT ("TreeId", "PersonId", "Rule") DO UPDATE SET
                "UserId" = EXCLUDED."UserId",
                "Threshold" = EXCLUDED."Threshold",
                "Facts" = EXCLUDED."Facts",
                "Reason" = EXCLUDED."Reason",
                "ConfirmedBy" = EXCLUDED."ConfirmedBy",
                "ConfirmedAt" = EXCLUDED."ConfirmedAt"
             RETURNING *`,
            [params.ownerId, params.treeId, params.personId, params.rule, params.threshold,
                JSON.stringify(params.facts), params.reason, params.userId],
        );
        const row = result.rows[0] as DataCheckConfirmationRow;
        await auditDataCheckConfirmation('create', { ...row }, params.ownerId, params.userId, client);
        await client.query('COMMIT');
        return row;
    } catch (e) {
        await safeRollback(client);
        throw e;
    } finally {
        client.release();
    }
}

/** Reopen a confirmed problem: delete its row and audit that. False when there was none. */
export async function deleteDataCheckConfirmation(params: {
    treeId: number;
    ownerId: number;
    userId: number;
    personId: number;
    rule: string;
}): Promise<boolean> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `DELETE FROM "DataCheckConfirmations"
              WHERE "TreeId" = $1 AND "PersonId" = $2 AND "Rule" = $3
             RETURNING *`,
            [params.treeId, params.personId, params.rule],
        );
        const row = result.rows[0] as DataCheckConfirmationRow | undefined;
        if (!row) {
            await client.query('ROLLBACK');
            return false;
        }
        await auditDataCheckConfirmation('delete', { ...row }, params.ownerId, params.userId, client);
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await safeRollback(client);
        throw e;
    } finally {
        client.release();
    }
}
