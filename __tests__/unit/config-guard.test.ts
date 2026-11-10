import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The DESKTOP_MODE bypass (proxy.ts) turns off all auth. This guard warns when
 * that's enabled in production against a *remote* database — the dangerous combo.
 * It must stay silent for the legitimate single-user local-Postgres desktop setup.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

interface GuardEnv { DESKTOP_MODE?: string; NODE_ENV?: string; DATABASE_URL?: string }

/** Fresh-import the module (resets its run-once flag), run it, report if it warned. */
async function warns(env: GuardEnv): Promise<boolean> {
  vi.resetModules();
  vi.stubEnv('DESKTOP_MODE', env.DESKTOP_MODE);
  vi.stubEnv('NODE_ENV', env.NODE_ENV ?? 'test');
  vi.stubEnv('DATABASE_URL', env.DATABASE_URL);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { assertDesktopModeSafe } = await import('@/lib/config-guard');
  assertDesktopModeSafe();
  return spy.mock.calls.length > 0;
}

const REMOTE = 'postgresql://u:p@db.hosted.example.com:5432/app';

describe('assertDesktopModeSafe', () => {
  it('warns for DESKTOP_MODE + production + remote DB host', async () => {
    expect(await warns({ DESKTOP_MODE: 'true', NODE_ENV: 'production', DATABASE_URL: REMOTE })).toBe(true);
  });

  it('stays silent for loopback DB hosts (single-user local Postgres)', async () => {
    expect(await warns({ DESKTOP_MODE: 'true', NODE_ENV: 'production', DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/app' })).toBe(false);
    expect(await warns({ DESKTOP_MODE: 'true', NODE_ENV: 'production', DATABASE_URL: 'postgresql://postgres@localhost:5432/app' })).toBe(false);
  });

  it('stays silent when DESKTOP_MODE is off', async () => {
    expect(await warns({ NODE_ENV: 'production', DATABASE_URL: REMOTE })).toBe(false);
  });

  it('stays silent outside production', async () => {
    expect(await warns({ DESKTOP_MODE: 'true', NODE_ENV: 'development', DATABASE_URL: REMOTE })).toBe(false);
  });

  it('only warns once (run-once guard)', async () => {
    vi.resetModules();
    vi.stubEnv('DESKTOP_MODE', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', REMOTE);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { assertDesktopModeSafe } = await import('@/lib/config-guard');
    assertDesktopModeSafe();
    assertDesktopModeSafe();
    assertDesktopModeSafe();
    expect(spy.mock.calls.length).toBe(1);
  });
});

describe('hasPlaceholderAuthSecret', () => {
  async function refuses(env: { AUTH_SECRET?: string; NODE_ENV?: string; DESKTOP_MODE?: string }): Promise<boolean> {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', env.AUTH_SECRET);
    vi.stubEnv('NODE_ENV', env.NODE_ENV ?? 'production');
    vi.stubEnv('DESKTOP_MODE', env.DESKTOP_MODE);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { hasPlaceholderAuthSecret } = await import('@/lib/config-guard');
    return hasPlaceholderAuthSecret();
  }

  it('refuses the .env.example placeholder and the published CI and build values in hosted production', async () => {
    expect(await refuses({ AUTH_SECRET: 'your-secret-key-here' })).toBe(true);
    expect(await refuses({ AUTH_SECRET: ' test-secret-for-ci ' })).toBe(true);
    expect(await refuses({ AUTH_SECRET: 'unused-in-static-build' })).toBe(true);
    expect(await refuses({ AUTH_SECRET: 'x' })).toBe(true);
  });

  it('accepts a real secret, and leaves a missing one to NextAuth', async () => {
    expect(await refuses({ AUTH_SECRET: 'Zk3v0t8mQ1o2yT7nH5bX9cR4wE6uI0pLaSdFgHjKlZx=' })).toBe(false);
    expect(await refuses({ AUTH_SECRET: undefined })).toBe(false);
  });

  it('leaves development, tests and desktop mode alone', async () => {
    expect(await refuses({ AUTH_SECRET: 'your-secret-key-here', NODE_ENV: 'development' })).toBe(false);
    expect(await refuses({ AUTH_SECRET: 'test-secret-for-ci', NODE_ENV: 'test' })).toBe(false);
    expect(await refuses({ AUTH_SECRET: 'x', DESKTOP_MODE: 'true' })).toBe(false);
  });

  it('logs the problem once', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'your-secret-key-here');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DESKTOP_MODE', undefined);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { hasPlaceholderAuthSecret } = await import('@/lib/config-guard');
    hasPlaceholderAuthSecret();
    hasPlaceholderAuthSecret();
    expect(spy.mock.calls.length).toBe(1);
  });
});
