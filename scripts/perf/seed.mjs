/**
 * Seed a perf database from a GEDCOM by POSTing it to a running app that has
 * DESKTOP_MODE=true (auth bypassed) and DATABASE_URL pointed at the perf DB.
 *
 * This uses the real import code path only to LOAD data — import/export timing
 * is deliberately NOT a metric of this harness (the import is being revamped to
 * cut SQL calls, so any number here would be stale by design). We just need a
 * realistic large tree in the DB for every other bench to run against.
 *
 * Usage:
 *   PERF_BASE_URL=http://localhost:3000 node scripts/perf/seed.mjs <path-to.ged>
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { BASE_URL } from './config.mjs';

const gedPath = process.argv[2] ?? process.env.GEDCOM_PATH;
if (!gedPath) {
  console.error('Usage: node scripts/perf/seed.mjs <path-to.ged>');
  process.exit(1);
}

const mode = process.env.SEED_MODE ?? 'overwrite';
const bytes = await readFile(gedPath);
const form = new FormData();
form.append('file', new Blob([bytes], { type: 'text/plain' }), basename(gedPath));

console.log(`Seeding ${BASE_URL} from ${gedPath} (${(bytes.length / 1024).toFixed(0)} KB, mode=${mode})…`);
const t0 = performance.now();
const res = await fetch(`${BASE_URL}/api/import/gedcom?mode=${mode}`, { method: 'POST', body: form });
const ms = performance.now() - t0;
const body = await res.text();

if (!res.ok) {
  console.error(`Import failed: HTTP ${res.status}\n${body}`);
  process.exit(1);
}
console.log(`Seed OK in ${(ms / 1000).toFixed(1)}s (import timing is informational, not a benchmark)`);
console.log(body.slice(0, 600));
