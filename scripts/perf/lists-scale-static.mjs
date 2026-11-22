// Investigation bench for #7 and #4 in the static (PGlite) build: imports a GEDCOM through
// the page, then times People, Families and Places Explore. Reports, does not gate.
//
// Usage: BASE_URL=http://127.0.0.1:4173 node scripts/perf/lists-scale-static.mjs a.ged [b.ged ...]

import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const TIMEOUT = 900_000;
const PLACE_ROW = process.env.PHONE === '1' ? 'ul.list-none > li > .min-h-14' : '.explore-row';

async function importGedcom(page, file) {
  await page.goto(`${baseUrl}/import-export`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Choose file' }).first().click();
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.getByRole('button', { name: 'Check the file' }).click();
  const go = page.getByRole('button', { name: /^Import [\d,]+ people$/ });
  await go.waitFor({ timeout: TIMEOUT });
  const t0 = Date.now();
  await go.click();
  await page.locator('main').getByRole('link', { name: 'View families' }).waitFor({ timeout: TIMEOUT });
  return Date.now() - t0;
}

/** Collect long tasks and event timings from the page's start. */
const OBSERVE = () => {
  window.__perf = { long: 0, longest: 0, events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__perf.long += Math.max(0, e.duration - 50); window.__perf.longest = Math.max(window.__perf.longest, e.duration); } }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.events.push({ name: e.name, d: e.duration }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
};

async function measure(page, route, rowSel, searchText) {
  const t0 = Date.now();
  await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' });
  await page.locator(rowSel).first().waitFor({ timeout: 120_000 });
  const firstRow = Date.now() - t0;
  await page.waitForTimeout(1500);
  const rows = await page.locator(rowSel).count();
  const dom = await page.evaluate(() => document.querySelectorAll('*').length);
  const heap = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6));
  const loadPerf = await page.evaluate(() => ({ ...window.__perf }));
  // One keystroke into the page's search box: worst event duration ≈ INP for that interaction.
  let typing = null;
  const box = page.locator('main input[type="search"], main input[role="searchbox"], main input[placeholder*="Search" i], main input[placeholder*="Find" i]').filter({ visible: true }).first();
  if (searchText && await box.count()) {
    await page.evaluate(() => { window.__perf.events = []; });
    await box.click();
    for (const ch of searchText) { await page.keyboard.type(ch); await page.waitForTimeout(250); }
    await page.waitForTimeout(800);
    const ev = await page.evaluate(() => window.__perf.events);
    typing = Math.round(Math.max(0, ...ev.filter((e) => /key|input/.test(e.name)).map((e) => e.d)));
  }
  return { route, firstRowMs: firstRow, rows, dom, heapMB: heap, blockingMs: Math.round(loadPerf.long), longestTaskMs: Math.round(loadPerf.longest), worstKeystrokeMs: typing };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--enable-precise-memory-info'] });
try {
  for (const file of process.argv.slice(2)) {
    const phone = process.env.PHONE === '1';
    // Import at desktop width (the phone import page is a different flow); phone runs then narrow the viewport and throttle the CPU 4x.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: phone });
    await ctx.addInitScript(() => { try { localStorage.setItem('heirloom_local_first_run_seen', '1'); } catch {} });
    await ctx.addInitScript(OBSERVE);
    const page = await ctx.newPage();
    const importMs = await importGedcom(page, file);
    // Let the post-import reload / data-dir switch settle before timing anything.
    await page.goto(baseUrl + '/places', { waitUntil: 'domcontentloaded' });
    await page.locator('.explore-row').first().waitFor({ timeout: 300_000 });
    const out = { file: file.split('/').pop(), phone, importMs, pages: [] };
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    if (phone) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    for (let run = 0; run < 2; run++) {
      if (!process.env.PLACES_ONLY) {
        out.pages.push({ run, ...(await measure(page, '/people', 'main table tbody tr', 'ash')) });
        out.pages.push({ run, ...(await measure(page, '/families', 'main table tbody tr', 'ash')) });
      }
      out.pages.push({ run, ...(await measure(page, '/places', PLACE_ROW, 'ham')) });
    }
    console.log(JSON.stringify(out));
    await ctx.close();
  }
} finally { await browser.close(); }
