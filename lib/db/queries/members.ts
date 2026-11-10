import { query } from '@/lib/db/connection';
import type { Queryable } from './audit-capture';

/**
 * The one home for "Members" / "MemberLog" SQL (hosted membership, ADR 0029). Hosted
 * only: the tables exist only where `connection.ts` creates them, never in the
 * static/PGlite build or DESKTOP_MODE. Writes take the transaction's executor,
 * because every change to a row is logged and re-checks the last-admin rule in the
 * same transaction (`lib/services/members.ts`).
 */

export type MemberRole = 'admin' | 'member';
export type MemberStatus = 'invited' | 'active' | 'revoked';
type MemberOrigin = 'invite' | 'bootstrap' | 'seed';
export type MemberLogAction =
    | 'invited' | 'accepted' | 'cancelled' | 'role_changed' | 'revoked' | 'restored' | 'bootstrap' | 'seeded';

export interface MemberRow {
    Id: number;
    Email: string;
    UserId: number | null;
    GoogleId: string | null;
    Role: MemberRole;
    Status: MemberStatus;
    Origin: MemberOrigin;
    InvitedBy: number | null;
    CreatedAt: string;
    UpdatedAt: string;
    ActivatedAt: string | null;
    LastSignInAt: string | null;
    RevokedAt: string | null;
}

/** A row for the Members page: the person's name, who invited them, what trees they reach. */
export interface MemberListRow extends MemberRow {
    Name: string | null;
    InvitedByName: string | null;
    InvitedByEmail: string | null;
    TreesOwned: number;
    TreesEdit: number;
    TreesContribute: number;
    TreesView: number;
}

export interface MemberLogRow {
    Id: number;
    Action: MemberLogAction;
    MemberId: number | null;
    Email: string | null;
    Role: MemberRole | null;
    Count: number | null;
    ActorId: number | null;
    ActorName: string | null;
    ActorEmail: string | null;
    CreatedAt: string;
}

const run = (exec?: Queryable): Queryable => exec ?? { query: (sql, params) => query(sql, params) };

/**
 * The per-request check (ADR 0029): the status and role of the row bound to this
 * user AND Google account, and whether the table has any row at all (an empty
 * table is what keeps development open). One indexed lookup, no cache.
 */
export async function getMemberAccess(userId: number, googleId: string): Promise<{
    status: MemberStatus | null;
    role: MemberRole | null;
    anyMembers: boolean;
}> {
    const result = await query(
        `SELECT m."Status" AS "status", m."Role" AS "role",
                EXISTS (SELECT 1 FROM "Members") AS "anyMembers"
         FROM (SELECT 1) one
         LEFT JOIN "Members" m ON m."UserId" = $1 AND m."GoogleId" = $2`,
        [userId, googleId],
    );
    const row = result.rows[0] as { status: MemberStatus | null; role: MemberRole | null; anyMembers: boolean };
    return { status: row.status ?? null, role: row.role ?? null, anyMembers: row.anyMembers === true };
}

export async function hasAnyMembers(): Promise<boolean> {
    const result = await query(`SELECT EXISTS (SELECT 1 FROM "Members") AS "any"`, []);
    return (result.rows[0] as { any: boolean }).any === true;
}

export async function getMemberByGoogleId(googleId: string, exec?: Queryable): Promise<MemberRow | null> {
    const result = await run(exec).query(`SELECT * FROM "Members" WHERE "GoogleId" = $1`, [googleId]);
    return (result.rows[0] as MemberRow | undefined) ?? null;
}

export async function getMemberByEmail(email: string, exec?: Queryable): Promise<MemberRow | null> {
    const result = await run(exec).query(`SELECT * FROM "Members" WHERE "Email" = $1`, [email]);
    return (result.rows[0] as MemberRow | undefined) ?? null;
}

/** Locks the row for the rest of the transaction. */
export async function getMemberForUpdate(id: number, exec: Queryable): Promise<MemberRow | null> {
    const result = await exec.query(`SELECT * FROM "Members" WHERE "Id" = $1 FOR UPDATE`, [id]);
    return (result.rows[0] as MemberRow | undefined) ?? null;
}

/**
 * Serialises every membership change, so two admins demoting each other at once
 * can't both pass the last-admin count. Transaction-scoped.
 */
export async function lockMembership(exec: Queryable): Promise<void> {
    await exec.query(`SELECT pg_advisory_xact_lock(hashtext('genealogy_membership'))`, []);
}

export async function isActiveAdmin(userId: number, googleId: string, exec: Queryable): Promise<boolean> {
    const result = await exec.query(
        `SELECT 1 FROM "Members"
         WHERE "UserId" = $1 AND "GoogleId" = $2 AND "Status" = 'active' AND "Role" = 'admin'`,
        [userId, googleId],
    );
    return result.rows.length > 0;
}

export async function countActiveAdmins(exec: Queryable): Promise<number> {
    const result = await exec.query(
        `SELECT COUNT(*)::int AS "n" FROM "Members" WHERE "Role" = 'admin' AND "Status" = 'active'`,
        [],
    );
    return (result.rows[0] as { n: number }).n;
}

export async function insertInvitation(
    input: { email: string; role: MemberRole; invitedBy: number },
    exec: Queryable,
): Promise<MemberRow | null> {
    const result = await exec.query(
        `INSERT INTO "Members" ("Email", "Role", "Status", "Origin", "InvitedBy")
         VALUES ($1, $2, 'invited', 'invite', $3)
         ON CONFLICT ("Email") DO NOTHING
         RETURNING *`,
        [input.email, input.role, input.invitedBy],
    );
    return (result.rows[0] as MemberRow | undefined) ?? null;
}

