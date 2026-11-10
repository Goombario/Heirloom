/**
 * Media upload bench — end-to-end latency of POST /api/media/upload, which
 * includes server-side sharp compression (resize to 2048px, JPEG q85).
 *
 * Uploads a synthetic image at a couple of source sizes so the report reflects
 * both a typical photo and a near-limit (10MB) upload. Requires the app running
 * in DESKTOP_MODE (auth bypassed). sharp is a project dependency.
 *
 * Usage: node scripts/perf/bench-media.mjs
 */
import sharp from 'sharp';
import { BASE_URL } from './config.mjs';
import { summarize, round, writeResult, runMeta, padCols } from './lib/stats.mjs';

const SAMPLES = Number(process.env.PERF_MEDIA_SAMPLES ?? 8);

/** Build a noisy JPEG of the given pixel dimension (noise resists compression). */
async function makeImage(dim) {
  const px = dim * dim * 3;
  const buf = Buffer.allocUnsafe(px);
  for (let i = 0; i < px; i++) buf[i] = (i * 2654435761) & 0xff; // cheap deterministic noise
  return sharp(buf, { raw: { width: dim, height: dim, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

async function uploadOnce(bytes, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), name);
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/media/upload`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  return { ms: performance.now() - t0, status: res.status, storedId: body?.media?.Id ?? body?.media?.id };
}

export async function benchMedia({ timestamp } = {}) {
  const cases = [
    { key: 'photo~2MP', dim: 1500 },
    { key: 'photo~near10MB', dim: 2550 },
  ];
  const results = [];

  for (const c of cases) {
    const bytes = await makeImage(c.dim);
    const first = await uploadOnce(bytes, `${c.key}.jpg`);
    if (first.status >= 400) {
      results.push({ key: c.key, srcKB: round(bytes.length / 1024), error: `HTTP ${first.status}` });
      continue;
    }
    const samples = [first.ms];
    for (let i = 1; i < SAMPLES; i++) samples.push((await uploadOnce(bytes, `${c.key}-${i}.jpg`)).ms);
    results.push({ key: c.key, srcKB: round(bytes.length / 1024), status: first.status, ms: summarize(samples) });
  }

  return { kind: 'media-upload', meta: runMeta({ baseUrl: BASE_URL, samples: SAMPLES }), timestamp, results };
}

function printTable(env) {
  const w = [16, 10, 9, 9, 9, 9];
  console.log('\n=== Media upload (incl. sharp compression, ms) ===');
  console.log(padCols(['case', 'srcKB', 'p50', 'p95', 'max', 'mean'], w));
  console.log('-'.repeat(70));
  for (const r of env.results) {
    if (r.error) { console.log(padCols([r.key, r.srcKB, r.error], w)); continue; }
    console.log(padCols([r.key, r.srcKB, r.ms.p50, r.ms.p95, r.ms.max, r.ms.mean], w));
  }
}

if (process.argv[1]?.endsWith('bench-media.mjs')) {
  const env = await benchMedia({ timestamp: process.env.PERF_TIMESTAMP ?? null });
  printTable(env);
  writeResult('scripts/perf/baseline/media-upload.json', env);
  console.log('\nwrote scripts/perf/baseline/media-upload.json');
}
