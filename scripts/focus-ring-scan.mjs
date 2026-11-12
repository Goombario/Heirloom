// Browser-level guard for #690: keyboard focus is visible on every interactive
// primitive, in both themes. It also checks #798 (KB-1): the first Tab stop on
// every route is "Skip to content", and following it focuses <main>.
//
// Modeled closely on scripts/a11y-contrast-scan.mjs and scripts/page-shell-scan.mjs:
// same static-preview boot, same ready-selector wait (no `networkidle`), same
// theme-switching (colorScheme + localStorage('theme')), same exit-code/message
// style, and the same "empty render must error, not silently pass" guard.
//
// For each route × theme, this presses real Tab key events from the top of the
// page (nothing pre-focused) and, at each stop, reads the focused element's
// computed `outline-*` / `box-shadow` while it holds focus, and again at rest: only
// a style that appears with focus counts. Most primitives use
// the base `:focus-visible` outline (see app/globals.css); a few (e.g. DataTable
// sort headers) intentionally use an inset `box-shadow` ring instead — both count
// as visible.
//
// Usage: node scripts/focus-ring-scan.mjs   (set BASE_URL to skip booting a server)

import { chromium } from 'playwright';
import { runConcurrently, withBrowser } from './lib/browser-lifecycle.mjs';
import { resolveChromiumExecutable } from './lib/chromium-resolver.mjs';
import { startStaticPreview } from './lib/managed-static-preview.mjs';

let baseUrl = process.env.BASE_URL || '';

// The routes #690 covers for interactive primitives: list/table controls
// (/people, /library), card/journal actions (/cases), form controls
// (/options), filter bar + DataTable sort headers (/audit, the inset
// box-shadow ring case), and the edit-mode surfaces (/a11y-harness, same
// dev-only harness scripts/a11y-contrast-scan.mjs uses to reach inline
// edit-mode components that aren't otherwise a URL).
const ROUTES = ['/people', '/library', '/cases', '/options', '/audit', '/data-checks', '/a11y-harness', '/dev/components'];
const THEMES = ['light', 'dark'];

// Real Tab keypresses can walk a long page; this is a safety bound on total
// keypresses per route/theme, not a claim that every route has this many
// focusable elements — most stop far sooner via the cycle-back check below.
const MAX_TAB_STOPS = 40;
const MIN_OUTLINE_WIDTH_PX = 2;

// Same rationale as scripts/a11y-contrast-scan.mjs: `domcontentloaded` + an
// explicit ready selector, NOT `networkidle` (never settles against a dev
// server's HMR connection; the static preview here doesn't need it either,
// but this keeps the two scripts' navigation behavior identical).
const READY_SELECTOR = 'nav, header, main';
const NAV_TIMEOUT_MS = Number(process.env.A11Y_NAV_TIMEOUT_MS || 60_000);
const READY_TIMEOUT_MS = 15_000;
const SETTLE_MS = 1500;
// A route that renders (almost) nothing must not be able to report "0 stops,
// 0 offenders" as a silent pass — see scripts/a11y-contrast-scan.mjs.
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
 * Read the currently-focused element's identity + computed focus style. Runs
 * in-page so `window.__focusScanFirst` (an actual element reference, not a
 * serialized value) can be compared across calls to detect a cycle back to
 * the first stop without relying on a fragile tag/id/class key.
 */
function readFocusStop() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    return { isBody: true };
  }
  if (window.__focusScanFirst == null) {
    window.__focusScanFirst = el;
  } else if (window.__focusScanFirst === el) {
    return { isBody: false, cycled: true };
  }

  const getAccessibleName = (node) => {
    const ariaLabel = node.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
      if (text) return text.replace(/\s+/g, ' ');
    }
    if (node.tagName === 'IMG') {
      const alt = node.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();
    }
    if (node.id) {
      const label = document.querySelector(`label[for="${window.CSS.escape(node.id)}"]`);
      if (label && label.textContent && label.textContent.trim()) {
        return label.textContent.trim().replace(/\s+/g, ' ');
      }
    }
    const title = node.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const placeholder = node.getAttribute('placeholder');
    const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 60);
    if (placeholder && placeholder.trim()) return placeholder.trim();
    return '(no accessible name)';
  };

  // A borderless field inside a `focus-ring-within` shell (e.g. SearchBar) shows
  // its ring on the shell, so measure the shell instead of the field.
  const ringHost = el.parentElement?.closest('.focus-ring-within') ?? el;
  const read = () => {
    const cs = window.getComputedStyle(ringHost);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, boxShadow: cs.boxShadow };
  };
  const focused = read();
  // The same element at rest. A shadow or outline it always wears (a primary
  // button's glow, a card shadow) is not a focus indicator, so a stop passes only
  // on a style that APPEARS with focus. Refocusing puts the Tab walk back where it
  // was; transitions are frozen for the scan (see scanRoute), so both reads are final.
  el.blur();
  const rest = read();
  el.focus();
  return {
    isBody: false,
    cycled: false,
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className : '',
    name: getAccessibleName(el),
    ...focused,
    rest,
  };
}

const isTransparent = (color) => color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);

