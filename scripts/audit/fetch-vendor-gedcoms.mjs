// Download the public sample GEDCOMs listed in vendor-gedcoms.json into the
// gitignored test-data/vendor/, check each one's sha256, and write the
// manifest the interop probe reads (#810, #869).
//
//   node scripts/audit/fetch-vendor-gedcoms.mjs
//   npm run audit:gedcom-interop
//
// Every URL is pinned to a commit, so the corpus can't drift under a report.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../test-data/vendor/', import.meta.url));
const list = JSON.parse(await readFile(new URL('./vendor-gedcoms.json', import.meta.url), 'utf8'));

let failed = 0;
const fetched = [];
for (const entry of list.files) {
    if (isAbsolute(entry.file) || entry.file.split(/[/\\]/).includes('..')) {
        console.error(`${entry.file}: refused, the path must stay inside test-data/vendor/`);
        failed++;
        continue;
    }
    const dest = join(OUT, entry.file);
    const res = await fetch(entry.url);
    if (!res.ok) {
        console.error(`${entry.file}: HTTP ${res.status}`);
        failed++;
        continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256) {
        console.error(`${entry.file}: sha256 ${sha256}, expected ${entry.sha256}`);
        failed++;
        continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    fetched.push(entry);
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ description: list.description, sources: list.sources, files: fetched }, null, 2));
console.log(`${fetched.length} of ${list.files.length} files in ${OUT}`);
process.exitCode = failed ? 1 : 0;
