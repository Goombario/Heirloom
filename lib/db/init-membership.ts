import { getAllowedEmails, getBootstrapEmail, isHostedProduction } from '@/lib/auth/allowed-emails';
import type { DbExecutor } from './init-schema';

/**
 * Hosted membership (#656, ADR 0029): who may sign in to a hosted instance. These
 * tables live outside `initializeSchema` on purpose: the static/PGlite build and
 * DESKTOP_MODE never create or read them, so `connection.ts` runs this only on the
 * hosted path (and leaves `SCHEMA_VERSION` alone).
 *
 * - "Members": one row per invited address. `invited` rows have no user; the first
 *   verified Google sign-in binds the row to that `Users` row and Google account
 *   and makes it `active`. Revoking keeps the row so Restore access works.
 * - "MemberLog": the admin log. Never the tree audit log, never undoable.
 * - "MembershipMeta": one-off markers, such as the AUTH_ALLOWED_EMAILS seed.
 */
export async function initializeMembershipSchema(db: DbExecutor): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS "Members" (
      "Id" SERIAL PRIMARY KEY,
      "Email" TEXT NOT NULL,
      "UserId" INTEGER REFERENCES "Users"("Id") ON DELETE CASCADE,
      "GoogleId" TEXT,
      "Role" TEXT NOT NULL CHECK ("Role" IN ('admin', 'member')),
      "Status" TEXT NOT NULL CHECK ("Status" IN ('invited', 'active', 'revoked')),
      "Origin" TEXT NOT NULL CHECK ("Origin" IN ('invite', 'bootstrap', 'seed')),
      "InvitedBy" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "ActivatedAt" TIMESTAMPTZ,
      "LastSignInAt" TIMESTAMPTZ,
      "RevokedAt" TIMESTAMPTZ,
      -- An invitation is bound to nobody; every other row is bound to one user and
      -- one Google account, which is how the person is matched from then on.
      CONSTRAINT "members_bound" CHECK (
        ("Status" = 'invited' AND "UserId" IS NULL AND "GoogleId" IS NULL)
        OR ("Status" <> 'invited' AND "UserId" IS NOT NULL AND "GoogleId" IS NOT NULL)
      ),
      CONSTRAINT "members_email_normalized" CHECK ("Email" = lower(btrim("Email")) AND "Email" <> '')
    );
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON "Members"("Email");`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_user ON "Members"("UserId") WHERE "UserId" IS NOT NULL;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_google ON "Members"("GoogleId") WHERE "GoogleId" IS NOT NULL;`);

  // "ActorId" NULL is the System (bootstrap, seed). "MemberId" has no FK: a
  // cancelled invitation's row is deleted and its log line stays.
  await db.query(`
    CREATE TABLE IF NOT EXISTS "MemberLog" (
      "Id" SERIAL PRIMARY KEY,
      "Action" TEXT NOT NULL CHECK ("Action" IN
        ('invited', 'accepted', 'cancelled', 'role_changed', 'revoked', 'restored', 'bootstrap', 'seeded')),
      "MemberId" INTEGER,
      "Email" TEXT,
      "Role" TEXT,
      "Count" INTEGER,
      "ActorId" INTEGER REFERENCES "Users"("Id") ON DELETE SET NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_memberlog_created ON "MemberLog"("CreatedAt" DESC, "Id" DESC);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS "MembershipMeta" (
      "Key" TEXT PRIMARY KEY,
      "Value" TEXT NOT NULL
    );
  `);
}

const SEEDED_KEY = 'allowlist_seeded';

/**
 * The startup steps of ADR 0029, run once per server process inside the schema
 * transaction (so two booting instances can't both seed):
 *
 * 1. On the first startup with the table, every AUTH_ALLOWED_EMAILS address with no
 *    row becomes a member: `active` when a `Users` row has that email, else
 *    `invited`. After that the variable is ignored, with a warning while it's set.
 * 2. When no active or invited admin exists, AUTH_BOOTSTRAP_EMAIL becomes one: its
 *    row is promoted and restored, or an invited admin row is created.
 * 3. Hosted production with no admin left logs an error: every sign-in is refused.
 *
 * Never logs an address (production logs stay free of family emails).
 */
