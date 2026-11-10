// Guards the static (local-first) export against bundling the node-postgres
// connection module. next.config.ts swaps '@/lib/db/connection' for the PGlite
// implementation, but that swap has silently no-op'd before: a resolve.alias entry
// never matched the tsconfig `@/*` request, so `pg` shipped to the browser and /audit
// rendered "DATABASE_URL environment variable is not set" on Cloudflare and Tauri.
// dev:static could not catch it (Turbopack applies a separate, working alias), so this
// asserts against the built artifact. Runs at the end of scripts/build-static.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Thrown by lib/db/connection.ts when DATABASE_URL is absent — a string unique to the
// pg-backed module, so its presence in out/ means the PGlite swap did not apply.
const PG_MARKER = 'DATABASE_URL environment variable is not set';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.js')) yield full;
  }
}

function findPgLeaks(outDir) {
  const leaks = [];
  for (const file of walk(outDir)) {
    if (readFileSync(file, 'utf8').includes(PG_MARKER)) leaks.push(file);
  }
  return leaks;
}

const outDir = path.join(process.cwd(), 'out');
const leaks = findPgLeaks(outDir);

if (leaks.length > 0) {
  console.error(
    `\n✗ Static build leaked the pg connection module into ${leaks.length} chunk(s):\n` +
      leaks.map((f) => `    ${path.relative(process.cwd(), f)}`).join('\n') +
      `\n\n  next.config.ts should replace '@/lib/db/connection' with connection.pglite.ts\n` +
      `  for the webpack (build:static) compiler. See the NormalModuleReplacementPlugin there.\n`,
  );
  process.exit(1);
}

console.log('✓ Static build contains no pg connection module.');
