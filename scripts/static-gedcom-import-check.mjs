// GEDCOM import through the static build's UI (#1006, #810).
//
// The interop probe and the hostile corpus call the import services directly.
// This drives Import & Export in the browser the way a user does: pick a file,
// choose a mode, preview, import, confirm an overwrite, and wait for the photos.
// It checks what the page reports against the hostile corpus manifest, so the
// expectations live in one place. Large vendor files from `test-data/vendor`
// run when `node scripts/audit/fetch-vendor-gedcoms.mjs` has fetched them.
//
// Reports failures only, and exits 1 on any.
//
// Usage: npm run test:static-import (builds the static app first), or
//        node scripts/static-gedcom-import-check.mjs against an existing out/
//        (set BASE_URL to skip booting a server, SKIP_LARGE=1 to leave out the vendor
//        files, SCREENSHOT_DIR to keep a screenshot of each failed step)

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { withBrowser } from './lib/browser-lifecycle.mjs';
import { resolveChromiumExecutable } from './lib/chromium-resolver.mjs';
import { startStaticPreview } from './lib/managed-static-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(ROOT, 'test-fixtures/gedcom-hostile');
const HABSBURG = path.join(ROOT, 'test-data/vendor/findmypast/Habsburg.ged');
const manifest = JSON.parse(readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const fixture = (file) => {
  const found = manifest.fixtures.find((f) => f.file === file);
  if (!found) throw new Error(`no manifest entry for ${file}`);
  return found;
};

const NAV_TIMEOUT_MS = 60_000;
const IMPORT_TIMEOUT_MS = 120_000;
const LARGE_IMPORT_TIMEOUT_MS = 600_000;
// Steps move on the way a user does, with "Import another file" and the nav links,
// never by reloading: a reload just after an import can lose it (#1008) or leave
// the page waiting on the database worker (#1009). Those have their own issues.

/**
 * Each step imports one file in one mode. `people` is what the result panel's
 * People count shows; `photos` is "ready / total"; `refused` means the page must
 * stop with that error before changing anything.
 */
const STEPS = [
  { file: 'structure/dangling-pointers.ged', mode: 'overwrite', people: 1, warnings: fixture('structure/dangling-pointers.ged').warnings.length },
  // A second merge of the same file adds no one: everyone is already in the tree (#1007).
  { file: 'structure/dangling-pointers.ged', mode: 'merge', people: 0, matched: 'Already in the tree and left unchanged: 1 person', warnings: fixture('structure/dangling-pointers.ged').warnings.length },
  { file: 'genealogy/three-partners.ged', mode: 'overwrite', people: 3, warnings: fixture('genealogy/three-partners.ged').warnings.length },
  // dup.png is ambiguous in the zip, so overwrite must refuse rather than lose it (#1005).
  { file: 'archives/vendor-absolute-media.zip', mode: 'overwrite', refused: 'Import cancelled' },
  { file: 'archives/vendor-relative-media.zip', mode: 'overwrite', people: 2, photos: '2 / 2' },
  { file: 'archives/vendor-case-media.zip', mode: 'overwrite', people: 1, photos: '1 / 1' },
  { file: 'archives/vendor-backslash-media.zip', mode: 'merge', people: 2, photos: '2 / 2' },
];

let baseUrl = process.env.BASE_URL || '';
const failures = [];
const fail = (step, message) => failures.push(`  ${step}: ${message}`);

/** Bring the import form back: load the page once, then reset it in place. */
async function openImportPage(page) {
  if (!page.url().endsWith('/import-export')) {
    await page.goto(`${baseUrl}/import-export`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  }
  const another = page.getByRole('button', { name: 'Import another file' });
  if (await another.isVisible()) await another.click();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true }).first();
  if (await cancel.isVisible()) await cancel.click();
  await page.getByRole('button', { name: 'Preview import' }).first().waitFor({ timeout: NAV_TIMEOUT_MS });
}

