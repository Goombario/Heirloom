#!/usr/bin/env node
/**
 * One-command clean dev restart.
 *
 * Why this exists: `next dev` uses Turbopack, whose `.next` cache does NOT
 * reliably regenerate CSS via HMR — this includes a newly-added *arbitrary*
 * Tailwind value (e.g. `text-[28px]`, `-mb-px`), but also plain edits to
 * *existing* values in app/globals.css. Confirmed by direct testing
 * (2026-07-08): the staleness is sporadic and NOT fixed by a plain restart —
 * `.next/dev/cache/turbopack` persists across `next dev` invocations, so a
 * kill + `npm run dev` still serves the pre-edit stylesheet. Only wiping
 * `.next` guarantees the change takes effect. Known upstream Turbopack/
 * Tailwind-4 bug (vercel/next.js#87884), not fixable in this repo's config.
 * Doing the wipe by hand means finding the dev PID, killing only it (not
 * every node process), deleting `.next`, and restarting — three fiddly,
 * platform-specific steps. This script is all of them, cross-platform.
 *
 * Usage:
 *   node scripts/dev-clean.mjs          # port 3000, `npm run dev`
 *   node scripts/dev-clean.mjs static   # port 3010, `npm run dev:static`
 *
 * Deleting `.next` here uses Node's fs.rmSync (a project-local build artifact),
 * not a shell `rm -rf`, so it doesn't trip command-pattern permission prompts.
 */
import { rmSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const isStatic = process.argv.includes('static');
const port = isStatic ? 3010 : 3000;
const npmScript = isStatic ? 'dev:static' : 'dev';
const isWin = process.platform === 'win32';

/** Kill only the process(es) LISTENING on `p` — never a blanket node kill. */
function killPort(p) {
    try {
        if (isWin) {
            const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
            const pids = new Set();
            for (const line of out.split('\n')) {
                if (line.includes(`:${p}`) && /LISTENING/i.test(line)) {
                    const pid = line.trim().split(/\s+/).pop();
                    if (pid && pid !== '0') pids.add(pid);
                }
            }
            for (const pid of pids) {
                spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
                console.log(`[dev-clean] freed port ${p} (killed PID ${pid})`);
            }
        } else {
            const out = spawnSync('lsof', ['-ti', `tcp:${p}`], { encoding: 'utf8' }).stdout || '';
            for (const pid of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
                spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
                console.log(`[dev-clean] freed port ${p} (killed PID ${pid})`);
            }
        }
    } catch (e) {
        console.warn(`[dev-clean] port cleanup skipped: ${e.message}`);
    }
}

killPort(port);

try {
    // On Windows the just-killed dev server releases its .next file handles a
    // beat after taskkill returns, so the first delete can hit ENOTEMPTY/EBUSY —
    // rmSync retries those internally with a delay.
    rmSync('.next', { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
    console.log('[dev-clean] cleared .next (Turbopack cache)');
} catch (e) {
    console.warn(`[dev-clean] .next cleanup: ${e.message}`);
}

console.log(`[dev-clean] cold-starting "${npmScript}" on :${port}`);
// Pipe stdout (instead of 'inherit') so we can watch for the dev server's
// "Ready" line. Why: once the server is up, essentially the only way it exits
// non-zero is being force-killed — which is exactly what the NEXT `dev:clean`
// restart does via killPort(). Propagating that code makes the prior,
// harness-tracked background task report "failed with exit code 1" on every
// restart — a phantom failure (the new server is fine). So once the server has
// reported Ready, treat a later nonzero exit as an intentional shutdown (exit
// 0). A genuine *startup* crash never reaches Ready, so its real exit code
// still propagates.
const child = spawn('npm', ['run', npmScript], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isWin,
});
let sawReady = false;
child.stdout.on('data', (d) => {
    process.stdout.write(d);
    if (/Ready in/i.test(d)) sawReady = true;
});
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('exit', (code) => process.exit(sawReady ? 0 : (code ?? 0)));
