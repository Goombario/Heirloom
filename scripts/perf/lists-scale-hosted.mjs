// Investigation bench for #7 on the hosted build (DESKTOP_MODE, perf DB): for each GEDCOM,
// overwrite-import it, then time the list APIs and the People/Families pages in Chromium.
// Usage: BASE=http://localhost:3000 node scripts/perf/lists-scale-hosted.mjs a.ged [b.ged ...]
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

async function api(path, n = 12) {
  const times = []; let bytes = 0; let count = null;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await fetch(BASE + path);
    const body = await res.text();
    times.push(performance.now() - t0);
    bytes = body.length; try { count = JSON.parse(body).count ?? null; } catch {}
  }
  return { path, count, KB: Math.round(bytes / 1024), gzipKB: null, cold: Math.round(times[0]), p50: pct(times.slice(1), 0.5), p95: pct(times.slice(1), 0.95) };
}

async function page(browser, route, rowSel) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__lcp = 0; window.__long = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
  });
  const p = await ctx.newPage();
  let transferKB = 0;
  p.on('response', async (r) => { if (r.url().includes('/api/')) { const len = Number((await r.allHeaders())['content-length'] || 0); transferKB += len / 1024; } });
  const out = [];
  for (let run = 0; run < 3; run++) {
    const t0 = Date.now();
    await p.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await p.locator(rowSel).first().waitFor({ timeout: 120_000 });
    const rows = Date.now() - t0;
    await p.waitForTimeout(1200);
    const m = await p.evaluate(() => ({ lcp: Math.round(window.__lcp), tbt: Math.round(window.__long), heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6), dom: document.querySelectorAll('*').length, imgs: document.querySelectorAll('main img').length }));
    out.push({ rows, ...m });
  }
  await ctx.close();
  const med = (k) => pct(out.map((o) => o[k]), 0.5);
  return { route, rowsVisibleMs: med('rows'), lcpMs: med('lcp'), blockingMs: med('tbt'), heapMB: med('heap'), dom: med('dom'), imgs: med('imgs') };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--enable-precise-memory-info'] });
try {
  for (const file of process.argv.slice(2)) {
    const form = new FormData();
    form.append('file', new Blob([await readFile(file)], { type: 'text/plain' }), file.split('/').pop());
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/import/gedcom?mode=overwrite`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`import ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await res.text();
    const result = { file: file.split('/').pop(), importS: Math.round((performance.now() - t0) / 1000), apis: [], pages: [] };
    for (const path of ['/api/people', '/api/families', '/api/places']) result.apis.push(await api(path));
    result.pages.push(await page(browser, '/people', 'main table tbody tr'));
    result.pages.push(await page(browser, '/families', 'main table tbody tr'));
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); }
