// Writes the static build's starting database (lib/db/pglite-seed.ts) where the
// PGlite worker imports it from. Run by prebuild:static and predev:static.
//
// Usage: npm run pglite:seed

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPgliteSeed } from '../lib/db/pglite-seed';
import { SCHEMA_VERSION } from '../lib/db/init-schema';

const OUT = path.join(process.cwd(), 'lib', 'db', 'generated', 'pglite-seed.tar.gz');

async function main(): Promise<void> {
  const blob = await buildPgliteSeed();
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(await blob.arrayBuffer()));
  console.log(`pglite seed: schema v${SCHEMA_VERSION}, ${(blob.size / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
