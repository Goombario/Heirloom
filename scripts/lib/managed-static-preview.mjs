import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_OUT_DIR = 'out';

export function buildPreviewArgs({
  host = DEFAULT_HOST,
  port,
  outDir = DEFAULT_OUT_DIR,
}) {
  return [
    path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview', '--host', host, '--port', String(port), '--strictPort', '--outDir', outDir,
  ];
}

async function reserveLoopbackPort(host) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error('Unable to reserve a loopback port');
  return port;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childExitPromise(child, stderr) {
  let settled = false;
  let resolveSettled;
  const settledPromise = new Promise((resolve) => { resolveSettled = resolve; });
  const exit = new Promise((_, reject) => {
    child.once('exit', (code, signal) => {
      settled = true;
      resolveSettled();
      const details = stderr().trim();
      reject(new Error(
        `Static preview exited before becoming ready: ${details || signal || (code == null ? 'unknown child exit' : `code ${code}`)}`,
      ));
    });
    child.once('error', (error) => {
      settled = true;
      resolveSettled();
      const details = stderr().trim();
      reject(new Error(
        `Static preview exited before becoming ready: ${details || error.message}`,
      ));
    });
  });
  return { exit, settled: () => settled, settledPromise };
}

async function waitForHealth(baseUrl, timeoutMs, healthCheck) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await healthCheck(baseUrl)) return;
    } catch {
      // The preview may still be starting; child exit is raced separately.
    }
    await wait(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Static preview did not become ready within ${timeoutMs}ms`);
}

export async function startStaticPreview(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? await reserveLoopbackPort(host);
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const spawnSyncImpl = options.spawnSyncImpl ?? nodeSpawnSync;
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const healthCheck = options.healthCheck ?? (async (url) => {
    const response = await fetch(url);
    return response.ok;
  });
  const args = buildPreviewArgs({ host, port, outDir });
  const child = spawnImpl(process.execPath, args, {
    shell: false,
    detached: platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrText = '';
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => {
    stderrText += String(chunk);
    process.stderr.write(chunk);
  });

  const childState = childExitPromise(child, () => stderrText);
  let stopPromise;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (typeof child.pid !== 'number') return;
      if (platform === 'win32') {
        const result = spawnSyncImpl('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
          stdio: 'ignore',
          shell: false,
        });
        if (result?.error || (result?.status != null && result.status !== 0)) {
          try { child.kill(); } catch { /* already gone */ }
        }
        return;
      }
      try {
        killImpl(-child.pid, 'SIGTERM');
      } catch {
        if (!childState.settled()) return;
      }
      await Promise.race([childState.settledPromise, wait(5000)]);
      if (!childState.settled()) {
        try { killImpl(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    })();
    return stopPromise;
  };

  const baseUrl = `http://${host}:${port}`;
  try {
    await Promise.race([
      waitForHealth(baseUrl, startupTimeoutMs, healthCheck),
      childState.exit,
    ]);
    return { baseUrl, pid: child.pid, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
