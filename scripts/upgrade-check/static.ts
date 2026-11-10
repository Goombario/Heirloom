// Static half of the upgrade check (#811). Run by scripts/upgrade-check/run.sh.
// The release's static build restores a backup into IndexedDB and saves a backup;
// then the candidate build is served on the same origin, in the same browser
// context, so it opens that IndexedDB the way a returning visitor's browser does,
// and saves one backup before a reload and one after. The backups are compared
// table by table.
//
// Usage: tsx scripts/upgrade-check/static.ts <release out/> <candidate out/> <restore.hlbak> <report dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { inspectBackupLogical } from '../../lib/db/connection.pglite';
import { snapshotTables, compareSnapshots, printComparison, type Snapshot } from './snapshot';
import { resolveChromiumExecutable } from '../lib/chromium-resolver.mjs';
import { startStaticPreview } from '../lib/managed-static-preview.mjs';

const [outOld, outNew, restoreFile, reportDir] = process.argv.slice(2);
const PORT = Number(process.env.UPGRADE_CHECK_PORT || 3977);
const BASE = `http://127.0.0.1:${PORT}`;

async function openOptions(page: Page): Promise<void> {
  await page.goto(`${BASE}/options`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const button = page.getByRole('button', { name: 'Download backup' }).first();
  await button.waitFor({ timeout: 120_000 });
  // The static export renders this button before React hydrates it, and a click
  // in that gap is dropped: no backup starts and the download wait times out
  // (#1299). React attaches its props to the element once hydrated.
  // (No named functions in the page callback: tsx wraps them in a helper the page lacks.)
  await page.waitForFunction(
    (el) => !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$')),
    await button.elementHandle(),
    { timeout: 60_000, polling: 50 },
  );
}

async function downloadBackup(page: Page, name: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: 'Download backup' }).first().click(),
  ]);
  const file = path.join(reportDir, name);
  await download.saveAs(file);
  return file;
}

async function snapshotBackup(file: string): Promise<Snapshot> {
  const { datadir } = await inspectBackupLogical(new Blob([readFileSync(file)]));
  const db = await PGlite.create({ loadDataDir: datadir });
  try {
    return await snapshotTables(async (sql) => (await db.query<Record<string, unknown>>(sql)).rows);
  } finally {
    await db.close();
  }
}

async function drive(): Promise<string[]> {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: resolveChromiumExecutable() || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    // A native save dialog can't be driven headless: take the plain-download path.
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    try { localStorage.setItem('heirloom_local_first_run_seen', '1'); } catch { /* storage blocked */ }
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let preview: { stop(): Promise<void> } | null = null;
  try {
    preview = await startStaticPreview({ port: PORT, outDir: outOld });
    await openOptions(page);
    await page.locator('input[type="file"][accept=".hlbak"]').setInputFiles(restoreFile);
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click({ timeout: 120_000 });
    await page.waitForEvent('load', { timeout: 180_000 });
    await openOptions(page);
    await downloadBackup(page, 'release.hlbak');
    await preview!.stop();
    preview = null;

    preview = await startStaticPreview({ port: PORT, outDir: outNew });
    await openOptions(page);
    await downloadBackup(page, 'candidate.hlbak');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openOptions(page);
    await downloadBackup(page, 'candidate-reload.hlbak');
    return errors;
  } catch (err) {
    await page.screenshot({ path: path.join(reportDir, 'failure.png') }).catch(() => {});
    throw err;
  } finally {
    await preview?.stop();
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!reportDir) {
    console.error('Usage: static.ts <release out/> <candidate out/> <restore.hlbak> <report dir>');
    process.exit(2);
  }
  mkdirSync(reportDir, { recursive: true });
  const errors = await drive();

  const release = await snapshotBackup(path.join(reportDir, 'release.hlbak'));
  const candidate = await snapshotBackup(path.join(reportDir, 'candidate.hlbak'));
  const reloaded = await snapshotBackup(path.join(reportDir, 'candidate-reload.hlbak'));
  writeFileSync(path.join(reportDir, 'tables.json'), JSON.stringify({ release, candidate }));

  const version = (s: Snapshot) => s._SchemaMeta?.map((r) => r.Version).join(',') ?? 'none';
  console.log(`\nStatic: schema ${version(release)} → ${version(candidate)}, ${release.People?.length ?? 0} people, ${release.MediaBlob?.length ?? 0} photo blobs`);
  const c = compareSnapshots(release, candidate);
  printComparison('Static database (release backup → candidate backup)', c);
  const stable = JSON.stringify(candidate) === JSON.stringify(reloaded);
  console.log(`  After a reload: ${stable ? 'identical' : 'DIFFERENT'}`);
  console.log(`  Page errors: ${errors.length ? errors.join('\n    ') : 'none'}`);
  if (c.lost.length || !stable || errors.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