function isRingVisible(stop) {
  const { rest } = stop;
  const outlineOk = stop.outlineStyle !== 'none'
    && parseFloat(stop.outlineWidth) >= MIN_OUTLINE_WIDTH_PX
    && !isTransparent(stop.outlineColor)
    && (rest.outlineStyle === 'none' || rest.outlineWidth !== stop.outlineWidth || rest.outlineColor !== stop.outlineColor);
  const boxShadowOk = stop.boxShadow !== 'none' && stop.boxShadow !== rest.boxShadow;
  return outlineOk || boxShadowOk;
}

/**
 * Tab through `page` from the top (nothing pre-focused), capping at
 * `MAX_TAB_STOPS` presses. Elements that land focus on `<body>`/`<html>` are
 * skipped (not recorded, tabbing continues); the walk stops early once focus
 * cycles back to the first recorded stop.
 */
async function collectFocusStops(page) {
  await page.evaluate(() => {
    window.__focusScanFirst = null;
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });

  const stops = [];
  for (let i = 0; i < MAX_TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(readFocusStop);
    if (stop.isBody) continue;
    if (stop.cycled) break;
    stops.push(stop);
  }
  return stops;
}

/**
 * Scan one route in one theme. Returns `{ stops }` on a successful render, or
 * `{ error }` when the page never became scannable — never a silent zero.
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

  // Fonts and hydration can repaint after the ready selector attaches.
  await page.waitForTimeout(SETTLE_MS);
  // Freeze transitions so a computed style read right after a focus change is the
  // settled value, not the first frame of a 120ms ease (#706 motion baseline).
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });

  const dom = await page.evaluate(() => ({
    els: document.querySelectorAll('*').length,
    text: (document.body?.innerText || '').trim().length,
  }));
  if (dom.els < MIN_ELEMENTS || dom.text === 0) {
    return {
      error: `rendered empty (${dom.els} elements, ${dom.text} text chars) — ` +
        'a blank page cannot legitimately be "0 offenders"',
    };
  }

  const stops = await collectFocusStops(page);
  return { stops, skipLink: await checkSkipLink(page, stops) };
}

/**
 * #798 (KB-1): the first Tab stop is "Skip to content", and following it moves
 * focus to `<main>`. Returns a problem string, or null when both hold.
 */
async function checkSkipLink(page, stops) {
  const first = stops[0];
  if (!first || !String(first.className).split(/\s+/).includes('skip-link')) {
    return `first Tab stop is <${first?.tag ?? 'none'}> "${first?.name ?? ''}", not the skip link`;
  }
  await page.focus('.skip-link');
  await page.keyboard.press('Enter');
  const landed = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` : 'none';
  });
  return landed === 'main#main-content' ? null : `following the skip link focused ${landed}, not main`;
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
      const offenders = r.stops ? r.stops.filter((s) => !isRingVisible(s)) : [];
      results.push({ theme, route, ...r, offenders });
      process.stdout.write(
        `  ${theme} ${route} → ${r.error ? `ERROR (${r.error})` : `${r.stops.length - offenders.length}/${r.stops.length} stops OK${r.skipLink ? `; SKIP LINK: ${r.skipLink}` : ''}`}\n`,
      );
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

  const results = await withBrowser(
    () => chromium.launch({
      args: ['--no-sandbox'],
      executablePath: resolveChromiumExecutable() || undefined,
    }),
    async (browser) => runConcurrently(THEMES.map((theme) => () => scanTheme(browser, theme))),
  );

  const broken = results.filter((r) => r.error);
  const totalStops = results.reduce((s, r) => s + (r.stops?.length || 0), 0);
  const totalOffenders = results.reduce((s, r) => s + r.offenders.length, 0);
  const failures = results
    .filter((r) => r.offenders.length > 0)
    .map((r) => `  [${r.theme}] ${r.route}: ${r.offenders.length} offender(s)\n${
      r.offenders.map((o) => {
        const cls = o.className ? `.${String(o.className).trim().split(/\s+/).join('.')}` : '';
        const idAttr = o.id ? `#${o.id}` : '';
        return `      <${o.tag}${idAttr}${cls}> "${o.name}" — focused: outline ${o.outlineStyle} ${o.outlineWidth} ${o.outlineColor}, box-shadow ${o.boxShadow}; at rest: outline ${o.rest.outlineStyle} ${o.rest.outlineWidth}, box-shadow ${o.rest.boxShadow}`;
      }).join('\n')}`);

  if (broken.length > 0) {
    console.error(`\n✗ ${broken.length} route(s) could not be scanned:\n${
      broken.map((r) => `  [${r.theme}] ${r.route}: ${r.error}`).join('\n')}`);
  }
  if (totalOffenders > 0) {
    console.error(`\n✗ ${totalOffenders} focus-ring offender(s) across ${totalStops} stop(s):\n${failures.join('\n')}`);
  }
  const skipFailures = results.filter((r) => r.skipLink);
  if (skipFailures.length > 0) {
    console.error(`\n✗ Skip link (#798) failed on ${skipFailures.length} route(s):\n${
      skipFailures.map((r) => `  [${r.theme}] ${r.route}: ${r.skipLink}`).join('\n')}`);
  }
  if (broken.length > 0 || totalOffenders > 0 || skipFailures.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(`\n✓ Visible focus ring on all ${totalStops} tab stop(s), and a working skip link, across ${ROUTES.length} routes × ${THEMES.length} themes.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await preview?.stop();
  });
