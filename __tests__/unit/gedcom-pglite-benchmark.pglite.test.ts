import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { readFileSync, statSync, existsSync } from 'fs';

// Route the whole data layer at the PGlite connection, exactly like the static build.
vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Local perf benchmark. Point at any large .ged via GEDCOM_BENCH_FILE; without
// it (as in CI) this skips.
// NOTE: in-memory PGlite has NO Web Worker / IndexedDB, so this measures the
// import service+engine only — it does NOT reproduce the browser's per-statement
// worker round-trip cost (see the branch's investigation notes).
const GEDCOM_PATH = process.env.GEDCOM_BENCH_FILE ?? '';

const describeIf = existsSync(GEDCOM_PATH) ? describe : describe.skip;

describeIf('BENCHMARK GEDCOM import on in-memory PGlite (static code path)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('imports the benchmark file via LocalGedcomClient and reports timing', async () => {
    // Import lazily so the connection mock is active first.
    const { LocalGedcomClient } = await import('@/lib/data/local/gedcom');
    const client = new LocalGedcomClient();

    const bytes = readFileSync(GEDCOM_PATH);
    const sizeKB = (statSync(GEDCOM_PATH).size / 1024).toFixed(1);
    const file = new File([bytes], 'benchmark.ged', { type: 'text/plain' });

    const start = performance.now();
    const result = await client.importGedcom({ file, mode: 'overwrite' }, null);
    const elapsedMs = performance.now() - start;

    console.log('\n===== PGLITE (in-memory) IMPORT BENCHMARK =====');
    console.log(`File:    ${GEDCOM_PATH} (${sizeKB} KB)`);
    console.log(`Elapsed: ${elapsedMs.toFixed(0)} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
    console.log(`Result:  ${JSON.stringify(result)}`);
    console.log('===============================================\n');

    expect(result.peopleCount).toBeGreaterThan(2000);
  }, 300_000);
});
