// Phone person page checks (#1053): accessibility and the touch behaviour jsdom can't see.
//
// Boots the static build, restores test-fixtures/synthetic.hlbak, and opens a person at
// 390×844 with a touch device profile in both themes. On every tab it asserts no sideways
// page scroll, no axe violations (WCAG 2 A/AA rules) and a 44px hit on every control, a
// ::before hit-area counted. Then, in one theme: a sideways drag changes tab and is
// announced, each tab opens where it was left, a drag from the left 24px or a short one
// doesn't, a sheet takes focus, the phone's Back closes it without leaving the page (or
// asks first when something was typed, the mobile audit's MB-3), and the Undo toast lands
// in a live region, and Adjust crop draws the photo.
//
// Roles: the static build is always the owner, so the contributor and viewer variants are
// covered by __tests__/unit/mobile-person-page.test.tsx instead.
//
// Usage: node scripts/mobile-person-scan.mjs   (set BASE_URL to skip booting a server)

import path from 'node:path';
import { chromium } from 'playwright';
import axeSource from 'axe-core';
import { withBrowser } from './lib/browser-lifecycle.mjs';
import { resolveChromiumExecutable } from './lib/chromium-resolver.mjs';
import { startStaticPreview } from './lib/managed-static-preview.mjs';

let baseUrl = process.env.BASE_URL || '';
const FIXTURE = path.resolve('test-fixtures/synthetic.hlbak');
// Aster Arbor: a birth, a death, family, a name, a note and citations in the fixture.
const PERSON = '/people/view?id=1';
const THEMES = ['light', 'dark'];
const TABS = ['overview', 'events', 'family', 'media', 'sources'];
const TIMEOUT = 30_000;
const MIN_TARGET = 44;
// axe's `target-size` measures boxes, so it can't see the ::before hit areas that take the
// small chips to 44px tall; smallTargets() below counts them and holds the stricter 44px floor.
const AXE_SKIP = ['target-size'];

const failures = [];
const fail = (where, what) => failures.push(`  ${where}: ${what}`);

async function restoreFixture(page) {
  // Phone Options (#1122) has no Local data section, so restore at desktop width.
  const phone = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(baseUrl + '/options', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').first().setInputFiles(FIXTURE);
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Restore', exact: true }).click({ timeout: TIMEOUT });
  // The page reloads once the data is in.
  await page.waitForEvent('load', { timeout: TIMEOUT });
  await page.setViewportSize(phone);
}

async function openPerson(page) {
  await page.goto(baseUrl + PERSON, { waitUntil: 'domcontentloaded' });
  await page.locator('.mp-root [role=tablist]').waitFor({ timeout: TIMEOUT });
  await page.locator('.mp-root h1').filter({ hasText: /\S/ }).waitFor({ timeout: TIMEOUT });
  await page.waitForTimeout(800);
}

const selectedTab = (page) => page.locator('.mp-root [role=tab][aria-selected=true]').getAttribute('data-tab');

/** Controls on the page (sheets included) whose hit area, ::before counted, is under 44px. */
function smallTargets(page) {
  return page.evaluate((min) => {
    const out = [];
    const controls = document.querySelectorAll('.mp-root :is(button, a[href], [role=button], [role=tab], [role=switch]), [data-vaul-drawer] :is(button, a[href], [role=button])');
    for (const el of controls) {
      if (el.closest('[aria-hidden=true], [inert]') || el.getAttribute('tabindex') === '-1') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const b = getComputedStyle(el, '::before');
      const grow = (v) => Math.max(0, -parseFloat(v) || 0);
      const extended = b.content !== 'none' && b.position === 'absolute';
      const w = r.width + (extended ? grow(b.left) + grow(b.right) : 0);
      const h = r.height + (extended ? grow(b.top) + grow(b.bottom) : 0);
      // Citation chips: 44 tall, and 24 across, as far as the gap to their neighbours allows.
      const minW = el.classList.contains('cite-chip') ? 24 : min;
      if (w < minW - 0.5 || h < min - 0.5) {
        out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" ${Math.round(w)}×${Math.round(h)}`);
      }
    }
    return out;
  }, MIN_TARGET);
}

async function axe(page, scope = '.mp-root') {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource.source);
  const res = await page.evaluate(async ({ skip, scope }) => await window.axe.run(scope, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: Object.fromEntries(skip.map((id) => [id, { enabled: false }])),
  }), { skip: AXE_SKIP, scope });
  return res.violations.map((v) => `${v.id} ×${v.nodes.length}: ${v.nodes[0]?.target?.join(' ')}`);
}

