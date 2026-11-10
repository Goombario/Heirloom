// Hosted half of the upgrade check (#811). Run by scripts/upgrade-check/run.sh,
// with the working directory set to the tree whose code should act: the release
// worktree to seed and snapshot the old database, the candidate to upgrade it.
// That tree's own services are loaded from the working directory.
//
//   seed-large <ged> <email>   import a GEDCOM into a new tree for <email>
//   snapshot <dir>             boot (the candidate upgrades here), then save tables + an export zip per tree
//   compare <before> <after>   compare two snapshots; exit 1 if a row or table is lost
//   import-zip <zip> <dir>     import a release's export zip into a new tree and re-export it
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { snapshotTables, compareSnapshots, printComparison, type Rows } from './snapshot';

const root = process.cwd();
const load = (file: string) => import(path.join(root, file));

async function withDb<T>(run: (q: (sql: string, params?: unknown[]) => Promise<Rows>) => Promise<T>): Promise<T> {
  const conn = await load('lib/db/connection.ts');
  try {
    return await run(async (sql, params) => (await conn.query(sql, params)).rows as Rows);
  } finally {
    await conn.closePool();
  }
}

async function seedLarge(ged: string, email: string): Promise<void> {
  const { importGedcomService } = await load('lib/services/gedcom.ts');
  await withDb(async (q) => {
    const user = (await q(`SELECT "Id" FROM "Users" WHERE "Email" = $1`, [email]))[0];
    const tree = (await q(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Large GEDCOM') RETURNING "Id"`, [user.Id]))[0];
    const file = new File([readFileSync(ged)], path.basename(ged), { type: 'text/plain' });
    const res = await importGedcomService({ file, mode: 'merge', currentUserId: user.Id, requestedTreeId: tree.Id });
    console.log(`Imported ${res.peopleCount} people into tree ${tree.Id}`);
  });
}

async function snapshot(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const { exportGedcomService } = await load('lib/services/gedcom-export.ts');
  await withDb(async (q) => {
    await q('SELECT 1'); // the hosted boot: ensureSchema, and with it the upgrade
    const tables = await snapshotTables((sql) => q(sql));
    writeFileSync(path.join(dir, 'tables.json'), JSON.stringify(tables));
    for (const t of await q(`SELECT "Id", "OwnerId" FROM "Trees" ORDER BY "Id"`)) {
      const res = await exportGedcomService({
        requestedTreeId: t.Id, requestedOwnerId: null, currentUserId: t.OwnerId, includeMedia: true, mediaPolicy: 'omit-unresolved',
      });
      if (res.kind !== 'zip') throw new Error(`tree ${t.Id}: export returned ${res.kind}`);
      writeFileSync(path.join(dir, `tree-${t.Id}.zip`), res.buffer);
    }
    console.log(`Snapshot: ${Object.keys(tables).length} tables, ${tables.People?.length ?? 0} people → ${dir}`);
  });
}

/** Zip entries by name → content, ignoring entry timestamps. `cases.json` carries its own export time. */
async function zipEntries(file: string): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (zip.files[name].dir) continue;
    let text = await zip.files[name].async('base64');
    if (name === 'cases.json') {
      const { exported_at: _drop, ...rest } = JSON.parse(await zip.files[name].async('string'));
      text = JSON.stringify(rest);
    }
    out.set(name, text);
  }
  return out;
}

async function compare(before: string, after: string): Promise<void> {
  const read = (dir: string) => JSON.parse(readFileSync(path.join(dir, 'tables.json'), 'utf8'));
  const c = compareSnapshots(read(before), read(after));
  printComparison('Hosted database', c);

  console.log('\nExports:');
  for (const zip of readdirSync(before).filter((f) => f.endsWith('.zip')).sort()) {
    const [a, b] = [await zipEntries(path.join(before, zip)), await zipEntries(path.join(after, zip))];
    const differ = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
    console.log(`  ${zip}: ${differ.length ? `entries differ: ${differ.join(', ')}` : `same contents (${a.size} entries)`}`);
  }
  if (c.lost.length) process.exitCode = 1;
}