/** Import one file through the page; returns what the result panel shows, or the error. */
async function importThroughUi(page, filePath, mode, timeout) {
  await openImportPage(page);
  await page.locator('input[type="file"][accept=".ged,.zip"]').setInputFiles(filePath);
  await page.locator(`input[name="import-mode"][value="${mode}"]`).check();
  await page.getByRole('button', { name: 'Preview import' }).first().click();
  const errorBanner = page.getByText('Error', { exact: true });
  const importButton = page.getByRole('button', { name: 'Import', exact: true });
  await Promise.race([importButton.waitFor({ timeout }), errorBanner.waitFor({ timeout })]);
  if (await errorBanner.isVisible()) return { error: await errorBanner.locator('xpath=..').innerText() };
  const preview = Number(await page.locator('div', { hasText: /^People: \d+$/ }).last().locator('strong').innerText());

  await importButton.click();
  const replace = page.getByRole('button', { name: 'Replace tree' });
  const region = page.getByRole('region', { name: 'Media import recovery' });
  // Only a finished result offers these; a recovery list left by an earlier import doesn't.
  const done = region.getByRole('link', { name: /View people|View imported records/ }).or(region.getByRole('button', { name: 'View imported records' }));
  await Promise.race([replace.waitFor({ timeout }), done.first().waitFor({ timeout }), errorBanner.waitFor({ timeout })]);
  if (await replace.isVisible()) {
    await replace.click();
    await Promise.race([done.first().waitFor({ timeout }), errorBanner.waitFor({ timeout })]);
  }
  if (await errorBanner.isVisible()) return { error: await errorBanner.locator('xpath=..').innerText() };
  await region.getByRole('button', { name: /Processing photos/ }).waitFor({ state: 'hidden', timeout });
  const value = async (label) => {
    const term = region.locator('dt', { hasText: new RegExp(`^${label}$`) });
    return (await term.count()) ? (await term.locator('xpath=following-sibling::dd').innerText()).trim() : null;
  };
  return {
    preview,
    people: Number(await value('People')),
    photos: await value('Photos ready'),
    warnings: await region.locator('ul.list-disc.text-warning-text > li').count(),
    text: await region.innerText(),
  };
}

async function runStep(page, step) {
  const name = `${step.file} (${step.mode})`;
  const got = await importThroughUi(page, path.join(CORPUS, step.file), step.mode, IMPORT_TIMEOUT_MS);
  if (step.refused) {
    if (!got.error?.includes(step.refused)) fail(name, `expected refusal "${step.refused}", got ${JSON.stringify(got)}`);
    return;
  }
  if (got.error) return fail(name, `import failed: ${got.error.replace(/\s+/g, ' ')}`);
  if (got.people !== step.people) fail(name, `People ${got.people}, expected ${step.people}; result: ${got.text.replace(/\s+/g, " ")}`);
  if (step.photos !== undefined && got.photos !== step.photos) fail(name, `Photos ready ${got.photos}, expected ${step.photos}`);
  if (step.matched && !got.text.includes(step.matched)) fail(name, `no "${step.matched}" in the result: ${got.text.replace(/\s+/g, " ")}`);
  if (step.warnings !== undefined && got.warnings !== step.warnings) fail(name, `${got.warnings} import warnings shown, expected ${step.warnings}`);
}

/** A large tree imports through the page and the app still answers afterwards (#957). */
async function runLargeStep(page) {
  const name = 'Habsburg.ged (overwrite)';
  const started = Date.now();
  const got = await importThroughUi(page, HABSBURG, 'overwrite', LARGE_IMPORT_TIMEOUT_MS);
  if (got.error) return fail(name, `import failed: ${got.error.replace(/\s+/g, ' ')}`);
  if (got.people !== got.preview) fail(name, `People ${got.people}, but the preview counted ${got.preview}`);
  console.log(`  ${name}: ${got.people} people in ${Math.round((Date.now() - started) / 1000)}s`);
  await page.getByRole('link', { name: /View people/ }).click();
  try {
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: NAV_TIMEOUT_MS });
  } catch {
    fail(name, 'the People page did not render after the import');
  }
}

let preview;
async function main() {
  if (!baseUrl) {
    preview = await startStaticPreview();
    baseUrl = preview.baseUrl;
  }
  const pageErrors = [];
  await withBrowser(
    () => chromium.launch({ args: ['--no-sandbox'], executablePath: resolveChromiumExecutable() || undefined }),
    async (browser) => {
      // One context throughout: the in-browser database lives in its IndexedDB.
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(() => {
        try { localStorage.setItem('heirloom_local_first_run_seen', '1'); } catch { /* ignore */ }
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => pageErrors.push(String(e.message).split('\n')[0]));
      for (const step of STEPS) {
        const before = failures.length;
        try {
          await runStep(page, step);
        } catch (e) {
          fail(`${step.file} (${step.mode})`, String(e.message).split('\n')[0]);
        }
        if (failures.length > before && process.env.SCREENSHOT_DIR) {
          await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${path.basename(step.file)}-${step.mode}.png`), fullPage: true });
        }
      }
      if (existsSync(HABSBURG) && !process.env.SKIP_LARGE) {
        try {
          await runLargeStep(page);
        } catch (e) {
          fail('Habsburg.ged (overwrite)', String(e.message).split('\n')[0]);
        }
      } else {
        console.log('  Habsburg.ged skipped: fetch it with node scripts/audit/fetch-vendor-gedcoms.mjs, without SKIP_LARGE');
      }
      await ctx.close();
    },
  );
  for (const message of pageErrors) failures.push(`  uncaught page error: ${message}`);

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} static import failure(s):\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ ${STEPS.length} imports through the static UI behaved as the corpus pins them.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await preview?.stop();
  });
