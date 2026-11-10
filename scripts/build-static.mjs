// Static-export build wrapper. output:'export' cannot compile the /api route
// handlers or proxy.ts (server-only; the local PGlite app never calls them), so
// we move them out of the app tree, run next build, and ALWAYS restore them.
import { rmSync, renameSync, existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const STASH = path.join(root, '.static-build-stash');

// [sourceRelPath, stashName]
const MOVES = [
  ['app/api', 'api'],
  ['proxy.ts', 'proxy.ts'],
];

// Synchronous sleep (no async in this top-level script).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows transiently EPERM/EBUSY-locks directories (Defender / search indexer /
// file watchers), so renameSync flakes. Retry, then fall back to copy + remove
// (not atomic, but content-identical — fine for a build-time stash).
function move(src, dest) {
  const retryable = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'];
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(src, dest);
      return;
    } catch (err) {
      if (retryable.includes(err.code) && attempt < 5) {
        sleepSync(250);
        continue;
      }
      cpSync(src, dest, { recursive: true });
      rmSync(src, { recursive: true, force: true });
      return;
    }
  }
}

function stash() {
  rmSync(STASH, { recursive: true, force: true });
  mkdirSync(STASH, { recursive: true });
  for (const [rel, name] of MOVES) {
    const src = path.join(root, rel);
    if (existsSync(src)) move(src, path.join(STASH, name));
  }
}

function restore() {
  for (const [rel, name] of MOVES) {
    const stashed = path.join(STASH, name);
    const dest = path.join(root, rel);
    if (existsSync(stashed)) {
      rmSync(dest, { recursive: true, force: true });
      move(stashed, dest);
    }
  }
  rmSync(STASH, { recursive: true, force: true });
}

// Wipe .next BEFORE stashing. A prior dev/hosted build leaves typed-route
// validators in .next/ that import the app/api/**/route handlers; a stale .next
// makes the static build fail type-checking against modules that are about to be
// moved out. Build clean.
//
// The ORDER is load-bearing (#336). rmSync throws EBUSY/ENOTEMPTY/EPERM when a
// dev server (or Defender, or the search indexer) holds a handle under .next —
// routine on Windows. Anything that throws between stash() and the try/finally
// below skips restore() entirely, leaving app/api + proxy.ts sitting in the stash
// dir and DELETED from the working tree. Wiping first means a failed wipe happens
// while the tree is still intact: nothing has been moved yet.
rmSync(path.join(root, '.next'), { recursive: true, force: true });

// restore() is the only thing between an interrupted build and a checkout missing
// its API routes, so cover the exits `finally` cannot see: Ctrl-C, a kill, and an
// uncaught throw. It existsSync-guards every move and force-removes the stash dir,
// so calling it with nothing stashed is a no-op and calling it twice is harmless.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restore();
    process.exit(1);
  });
}
process.on('uncaughtException', (err) => {
  restore();
  console.error(err);
  process.exit(1);
});

stash();
let code = 1;
try {
  // BUILD_TARGET / NEXT_PUBLIC_DATA_MODE / NEXT_PUBLIC_BASE_PATH come from the env
  // (set by the npm script / CI). next build inherits them.
  // --webpack: Next.js 16 defaults `next build` to Turbopack, but @serwist/next
  // only hooks into the webpack compiler (it silently produces no public/sw.js
  // under Turbopack, with just a console warning). The static build is the only
  // one that needs the service worker (hosted sets `disable: !isStatic`), so
  // forcing webpack only here doesn't affect the hosted `next build` path.
  const buildCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const buildArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd exec -- next build --webpack']
    : ['exec', '--', 'next', 'build', '--webpack'];
  const res = spawnSync(buildCommand, buildArgs, {
    stdio: 'inherit', shell: false, env: process.env,
  });
  code = res.status ?? 1;

  // The '@/lib/db/connection' → PGlite swap in next.config.ts has silently no-op'd
  // before, shipping pg to the browser. Fail the build rather than deploy a broken
  // /audit to Cloudflare/Tauri again.
  if (code === 0) {
    const guard = spawnSync('node', [path.join(root, 'scripts', 'assert-static-no-pg.mjs')], {
      stdio: 'inherit', shell: false, env: process.env,
    });
    code = guard.status ?? 1;
  }
  // SPA fallback for unmatched paths. On Cloudflare Workers Static Assets (our
  // deploy target) this is handled by `not_found_handling: single-page-application`
  // in wrangler.jsonc — do NOT also emit an out/_redirects `/* /index.html 200`
  // rule: Workers Assets strips `.html`/`/index` and rejects that rule as an
  // infinite loop, failing the deploy.
  //  - out/404.html: a copy of index.html, the genuine 404 page; also the SPA
  //    fallback on plain static hosts that don't honour not_found_handling.
  if (code === 0 && existsSync(path.join(root, 'out', 'index.html'))) {
    cpSync(path.join(root, 'out', 'index.html'), path.join(root, 'out', '404.html'));

    // out/_headers: long-cache the content-hashed build assets. Everything under
    // /_next/static/ is fingerprinted by content hash (incl. the PGlite WASM and
    // the ~6 MB pglite .data), so it is safe to mark immutable. Without this,
    // Cloudflare Workers Static Assets serves them with `max-age=0,
    // must-revalidate`, forcing a revalidation round-trip on every hard load.
    // Unlike _redirects, a _headers file is accepted by Workers Static Assets.
    // APPEND to the file the export copied from public/_headers (security
    // headers: CSP etc.) — overwriting would drop those rules.
    const headersFile = path.join(root, 'out', '_headers');
    const existing = existsSync(headersFile)
      ? readFileSync(headersFile, 'utf8').replace(/\n*$/, '\n\n')
      : '';
    writeFileSync(
      headersFile,
      existing + '/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    );
  }
} finally {
  restore();
}
process.exit(code);
