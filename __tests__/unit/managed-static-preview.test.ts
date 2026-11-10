import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { buildPreviewArgs, startStaticPreview } from '@/scripts/lib/managed-static-preview.mjs';

function fakeChild(pid = 1234) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe('managed static preview', () => {
  it('builds a strict Vite preview command for the completed output directory', () => {
    expect(buildPreviewArgs({ port: 4173, outDir: 'out' })).toEqual([
      expect.stringMatching(/node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/),
      'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort', '--outDir', 'out',
    ]);
  });

  it('rejects when the child exits before health readiness and includes stderr', async () => {
    const child = fakeChild();
    const preview = startStaticPreview({
      port: 4173,
      startupTimeoutMs: 100,
      healthCheck: async () => false,
      spawnImpl: () => child,
      platform: 'win32',
      spawnSyncImpl: vi.fn(),
    });
    child.stderr.write('synthetic preview failure');
    child.emit('exit', 1, null);

    await expect(preview).rejects.toThrow(
      'Static preview exited before becoming ready: synthetic preview failure',
    );
  });

  it('makes stop idempotent for an owned preview process', async () => {
    const child = fakeChild();
    const taskkill = vi.fn();
    const preview = await startStaticPreview({
      port: 4173,
      healthCheck: async () => true,
      spawnImpl: () => child,
      platform: 'win32',
      spawnSyncImpl: taskkill,
    });

    await Promise.all([preview.stop(), preview.stop()]);

    expect(taskkill).toHaveBeenCalledOnce();
    expect(taskkill).toHaveBeenCalledWith(
      'taskkill', ['/pid', '1234', '/f', '/t'],
      { stdio: 'ignore', shell: false },
    );
  });

  it('falls back to the exact child when Windows tree termination reports failure', async () => {
    const child = fakeChild();
    const taskkill = vi.fn(() => ({ status: 1 }));
    const preview = await startStaticPreview({
      port: 4173,
      healthCheck: async () => true,
      spawnImpl: () => child,
      platform: 'win32',
      spawnSyncImpl: taskkill,
    });

    await preview.stop();

    expect(taskkill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
