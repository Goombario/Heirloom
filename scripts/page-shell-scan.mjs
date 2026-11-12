// Browser-level guard for #689: every top-level route renders exactly one
// `<main>`, owned by the new `PageShell` (data-page-shell="list|detail|workspace"),
// and list-page titles (`h1`) align on a common left edge within a variant.
//
// Modeled closely on scripts/a11y-contrast-scan.mjs: same static-preview boot,
// same ready-selector wait (no `networkidle`), same exit-code/message style.
// Routes are scanned in their empty state (no seeding) so the run stays fast
// and deterministic in CI.
//
// Usage: node scripts/page-shell-scan.mjs   (set BASE_URL to skip booting a server)

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runConcurrently, withBrowser } from './lib/browser-lifecycle.mjs';
import { resolveChromiumExecutable } from './lib/chromium-resolver.mjs';
import { startStaticPreview } from './lib/managed-static-preview.mjs';

let baseUrl = process.env.BASE_URL || '';

// The top-level routes #689 covers. `/people/new` now only redirects to the
// People list's Add person dialog (#52), so it is checked for hydration only.
const ROUTES = [
  '/', '/people', '/families', '/library', '/places',
  '/cases', '/relationship', '/import-export', '/options', '/audit', '/data-checks', '/about',
];

// Routes whose h1 is a hero title inside a card, not the PageShell title block,
// so it sits inside the card's padding by design. Home's "Welcome back" lives in
// the dark welcome hero. Their <main>/shell check still runs.
const HERO_TITLE_ROUTES = new Set(['/']);

// Routes whose desktop page is a full-width workspace by design, not a list page:
// Places Explore is the map and its rail across the whole width (#56). On a phone
// they stay list pages. Their h1 sits in the workspace, so it is not aligned.
const DESKTOP_WORKSPACE_ROUTES = new Set(['/places']);
const expectedShell = (route, viewport) => (viewport === 'desktop' && DESKTOP_WORKSPACE_ROUTES.has(route) ? 'workspace' : 'list');

// Every route above, plus `/people/new`, fails the scan on a React hydration
// error in either viewport (#845): the prerender is desktop-width, so markup
// picked from the viewport on the first client render mismatches at 390.
const HYDRATION_ROUTES = [...ROUTES, '/people/new'];
// Production React logs a mismatch as minified error #418 (text), #423/#425
// (text/attribute), or #419/#422 (a Suspense boundary that fell back); a dev
// server spells it out.
const HYDRATION_ERROR = /Minified React error #(418|419|422|423|425)\b|Hydration failed|hydrated but some attributes|didn't match the client/i;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

// A route that legitimately renders no `h1` in the empty state (onboarding,
// redirect) is detected at scan time (h1Left === null) and excluded from the
// h1-alignment comparison below, not hardcoded here — its <main>/shell check
// still runs, and it's reported separately.

// Same rationale as scripts/a11y-contrast-scan.mjs: `domcontentloaded` + an
// explicit ready selector, NOT `networkidle` (never settles against a dev
// server's HMR connection; the static preview here doesn't need it either,
// but this keeps the two scripts' navigation behavior identical).
const READY_SELECTOR = 'nav, header, main';
const NAV_TIMEOUT_MS = Number(process.env.A11Y_NAV_TIMEOUT_MS || 60_000);
const READY_TIMEOUT_MS = 15_000;
// This app's local-first data mode does a cold PGlite init/query on first
// paint. Measured on the static build: /audit gates its whole `<main>` behind
// that fetch (~3.1s to appear), and /library's real `h1` (inside
// `LibraryHeader`) mounts ~2.8s after its skeleton `<main>` — both well past a
// flat short settle. So this waits for `main` explicitly (bounded, and a
// genuine failure if it never shows), then best-effort for `h1` shortly after.
const MAIN_TIMEOUT_MS = 20_000;
const H1_TIMEOUT_MS = 8_000;
const SETTLE_MS = 800;
const ALIGNMENT_TOLERANCE_PX = 1;
// A route that fails the shell check is screenshotted here, and every uncaught
// page error is printed, so a one-off failure in CI names its exception (#1016).
const FAILURE_DIR = process.env.PAGE_SHELL_SCAN_DIR || 'test-results/page-shell-scan';

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
 * Navigate to `route` and wait for the app shell to be ready. Returns nothing
 * on success; throws with a short, greppable message on failure.
 */
