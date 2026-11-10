import { getClient } from '@/lib/db/connection';
import {
    countActiveAdmins, deleteInvitation, getMemberAccess, getMemberForUpdate, getMemberLog, hasAnyMembers, insertInvitation,
    insertMemberLog, isActiveAdmin, isEmailActiveMember, listMembers, lockMembership, updateMemberRole, updateMemberStatus,
    type MemberListRow, type MemberLogRow, type MemberRole, type MemberRow,
} from '@/lib/db/queries/members';
import type { Queryable } from '@/lib/db/queries/audit-capture';
import { normalizeEmail } from '@/lib/auth/allowed-emails';
import { isMembershipOpen } from '@/lib/auth/membership';
import { AccessError, MembershipConflictError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

/**
 * The Members page's business rules (#656, ADR 0029). Every function takes the
 * caller from `getUserFromRequest` and re-checks that they are an active admin:
 * hiding the menu item is not the control. Every write runs in one transaction
 * that serialises membership changes, writes the admin log, and re-counts admins.
 */

export interface MembersCaller {
    id: number;
    googleId: string;
}

const ROLES: readonly MemberRole[] = ['admin', 'member'];
/** Loose on purpose: Google decides what an address is. This only catches typos. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 320;

function hostedOnly(): void {
    if (process.env.DESKTOP_MODE === 'true') throw new NotFoundError('Members are not available here');
}

/** Throws AccessError unless the caller is an active admin. */
export async function requireAdmin(caller: MembersCaller): Promise<void> {
    hostedOnly();
    const access = await getMemberAccess(caller.id, caller.googleId);
    if (access.status !== 'active' || access.role !== 'admin') {
        throw new AccessError('Only an admin can manage members');
    }
}

/** For the menus: whether to show Members. False rather than an error for anyone else. */
export async function getMyMembershipService(caller: MembersCaller): Promise<{ isAdmin: boolean }> {
    if (process.env.DESKTOP_MODE === 'true') return { isAdmin: false };
    const access = await getMemberAccess(caller.id, caller.googleId);
    return { isAdmin: access.status === 'active' && access.role === 'admin' };
}

export async function listMembersService(caller: MembersCaller): Promise<{ members: MemberListRow[]; count: number }> {
    await requireAdmin(caller);
    const members = await listMembers();
    return { members, count: members.length };
}

export async function listMemberLogService(params: {
    caller: MembersCaller;
    page: number | null;
    pageSize: number | null;
}): Promise<{ entries: MemberLogRow[]; count: number }> {
    await requireAdmin(params.caller);
    const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);
    const page = Math.max(params.page ?? 1, 1);
    return getMemberLog(pageSize, (page - 1) * pageSize);
}

function parseRole(role: unknown): MemberRole {
    if (typeof role !== 'string' || !ROLES.includes(role as MemberRole)) {
        throw new ValidationError('Role must be "admin" or "member"');
    }
    return role as MemberRole;
}

function parseEmail(email: unknown): string {
    if (typeof email !== 'string') throw new ValidationError('Email is required');
    const normalized = normalizeEmail(email);
    if (!normalized) throw new ValidationError('Email is required');
    if (normalized.length > MAX_EMAIL || !EMAIL_SHAPE.test(normalized)) {
        throw new ValidationError('Enter a valid email address');
    }
    return normalized;
}

