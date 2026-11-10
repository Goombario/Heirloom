// Writes public/third-party-licenses.txt: the name, version, licence and notice
// text of every production dependency, for the About page's Credits link (#1256).
// Runs before every build (prebuild, prebuild:static). The output is generated,
// so it is gitignored. Dev-only packages never ship and are left out.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const OUT = path.join(root, 'public', 'third-party-licenses.txt');
const NOTICE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function licenceName(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function noticeText(dir) {
  const files = readdirSync(dir).filter((f) => NOTICE_FILE.test(f)).sort();
  return files.map((f) => readFileSync(path.join(dir, f), 'utf8').trim()).filter(Boolean).join('\n\n');
}

/** Production packages from the lockfile that are installed here. */
function productionPackages(lock) {
  const seen = new Map();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || entry.dev || entry.link) continue;
    const dir = path.join(root, key);
    if (!existsSync(path.join(dir, 'package.json'))) continue; // an optional package for another platform
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = `${name}@${entry.version}`;
    if (!seen.has(id)) seen.set(id, { name, version: entry.version, dir });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function main() {
  const lockFile = path.join(root, 'package-lock.json');
  if (!existsSync(lockFile)) {
    console.warn('third-party-licenses: no package-lock.json, skipped');
    return;
  }
  const sections = [];
  const firstWithText = new Map(); // identical notice text -> the package that printed it
  for (const { name, version, dir } of productionPackages(readJson(lockFile))) {
    const pkg = readJson(path.join(dir, 'package.json'));
    const full = noticeText(dir);
    const earlier = full && firstWithText.get(full);
    if (full && !earlier) firstWithText.set(full, `${name} ${version}`);
    const text = earlier ? `(Same licence text as ${earlier}, above.)` : full;
    sections.push([`${name} ${version}`, `License: ${licenceName(pkg)}`, pkg.homepage ? `Homepage: ${pkg.homepage}` : '', '', text || '(No licence file included in the package.)']
      .filter((line, i) => i !== 2 || line).join('\n'));
  }
  const header = 'Heirloom includes the following open-source software.\n' +
    'Each package is listed with its version, licence and the notice it ships with.';
  writeFileSync(OUT, `${header}\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`);
  console.log(`third-party-licenses: ${sections.length} packages -> public/third-party-licenses.txt`);
}

main();
