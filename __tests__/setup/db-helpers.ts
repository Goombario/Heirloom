import { query } from '@/lib/db/connection';

const TEST_USER_EMAILS = ['test@example.com', 'other@example.com'] as const;

let cachedTestUserIds: number[] | null = null;

/**
 * Resolve the test user IDs by querying the DB directly. This is the source of
 * truth for cleanup — never trust hardcoded IDs or even the JSON cache here,
 * because a stale/missing JSON could cause cleanup to wipe a real user's data.
 *
 * Throws if the seeded test users aren't found, so cleanup refuses to run
 * against a DB that hasn't been set up.
 */
async function resolveTestUserIds(): Promise<number[]> {
  if (cachedTestUserIds) return cachedTestUserIds;
  const result = await query(
    `SELECT "Id" FROM "Users" WHERE "Email" = ANY($1)`,
    [TEST_USER_EMAILS]
  );
  if (result.rows.length !== TEST_USER_EMAILS.length) {
    throw new Error(
      `cleanupTestData: expected ${TEST_USER_EMAILS.length} seeded test users ` +
      `(${TEST_USER_EMAILS.join(', ')}), found ${result.rows.length}. ` +
      `Did globalSetup run?`
    );
  }
  cachedTestUserIds = (result.rows as { Id: number }[]).map(r => r.Id);
  return cachedTestUserIds;
}

/**
 * Clean up test data after each test, scoped strictly to the seeded test users.
 *
 * The DELETEs MUST be scoped by user — unscoped `DELETE FROM "People"` would
 * wipe every user's data on whichever DB DATABASE_URL points to (typically a
 * shared dev DB when no `.env.test.local` exists).
 *
 * Order matters:
 *   1. Junction tables without FK CASCADE (e.g. FamilyPerson) — must
 *      be deleted BEFORE their parent rows so the subquery still resolves.
 *   2. Tables with direct UserId/OwnerId. CASCADE handles the rest:
 *        - Cases → CaseComments, CaseMedia, CasePerson
 *        - Media → MediaTag (via MediaId)
 *        - People → MediaTag (via PersonId), NameVariant (via PersonId)
 *        - Sources → remaining Citations (via SourceId)
 *      We still delete Citation/NameVariant by OwnerId explicitly as defense
 *      in depth against any orphan rows.
 */
export async function cleanupTestData() {
  const userIds = await resolveTestUserIds();

  // 1. Junction tables without FK CASCADE — scope via owned parents.
  await query(
    `DELETE FROM "FamilyPerson"
     WHERE "FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "UserId" = ANY($1))
        OR "ChildrenId" IN (SELECT "Id" FROM "People" WHERE "UserId" = ANY($1))`,
    [userIds]
  );

  // 2. Owner-scoped tables. AuditLog stores both TreeOwnerId (whose tree was
  // touched) and UserId (who did it); scope by either.
  await query('DELETE FROM "AuditLog" WHERE "TreeOwnerId" = ANY($1) OR "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Cases" WHERE "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "DataCheckConfirmations" WHERE "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Events" WHERE "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Citation" WHERE "OwnerId" = ANY($1)', [userIds]);
  await query('DELETE FROM "NameVariant" WHERE "OwnerId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Media" WHERE "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Sources" WHERE "OwnerId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Repository" WHERE "OwnerId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Places" WHERE "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "Families" WHERE "UserId" = ANY($1)', [userIds]);
  await query('DELETE FROM "People" WHERE "UserId" = ANY($1)', [userIds]);
  await query(
    'DELETE FROM "TreeSharing" WHERE "OwnerId" = ANY($1) OR "SharedWithId" = ANY($1)',
    [userIds]
  );
  await query('DELETE FROM "PendingShares" WHERE "OwnerId" = ANY($1)', [userIds]);
  // Multi-tree: drop test-created trees (default trees get lazily recreated by
  // resolveDefaultTree on the next request that needs one).
  await query('DELETE FROM "Trees" WHERE "OwnerId" = ANY($1)', [userIds]);
}

/**
 * Check if a test database is available.
 * Integration tests should skip if no DATABASE_URL is set.
 */
export function hasTestDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * True when the integration suite runs on PGlite (vitest.pglite.config.ts). PGlite
 * is a single connection, so a test that needs two concurrent Postgres sessions
 * (row locks, advisory locks, `pg_backend_pid`) skips there.
 */
export function onPglite(): boolean {
  return process.env.TEST_DB_ENGINE === 'pglite';
}
