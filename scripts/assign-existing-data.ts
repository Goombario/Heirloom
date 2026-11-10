import { Pool } from 'pg';

/**
 * Assign all existing data (with NULL UserId) to a user
 * Run this after signing in for the first time to migrate your existing data
 */

interface User {
  Id: number;
  Email: string;
  Name: string | null;
  GoogleId: string;
  CreatedAt: string;
  UpdatedAt: string;
}

interface CountResult {
  count: string;
}

const email = process.argv[2];
const name = process.argv[3] || 'Primary User';
const googleId = process.argv[4] || 'local-user-1';

if (!email) {
  console.error('Usage: npm run db:assign <email> [name] [googleId]');
  console.error('Example: npm run db:assign "yourname@gmail.com" "Your Name" "google-oauth-id"');
  process.exit(1);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  console.log('Migrating existing data to user:', email);

  // Check if user exists
  const userResult = await pool.query('SELECT * FROM "Users" WHERE "Email" = $1', [email]);
  let user = userResult.rows[0] as User | undefined;

  if (!user) {
    // Create user
    console.log('Creating user record...');
    const insertResult = await pool.query(
      `INSERT INTO "Users" ("Email", "Name", "GoogleId", "CreatedAt", "UpdatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [email, name, googleId]
    );
    user = insertResult.rows[0] as User;
    console.log('User created with ID:', user.Id);
  } else {
    console.log('User already exists with ID:', user.Id);
  }

  const userId = user.Id;

  // Count records with NULL UserId
  const [peopleCount, familiesCount, eventsCount, mediaCount] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM "People" WHERE "UserId" IS NULL'),
    pool.query('SELECT COUNT(*) as count FROM "Families" WHERE "UserId" IS NULL'),
    pool.query('SELECT COUNT(*) as count FROM "Events" WHERE "UserId" IS NULL'),
    pool.query('SELECT COUNT(*) as count FROM "Media" WHERE "UserId" IS NULL'),
  ]);

  const pCount = parseInt((peopleCount.rows[0] as CountResult).count, 10);
  const fCount = parseInt((familiesCount.rows[0] as CountResult).count, 10);
  const eCount = parseInt((eventsCount.rows[0] as CountResult).count, 10);
  const mCount = parseInt((mediaCount.rows[0] as CountResult).count, 10);

  console.log('\nRecords to migrate:');
  console.log(`  - People: ${pCount}`);
  console.log(`  - Families: ${fCount}`);
  console.log(`  - Events: ${eCount}`);
  console.log(`  - Media: ${mCount}`);

  if (pCount === 0 && fCount === 0 && eCount === 0 && mCount === 0) {
    console.log('\nNo records to migrate. All data already has a user assigned.');
    await pool.end();
    process.exit(0);
  }

  // Every read is now TreeId-scoped, so assigned rows must also be stamped
  // with the user's default tree — UserId alone leaves them invisible until
  // the next server restart re-runs the init-schema backfill.
  console.log('\nResolving default tree...');
  const treeResult = await pool.query(
    'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" ASC LIMIT 1',
    [userId]
  );
  let treeId = (treeResult.rows[0] as { Id: number } | undefined)?.Id;
  if (!treeId) {
    const created = await pool.query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'My Tree') RETURNING "Id"`,
      [userId]
    );
    treeId = (created.rows[0] as { Id: number }).Id;
    console.log('Created default tree with ID:', treeId);
  } else {
    console.log('Using default tree ID:', treeId);
  }

  // Assign all NULL records to this user (and their default tree)
  console.log('\nAssigning records to user...');

  await pool.query('UPDATE "People" SET "UserId" = $1, "TreeId" = COALESCE("TreeId", $2) WHERE "UserId" IS NULL', [userId, treeId]);
  console.log(`Updated ${pCount} people`);

  await pool.query('UPDATE "Families" SET "UserId" = $1, "TreeId" = COALESCE("TreeId", $2) WHERE "UserId" IS NULL', [userId, treeId]);
  console.log(`Updated ${fCount} families`);

  await pool.query('UPDATE "Events" SET "UserId" = $1, "TreeId" = COALESCE("TreeId", $2) WHERE "UserId" IS NULL', [userId, treeId]);
  console.log(`Updated ${eCount} events`);

  await pool.query('UPDATE "Media" SET "UserId" = $1, "TreeId" = COALESCE("TreeId", $2) WHERE "UserId" IS NULL', [userId, treeId]);
  console.log(`Updated ${mCount} media`);

  // Verify
  const [verifyPeople, verifyFamilies] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM "People" WHERE "UserId" = $1', [userId]),
    pool.query('SELECT COUNT(*) as count FROM "Families" WHERE "UserId" = $1', [userId]),
  ]);

  console.log('\nMigration complete!');
  console.log(`  - User ${email} (ID: ${userId}) now owns:`);
  console.log(`    - ${(verifyPeople.rows[0] as CountResult).count} people`);
  console.log(`    - ${(verifyFamilies.rows[0] as CountResult).count} families`);

  await pool.end();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
