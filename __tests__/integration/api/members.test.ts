import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { GET as LIST, POST as INVITE } from '@/app/api/members/route';
import { PATCH, DELETE } from '@/app/api/members/[id]/route';
import { GET as LOG } from '@/app/api/members/log/route';
import { GET as ME } from '@/app/api/members/me/route';
import { GET as CHECK } from '@/app/api/members/check/route';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { auth } from '@/lib/auth/auth';
import { admitSignIn } from '@/lib/auth/membership';
import { query } from '@/lib/db/connection';
import { initializeMembershipSchema, reconcileMembership } from '@/lib/db/init-membership';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { hasTestDatabase } from '../../setup/db-helpers';

// The real NextAuth instance can't run here; the live-session test feeds it a session.
vi.mock('@/lib/auth/auth', () => ({ auth: vi.fn() }));

/**
 * Hosted membership (#656, ADR 0029): the admin API, the sign-in admission, and the
 * per-request check. Rows this file makes use the members.test domain or the two
 * seeded test users, and only those are cleaned up, so a shared dev database keeps
 * its own members. Tests that need the whole table (open sign-in, bootstrap, the
 * one-time seed) run only when it holds nothing else.
 */
const describeIf = hasTestDatabase() ? describe : describe.skip;
const DOMAIN = '@members.test';
const exec = { query: (sql: string, params?: unknown[]) => query(sql, params) };

const adminCaller = { ...TEST_USER };
const memberCaller = { ...TEST_USER_2 };

async function cleanup() {
  const ids = [TEST_USER.id, TEST_USER_2.id];
  await query(`DELETE FROM "MemberLog" WHERE "Email" LIKE $1 OR "ActorId" = ANY($2) OR "Email" = ANY($3)`,
    [`%${DOMAIN}`, ids, [TEST_USER.email, TEST_USER_2.email]]);
  await query(`DELETE FROM "Members" WHERE "Email" LIKE $1 OR "UserId" = ANY($2) OR "Email" = ANY($3)`,
    [`%${DOMAIN}`, ids, [TEST_USER.email, TEST_USER_2.email]]);
  await query(`DELETE FROM "TreeSharing" WHERE "SharedWithId" IN (SELECT "Id" FROM "Users" WHERE "Email" LIKE $1)`, [`%${DOMAIN}`]);
  await query(`DELETE FROM "Trees" WHERE "OwnerId" IN (SELECT "Id" FROM "Users" WHERE "Email" LIKE $1)`, [`%${DOMAIN}`]);
  await query(`DELETE FROM "Users" WHERE "Email" LIKE $1`, [`%${DOMAIN}`]);
}

async function addActive(user: typeof TEST_USER, role: 'admin' | 'member') {
  const r = await query(
    `INSERT INTO "Members" ("Email", "UserId", "GoogleId", "Role", "Status", "Origin", "ActivatedAt")
     VALUES ($1, $2, $3, $4, 'active', 'invite', CURRENT_TIMESTAMP) RETURNING "Id"`,
    [user.email, user.id, user.googleId, role],
  );
  return (r.rows[0] as { Id: number }).Id;
}

async function memberRow(email: string) {
  const r = await query(`SELECT * FROM "Members" WHERE "Email" = $1`, [email]);
  return r.rows[0] as { Id: number; Status: string; Role: string; UserId: number | null; GoogleId: string | null } | undefined;
}