async function importZip(zipFile: string, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const { readBundle, normalizeBundle, omitMediaFile } = await load('__tests__/setup/gedcom-bundle.ts');
  const { importGedcomService } = await load('lib/services/gedcom.ts');
  const { exportGedcomService } = await load('lib/services/gedcom-export.ts');
  const { materializeImportMediaService } = await load('lib/services/media-upload.ts');
  const { contentTypeForExtension, fileExtension } = await load('lib/media/allowed-extensions.ts');

  await withDb(async (q) => {
    const first = await readBundle(readFileSync(zipFile));
    const owner = (await q(`SELECT "Id" FROM "Users" ORDER BY "Id" LIMIT 1`))[0].Id;
    const tree = (await q(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"`, [owner, `Reimport ${path.basename(zipFile)}`]))[0].Id;
    const res = await importGedcomService({
      file: new File([first.ged], 'family_tree.ged', { type: 'text/plain' }), mode: 'merge',
      casesJson: JSON.stringify(first.cases), mediaJson: JSON.stringify(first.media),
      sourcesJson: JSON.stringify(first.sources), placesJson: JSON.stringify(first.places),
      archiveManifest: [...first.mediaBytes.keys()], currentUserId: owner, requestedTreeId: tree,
    });
    // What the browser does after the import: upload each photo from the zip.
    for (const item of res.mediaItems) {
      const bytes = first.mediaBytes.get(item.archivePath);
      if (!bytes) continue;
      await materializeImportMediaService({
        itemId: item.id, archivePath: item.archivePath, requestedTreeId: tree, requestedOwnerId: null, currentUserId: owner,
        file: new File([new Uint8Array(bytes)], item.originalFilename, { type: contentTypeForExtension(fileExtension(item.archivePath)) }),
      });
    }
    const out = await exportGedcomService({ requestedTreeId: tree, requestedOwnerId: null, currentUserId: owner, includeMedia: true, mediaPolicy: 'omit-unresolved' });
    if (out.kind !== 'zip') throw new Error(`re-export returned ${out.kind}`);
    const second = await readBundle(out.buffer);
    writeFileSync(path.join(dir, 'old.ged'), first.ged);
    writeFileSync(path.join(dir, 'new.ged'), second.ged);

    // Sidecar arrays are compared as sets: a re-import may list rows in another order.
    const canon = (v: unknown): unknown => Array.isArray(v)
      ? v.map(canon).map((x) => JSON.stringify(x)).sort().map((x) => JSON.parse(x))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x)])) : v;
    const norm = (b: typeof first) => { const n = normalizeBundle(b); return { ...n, media: omitMediaFile(n.media) }; };
    const [A, B] = [norm(first), norm(second)];
    const same = (k: 'cases' | 'sources' | 'places' | 'media') => JSON.stringify(canon(A[k])) === JSON.stringify(canon(B[k]));
    const gedDiff = second.ged.split('\n').length - first.ged.split('\n').length;
    console.log(`  ${path.basename(zipFile)} → tree ${tree}: ${res.peopleCount} people, ${res.mediaItems.length} photos;`
      + ` cases ${same('cases')}, sources ${same('sources')}, places ${same('places')}, media.json ${same('media')},`
      + ` GEDCOM ${first.ged === second.ged ? 'identical' : `differs (${gedDiff >= 0 ? '+' : ''}${gedDiff} lines; diff ${dir}/old.ged new.ged)`}`);
  });
}

const [phase, a, b] = process.argv.slice(2);
const phases: Record<string, () => Promise<void>> = {
  'seed-large': () => seedLarge(a, b),
  snapshot: () => snapshot(a),
  compare: () => compare(a, b),
  'import-zip': () => importZip(a, b),
};
if (!phases[phase]) {
  console.error('Usage: hosted.ts seed-large <ged> <email> | snapshot <dir> | compare <before> <after> | import-zip <zip> <dir>');
  process.exit(2);
}
phases[phase]().catch((err) => { console.error(err); process.exit(1); });
