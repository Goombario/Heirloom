/**
 * Service-level read bench on PGlite (#1268): imports the task audit's large
 * tree (`scripts/ux-audit/gen-large-gedcom.mjs`, 4,834 people) and times each
 * page's main read with its query count and JSON payload size. No server, no
 * browser: it isolates SQL and service work from network and render cost.
 *
 *   npm run benchmark:services
 *
 * Writes `scripts/perf/baseline/services.json` (or `$PERF_OUT`). Set
 * `PERF_EXPLAIN="<bench name>"` to also write that bench's slowest query plan
 * to `services-explain.txt` beside it, and `PERF_QUERIES="<bench name>"` to
 * write each of that bench's queries with its own time to `services-queries.txt`.
 */
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../../__tests__/setup/pglite-snapshot';

const counter = { on: false, lastEnd: 0, calls: [] as { text: string; params?: unknown[]; ms: number }[] };
vi.mock('@/lib/db/connection', async () => {
  const m = await import('@/lib/db/connection.pglite');
  return {
    ...m,
    query: async (text: string, params?: unknown[]) => {
      if (!counter.on) return m.query(text, params);
      const t0 = performance.now();
      const r = await m.query(text, params);
      // PGlite runs one query at a time, so a query sent alongside others spends
      // most of its wait queued. Its own time starts when the one before it ended.
      const end = performance.now();
      counter.calls.push({ text, params, ms: end - Math.max(t0, counter.lastEnd) });
      counter.lastEnd = end;
      return r;
    },
  };
});

import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getTreeService } from '@/lib/services/tree';
import { getDashboardService, getSuggestionsService } from '@/lib/services/dashboard';
import { listDataChecksService, summarizeDataChecksService } from '@/lib/services/data-checks';
import { listPeopleService, getPersonService } from '@/lib/services/people';
import { listFamiliesService, getFamilyService } from '@/lib/services/families';
import { listPlacesService, getPlaceDetailService } from '@/lib/services/places';
import { listFaceQueueService } from '@/lib/services/media-faces';
import { listSourcesService } from '@/lib/services/sources';
import { listAuditService } from '@/lib/services/audit';
import { listCasesService } from '@/lib/services/cases';

const USER_ID = 991_268;
const OUT = process.env.PERF_OUT ?? path.resolve('scripts/perf/baseline/services.json');
const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 100);
const results: { name: string; ms: number; queries: number; kb: number; slowest: string }[] = [];

/** Best of three warm runs; the query count and payload come from the last. */
async function measure(name: string, fn: () => Promise<unknown>) {
  await fn();
  let best = Infinity;
  let bytes = 0;
  for (let i = 0; i < 3; i++) {
    counter.calls = [];
    counter.on = true;
    const t0 = performance.now();
    const out = await fn();
    best = Math.min(best, performance.now() - t0);
    counter.on = false;
    bytes = JSON.stringify(out ?? null).length;
  }
  const slowest = [...counter.calls].sort((a, b) => b.ms - a.ms)[0];
  results.push({
    name, ms: Math.round(best), queries: counter.calls.length, kb: Math.round(bytes / 1024),
    slowest: slowest ? `${Math.round(slowest.ms)} ms ${oneLine(slowest.text)}` : '',
  });
  if (process.env.PERF_QUERIES === name) {
    writeFileSync(
      path.join(path.dirname(OUT), 'services-queries.txt'),
      counter.calls.map((c) => `${String(Math.round(c.ms)).padStart(5)} ms  ${oneLine(c.text)}`).join('\n') + '\n',
    );
  }
  if (process.env.PERF_EXPLAIN === name && slowest) {
    const plan = await query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${slowest.text}`, slowest.params);
    writeFileSync(path.join(path.dirname(OUT), 'services-explain.txt'), plan.rows.map((r) => Object.values(r as object)[0]).join('\n'));
  }
}

describe('service reads on the large tree', () => {
  let db: PGlite;
  let dir: string;
  let treeId: number;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'bench-services-'));
    const out = path.join(dir, 'large-tree.ged');
    execFileSync(process.execPath, [path.resolve('scripts/ux-audit/gen-large-gedcom.mjs'), '--out', out]);
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'bench@test.local', 'bench']);
    treeId = await resolveDefaultTree(USER_ID);
    const file = new File([readFileSync(out)], 'large-tree.ged', { type: 'text/plain' });
    await importGedcomService({ file, mode: 'overwrite', currentUserId: USER_ID });
  }, 300_000);

  afterAll(async () => {
    writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
    console.table(results.map(({ slowest: _slowest, ...r }) => r));
    __setTestDb(null);
    await db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('times each page read', async () => {
    const s = { requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID };
    const first = async <T>(sql: string, params: unknown[]) => (await query(sql, params)).rows[0] as T;
    const { Id: personId } = await first<{ Id: number }>('SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "GedcomId" = $2', [treeId, '@I2245@']);
    const { id: familyId } = await first<{ id: number }>(
      `SELECT fp."FamiliesAsChildId" AS id FROM "FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId"
        WHERE f."TreeId" = $1 GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT 1`, [treeId]);
    const { id: placeId } = await first<{ id: number }>(
      `SELECT "BirthPlaceId" AS id FROM "People" WHERE "TreeId" = $1 AND "BirthPlaceId" IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT 1`, [treeId]);

    await measure('tree descendants', () => getTreeService({ ...s, id: personId, mode: 'descendants' }));
    await measure('tree ancestors', () => getTreeService({ ...s, id: personId, mode: 'ancestors' }));
    await measure('home dashboard', () => getDashboardService(s));
    await measure('home suggestions', () => getSuggestionsService(s));
    await measure('data checks', () => listDataChecksService(s));
    await measure('home data checks summary', () => summarizeDataChecksService(s));
    await measure('people list', () => listPeopleService(s));
    await measure('person', () => getPersonService({ ...s, id: personId }));
    await measure('families list', () => listFamiliesService(s));
    await measure('family', () => getFamilyService({ ...s, id: familyId }));
    await measure('places list', () => listPlacesService(s));
    await measure('place detail', () => getPlaceDetailService({ ...s, id: placeId }));
    await measure('face queue', () => listFaceQueueService(s));
    await measure('sources list', () => listSourcesService({ ...s, withCounts: true }));
    await measure('audit page', () => listAuditService({ ...s, page: 1, pageSize: 50 }));
    await measure('cases list', () => listCasesService(s));
  }, 300_000);
});