async function gotoReady(page, route) {
  const res = await page.goto(baseUrl + route, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT_MS,
  });
  if (res && !res.ok()) throw new Error(`HTTP ${res.status()}`);
  await page.waitForSelector(READY_SELECTOR, { state: 'attached', timeout: READY_TIMEOUT_MS });
  // The READY_SELECTOR above matches the persistent app chrome (nav/header),
  // which can attach before the route's own PageShell `<main>` does — wait for
  // it explicitly so a slow cold fetch doesn't read as "no main" (see
  // MAIN_TIMEOUT_MS above). A route that truly never renders a `<main>` fails
  // here with a real error, not a silent zero.
  await page.waitForSelector('main', { state: 'attached', timeout: MAIN_TIMEOUT_MS });
  // Best-effort: some routes gate their real `h1` behind a second async step
  // after `main` first mounts (a loading skeleton swaps in the title once data
  // resolves). Give it a bounded chance to show up before measuring; a route
  // that truly never renders one (onboarding, redirect) just times out here —
  // this call never fails the scan, only lets a fair measurement happen.
  await page.waitForSelector('h1', { state: 'visible', timeout: H1_TIMEOUT_MS }).catch(() => {});
  // Fonts and hydration can repaint/reflow text after the above settle, and
  // this test measures pixel positions.
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Scan one route in one viewport: `<main>` count + its `data-page-shell`
 * attribute, and the first visible `h1`'s left edge (or `null` if none).
 * Returns `{ error }` when the page never became scannable — never a silent
 * pass.
 */
async function scanRoute(page, route, viewportName) {
  let result;
  try {
    await gotoReady(page, route);
    result = await measureRoute(page);
  } catch (e) {
    result = { error: `never rendered — ${String(e.message).split('\n')[0]}` };
  }
  if (result.error || result.mainCount !== 1 || result.pageShellVariant !== 'list') {
    result.screenshot = await saveFailureShot(page, viewportName, route);
  }
  return result;
}

/** Best-effort full-page screenshot of a failing route; returns its path or null. */
async function saveFailureShot(page, viewportName, route) {
  const file = `${FAILURE_DIR}/${viewportName}${route === '/' ? '-home' : route.replaceAll('/', '-')}.png`;
  try {
    await mkdir(FAILURE_DIR, { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

function measureRoute(page) {
  return page.evaluate(() => {
    const mains = document.querySelectorAll('main');
    const mainCount = mains.length;
    const pageShellVariant = mains.length === 1 ? mains[0].getAttribute('data-page-shell') : null;

    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const h1 = [...document.querySelectorAll('h1')].find(isVisible) || null;
    // A v1.1 desktop page titles itself in the navy cover band (#55), its h1 inset
    // in the band: the band's own edge is what lines up with the other pages' titles.
    const band = h1 ? h1.closest('.cover-band') : null;
    const h1Left = h1 ? (band || h1).getBoundingClientRect().left : null;

    return { mainCount, pageShellVariant, h1Left };
  });
}

/**
 * Scan every route in one viewport, in its own browser context. Also records
 * React hydration errors on every route in HYDRATION_ROUTES, as
 * `{ viewport, route, text }`.
 */
async function scanViewport(browser, viewport) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem('heirloom_local_first_run_seen', '1');
      } catch { /* ignore */ }
    });

    let current = null;
    const hydrationErrors = [];
    // Every uncaught exception, not just hydration ones: a client error that reaches
    // the root renders Next's global error page, which otherwise shows up here only
    // as "main count=0" (#1016).
    const pageErrors = [];
    const record = (text) => {
      if (HYDRATION_ERROR.test(text)) hydrationErrors.push({ viewport: viewport.name, route: current, text: text.split('\n')[0] });
    };
    page.on('pageerror', (e) => {
      record(String(e.message));
      pageErrors.push({ viewport: viewport.name, route: current, text: String(e.stack || e.message).split('\n').slice(0, 6).join('\n    ') });
    });
    page.on('console', (msg) => { if (msg.type() === 'error') record(msg.text()); });

    const results = [];
    for (const route of HYDRATION_ROUTES) {
      current = route;
      if (!ROUTES.includes(route)) {
        // Hydration only: the list-shell and h1 checks don't apply to this route.
        try {
          await gotoReady(page, route);
        } catch (e) {
          results.push({ viewport: viewport.name, route, error: `never rendered — ${String(e.message).split('\n')[0]}` });
        }
        continue;
      }
      const r = await scanRoute(page, route, viewport.name);
      results.push({ viewport: viewport.name, route, ...r });
      process.stdout.write(
        `  ${viewport.name} ${route} → ${r.error ? `ERROR (${r.error})` : `main×${r.mainCount} shell=${r.pageShellVariant} h1Left=${r.h1Left}`}\n`,
      );
    }
    return { results, hydrationErrors, pageErrors };
  } finally {
    await ctx.close();
  }
}

