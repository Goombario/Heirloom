import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChromiumExecutable } from './lib/chromium-resolver.mjs';

const MIN_NODE = [24, 0, 0];
const MIN_NPM = [11, 16, 0];

function versionParts(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function belowMinimum(value, minimum) {
  const actual = versionParts(value);
  if (!actual) return true;
  for (let index = 0; index < minimum.length; index++) {
    if (actual[index] < minimum[index]) return true;
    if (actual[index] > minimum[index]) return false;
  }
  return false;
}

export function evaluateToolchain(probes) {
  const actions = [];
  if (belowMinimum(probes.nodeVersion, MIN_NODE)) {
    actions.push('Node.js 24 or newer is required');
  }
  if (belowMinimum(probes.npmVersion, MIN_NPM)) {
    actions.push('npm 11.16.0 or newer is required');
  }
  if (!probes.tempWritable) {
    actions.push('the temporary directory is not writable');
  }
  if (!probes.chromiumAvailable) {
    actions.push('Playwright Chromium is unavailable; run the one-time browser setup command');
  }
  if (!probes.userInfoOk) {
    actions.push('os.userInfo() is unavailable; canonical repository commands do not depend on it');
  }
  return {
    status: actions.some((action) => !action.startsWith('os.userInfo()'))
      ? 'error'
      : actions.length > 0 ? 'warning' : 'ok',
    actions,
  };
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function readNpmVersion() {
  try {
    const command = npmCommand();
    const executable = process.platform === 'win32' ? 'cmd.exe' : command;
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', `${command} --version`]
      : ['--version'];
    return execFileSync(executable, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    }).trim();
  } catch {
    return 'unavailable';
  }
}

function checkTempWritable() {
  const probePath = path.join(os.tmpdir(), `codex-toolchain-${randomUUID()}.tmp`);
  try {
    writeFileSync(probePath, 'toolchain probe');
    return true;
  } catch {
    return false;
  } finally {
    try { unlinkSync(probePath); } catch { /* no sensitive path is reported */ }
  }
}

function checkUserInfo() {
  try {
    os.userInfo();
    return true;
  } catch {
    return false;
  }
}

function checkChromium() {
  try {
    return Boolean(resolveChromiumExecutable());
  } catch {
    return false;
  }
}

export function collectToolchain() {
  const probes = {
    nodeVersion: process.version,
    npmVersion: readNpmVersion(),
    tempWritable: checkTempWritable(),
    userInfoOk: checkUserInfo(),
    chromiumAvailable: checkChromium(),
  };
  return { ...probes, ...evaluateToolchain(probes) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = collectToolchain();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === 'error') process.exitCode = 1;
}
