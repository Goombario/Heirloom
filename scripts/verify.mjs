// Runs the pre-PR gates locally, as parallel as the machine allows.
//
//   Phase 1: lint, the knip ratchet and tsc, side by side. Any failure stops here,
//            before the slow tiers start.
//   Phase 2: the unit suite, the integration suite on PGlite, and the integration
//            suite on Postgres when the test database answers.
//
// Output is buffered per task so parallel runs don't interleave: a passing task
// prints its summary, and a failing one prints everything it wrote.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';

const cpus = os.availableParallelism();
const color = process.stdout.isTTY;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function run({ name, cmd, args, env = {} }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...(color ? { FORCE_COLOR: '1' } : {}), ...env },
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const finish = (ok) => {
      const result = { name, ok, output, ms: Date.now() - started };
      report(result);
      resolve(result);
    };
    child.on('error', (err) => { output += String(err); finish(false); });
    child.on('close', (code) => finish(code === 0));
  });
}

function report({ name, ok, output, ms }) {
  const mark = ok ? paint('32', '✓') : paint('31', '✗');
  console.log(`${mark} ${name} ${paint('2', `(${formatDuration(ms)})`)}`);
  if (!ok) {
    console.log(output.trimEnd());
    console.log();
    return;
  }
  const summary = stripAnsi(output).split('\n').filter((line) => /^\s*(Test Files|Tests)\s/.test(line));
  for (const line of summary) console.log(paint('2', `    ${line.trim()}`));
}

// Only .env.test.local opts in: .env.local usually points at the dev database,
// and the integration suite seeds and deletes rows wherever it runs.
function testDatabaseUrl() {
  if (!existsSync('.env.test.local')) return null;
  for (const line of readFileSync('.env.test.local', 'utf-8').split('\n')) {
    const match = line.match(/^DATABASE_URL=(.*)/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

function parseHost(url) {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, port: Number(parsed.port) || 5432 };
  } catch {
    return null;
  }
}

function reachable(url) {
  const target = parseHost(url);
  if (!target) return Promise.resolve(false);
  const { host, port } = target;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function phase(title, tasks) {
  console.log(paint('1', `\n${title}`));
  const results = await Promise.all(tasks.map(run));
  return results.every((result) => result.ok);
}

const started = Date.now();

const checksPassed = await phase('Phase 1: lint, knip, tsc', [
  { name: 'lint', cmd: 'npm', args: ['run', 'lint', '--silent'] },
  { name: 'knip', cmd: 'npm', args: ['run', 'audit:knip:ci', '--silent'] },
  { name: 'tsc', cmd: 'npx', args: ['tsc', '--noEmit'] },
]);
if (!checksPassed) {
  console.log(paint('31', '\nStatic checks failed; the test suites did not run.'));
  process.exit(1);
}

const tests = [
  {
    name: 'unit',
    cmd: 'npx',
    args: ['vitest', 'run', '__tests__/unit/', '--fileParallelism', `--maxWorkers=${Math.max(2, Math.floor(cpus / 2))}`],
    env: { SKIP_TEST_DB_SETUP: '1' },
  },
  {
    name: 'integration (PGlite)',
    cmd: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.pglite.config.ts', `--maxWorkers=${Math.max(2, Math.floor(cpus / 4))}`],
  },
];
const databaseUrl = testDatabaseUrl();
const skipReason = !databaseUrl
  ? 'no DATABASE_URL in .env.test.local'
  : !(await reachable(databaseUrl)) && `nothing answers at ${parseHost(databaseUrl)?.host ?? 'DATABASE_URL'}`;
if (skipReason) {
  console.log(paint('33', `\nSkipping integration (Postgres): ${skipReason}. Start it with \`npm run db:test:up\`.`));
} else {
  tests.push({ name: 'integration (Postgres)', cmd: 'npm', args: ['run', 'test:integration', '--silent'] });
}

const testsPassed = await phase(`Phase 2: tests (${cpus} CPUs)`, tests);
const total = formatDuration(Date.now() - started);
if (!testsPassed) {
  console.log(paint('31', `\nVerify failed after ${total}.`));
  process.exit(1);
}
console.log(paint('32', `\nVerify passed in ${total}${skipReason ? ', without the Postgres integration suite' : ''}.`));