// #806 (T-1, T-2): at 768 every top-level destination shows its name (no
// icon-only nav), and the People and Families tables fit without scrolling
// sideways. The empty state has no rows to overflow, so this one stage restores
// the synthetic fixture into its own browser context first.
const TABLET_VIEWPORT = { width: 768, height: 1024 };
const TABLET_FIXTURE = fileURLToPath(new URL('../test-fixtures/synthetic.hlbak', import.meta.url));
const TABLET_TABLE_ROUTES = ['/people', '/families'];
// The nav's top-level destinations (app/components/nav/navItems.ts). The gear
// and account controls are icon buttons by design, not destinations.
const TABLET_NAV_DESTINATIONS = ['/people', '/families', '/tree', '/library', '/places', '/cases'];

async function scanTablet(browser) {
  const ctx = await browser.newContext({ viewport: TABLET_VIEWPORT });
  const problems = [];
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem('heirloom_local_first_run_seen', '1');
      } catch { /* ignore */ }
    });
    page.on('dialog', (d) => d.accept());

    try {
      await gotoReady(page, '/options');
      await page.locator('input[type="file"][accept=".hlbak"]').first().setInputFiles(TABLET_FIXTURE);
      await page.getByRole('button', { name: 'Restore', exact: true }).click({ timeout: NAV_TIMEOUT_MS });
      await page.waitForEvent('load', { timeout: NAV_TIMEOUT_MS });
    } catch (e) {
      return [`768: could not restore ${TABLET_FIXTURE} — ${String(e.message).split('\n')[0]}`];
    }

    for (const route of TABLET_TABLE_ROUTES) {
      try {
        await gotoReady(page, route);
        await page.locator('main table tbody tr').first().waitFor({ state: 'visible', timeout: MAIN_TIMEOUT_MS });
      } catch (e) {
        problems.push(`768 ${route}: no table rows after the restore — ${String(e.message).split('\n')[0]}`);
        continue;
      }
      let m;
      try {
        m = await page.evaluate((destinations) => {
          const table = document.querySelector('main table');
          const wrap = table.parentElement;
          const nav = document.querySelector('nav.app-nav');
          const shown = (el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
          const links = [...nav.querySelectorAll('a[href]')]
            .filter((a) => shown(a) && destinations.includes(new URL(a.href).pathname));
          return {
            table: [table.scrollWidth, wrap.clientWidth],
            page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
            links: links.length,
            unlabelled: links.filter((a) => !a.innerText.trim()).map((a) => new URL(a.href).pathname),
          };
        }, TABLET_NAV_DESTINATIONS);
      } catch (e) {
        problems.push(`768 ${route}: could not measure the nav and table — ${String(e.message).split('\n')[0]}`);
        continue;
      }
      process.stdout.write(`  tablet ${route} → table ${m.table[0]}/${m.table[1]}px, page ${m.page[0]}/${m.page[1]}px, ${m.links} nav links\n`);
      if (m.table[0] > m.table[1]) problems.push(`768 ${route}: table overflows its card (scrollWidth ${m.table[0]} > clientWidth ${m.table[1]})`);
      if (m.page[0] > m.page[1]) problems.push(`768 ${route}: page scrolls sideways (${m.page[0]} > ${m.page[1]})`);
      if (m.links !== TABLET_NAV_DESTINATIONS.length) problems.push(`768 ${route}: ${m.links} of ${TABLET_NAV_DESTINATIONS.length} nav destinations visible`);
      if (m.unlabelled.length > 0) problems.push(`768 ${route}: nav links without a visible label: ${m.unlabelled.join(', ')}`);
    }
    return problems;
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

  const { listResults, hydrationErrors, pageErrors, tabletProblems } = await withBrowser(
    () => chromium.launch({
      args: ['--no-sandbox'],
      executablePath: resolveChromiumExecutable() || undefined,
    }),
    async (browser) => {
      // Viewports are independent and the run is dominated by waiting on the
      // server, not local CPU, so scanning them concurrently roughly halves
      // wall clock — same rationale as the theme concurrency in
      // a11y-contrast-scan.mjs. The tablet check runs in its own context
      // alongside them.
      const [viewportResults, tabletProblems] = await Promise.all([
        runConcurrently(VIEWPORTS.map((viewport) => () => scanViewport(browser, viewport))),
        scanTablet(browser),
      ]);
      return {
        listResults: viewportResults.flatMap((v) => v.results),
        hydrationErrors: viewportResults.flatMap((v) => v.hydrationErrors),
        pageErrors: viewportResults.flatMap((v) => v.pageErrors),
        tabletProblems,
      };
    },
  );

  const problems = [];
  const errorsFor = (r) => pageErrors.filter((e) => e.viewport === r.viewport && e.route === r.route);
  // A failing row's own page errors and screenshot, indented under it.
  const detail = (r) => [
    ...errorsFor(r).map((e) => `\n      page error: ${e.text}`),
    r.screenshot ? `\n      screenshot: ${r.screenshot}` : '',
  ].join('');

  // 1. Every route: exactly one <main>, data-page-shell="list" (or its desktop workspace).
  const broken = listResults.filter((r) => r.error);
  const badShell = listResults.filter((r) => !r.error && (r.mainCount !== 1 || r.pageShellVariant !== expectedShell(r.route, r.viewport)));
  if (broken.length > 0) {
    problems.push(`${broken.length} route/viewport combo(s) could not be scanned:\n${
      broken.map((r) => `  [${r.viewport}] ${r.route}: ${r.error}${detail(r)}`).join('\n')}`);
  }
  if (badShell.length > 0) {
    problems.push(`${badShell.length} route/viewport combo(s) have the wrong <main>/shell:\n${
      badShell.map((r) => `  [${r.viewport}] ${r.route}: main count=${r.mainCount}, data-page-shell=${r.pageShellVariant}${detail(r)}`).join('\n')}`);
  }

  // 1b. No route hydrates with a mismatch, at either width (#845).
  if (hydrationErrors.length > 0) {
    problems.push(`${hydrationErrors.length} React hydration error(s):\n${
      hydrationErrors.map((e) => `  [${e.viewport}] ${e.route}: ${e.text}`).join('\n')}`);
  } else {
    console.log(`\n✓ No hydration errors across ${HYDRATION_ROUTES.length} routes × ${VIEWPORTS.length} viewports.`);
  }

  // 2. Per viewport, all recorded h1 lefts must agree within tolerance.
  const excluded = [];
  const alignmentReports = [];
  for (const viewport of VIEWPORTS) {
    const rows = listResults.filter((r) => r.viewport === viewport.name && !r.error);
    const withH1 = rows.filter((r) => r.h1Left != null && !HERO_TITLE_ROUTES.has(r.route) && expectedShell(r.route, r.viewport) === 'list');
    const withoutH1 = rows.filter((r) => r.h1Left == null);
    for (const r of withoutH1) {
      excluded.push(`[${r.viewport}] ${r.route}: no visible h1 in the empty state`);
    }
    if (withH1.length === 0) continue;

    const lefts = withH1.map((r) => r.h1Left);
    const reference = lefts[0];
    const outliers = withH1.filter((r) => Math.abs(r.h1Left - reference) > ALIGNMENT_TOLERANCE_PX);
    alignmentReports.push(
      `  [${viewport.name}] h1 lefts: ${withH1.map((r) => `${r.route}=${r.h1Left.toFixed(1)}`).join(', ')}`,
    );
    if (outliers.length > 0) {
      problems.push(`${viewport.name}: h1 left edges misaligned (reference ${reference.toFixed(1)}px from ${withH1[0].route}):\n${
        outliers.map((r) => `  [${r.viewport}] ${r.route}: ${r.h1Left.toFixed(1)}px${detail(r)}`).join('\n')}`);
    }
  }

  // 4. Tablet (768): labelled nav, tables that fit (#806).
  if (tabletProblems.length > 0) {
    problems.push(`768px layout (#806):\n${tabletProblems.map((p) => `  ${p}`).join('\n')}`);
  } else {
    console.log(`\n✓ 768px: nav destinations are labelled and ${TABLET_TABLE_ROUTES.join(' and ')} tables fit.`);
  }

  // Uncaught page errors never fail the scan on their own, but are always listed.
  if (pageErrors.length > 0) {
    console.log(`\nUncaught page errors (${pageErrors.length}):\n${
      pageErrors.map((e) => `  [${e.viewport}] ${e.route}: ${e.text}`).join('\n')}`);
  }

  console.log(`\nh1 alignment by viewport:\n${alignmentReports.join('\n')}`);
  if (excluded.length > 0) {
    console.log(`\nRoutes excluded from h1-alignment (no visible h1 in the empty state — onboarding/redirect, not faked):\n${
      excluded.map((e) => `  ${e}`).join('\n')}`);
  }

  if (problems.length > 0) {
    console.error(`\n✗ page-shell-scan failures:\n\n${problems.join('\n\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ Every route renders exactly one <main> with its expected shell and h1 titles align across ${ROUTES.length} routes × ${VIEWPORTS.length} viewports.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await preview?.stop();
  });
