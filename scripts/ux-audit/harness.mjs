// Browser session helper for task-based UX audits (see README.md in this folder).
//
// One persistent Chromium profile per viewport (or per PROFILE), so the active
// tree and other localStorage settings carry across scripts the way they do for
// a real user. Every screenshot is numbered and logged with the elapsed time,
// the URL, and any page errors, console errors or failed /api/ calls seen since
// the previous step. `focus()` and `tab()` report where keyboard focus lands,
// for keyboard-only runs.
//
// The harness records; it doesn't assert. Use it to explore and to gather
// evidence, then turn confirmed findings into real tests.
//
// Environment:
//   BASE_URL  app under test (default http://127.0.0.1:3000)
//   OUT_DIR   evidence root (default .playwright-screenshots/ux-audit)
//   PROFILE   profile name (default w<width>); delete OUT_DIR/.profiles to start fresh

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChromiumExecutable } from '../lib/chromium-resolver.mjs';

export const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT_DIR = process.env.OUT_DIR || '.playwright-screenshots/ux-audit';

/**
 * Open a session. `name` is the evidence subfolder for this script's screenshots and log.
 * Options: width, height, theme ('light' | 'dark'), language ('en' | 'fr' | 'ru'),
 * treeId (sets the active tree before the first page load), profile.
 */
export async function session(name, { width = 1440, height = 900, theme = 'light', language, treeId, profile } = {}) {
  const dir = path.join(OUT_DIR, 'shots', name);
  fs.mkdirSync(dir, { recursive: true });
  const profileDir = path.join(OUT_DIR, '.profiles', profile || process.env.PROFILE || `w${width}`);
  const mobile = width < 600;
  const ctx = await chromium.launchPersistentContext(profileDir, {
    executablePath: resolveChromiumExecutable() ?? undefined,
    viewport: { width, height },
    colorScheme: theme,
    deviceScaleFactor: 1,
    acceptDownloads: true,
    hasTouch: mobile,
    isMobile: mobile,
  });
  await ctx.addInitScript(([t, lang, tree]) => {
    try {
      localStorage.setItem('theme', t);
      if (lang) localStorage.setItem('language', lang);
      if (tree != null) localStorage.setItem('heirloom.activeTree', JSON.stringify({ treeId: tree }));
    } catch {
      // Storage can be unavailable on error pages; the step log will show the failure.
    }
  }, [theme, language, treeId]);
  const page = ctx.pages()[0] || (await ctx.newPage());

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 240));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE_URL, '')}`);
  });

  const log = [];
  const t0 = Date.now();
  let n = 0;
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const s = {
    page,
    ctx,
    dir,
    errors,
    log,
    /** Navigate to an app path and wait for the network to settle. */
    async go(url) {
      await page.goto(BASE_URL + url, { waitUntil: 'networkidle', timeout: 120000 }).catch((e) => log.push(`goto failed ${url}: ${e}`));
      await page.waitForTimeout(800);
    },
    /** Numbered screenshot plus a log line with any errors since the last one. */
    async shot(label, fullPage = false) {
      await page.waitForTimeout(500);
      const file = `${String(++n).padStart(2, '0')}-${label}.png`;
      await page.screenshot({ path: path.join(dir, file), fullPage }).catch(() => {});
      const errs = errors.splice(0);
      log.push(`[${elapsed()}] ${file} ${page.url().replace(BASE_URL, '')}${errs.length ? ' ERR: ' + errs.join(' | ') : ''}`);
      return file;
    },
    /** Free-text observation in the step log. */
    note(text) {
      log.push('  - ' + text);
    },
    /** Describe the focused element: tag, role, accessible text, position; BODY when focus is lost. */
    async focus() {
      return page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return 'BODY';
        const r = e.getBoundingClientRect();
        const role = e.getAttribute('role');
        const text = (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        return `${e.tagName.toLowerCase()}${role ? `[${role}]` : ''} "${text}" @${Math.round(r.x)},${Math.round(r.y)}${r.width === 0 ? ' INVISIBLE' : ''}`;
      });
    },
    /** Press a key `times` times and return where focus landed after each press. */
    async tab(times = 1, key = 'Tab') {
      const stops = [];
      for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(120);
        stops.push(await s.focus());
      }
      return stops;
    },
    /** Run one user action, log a failure instead of throwing, then take a screenshot. */
    async step(label, fn, fullPage = false) {
      try {
        await fn();
      } catch (e) {
        log.push(`FAILED ${label}: ${String(e).split('\n')[0].slice(0, 220)}`);
      }
      return s.shot(label, fullPage);
    },
    /** Write log.txt, print the log, and close the browser. */
    async done() {
      if (errors.length) log.push('ERR at end: ' + errors.join(' | '));
      fs.writeFileSync(path.join(dir, 'log.txt'), log.join('\n') + '\n');
      console.log(log.join('\n'));
      await ctx.close();
    },
  };
  return s;
}
