import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guard: `scripts/build-static.mjs` moves `app/api/` and `proxy.ts` OUT of the
 * working tree for the duration of the static export, and `restore()` in the
 * `finally` is the only thing that puts them back. Anything that can throw
 * between `stash()` and the `try` therefore deletes core source from the
 * checkout — the failure mode in #336.
 *
 * The `.next` wipe is exactly such a statement: `rmSync` throws
 * EBUSY/ENOTEMPTY/EPERM whenever a dev server holds a handle under `.next`,
 * which is routine on Windows. It must run BEFORE `stash()`, so that a failed
 * wipe happens while the tree is still intact.
 *
 * This is a source-level assertion because the ordering is the whole fix and it
 * looks arbitrary without the comment above it — nothing else stops a later edit
 * from moving the wipe back down next to the build it prepares.
 */
const SCRIPT = path.join(process.cwd(), 'scripts', 'build-static.mjs');

function source(): string {
  return readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
}

describe('build-static stash ordering (#336)', () => {
  it('wipes .next before stashing the server-only files', () => {
    const src = source();

    // Top-level statements, both at column 0 — the `stash()` inside the function
    // declaration is indented and so is not matched here.
    const wipe = src.search(/^rmSync\(path\.join\(root, '\.next'\)/m);
    const stash = src.search(/^stash\(\);$/m);

    expect(wipe, 'could not find the top-level `.next` rmSync in build-static.mjs').toBeGreaterThan(-1);
    expect(stash, 'could not find the top-level `stash();` call in build-static.mjs').toBeGreaterThan(-1);

    if (wipe > stash) {
      throw new Error(
        '\nscripts/build-static.mjs wipes .next AFTER stash().\n' +
          'That is the #336 source-deletion bug: rmSync on .next throws EBUSY when a dev\n' +
          'server holds a handle, and a throw before the try/finally skips restore(),\n' +
          'leaving app/api/ and proxy.ts deleted from the working tree.\n' +
          'Move the rmSync back above stash().\n'
      );
    }
  });

  it('restores the stash on interrupt and uncaught throw, not only via finally', () => {
    const src = source();
    // `finally` covers a normal failure; these cover Ctrl-C and a hard crash,
    // which would otherwise strand the stash just as effectively.
    expect(src).toContain("'SIGINT'");
    expect(src).toMatch(/process\.on\('uncaughtException'/);
    // Whitespace-tolerant on purpose: this asserts restore() runs before the
    // exit, not how the handler happens to be formatted.
    expect(src).toMatch(/restore\(\);\s*process\.exit\(1\)/);
  });

  it('invokes Next through the repository npm shim instead of the global npx shim', () => {
    const src = source();

    expect(src).not.toContain("spawnSync('npx'");
    expect(src).toContain("process.platform === 'win32' ? 'cmd.exe' : 'npm'");
    expect(src).toContain("'npm.cmd exec -- next build --webpack'");
    expect(src).toContain("['exec', '--', 'next', 'build', '--webpack']");
  });
});