export async function reconcileMembership(db: DbExecutor): Promise<void> {
  const seeded = await db.query(`SELECT 1 FROM "MembershipMeta" WHERE "Key" = $1`, [SEEDED_KEY]);
  const allowed = getAllowedEmails();
  if (seeded.rows.length === 0) {
    let count = 0;
    for (const email of new Set(allowed ?? [])) {
      const user = (await db.query(
        `SELECT "Id", "GoogleId" FROM "Users" WHERE lower("Email") = $1 ORDER BY "Id" LIMIT 1`,
        [email],
      )).rows[0] as { Id: number; GoogleId: string } | undefined;
      // A user already bound to another row (a second address for one account) stays out.
      const bound = user
        ? (await db.query(`SELECT 1 FROM "Members" WHERE "UserId" = $1 OR "GoogleId" = $2`, [user.Id, user.GoogleId])).rows.length > 0
        : false;
      const inserted = await db.query(
        `INSERT INTO "Members" ("Email", "UserId", "GoogleId", "Role", "Status", "Origin", "ActivatedAt")
         VALUES ($1, $2, $3, 'member', $4, 'seed', $5)
         ON CONFLICT ("Email") DO NOTHING
         RETURNING "Id"`,
        user && !bound
          ? [email, user.Id, user.GoogleId, 'active', new Date().toISOString()]
          : [email, null, null, 'invited', null],
      );
      if (inserted.rows.length > 0) count++;
    }
    if (count > 0) {
      await db.query(`INSERT INTO "MemberLog" ("Action", "Count") VALUES ('seeded', $1)`, [count]);
    }
    await db.query(`INSERT INTO "MembershipMeta" ("Key", "Value") VALUES ($1, $2)`, [SEEDED_KEY, new Date().toISOString()]);
  } else if (allowed !== null) {
    console.warn(
      '[config] AUTH_ALLOWED_EMAILS is still set but is no longer read: members are managed ' +
        'on the Members page. Remove the variable.',
    );
  }

  const hasAdmin = async () => (await db.query(
    `SELECT 1 FROM "Members" WHERE "Role" = 'admin' AND "Status" IN ('active', 'invited') LIMIT 1`,
  )).rows.length > 0;

  const bootstrap = getBootstrapEmail();
  if (bootstrap && !(await hasAdmin())) {
    const existing = (await db.query(`SELECT "Id", "Status" FROM "Members" WHERE "Email" = $1`, [bootstrap])).rows[0] as
      { Id: number; Status: string } | undefined;
    let memberId: number;
    if (existing) {
      await db.query(
        `UPDATE "Members"
            SET "Role" = 'admin',
                "Status" = CASE WHEN "Status" = 'revoked' THEN 'active' ELSE "Status" END,
                "RevokedAt" = NULL,
                "UpdatedAt" = CURRENT_TIMESTAMP
          WHERE "Id" = $1`,
        [existing.Id],
      );
      memberId = existing.Id;
    } else {
      memberId = ((await db.query(
        `INSERT INTO "Members" ("Email", "Role", "Status", "Origin") VALUES ($1, 'admin', 'invited', 'bootstrap') RETURNING "Id"`,
        [bootstrap],
      )).rows[0] as { Id: number }).Id;
    }
    await db.query(
      `INSERT INTO "MemberLog" ("Action", "MemberId", "Email", "Role") VALUES ('bootstrap', $1, $2, 'admin')`,
      [memberId, bootstrap],
    );
  }

  if (isHostedProduction() && !(await hasAdmin())) {
    console.error(
      '[config] SECURITY ERROR: this instance has no admin and AUTH_BOOTSTRAP_EMAIL is not set. ' +
        'Google sign-ins from anyone without an active membership will be refused. Set ' +
        'AUTH_BOOTSTRAP_EMAIL to your Google address and restart.',
    );
  }
}
