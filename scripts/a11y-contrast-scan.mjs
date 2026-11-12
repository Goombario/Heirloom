// Browser-level WCAG color-contrast guard.
//
// Boots the static build, renders the key routes in BOTH themes, runs axe-core,
// and fails (exit 1) if any color-contrast violation is found. This complements
// __tests__/unit/contrast-tokens.test.ts (which guards the raw tokens without a
// browser) by catching a component that wires a bad fg/bg pair onto the page.
//
// Routes are scanned in their empty state (no seeding) so the run stays fast and
// deterministic in CI; data-dependent surfaces (hero dates, list rows) are guarded
// at the token level by the unit test.
//
// Usage: node scripts/a11y-contrast-scan.mjs   (set BASE_URL to skip booting a server)

import { chromium } from 'playwright';
import axeSource from 'axe-core';
import { runConcurrently, withBrowser } from './lib/browser-lifecycle.mjs';
import { resolveChromiumExecutable } from './lib/chromium-resolver.mjs';
import { startStaticPreview } from './lib/managed-static-preview.mjs';

let baseUrl = process.env.BASE_URL || '';
const ROUTES = [
  '/', '/people', '/people/new', '/families', '/library', '/places',
  '/cases', '/relationship', '/import-export', '/options', '/audit', '/data-checks', '/about',
  // Dev-only harness (404s in production builds) — renders the inline
  // edit-mode components (hero identity editor incl. its dark-island
  // wrapper, names panel, relationship list + add panel) with static
  // fixture props, since edit mode is client state on /people/view rather
  // than a URL the fixed route list above can reach. See app/a11y-harness.
  '/a11y-harness',
  // Dev-only v1.1 desktop components page (#55), same 404-in-production rule.
  '/dev/components',
];
const THEMES = ['light', 'dark'];

// Navigation waits on `domcontentloaded` plus an explicit app-ready selector —
// NOT `networkidle`. Playwright discourages `networkidle`, and against a `next dev`
// server it can never settle (the HMR connection keeps the network busy), so every
// navigation burned the full timeout: measured 30.0s on 24/24 route-visits, ~94% of
// the run's wall clock, with an identical cold/warm delta proving it was not compile
// cost. The old code then swallowed that timeout with `.catch(() => {})`.
const READY_SELECTOR = 'nav, header, main';
const NAV_TIMEOUT_MS = Number(process.env.A11Y_NAV_TIMEOUT_MS || 60_000);
// Deliberately much shorter than the navigation timeout: the app shell is in the
// server-rendered HTML, so once `domcontentloaded` has fired the ready selector is
// either already attached or never will be. Waiting the full nav timeout here would
// make a fully-broken run cost 24 × 60s before it reported anything.
const READY_TIMEOUT_MS = 15_000;
const SETTLE_MS = 1500;
// A route that renders (almost) nothing must not be able to report "0 violations":
// axe finds nothing to complain about on a blank page, so a 404 / crash / empty
// shell used to pass the gate silently.
const MIN_ELEMENTS = 20;

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Server at ${url} did not become ready in ${timeoutMs}ms`);
}

/**
 * Scan one route in one theme. Returns `{ violations, combos }` on a successful
 * render, or `{ error }` when the page never became scannable — never a silent zero.
 */
async function scanRoute(page, route) {
  try {
    const res = await page.goto(baseUrl + route, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    if (res && !res.ok()) return { error: `HTTP ${res.status()}` };
    await page.waitForSelector(READY_SELECTOR, { state: 'attached', timeout: READY_TIMEOUT_MS });
  } catch (e) {
    return { error: `never rendered — ${String(e.message).split('\n')[0]}` };
  }

  // Fonts and hydration can repaint text after the ready selector attaches, and a
  // swapped font changes what axe measures.
  await page.waitForTimeout(SETTLE_MS);

  const dom = await page.evaluate(() => ({
    els: document.querySelectorAll('*').length,
    text: (document.body?.innerText || '').trim().length,
  }));
  if (dom.els < MIN_ELEMENTS || dom.text === 0) {
    return {
      error: `rendered empty (${dom.els} elements, ${dom.text} text chars) — ` +
        'a blank page cannot legitimately be "0 violations"',
    };
  }

  await page.evaluate(axeSource.source);
  const res = await page.evaluate(async () =>
    await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } }));
  const violations = res.violations.reduce((s, v) => s + v.nodes.length, 0);
  const combos = [...new Set(res.violations.flatMap((v) =>
    v.nodes.map((node) => (node.failureSummary || '').match(/contrast of [\d.]+.*?background color: #\w+/s)?.[0] || '')))];
  return { violations, combos };
}

/** Scan every route in one theme, in its own browser context. */
async function scanTheme(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  try {
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('theme', t);
        localStorage.setItem('heirloom_local_first_run_seen', '1');
      } catch { /* ignore */ }
    }, theme);

    const results = [];
    for (const route of ROUTES) {
      const r = await scanRoute(page, route);
      results.push({ theme, route, ...r });
      process.stdout.write(`  ${theme} ${route} → ${r.error ? `ERROR (${r.error})` : r.violations}\n`);
    }
    return results;
  } finally {
    await ctx.close();
  }
}

let preview;
async function main() {
  if (!process.env.BASE_URL) {
    preview = await startStaticPreview();
    baseUrl = preview.baseUrl;
  }
  await waitForServer(baseUrl + '/');

  // PLAYWRIGHT_CHROMIUM_PATH lets sandboxed/offline environments point at an
  // already-installed Chromium; CI installs the bundled build and omits it.
  const results = await withBrowser(
    () => chromium.launch({
      args: ['--no-sandbox'],
      executablePath: resolveChromiumExecutable() || undefined,
    }),
    async (browser) => {
      // The themes are independent and the run is dominated by waiting on the server,
      // not by local CPU, so scanning them concurrently roughly halves wall clock.
      // Progress lines interleave, so each is tagged with its theme.
      return runConcurrently(THEMES.map((theme) => () => scanTheme(browser, theme)));
    },
  );

  const broken = results.filter((r) => r.error);
  const total = results.reduce((s, r) => s + (r.violations || 0), 0);
  const failures = results
    .filter((r) => r.violations > 0)
    .map((r) => `  [${r.theme}] ${r.route}: ${r.violations} node(s)\n${
      r.combos.map((c) => '      ' + c.replace(/\s+/g, ' ')).join('\n')}`);

  if (broken.length > 0) {
    console.error(`\n✗ ${broken.length} route(s) could not be scanned:\n${
      broken.map((r) => `  [${r.theme}] ${r.route}: ${r.error}`).join('\n')}`);
  }
  if (total > 0) {
    console.error(`\n✗ ${total} color-contrast violation(s):\n${failures.join('\n')}`);
  }
  if (broken.length > 0 || total > 0) {
    process.exitCode = 1;
  } else {
    console.log(`\n✓ No color-contrast violations across ${ROUTES.length} routes × ${THEMES.length} themes.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await preview?.stop();
  });
