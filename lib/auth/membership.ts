import { getClient } from '@/lib/db/connection';
import {
    activateInvitation, getMemberAccess, hasAnyMembers, getMemberByEmail, getMemberByGoogleId, insertMemberLog, touchMemberSignIn,
} from '@/lib/db/queries/members';
import { getUserSummaryByEmail, getUserSummaryByGoogleId } from '@/lib/db/queries/users';
import { getBootstrapEmail, isHostedProduction, normalizeEmail } from './allowed-emails';
import { resolveOrCreateUser } from './provision';

/**
 * Who may sign in to a hosted instance (#656, ADR 0029). Node-only: imported by the
 * Node NextAuth instance and `getUserFromRequest`, never by the edge proxy.
 *
 * Open sign-in (anyone with a Google account) survives only outside hosted
 * production, on an instance with no member rows and no AUTH_BOOTSTRAP_EMAIL: the
 * development setup. Everywhere else a person needs an active row.
 */

/** True when an instance with this many rows lets anyone in. */
export function isMembershipOpen(anyMembers: boolean): boolean {
    return !anyMembers && getBootstrapEmail() === null && !isHostedProduction();
}

/**
 * The per-request check `getUserFromRequest` makes, so a revoke takes effect on the
 * next API call whatever the session's age. No cache.
 */
export async function hasActiveMembership(userId: number, googleId: string): Promise<boolean> {
    const access = await getMemberAccess(userId, googleId);
    if (access.status === 'active') return true;
    return access.status === null && isMembershipOpen(access.anyMembers);
}

export interface SignInProfile {
    googleId: string;
    email: string | null | undefined;
    /** Google's `email_verified` claim. An invitation needs it. */
    emailVerified: boolean;
    name: string | null;
    image: string | null;
}

/**
 * The Node `signIn` callback. A Google account bound to a row gets in while that row
 * is active. Otherwise a verified address with an open invitation claims it: the
 * `Users` row is provisioned and the invitation is bound to it and made active.
 * Anything else is refused (NextAuth shows AccessDenied).
 */
export async function admitSignIn(profile: SignInProfile): Promise<boolean> {
    const { googleId } = profile;
    if (!googleId) return false;

    const bound = await getMemberByGoogleId(googleId);
    if (bound) {
        if (bound.Status !== 'active') return false;
        await touchMemberSignIn(bound.Id);
        return true;
    }

    const email = profile.email ? normalizeEmail(profile.email) : '';
    const invitation = email ? await getMemberByEmail(email) : null;
    if (!invitation || invitation.Status !== 'invited') {
        // Nobody listed: open only on an empty development instance.
        return invitation === null && isMembershipOpen(await hasAnyMembers());
    }
    if (!profile.emailVerified) return false;

    // An existing Users row with this email but another Google account is someone
    // else's history; a new account with the same address doesn't inherit it.
    const sameEmail = await getUserSummaryByEmail(profile.email!);
    if (sameEmail && !(await getUserSummaryByGoogleId(googleId))) {
        console.warn('[Auth] Refused an invitation: its address belongs to an account with another Google login');
        return false;
    }

    const user = await resolveOrCreateUser({ googleId, email: profile.email!, name: profile.name, image: profile.image });
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const activated = await activateInvitation(invitation.Id, { userId: user.id, googleId }, client);
        if (activated) {
            await insertMemberLog({ action: 'accepted', memberId: activated.Id, email: activated.Email, role: activated.Role, actorId: user.id }, client);
        }
        await client.query('COMMIT');
        return activated !== null;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}
