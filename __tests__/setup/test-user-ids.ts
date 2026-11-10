import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

export interface TestUserIds {
  user1: number;
  user2: number;
}

const ID_FILE = path.resolve(process.cwd(), '__tests__/setup/.test-user-ids.json');
const FALLBACK_IDS: TestUserIds = { user1: 1, user2: 2 };

let cached: TestUserIds | null = null;

/**
 * Read the test user IDs written by globalSetup after seeding.
 * Falls back to {1,2} when the file is absent (unit-test runs, or when
 * the integration DB is unavailable and tests skip). The PGlite suite never
 * reads the file: each of its databases seeds the users at 1 and 2
 * (pglite-engine.ts), and `npm run verify` runs it beside the Postgres suite,
 * whose IDs the file holds.
 */
export function getTestUserIds(): TestUserIds {
  if (cached) return cached;
  cached = process.env.TEST_DB_ENGINE !== 'pglite' && existsSync(ID_FILE)
    ? (JSON.parse(readFileSync(ID_FILE, 'utf-8')) as TestUserIds)
    : FALLBACK_IDS;
  return cached;
}

export function writeTestUserIds(ids: TestUserIds): void {
  writeFileSync(ID_FILE, JSON.stringify(ids));
  cached = ids;
}
