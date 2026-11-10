import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { PathLike } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { evaluateToolchain } from '@/scripts/check-test-toolchain.mjs';
import { resolveChromiumExecutable } from '@/scripts/lib/chromium-resolver.mjs';

const temporaryDirectories: string[] = [];

function temporaryExecutable(...parts: string[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chromium-resolver-'));
  temporaryDirectories.push(root);
  const executablePath = path.join(root, ...parts);
  mkdirSync(path.dirname(executablePath), { recursive: true });
  writeFileSync(executablePath, 'browser');
  return { root, executablePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const healthy = {
  nodeVersion: '24.19.0',
  npmVersion: '11.17.0',
  tempWritable: true,
  userInfoOk: true,
  chromiumAvailable: true,
};

describe('evaluateToolchain', () => {
  it('warns when userInfo is unavailable but canonical tooling remains usable', () => {
    expect(evaluateToolchain({ ...healthy, userInfoOk: false }).status).toBe('warning');
  });

  it.each([
    ['Node is below the supported version', { nodeVersion: '23.9.0' }],
    ['npm is below the supported version', { npmVersion: '11.15.0' }],
    ['the temporary directory is unwritable', { tempWritable: false }],
    ['Chromium is unavailable', { chromiumAvailable: false }],
  ])('reports an error when %s', (_label, override) => {
    expect(evaluateToolchain({ ...healthy, ...override }).status).toBe('error');
  });

  it('returns ok for a fully healthy toolchain', () => {
    expect(evaluateToolchain(healthy)).toEqual({ status: 'ok', actions: [] });
  });

  it('accepts newer npm major versions when they exceed the minimum', () => {
    expect(evaluateToolchain({ ...healthy, npmVersion: '12.0.0' })).toEqual({ status: 'ok', actions: [] });
  });
});

describe('resolveChromiumExecutable', () => {
  it('prefers a valid explicit PLAYWRIGHT_CHROMIUM_PATH', () => {
    const explicit = temporaryExecutable('explicit.exe').executablePath;
    const bundled = temporaryExecutable('bundled.exe').executablePath;

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', PLAYWRIGHT_CHROMIUM_PATH: explicit },
      playwrightExecutablePath: bundled,
    })).toBe(explicit);
  });

  it('uses the present Playwright-managed executable after an invalid override', () => {
    const bundled = temporaryExecutable('bundled.exe').executablePath;

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', PLAYWRIGHT_CHROMIUM_PATH: path.join(os.tmpdir(), 'missing-explicit.exe') },
      playwrightExecutablePath: bundled,
    })).toBe(bundled);
  });

  it('skips an explicit directory and uses the valid Playwright-managed executable', () => {
    const explicitDirectory = mkdtempSync(path.join(os.tmpdir(), 'chromium-explicit-directory-'));
    temporaryDirectories.push(explicitDirectory);
    const bundled = temporaryExecutable('bundled.exe').executablePath;

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', PLAYWRIGHT_CHROMIUM_PATH: explicitDirectory },
      playwrightExecutablePath: bundled,
    })).toBe(bundled);
  });

  it('skips an explicit regular file that fails the access check', () => {
    const explicit = temporaryExecutable('explicit.bin').executablePath;
    const bundled = temporaryExecutable('bundled.exe').executablePath;
    const access = (candidate: PathLike) => {
      if (candidate === explicit) throw new Error('not executable');
    };

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', PLAYWRIGHT_CHROMIUM_PATH: explicit },
      playwrightExecutablePath: bundled,
      access,
    })).toBe(bundled);
  });

  it('falls back to installed Chrome on Windows', () => {
    const { root, executablePath } = temporaryExecutable(
      'Google', 'Chrome', 'Application', 'chrome.exe',
    );

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', ProgramFiles: root },
      playwrightExecutablePath: path.join(os.tmpdir(), 'missing-bundled.exe'),
    })).toBe(executablePath);
  });

  it('falls back to installed Edge when Chrome is absent', () => {
    const { root, executablePath } = temporaryExecutable(
      'Microsoft', 'Edge', 'Application', 'msedge.exe',
    );

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', 'ProgramFiles(x86)': root },
      playwrightExecutablePath: path.join(os.tmpdir(), 'missing-bundled.exe'),
    })).toBe(executablePath);
  });

  it('skips an installed browser directory and uses the next valid candidate', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'chromium-invalid-installed-'));
    temporaryDirectories.push(root);
    mkdirSync(path.join(root, 'Google', 'Chrome', 'Application'), { recursive: true });
    mkdirSync(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    const { executablePath: edge } = temporaryExecutable('Microsoft', 'Edge', 'Application', 'msedge.exe');
    const edgeRoot = path.dirname(path.dirname(path.dirname(path.dirname(edge))));

    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: { NODE_ENV: 'test', ProgramFiles: root, 'ProgramFiles(x86)': edgeRoot },
      playwrightExecutablePath: path.join(os.tmpdir(), 'missing-bundled.exe'),
    })).toBe(edge);
  });

  it('returns unavailable when no supported browser candidate exists', () => {
    expect(resolveChromiumExecutable({
      platform: 'win32',
      env: {
        NODE_ENV: 'test',
        ProgramFiles: path.join(os.tmpdir(), 'missing-program-files'),
        'ProgramFiles(x86)': path.join(os.tmpdir(), 'missing-program-files-x86'),
        LOCALAPPDATA: path.join(os.tmpdir(), 'missing-local-app-data'),
      },
      playwrightExecutablePath: path.join(os.tmpdir(), 'missing-bundled.exe'),
    })).toBeNull();
  });
});
