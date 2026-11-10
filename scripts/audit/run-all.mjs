import { execSync } from 'node:child_process';
import { findDeadCssCandidates } from './dead-css.mjs';
import { findOversized } from './oversized.mjs';

console.log('=== Migration-artifact census ===');

const { files, threshold } = findOversized();
console.log(`\n[1] Oversized components (>= ${threshold} lines): ${files.length}`);
for (const f of files) console.log(`    ${String(f.lines).padStart(5)}  ${f.file}`);

const { candidates, totalSelectors } = findDeadCssCandidates();
console.log(`\n[2] Dead CSS class candidates: ${candidates.length}/${totalSelectors} (confirm — dynamic-class false positives)`);
for (const c of candidates.sort()) console.log(`    .${c}`);

console.log('\n[3] Dead exports/files/deps (knip):');
try {
  execSync('npm run audit:knip', { stdio: 'inherit' });
} catch {
  // knip exits non-zero when it finds issues — that's expected for a census.
}

console.log('\n[4] Orphaned message keys (confirm — keys built at run time):');
try {
  execSync('npx tsx scripts/audit/orphan-i18n.ts', { stdio: 'inherit' });
} catch {
  console.log('    census failed; run `npx tsx scripts/audit/orphan-i18n.ts` to see why.');
}

console.log('\n[5] Imperative-DOM + primitive-bypass: run `npm run lint` and scan for the guardrail warnings.');
console.log('\n=== end census ===');
