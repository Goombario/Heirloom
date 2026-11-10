import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { diffKnip, knipIssueKeys } from './lib.mjs';

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, 'knip-baseline.json');

/** Run knip with the JSON reporter; return parsed report (tolerates non-zero exit). */
function runKnipJson() {
  try {
    const out = execSync('npx knip --reporter json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (err) {
    // knip exits non-zero when it finds issues; its JSON report is still on stdout.
    const stdout = err.stdout?.toString() ?? '';
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout);
      } catch {
        // Not a valid report — fall through and surface the real failure below.
      }
    }
    // No parseable report → a genuine knip/config failure (not the issues path).
    // Surface knip's stderr so CI shows a real diagnostic, not a bare parse error.
    const stderr = err.stderr?.toString().trim();
    throw new Error(`knip failed to produce a JSON report.${stderr ? `\nknip stderr:\n${stderr}` : ''}`);
  }
}

const report = runKnipJson();
const current = knipIssueKeys(report);

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`knip baseline updated: ${current.length} known issues recorded.`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : [];
const fresh = diffKnip(baseline, current);

if (fresh.length > 0) {
  console.error(`\n✖ knip ratchet: ${fresh.length} NEW unused item(s) introduced:`);
  for (const k of fresh) console.error(`    ${k}`);
  console.error('\nRemove the dead code, or (if intentional) run `npm run audit:knip:update` to accept it into the baseline.');
  process.exit(1);
}
console.log(`✓ knip ratchet: no new dead code (baseline: ${baseline.length} known).`);