async function scanTabs(page, theme) {
  for (const tab of TABS) {
    await page.locator(`.mp-root [role=tab][data-tab=${tab}]`).click();
    await page.waitForTimeout(400);
    const where = `[${theme}] ${tab}`;
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (sw > iw) fail(where, `the page scrolls sideways (${sw}px wide at ${iw})`);
    for (const t of await smallTargets(page)) fail(where, `target under 44px: ${t}`);
    for (const v of await axe(page)) fail(where, `axe ${v}`);
  }
  await page.locator('.mp-root [role=tab][data-tab=overview]').click();
}

/** A touch drag through CDP, which Playwright's touchscreen API can't do. */
async function drag(page, cdp, x0, x1, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(450);
}

async function checkGestures(page) {
  const where = '[gestures]';
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('.mp-root [role=tabpanel]').boundingBox();
  const y = Math.min(box.y + 100, 760);

  await drag(page, cdp, 320, 90, y);
  if ((await selectedTab(page)) !== 'events') fail(where, `a drag to the left should show Events, showed ${await selectedTab(page)}`);
  const said = (await page.locator('.mp-root p[aria-live]').textContent())?.trim();
  if (!said || !/events/i.test(said)) fail(where, `the tab change wasn't announced ("${said}")`);
  await drag(page, cdp, 90, 320, y);
  if ((await selectedTab(page)) !== 'overview') fail(where, 'a drag to the right should go back to Overview');
  await drag(page, cdp, 90, 320, y);
  if ((await selectedTab(page)) !== 'overview') fail(where, 'Overview is first; a drag to the right should leave it');
  await drag(page, cdp, 320, 280, y);
  if ((await selectedTab(page)) !== 'overview') fail(where, 'a short drag changed tab');
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (sw > iw) fail(where, `the page scrolls sideways after swiping (${sw}px wide at ${iw})`);
  // Once the photo has scrolled away, each tab opens where it was left (its top the first time).
  const stuckAt = await page.evaluate(() => {
    const tabs = document.querySelector('.mp-root [role=tablist]');
    return tabs.previousElementSibling.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(tabs).top);
  });
  await page.evaluate((top) => window.scrollTo(0, top), stuckAt + 300);
  await page.waitForTimeout(200);
  const left = await page.evaluate(() => window.scrollY);
  await drag(page, cdp, 320, 90, 500);
  const opened = await page.evaluate(() => window.scrollY);
  if (Math.abs(opened - stuckAt) > 2) fail(where, `Events should open at its top under the tabs (scrolled to ${opened}, the tabs stick at ${Math.round(stuckAt)})`);
  await drag(page, cdp, 90, 320, 500);
  const back = await page.evaluate(() => window.scrollY);
  if (Math.abs(back - left) > 2) fail(where, `Overview should come back where it was left (${left}), came back at ${back}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  // The left edge belongs to the phone's own Back: Chromium may go back, but the tab must not move.
  const before = page.url();
  await drag(page, cdp, 8, 300, y);
  if (page.url() === before && (await selectedTab(page)) !== 'overview') fail(where, 'a drag from the left edge changed tab');
  if (page.url() !== before) await openPerson(page);
}

async function checkSheetAndBack(page) {
  const where = '[sheet]';
  // By text, not role: while a sheet animates away the page behind it is still aria-hidden.
  const opener = page.locator('.mp-root button', { hasText: 'Add note' });
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'New note' });
  await sheet.waitFor({ timeout: TIMEOUT });
  await page.waitForTimeout(500);
  if (!(await sheet.evaluate((el) => el.contains(document.activeElement)))) fail(where, 'opening the sheet left focus behind it');
  for (const t of await smallTargets(page)) fail(where, `target under 44px: ${t}`);
  const url = page.url();
  await page.evaluate(() => history.back());
  await page.waitForTimeout(700);
  if (page.url() !== url) fail(where, `Back left the page (${page.url()}) instead of closing the sheet`);
  if (await sheet.isVisible()) fail(where, 'Back did not close the sheet');
  else if (!(await opener.evaluate((el) => el === document.activeElement))) fail(where, 'focus did not come back to "Add note"');

  // With something typed, Back asks first (audit MB-3), every time, and never leaves.
  await opener.click();
  await sheet.waitFor({ timeout: TIMEOUT });
  await sheet.locator('textarea').fill('A note from the phone check');
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  for (const round of [1, 2]) {
    await page.evaluate(() => history.back());
    await page.waitForTimeout(600);
    if (page.url() !== url) { fail(where, `Back ${round} with changes left the page`); return; }
    if (!(await ask.isVisible())) fail(where, `Back ${round} with changes didn't ask "Discard your changes?"`);
    else await ask.getByRole('button', { name: 'Keep editing' }).click();
    await page.waitForTimeout(300);
  }
  if (!(await sheet.isVisible())) fail(where, 'Keep editing closed the sheet');

  // A saved change lands in a live region, so a screen reader hears it. A local
  // write resolves only after its IndexedDB flush (#1033), so wait for the toast.
  await sheet.getByRole('button', { name: 'Save' }).click();
  const heard = await page.waitForFunction(
    () => [...document.querySelectorAll('[aria-live]')].some((el) => /Note added/.test(el.textContent || '')),
    null,
    { timeout: TIMEOUT },
  ).then(() => true, () => false);
  if (page.url() !== url) fail(where, `saving left the page (${page.url()})`);
  if (!heard) fail(where, 'the "Note added" toast is not inside a live region');
}