/** True when the table holds only this file's rows, so whole-table tests are safe. */
async function tableIsOurs(): Promise<boolean> {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM "Members" WHERE "Email" NOT LIKE $1 AND "Email" <> ALL($2)`,
    [`%${DOMAIN}`, [TEST_USER.email, TEST_USER_2.email]],
  );
  return (r.rows[0] as { n: number }).n === 0;
}

function as(caller: typeof TEST_USER | null) {
  vi.mocked(getUserFromRequest).mockResolvedValue(caller);
}

describeIf('Members API (ADR 0029)', () => {
  beforeAll(async () => {
    // Postgres creates these at startup; the PGlite suite never does (static build).
    await initializeMembershipSchema(exec);
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await addActive(TEST_USER, 'admin');
    as(adminCaller);
  });

  afterAll(async () => {
    await cleanup();
    vi.mocked(getUserFromRequest).mockResolvedValue({ ...TEST_USER });
  });

  it('lists members with what each reaches through sharing', async () => {
    await addActive(TEST_USER_2, 'member');
    const res = await LIST();
    expect(res.status).toBe(200);
    const body = await parseResponse<{ members: { Email: string; Role: string; Status: string }[]; count: number }>(res);
    const emails = body.members.map((m) => m.Email);
    expect(emails).toEqual(expect.arrayContaining([TEST_USER.email, TEST_USER_2.email]));
  });

  it('refuses every members route to a non-admin', async () => {
    await addActive(TEST_USER_2, 'member');
    as(memberCaller);
    expect((await LIST()).status).toBe(403);
    expect((await INVITE(createRequest('/api/members', { method: 'POST', body: { email: `x${DOMAIN}` } }))).status).toBe(403);
    expect((await LOG(createRequest('/api/members/log'))).status).toBe(403);
    const adminId = (await memberRow(TEST_USER.email))!.Id;
    const patch = await PATCH(createRequest(`/api/members/${adminId}`, { method: 'PATCH', body: { status: 'revoked' } }), { params: Promise.resolve({ id: String(adminId) }) });
    expect(patch.status).toBe(403);
    expect((await parseResponse<{ isAdmin: boolean }>(await ME())).isAdmin).toBe(false);
  });

  it('returns 401 without a session', async () => {
    as(null);
    expect((await LIST()).status).toBe(401);
  });

  it('invites an address, refuses a duplicate, and logs it', async () => {
    const email = `Anna${DOMAIN}`;
    const res = await INVITE(createRequest('/api/members', { method: 'POST', body: { email: ` ${email} `, role: 'member' } }));
    expect(res.status).toBe(201);
    const { member } = await parseResponse<{ member: { Email: string; Status: string; Role: string } }>(res);
    expect(member).toMatchObject({ Email: email.toLowerCase(), Status: 'invited', Role: 'member' });

    const again = await INVITE(createRequest('/api/members', { method: 'POST', body: { email } }));
    expect(again.status).toBe(409);
    expect((await parseResponse<{ code: string }>(again)).code).toBe('already_listed');

    const log = await parseResponse<{ entries: { Action: string; Email: string; ActorId: number }[] }>(await LOG(createRequest('/api/members/log')));
    expect(log.entries[0]).toMatchObject({ Action: 'invited', Email: email.toLowerCase(), ActorId: TEST_USER.id });
  });

  it('rejects a malformed address or role', async () => {
    expect((await INVITE(createRequest('/api/members', { method: 'POST', body: { email: 'not-an-email' } }))).status).toBe(400);
    expect((await INVITE(createRequest('/api/members', { method: 'POST', body: { email: `a${DOMAIN}`, role: 'owner' } }))).status).toBe(400);
  });

  it('refuses to demote or revoke the last admin, in the service', async () => {
    const id = (await memberRow(TEST_USER.email))!.Id;
    const params = { params: Promise.resolve({ id: String(id) }) };
    const demote = await PATCH(createRequest(`/api/members/${id}`, { method: 'PATCH', body: { role: 'member' } }), params);
    expect(demote.status).toBe(409);
    expect((await parseResponse<{ code: string }>(demote)).code).toBe('last_admin');
    const revoke = await PATCH(createRequest(`/api/members/${id}`, { method: 'PATCH', body: { status: 'revoked' } }), { params: Promise.resolve({ id: String(id) }) });
    expect(revoke.status).toBe(409);
    expect((await memberRow(TEST_USER.email))).toMatchObject({ Role: 'admin', Status: 'active' });
  });

  it('lets one of two admins step down, then keeps the other', async () => {
    const otherId = await addActive(TEST_USER_2, 'admin');
    const myId = (await memberRow(TEST_USER.email))!.Id;
    const res = await PATCH(createRequest(`/api/members/${myId}`, { method: 'PATCH', body: { role: 'member' } }), { params: Promise.resolve({ id: String(myId) }) });
    expect(res.status).toBe(200);
    as(memberCaller);
    const last = await PATCH(createRequest(`/api/members/${otherId}`, { method: 'PATCH', body: { status: 'revoked' } }), { params: Promise.resolve({ id: String(otherId) }) });
    expect(last.status).toBe(409);
  });

  it('revokes and restores, keeping the row and the shares', async () => {
    const id = await addActive(TEST_USER_2, 'member');
    const params = () => ({ params: Promise.resolve({ id: String(id) }) });
    expect((await PATCH(createRequest(`/api/members/${id}`, { method: 'PATCH', body: { status: 'revoked' } }), params())).status).toBe(200);
    expect(await memberRow(TEST_USER_2.email)).toMatchObject({ Status: 'revoked', UserId: TEST_USER_2.id });
    // A revoked row can't change role until it's restored.
    expect((await PATCH(createRequest(`/api/members/${id}`, { method: 'PATCH', body: { role: 'admin' } }), params())).status).toBe(409);
    expect((await PATCH(createRequest(`/api/members/${id}`, { method: 'PATCH', body: { status: 'active' } }), params())).status).toBe(200);
    expect(await memberRow(TEST_USER_2.email)).toMatchObject({ Status: 'active' });
    const actions = (await query(`SELECT "Action" FROM "MemberLog" WHERE "MemberId" = $1 ORDER BY "Id"`, [id])).rows.map((r) => (r as { Action: string }).Action);
    expect(actions).toEqual(['revoked', 'restored']);
  });

  it('cancels an unused invitation by deleting it, and only an invitation', async () => {
    await INVITE(createRequest('/api/members', { method: 'POST', body: { email: `cancel${DOMAIN}` } }));
    const id = (await memberRow(`cancel${DOMAIN}`))!.Id;
    expect((await DELETE(createRequest(`/api/members/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: String(id) }) })).status).toBe(200);
    expect(await memberRow(`cancel${DOMAIN}`)).toBeUndefined();
    const adminId = (await memberRow(TEST_USER.email))!.Id;
    expect((await DELETE(createRequest(`/api/members/${adminId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: String(adminId) }) })).status).toBe(409);
  });

  it('answers the Share tree check with one boolean and whether the caller may invite', async () => {
    await addActive(TEST_USER_2, 'member');
    const check = async (email: string) => parseResponse<{ member: boolean; canInvite: boolean }>(
      await CHECK(createRequest(`/api/members/check?email=${encodeURIComponent(email)}`)));
    expect(await check(TEST_USER_2.email)).toEqual({ member: true, canInvite: true });
    expect(await check(`nobody${DOMAIN}`)).toEqual({ member: false, canInvite: true });
    as(memberCaller);
    expect(await check(`nobody${DOMAIN}`)).toEqual({ member: false, canInvite: false });
  });

  describe('sign-in admission', () => {
    const profile = (email: string, sub: string, verified = true) => ({
      googleId: sub, email, emailVerified: verified, name: 'Anna', image: null,
    });

    it('turns a verified invitation into an active membership bound to the account', async () => {
      const email = `anna${DOMAIN}`;
      await INVITE(createRequest('/api/members', { method: 'POST', body: { email } }));
      expect(await admitSignIn(profile(email, 'g-anna', false))).toBe(false);
      expect(await memberRow(email)).toMatchObject({ Status: 'invited', UserId: null });

      expect(await admitSignIn(profile(email.toUpperCase(), 'g-anna'))).toBe(true);
      const row = await memberRow(email);
      expect(row).toMatchObject({ Status: 'active', GoogleId: 'g-anna' });
      expect(row!.UserId).not.toBeNull();
      const accepted = await query(`SELECT "ActorId" FROM "MemberLog" WHERE "Action" = 'accepted' AND "MemberId" = $1`, [row!.Id]);
      expect((accepted.rows[0] as { ActorId: number }).ActorId).toBe(row!.UserId);

      // From now on it's the Google account that matters, not the address.
      expect(await admitSignIn(profile(email, 'g-someone-else'))).toBe(false);
      expect(await admitSignIn(profile(`changed${DOMAIN}`, 'g-anna'))).toBe(true);
    });

    it('refuses an address with no row once the instance has members', async () => {
      expect(await admitSignIn(profile(`stranger${DOMAIN}`, 'g-stranger'))).toBe(false);
    });

    it('refuses a revoked member at sign-in', async () => {
      await query(
        `INSERT INTO "Members" ("Email", "UserId", "GoogleId", "Role", "Status", "Origin") VALUES ($1, $2, $3, 'member', 'revoked', 'invite')`,
        [TEST_USER_2.email, TEST_USER_2.id, TEST_USER_2.googleId],
      );
      expect(await admitSignIn(profile(TEST_USER_2.email, TEST_USER_2.googleId))).toBe(false);
    });

    it('stops a revoked member with a live session at the next API call', async () => {
      const real = await vi.importActual<typeof import('@/lib/auth/get-user-from-request')>('@/lib/auth/get-user-from-request');
      const id = await addActive(TEST_USER_2, 'member');
      vi.mocked(auth).mockResolvedValue({
        user: { email: TEST_USER_2.email, name: TEST_USER_2.name, googleId: TEST_USER_2.googleId, dbUserId: TEST_USER_2.id },
        expires: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      } as never);
      expect((await real.getUserFromRequest())?.id).toBe(TEST_USER_2.id);

      await PATCH(createRequest(`/api/members/${id}`, { method: 'PATCH', body: { status: 'revoked' } }), { params: Promise.resolve({ id: String(id) }) });
      expect(await real.getUserFromRequest()).toBeNull();

      // A token naming another account's user id doesn't borrow that membership.
      vi.mocked(auth).mockResolvedValue({
        user: { email: TEST_USER.email, name: 'x', googleId: 'g-forged', dbUserId: TEST_USER.id },
        expires: new Date(Date.now() + 86_400_000).toISOString(),
      } as never);
      expect(await real.getUserFromRequest()).toBeNull();
    });
  });

  describe('whole-table rules', () => {
    it('stays open for development only while the table is empty and no bootstrap is set', async () => {
      if (!(await tableIsOurs())) return;
      await cleanup();
      vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', '');
      expect(await admitSignIn({ googleId: 'g-dev', email: `dev${DOMAIN}`, emailVerified: true, name: null, image: null })).toBe(true);
      vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', `boss${DOMAIN}`);
      expect(await admitSignIn({ googleId: 'g-dev', email: `dev${DOMAIN}`, emailVerified: true, name: null, image: null })).toBe(false);
      vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', '');
      vi.stubEnv('NODE_ENV', 'production');
      expect(await admitSignIn({ googleId: 'g-dev', email: `dev${DOMAIN}`, emailVerified: true, name: null, image: null })).toBe(false);
    });

    it('bootstraps an admin on an empty instance, and only then', async () => {
      if (!(await tableIsOurs())) return;
      await cleanup();
      vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', ` Boss${DOMAIN} `);
      await reconcileMembership(exec);
      expect(await memberRow(`boss${DOMAIN}`)).toMatchObject({ Role: 'admin', Status: 'invited' });

      // An admin exists (even invited): the variable does nothing.
      vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', `second${DOMAIN}`);
      await reconcileMembership(exec);
      expect(await memberRow(`second${DOMAIN}`)).toBeUndefined();
    });

    it('promotes and restores an existing row when no admin is left', async () => {
      if (!(await tableIsOurs())) return;
      await cleanup();
      await query(
        `INSERT INTO "Members" ("Email", "UserId", "GoogleId", "Role", "Status", "Origin") VALUES ($1, $2, $3, 'member', 'revoked', 'invite')`,
        [TEST_USER.email, TEST_USER.id, TEST_USER.googleId],
      );
      vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', TEST_USER.email);
      await reconcileMembership(exec);
      expect(await memberRow(TEST_USER.email)).toMatchObject({ Role: 'admin', Status: 'active' });
    });

    it('seeds AUTH_ALLOWED_EMAILS once, then ignores it', async () => {
      if (!(await tableIsOurs())) return;
      await cleanup();
      const meta = await query(`SELECT "Value" FROM "MembershipMeta" WHERE "Key" = 'allowlist_seeded'`);
      await query(`DELETE FROM "MembershipMeta" WHERE "Key" = 'allowlist_seeded'`);
      try {
        vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', '');
        vi.stubEnv('AUTH_ALLOWED_EMAILS', `${TEST_USER_2.email}, New${DOMAIN}`);
        await reconcileMembership(exec);
        expect(await memberRow(TEST_USER_2.email)).toMatchObject({ Status: 'active', Role: 'member', UserId: TEST_USER_2.id, GoogleId: TEST_USER_2.googleId });
        expect(await memberRow(`new${DOMAIN}`)).toMatchObject({ Status: 'invited', Role: 'member' });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('AUTH_ALLOWED_EMAILS', `later${DOMAIN}`);
        await reconcileMembership(exec);
        expect(await memberRow(`later${DOMAIN}`)).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
      } finally {
        await query(`DELETE FROM "MemberLog" WHERE "Action" = 'seeded'`);
        await query(`DELETE FROM "MembershipMeta" WHERE "Key" = 'allowlist_seeded'`);
        if (meta.rows.length > 0) {
          await query(`INSERT INTO "MembershipMeta" ("Key", "Value") VALUES ('allowlist_seeded', $1)`, [(meta.rows[0] as { Value: string }).Value]);
        }
      }
    });
  });
});
