import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rankOversized } from './lib.mjs';
import { walk } from './fs-walk.mjs';

const ROOT = process.cwd();
const DEFAULT_THRESHOLD = 400;

/** .tsx files at/over `threshold` lines, ranked. Relative POSIX paths. */
export function findOversized(threshold = DEFAULT_THRESHOLD) {
  const files = walk(path.join(ROOT, 'app'), ['.tsx']).map((f) => ({
    file: path.relative(ROOT, f).split(path.sep).join('/'),
    lines: fs.readFileSync(f, 'utf8').split('\n').length,
  }));
  return { files: rankOversized(files, threshold), threshold };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, threshold } = findOversized();
  console.log(`\nOversized components (>= ${threshold} lines) — attention list, not a defect gate:`);
  for (const f of files) console.log(`  ${String(f.lines).padStart(5)}  ${f.file}`);
}