/** Edit person: a typing sheet with Delete for editors. Opened and left untouched. */
async function checkEditSheet(page) {
  const where = '[edit person]';
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.mp-root header').getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit person' });
  await sheet.waitFor({ timeout: TIMEOUT });
  await page.waitForTimeout(500);
  for (const t of await smallTargets(page)) fail(where, `target under 44px: ${t}`);
  for (const v of await axe(page, '[data-vaul-drawer]')) fail(where, `axe ${v}`);
  if (!(await sheet.getByText('Delete person', { exact: true }).isVisible())) fail(where, 'an editor has no Delete person row');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(600);
}

/** Adjust crop draws the photo on the stage (it once stayed blank: the stage was measured before the sheet mounted it). */
async function checkCrop(page) {
  const where = '[portrait crop]';
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.mp-root button[aria-label="Portrait"]').first().click();
  await page.getByRole('button', { name: 'Adjust crop' }).click();
  const screen = page.getByRole('dialog', { name: 'Adjust portrait' });
  await screen.waitFor({ timeout: TIMEOUT });
  const placed = screen.locator('[role=img] img[style*="transform"]');
  await placed.waitFor({ timeout: TIMEOUT }).catch(() => fail(where, 'the photo never drew on the crop stage'));
  await screen.getByRole('button', { name: 'Back' }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

async function scan(browser) {
  // One profile throughout: the restored fixture lives in this browser's storage.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  try {
    const page = await ctx.newPage();
    // The init script runs on every navigation, so the theme to use rides in sessionStorage.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', sessionStorage.getItem('scan-theme') || 'light');
        localStorage.setItem('heirloom_local_first_run_seen', '1');
      } catch { /* ignore */ }
    });
    await restoreFixture(page);
    for (const [i, theme] of THEMES.entries()) {
      await page.evaluate((t) => sessionStorage.setItem('scan-theme', t), theme);
      await page.emulateMedia({ colorScheme: theme });
      await openPerson(page);
      await scanTabs(page, theme);
      if (i === 0) {
        for (const check of [checkGestures, checkEditSheet, checkCrop, checkSheetAndBack]) {
          await check(page).catch((e) => fail(`[${check.name}]`, `stopped: ${String(e.message).split('\n')[0]}`));
        }
      }
      console.log(`  ${theme}: scanned ${TABS.length} tabs${i === 0 ? ', gestures and sheet' : ''}`);
    }
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
  await withBrowser(
    () => chromium.launch({ args: ['--no-sandbox'], executablePath: resolveChromiumExecutable() || undefined }),
    scan,
  );
  if (failures.length) {
    console.error(`\n✗ ${failures.length} phone person page problem(s):\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ Phone person page: no sideways scroll, axe clean, 44px targets, swipe, Back and announcements work.');
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await preview?.stop(); });
