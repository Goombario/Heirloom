// Investigation scan for #21: every axe WCAG 2.x A/AA rule (plus best-practice, reported
// separately) over the routes WITH data (test-fixtures/synthetic.hlbak restored), on
// desktop and phone, in both themes, plus a few opened states (notes row menu, dialogs).
// Writes a JSON report; does not gate anything.
//
// Usage: BASE_URL=http://127.0.0.1:4173 node scripts/a11y-deep-scan.mjs out.json

import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import axeSource from 'axe-core';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const outFile = process.argv[2] || 'a11y-deep.json';
const FIXTURE = path.resolve('test-fixtures/synthetic.hlbak');
const ROUTES = [
  '/', '/people', '/people/view?id=1', '/people/view?id=2', '/people/new', '/families', '/families/view?id=1',
  '/families/new', '/library', '/library/view?id=1', '/library/faces', '/places', '/places/view?id=1',
  '/cases', '/cases/view?id=1', '/cases/new', '/tree', '/relationship', '/import-export', '/options',
  '/audit', '/data-checks', '/about', '/privacy', '/a11y-harness', '/dev/components',
];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const THEMES = ['light', 'dark'];

async function axe(page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource.source);
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({
      id: v.id, impact: v.impact, tags: v.tags.filter((t) => /^wcag|best-practice/.test(t)), help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: (n.failureSummary || '').slice(0, 240) })),
    }));
  });
}

async function restore(page) {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(baseUrl + '/options', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').first().setInputFiles(FIXTURE);
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Restore', exact: true }).click({ timeout: 30_000 });
  await page.waitForEvent('load', { timeout: 60_000 });
  // The first load after a restore switches data directories and takes ~15 s; navigating
  // away earlier leaves the empty default tree on screen.
  await page.getByText('Synthetic QA Fixture').first().waitFor({ timeout: 90_000 });
}

async function visit(page, route) {
  const res = await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (res && !res.ok()) return `HTTP ${res.status()}`;
  await page.waitForSelector('main', { state: 'attached', timeout: 15_000 }).catch(() => {});
  await page.getByText('Synthetic QA Fixture').first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2200);
  const els = await page.evaluate(() => document.querySelectorAll('*').length);
  return els < 20 ? `rendered empty (${els})` : null;
}

/** Opened states the route list can't reach. Each returns a label or null when it couldn't open. */
const STATES = [
  { route: '/people/view?id=1', label: 'person notes row menu', open: async (p) => {
    const b = p.locator('button[aria-haspopup="menu"]').filter({ has: p.locator('svg') });
    const n = await b.count(); if (!n) return false; await b.first().click(); await p.waitForTimeout(400); return true; } },
  { route: '/people/view?id=1', label: 'person edit dialog', open: async (p) => {
    const b = p.getByRole('button', { name: /^Edit$/ }); if (!(await b.count())) return false; await b.first().click(); await p.waitForTimeout(600); return true; } },
  { route: '/people', label: 'keyboard shortcut cheatsheet', open: async (p) => { await p.keyboard.press('Shift+Slash'); await p.waitForTimeout(600); return (await p.getByRole('dialog').count()) > 0; } },
  { route: '/tree', label: 'tree with a person selected', open: async (p) => {
    const c = p.locator('.react-flow__node').first(); if (!(await c.count())) return false; await c.click(); await p.waitForTimeout(600); return true; } },
];

const results = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: theme, ...(vpName === 'phone' ? { hasTouch: true, isMobile: true } : {}) });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('heirloom_local_first_run_seen', '1'); } catch {} }, theme);
    const page = await ctx.newPage();
    await restore(page);
    await page.setViewportSize(vp);
    for (const route of ROUTES) {
      const err = await visit(page, route);
      const violations = err ? [] : await axe(page);
      results.push({ vp: vpName, theme, route, error: err, violations });
      process.stdout.write(`${vpName} ${theme} ${route}: ${err ?? violations.reduce((s, v) => s + v.nodes.length, 0)}\n`);
    }
    if (vpName === 'desktop') for (const s of STATES) {
      const err = await visit(page, s.route);
      const opened = err ? false : await s.open(page).catch(() => false);
      const violations = opened ? await axe(page) : [];
      results.push({ vp: vpName, theme, route: `${s.route} [${s.label}]`, error: opened ? null : 'could not open', violations });
      process.stdout.write(`${vpName} ${theme} [${s.label}]: ${opened ? violations.reduce((n, v) => n + v.nodes.length, 0) : 'not opened'}\n`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(outFile, JSON.stringify(results, null, 1));