/** One membership change: the lock, the caller's re-check, the work, then commit. */
async function inMembershipTransaction<T>(caller: MembersCaller, work: (client: Queryable) => Promise<T>): Promise<T> {
    await requireAdmin(caller);
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await lockMembership(client);
        // Re-checked under the lock: an admin demoted a moment ago can't act.
        if (!(await isActiveAdmin(caller.id, caller.googleId, client))) throw new AccessError('Only an admin can manage members');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function lockedMember(id: number, client: Queryable): Promise<MemberRow> {
    const member = await getMemberForUpdate(id, client);
    if (!member) throw new NotFoundError('Member not found');
    return member;
}

/** Refuses a change that would leave no active admin. */
async function assertNotLastAdmin(member: MemberRow, client: Queryable): Promise<void> {
    if (member.Role !== 'admin' || member.Status !== 'active') return;
    if (await countActiveAdmins(client) <= 1) {
        throw new MembershipConflictError('last_admin', 'This is the only admin. Make someone else an admin first.');
    }
}

/** Invite: an `invited` row for the address. No email is sent (ADR 0029). */
export async function inviteMemberService(params: { caller: MembersCaller; email: unknown; role: unknown }): Promise<MemberRow> {
    const email = parseEmail(params.email);
    const role = parseRole(params.role ?? 'member');
    return inMembershipTransaction(params.caller, async (client) => {
        const member = await insertInvitation({ email, role, invitedBy: params.caller.id }, client);
        if (!member) throw new MembershipConflictError('already_listed', 'That address is already on the list');
        await insertMemberLog({ action: 'invited', memberId: member.Id, email, role, actorId: params.caller.id }, client);
        return member;
    });
}

/** Make admin / Make member. Works on invited and active rows; never leaves no admin. */
export async function changeMemberRoleService(params: { caller: MembersCaller; memberId: number; role: unknown }): Promise<MemberRow> {
    const role = parseRole(params.role);
    return inMembershipTransaction(params.caller, async (client) => {
        const member = await lockedMember(params.memberId, client);
        if (member.Status === 'revoked') {
            throw new MembershipConflictError('wrong_status', 'Restore access before changing the role');
        }
        if (member.Role === role) return member;
        if (role === 'member') await assertNotLastAdmin(member, client);
        const updated = await updateMemberRole(member.Id, role, client);
        await insertMemberLog({ action: 'role_changed', memberId: member.Id, email: member.Email, role, actorId: params.caller.id }, client);
        return updated;
    });
}

/** Revoke access: the row stays (for Restore), and nothing else is deleted. */
export async function revokeMemberService(params: { caller: MembersCaller; memberId: number }): Promise<MemberRow> {
    return inMembershipTransaction(params.caller, async (client) => {
        const member = await lockedMember(params.memberId, client);
        if (member.Status !== 'active') {
            throw new MembershipConflictError('wrong_status', 'Only an active member can be revoked');
        }
        await assertNotLastAdmin(member, client);
        const updated = await updateMemberStatus(member.Id, 'revoked', client);
        await insertMemberLog({ action: 'revoked', memberId: member.Id, email: member.Email, role: member.Role, actorId: params.caller.id }, client);
        return updated;
    });
}

/** Restore access: a revoked row is active again, with no re-invite. */
export async function restoreMemberService(params: { caller: MembersCaller; memberId: number }): Promise<MemberRow> {
    return inMembershipTransaction(params.caller, async (client) => {
        const member = await lockedMember(params.memberId, client);
        if (member.Status !== 'revoked') {
            throw new MembershipConflictError('wrong_status', 'Only revoked access can be restored');
        }
        const updated = await updateMemberStatus(member.Id, 'active', client);
        await insertMemberLog({ action: 'restored', memberId: member.Id, email: member.Email, role: member.Role, actorId: params.caller.id }, client);
        return updated;
    });
}

/** Cancel an invitation that was never used: its row is deleted. */
export async function cancelInviteService(params: { caller: MembersCaller; memberId: number }): Promise<void> {
    await inMembershipTransaction(params.caller, async (client) => {
        const member = await lockedMember(params.memberId, client);
        if (member.Status !== 'invited') {
            throw new MembershipConflictError('wrong_status', 'Only an open invitation can be cancelled');
        }
        await deleteInvitation(member.Id, client);
        await insertMemberLog({ action: 'cancelled', memberId: member.Id, email: member.Email, role: member.Role, actorId: params.caller.id }, client);
    });
}

/**
 * The Share tree warning: can this address use a share yet? Any signed-in user may
 * ask (it's their own tree they're sharing); the answer is one boolean. `canInvite`
 * tells the dialog whether to offer "Invite them too".
 */
export async function shareRecipientStatusService(params: { caller: MembersCaller; email: unknown }): Promise<{
    member: boolean;
    canInvite: boolean;
}> {
    hostedOnly();
    const email = parseEmail(params.email);
    const [{ isAdmin }, any] = await Promise.all([getMyMembershipService(params.caller), hasAnyMembers()]);
    if (isMembershipOpen(any)) return { member: true, canInvite: false };
    return { member: await isEmailActiveMember(email), canInvite: isAdmin };
}
