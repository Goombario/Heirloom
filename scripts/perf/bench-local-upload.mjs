/**
 * Local photo-upload bench (#1259): add N photos through Library → Upload in the
 * static build, in WebKit and Chromium, and time each photo as the dialog marks
 * it done. Without a batch flush, each photo waits for a whole-file IndexedDB
 * flush, so later photos take longer than early ones.
 *
 * Usage: node scripts/perf/bench-local-upload.mjs   (needs a current `out/`)
 * Env:   PHOTOS=100  BROWSERS=webkit,chromium  BASE_URL=<skip booting a preview>
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, webkit } from 'playwright';
import { startStaticPreview } from '../lib/managed-static-preview.mjs';

const PHOTOS = Number(process.env.PHOTOS ?? 100);
const BROWSERS = (process.env.BROWSERS ?? 'webkit,chromium').split(',');
const DIR = path.join(os.tmpdir(), `heirloom-bench-photos-${PHOTOS}`);
const UPLOAD_TIMEOUT_MS = 30 * 60_000;

/** Camera-sized JPEGs with smooth gradients plus mild noise, ~1 MB once re-encoded at 2048px. */
async function makePhotos() {
  mkdirSync(DIR, { recursive: true });
  const files = [];
  for (let i = 0; i < PHOTOS; i++) {
    const file = path.join(DIR, `photo-${String(i).padStart(3, '0')}.jpg`);
    files.push(file);
    if (existsSync(file)) continue;
    const w = 3000, h = 2000;
    const raw = Buffer.allocUnsafe(w * h * 3);
    let seed = (i + 1) * 2654435761;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const n = (seed >>> 24) & 0x1f;
        const o = (y * w + x) * 3;
        raw[o] = (x * 255 / w + i * 7 + n) & 0xff;
        raw[o + 1] = (y * 255 / h + n) & 0xff;
        raw[o + 2] = ((x + y) * 128 / w + i * 13 + n) & 0xff;
      }
    }
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toFile(file);
  }
  return files;
}

async function run(browserType, baseUrl, files) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      try { localStorage.setItem('heirloom_local_first_run_seen', '1'); } catch { /* fresh profile */ }
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/library?tab=photos`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByRole('button', { name: 'Upload', exact: true }).first().click({ timeout: 120_000 });
    await page.getByLabel('Choose photos or documents').setInputFiles(files);
    const add = page.getByRole('dialog').getByRole('button', { name: new RegExp(`^Add ${files.length}$`) });
    await add.waitFor({ timeout: 120_000 });

    // Record when each photo's "Uploading photo-NNN.jpg" status first appears.
    await page.evaluate(() => {
      window.__marks = [];
      const t0 = performance.now();
      let last = 0;
      new MutationObserver(() => {
        const m = document.body.innerText.match(/Uploading photo-(\d+)\.jpg/);
        const n = m ? Number(m[1]) + 1 : null;
        if (n && n !== last) { last = n; window.__marks.push([n, performance.now() - t0]); }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const t0 = Date.now();
    await add.click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: UPLOAD_TIMEOUT_MS });
    const total = (Date.now() - t0) / 1000;
    const marks = await page.evaluate(() => window.__marks);
    // Photo n's time = when n+1 started (or the end for the last one) minus when n started.
    const ends = marks.map(([, t], i) => (marks[i + 1]?.[1] ?? total * 1000) - t);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) / 1000;
    const k = Math.min(10, Math.floor(ends.length / 2));
    return { total, first: avg(ends.slice(0, k)), last: avg(ends.slice(-k)), k, counted: ends.length };
  } finally {
    await browser.close();
  }
}

const files = await makePhotos();
let preview = null;
let baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  preview = await startStaticPreview();
  baseUrl = preview.baseUrl;
}
const results = {};
try {
  for (const name of BROWSERS) {
    const type = name === 'webkit' ? webkit : chromium;
    const r = await run(type, baseUrl, files);
    results[name] = r;
    console.log(`${name.padEnd(9)} ${PHOTOS} photos: ${r.total.toFixed(1)} s total · first ${r.k}: ${r.first.toFixed(2)} s/photo · last ${r.k}: ${r.last.toFixed(2)} s/photo`);
  }
} finally {
  await preview?.stop();
}
if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(results, null, 2));
