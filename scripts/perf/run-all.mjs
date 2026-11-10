/**
 * Orchestrator — runs every scriptable bench against a running production build
 * and writes a combined baseline/summary.json.
 *
 * Scriptable (browserless) benches run here: API latency + tree-layout compute.
 * The browser-dependent metrics (CWV, render FPS, memory) are captured with
 * Chrome DevTools and documented in README.md; they are recorded into
 * baseline/cwv.json by that procedure, and folded into the summary if present.
 *
 * Usage (app already built + running against the perf DB):
 *   PERF_BASE_URL=http://localhost:3000 node scripts/perf/run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { benchApi } from './bench-api.mjs';
import { benchMedia } from './bench-media.mjs';
import { writeResult, runMeta } from './lib/stats.mjs';
import { BASE_URL } from './config.mjs';

// A stable per-run timestamp threaded into every result envelope. The harness
// never calls Date.now() inside a bench (keeps a bench reproducible); the run
// wrapper stamps it once here.
const timestamp = new Date().toISOString();

async function preflight() {
  try {
    const res = await fetch(BASE_URL + '/api/people');
    return res.status < 500;
  } catch {
    return false;
  }
}

if (!(await preflight())) {
  console.error(`No app responding at ${BASE_URL}. Build + start it against the perf DB first (see README).`);
  process.exit(1);
}

console.log(`Perf run @ ${timestamp} against ${BASE_URL}`);

// 1) API latency (in-process)
const api = await benchApi({ timestamp });
writeResult('scripts/perf/baseline/api-latency.json', api);
console.log('✓ api-latency.json');

// 2) Tree layout compute (needs tsx for TS + d3 imports) — spawned
const layout = spawnSync('npx', ['tsx', 'scripts/perf/bench-tree-layout.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PERF_TIMESTAMP: timestamp },
  shell: process.platform === 'win32',
});
if (layout.status !== 0) console.error('⚠ tree-layout bench failed (see output above)');

// 3) Media upload (in-process; needs sharp)
try {
  const media = await benchMedia({ timestamp });
  writeResult('scripts/perf/baseline/media-upload.json', media);
  console.log('✓ media-upload.json');
} catch (e) {
  console.error('⚠ media bench failed:', e.message);
}

// 4) Compose summary
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const summary = {
  kind: 'perf-summary',
  meta: runMeta({ baseUrl: BASE_URL }),
  timestamp,
  benches: {
    apiLatency: read('scripts/perf/baseline/api-latency.json'),
    treeLayout: read('scripts/perf/baseline/tree-layout.json'),
    mediaUpload: read('scripts/perf/baseline/media-upload.json'),
    cwv: read('scripts/perf/baseline/cwv.json'), // populated by the browser procedure
    treeFps: read('scripts/perf/baseline/tree-fps.json'), // populated by the browser procedure
  },
};
writeResult('scripts/perf/baseline/summary.json', summary);
console.log('\n✓ wrote scripts/perf/baseline/summary.json');
