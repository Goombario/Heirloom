import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const WINDOWS_BROWSER_CANDIDATES = [
  ['chrome', 'Google', 'Chrome', 'Application', 'chrome.exe'],
  ['edge', 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
];

/**
 * Find a Chromium-family executable without installing or repairing anything.
 * Inputs are injectable so callers and tests can use the same deterministic
 * resolution rules regardless of the host environment.
 */
export function resolveChromiumExecutable({
  platform = process.platform,
  env = process.env,
  playwrightExecutablePath = chromium.executablePath(),
  stat = statSync,
  access = accessSync,
} = {}) {
  const isUsableCandidate = (candidate) => {
    try {
      if (!stat(candidate).isFile()) return false;
      const accessMode = constants.R_OK | (platform === 'win32' ? 0 : constants.X_OK);
      access(candidate, accessMode);
      return true;
    } catch {
      return false;
    }
  };

  const explicitPath = String(env.PLAYWRIGHT_CHROMIUM_PATH || '').trim();
  if (explicitPath && isUsableCandidate(explicitPath)) return explicitPath;

  if (playwrightExecutablePath && isUsableCandidate(playwrightExecutablePath)) {
    return playwrightExecutablePath;
  }

  if (platform !== 'win32') return null;

  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
    .filter((root, index, allRoots) => root && allRoots.indexOf(root) === index);

  for (const [, ...relativePath] of WINDOWS_BROWSER_CANDIDATES) {
    for (const root of roots) {
      const candidate = path.join(root, ...relativePath);
      if (isUsableCandidate(candidate)) return candidate;
    }
  }

  return null;
}
