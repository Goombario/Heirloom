import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractCssClassSelectors, isClassReferenced } from './lib.mjs';
import { walk } from './fs-walk.mjs';

const ROOT = process.cwd();
const CSS_PATH = path.join(ROOT, 'app', 'globals.css');

/** CSS classes defined in globals.css with zero whole-token references in app/**. */
export function findDeadCssCandidates() {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const selectors = extractCssClassSelectors(css);
  const files = walk(path.join(ROOT, 'app'), ['.tsx', '.ts']);
  const corpus = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const candidates = selectors.filter((c) => !isClassReferenced(c, corpus));
  return { candidates, totalSelectors: selectors.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { candidates, totalSelectors } = findDeadCssCandidates();
  console.log(`\nDead CSS class candidates (${candidates.length}/${totalSelectors} selectors):`);
  console.log('  NOTE: candidates only — classes built via dynamic strings may be false positives. Confirm before removal.');
  for (const c of candidates.sort()) console.log(`  .${c}`);
}