export async function updateMemberRole(id: number, role: MemberRole, exec: Queryable): Promise<MemberRow> {
    const result = await exec.query(
        `UPDATE "Members" SET "Role" = $2, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1 RETURNING *`,
        [id, role],
    );
    return result.rows[0] as MemberRow;
}

/** Revoke (active → revoked) or restore (revoked → active). Bound rows only. */
export async function updateMemberStatus(id: number, status: 'active' | 'revoked', exec: Queryable): Promise<MemberRow> {
    const result = await exec.query(
        `UPDATE "Members"
            SET "Status" = $2,
                "RevokedAt" = CASE WHEN $2 = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END,
                "UpdatedAt" = CURRENT_TIMESTAMP
          WHERE "Id" = $1 AND "UserId" IS NOT NULL
          RETURNING *`,
        [id, status],
    );
    return result.rows[0] as MemberRow;
}

/** Cancel an invitation that was never used: the row goes, its log line stays. */
export async function deleteInvitation(id: number, exec: Queryable): Promise<boolean> {
    const result = await exec.query(`DELETE FROM "Members" WHERE "Id" = $1 AND "Status" = 'invited'`, [id]);
    return (result.rowCount ?? 0) > 0;
}

/**
 * Bind an invitation to the user and Google account signing in, and make it active.
 * Matched by email this once; from then on by the account (ADR 0029).
 */
export async function activateInvitation(
    id: number,
    user: { userId: number; googleId: string },
    exec: Queryable,
): Promise<MemberRow | null> {
    const result = await exec.query(
        `UPDATE "Members"
            SET "UserId" = $2, "GoogleId" = $3, "Status" = 'active',
                "ActivatedAt" = CURRENT_TIMESTAMP, "LastSignInAt" = CURRENT_TIMESTAMP,
                "UpdatedAt" = CURRENT_TIMESTAMP
          WHERE "Id" = $1 AND "Status" = 'invited'
          RETURNING *`,
        [id, user.userId, user.googleId],
    );
    return (result.rows[0] as MemberRow | undefined) ?? null;
}

export async function touchMemberSignIn(id: number): Promise<void> {
    await query(`UPDATE "Members" SET "LastSignInAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`, [id]);
}

export async function insertMemberLog(
    entry: { action: MemberLogAction; memberId: number | null; email: string | null; role?: MemberRole | null; actorId: number | null },
    exec: Queryable,
): Promise<void> {
    await exec.query(
        `INSERT INTO "MemberLog" ("Action", "MemberId", "Email", "Role", "ActorId") VALUES ($1, $2, $3, $4, $5)`,
        [entry.action, entry.memberId, entry.email, entry.role ?? null, entry.actorId],
    );
}

/** Every row, with what each person reaches through tree ownership and sharing. */
export async function listMembers(): Promise<MemberListRow[]> {
    const result = await query(
        `SELECT m.*, u."Name" AS "Name",
                inv."Name" AS "InvitedByName", inv."Email" AS "InvitedByEmail",
                COALESCE(owned.n, 0)::int AS "TreesOwned",
                COALESCE(sh.edit, 0)::int AS "TreesEdit",
                COALESCE(sh.contribute, 0)::int AS "TreesContribute",
                COALESCE(sh.view, 0)::int AS "TreesView"
         FROM "Members" m
         LEFT JOIN "Users" u ON u."Id" = m."UserId"
         LEFT JOIN "Users" inv ON inv."Id" = m."InvitedBy"
         LEFT JOIN (SELECT "OwnerId", COUNT(*) AS n FROM "Trees" GROUP BY "OwnerId") owned
                ON owned."OwnerId" = m."UserId"
         LEFT JOIN (
             SELECT "SharedWithId",
                    COUNT(*) FILTER (WHERE "Permission" = 'edit') AS edit,
                    COUNT(*) FILTER (WHERE "Permission" = 'contribute') AS contribute,
                    COUNT(*) FILTER (WHERE "Permission" = 'view') AS view
             FROM "TreeSharing" GROUP BY "SharedWithId"
         ) sh ON sh."SharedWithId" = m."UserId"
         ORDER BY m."Id" ASC`,
        [],
    );
    return result.rows as MemberListRow[];
}

export async function getMemberLog(limit: number, offset: number): Promise<{ entries: MemberLogRow[]; count: number }> {
    const [rows, total] = await Promise.all([
        query(
            `SELECT l.*, u."Name" AS "ActorName", u."Email" AS "ActorEmail"
             FROM "MemberLog" l
             LEFT JOIN "Users" u ON u."Id" = l."ActorId"
             ORDER BY l."CreatedAt" DESC, l."Id" DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset],
        ),
        query(`SELECT COUNT(*)::int AS "n" FROM "MemberLog"`, []),
    ]);
    return { entries: rows.rows as MemberLogRow[], count: (total.rows[0] as { n: number }).n };
}

/**
 * Whether an address can use a share yet: a `Users` row with that email bound to an
 * active membership. For the Share tree warning; says nothing else about the row.
 */
export async function isEmailActiveMember(email: string): Promise<boolean> {
    const result = await query(
        `SELECT 1 FROM "Users" u
         JOIN "Members" m ON m."UserId" = u."Id" AND m."Status" = 'active'
         WHERE lower(u."Email") = $1
         LIMIT 1`,
        [email],
    );
    return result.rows.length > 0;
}
