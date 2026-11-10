/**
 * API latency bench — round-trip wall-clock for each hot endpoint against a
 * running production build.
 *
 * Against localhost the round trip (TTFB + full body read) is dominated by
 * server-side work — route handler + DB queries + serialization — so it is a
 * faithful proxy for backend cost without instrumenting the app. We record:
 *   - cold: the very first hit per endpoint (route compile / cache-cold path)
 *   - warm: p50/p95/p99 over SAMPLES after WARMUP discarded
 *   - bytes: response payload size (a big list is its own finding)
 *
 * A large cold-vs-warm gap or a fat payload points straight at the N+1
 * relationship-resolution concern the audit is chasing.
 *
 * Usage: node scripts/perf/bench-api.mjs   (expects the app already running)
 */
import { API_ENDPOINTS, BASE_URL, WARMUP, SAMPLES, THRESHOLDS } from './config.mjs';
import { summarize, round, writeResult, runMeta, padCols } from './lib/stats.mjs';

async function hit(path) {
  const t0 = performance.now();
  const res = await fetch(BASE_URL + path, { headers: { accept: 'application/json' } });
  const buf = await res.arrayBuffer(); // include full body read in the timing
  return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength };
}

/** Discover a real person id so detail routes hit a populated record. */
async function discoverPersonId() {
  try {
    const res = await fetch(BASE_URL + '/api/people');
    const data = await res.json();
    const list = data.people ?? data;
    return Array.isArray(list) && list.length ? list[0].id ?? list[0].Id : null;
  } catch {
    return null;
  }
}

function resolvePath(ep, ids) {
  if (!ep.dynamicId) return ep.path;
  const id = ids[ep.dynamicId];
  return id == null ? null : ep.path.replace(`{${ep.dynamicId}}`, String(id));
}

export async function benchApi({ timestamp } = {}) {
  const ids = { person: await discoverPersonId() };
  const results = [];

  for (const ep of API_ENDPOINTS) {
    const path = resolvePath(ep, ids);
    if (!path) {
      results.push({ key: ep.key, skipped: 'no dynamic id available' });
      continue;
    }

    // cold — first ever hit for this endpoint
    const cold = await hit(path);
    if (cold.status >= 400) {
      results.push({ key: ep.key, path, error: `HTTP ${cold.status}`, cold: round(cold.ms) });
      continue;
    }

    for (let i = 0; i < WARMUP; i++) await hit(path);

    const samples = [];
    let bytes = cold.bytes;
    for (let i = 0; i < SAMPLES; i++) {
      const r = await hit(path);
      samples.push(r.ms);
      bytes = r.bytes;
    }

    const warm = summarize(samples);
    const flags = [];
    if (warm.p95 > THRESHOLDS.api_p95_ms) flags.push(`warm p95 ${warm.p95}ms > ${THRESHOLDS.api_p95_ms}ms`);
    if (cold.ms > THRESHOLDS.api_cold_ms) flags.push(`cold ${round(cold.ms)}ms > ${THRESHOLDS.api_cold_ms}ms`);

    results.push({
      key: ep.key,
      path,
      status: cold.status,
      bytesKB: round(bytes / 1024),
      cold_ms: round(cold.ms),
      warm,
      coldWarmDelta_ms: round(cold.ms - warm.p50),
      flags,
    });
  }

  const envelope = { kind: 'api-latency', meta: runMeta({ baseUrl: BASE_URL, samples: SAMPLES, warmup: WARMUP }), timestamp, results };
  return envelope;
}

function printTable(env) {
  const w = [22, 9, 9, 9, 9, 9];
  console.log('\n=== API latency (ms, warm unless noted) ===');
  console.log(padCols(['endpoint', 'cold', 'p50', 'p95', 'p99', 'KB'], w));
  console.log('-'.repeat(80));
  for (const r of env.results) {
    if (r.skipped) { console.log(padCols([r.key, 'SKIP: ' + r.skipped], w)); continue; }
    if (r.error) { console.log(padCols([r.key, r.error], w)); continue; }
    console.log(padCols([r.key, r.cold_ms, r.warm.p50, r.warm.p95, r.warm.p99, r.bytesKB], w));
    for (const f of r.flags) console.log('   ⚠ ' + f);
  }
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bench-api.mjs')) {
  const env = await benchApi({ timestamp: process.env.PERF_TIMESTAMP ?? null });
  printTable(env);
  writeResult('scripts/perf/baseline/api-latency.json', env);
  console.log('\nwrote scripts/perf/baseline/api-latency.json');
}
