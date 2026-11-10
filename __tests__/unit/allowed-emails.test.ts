import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllowedEmails, getBootstrapEmail, isHostedProduction, normalizeEmail } from '@/lib/auth/allowed-emails';
import { authConfig } from '@/auth.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hosted sign-in settings', () => {
  it('reads an unset allowlist as null and a blank one as empty', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAILS', undefined);
    expect(getAllowedEmails()).toBeNull();
    vi.stubEnv('AUTH_ALLOWED_EMAILS', ' , ');
    expect(getAllowedEmails()).toEqual([]);
  });

  it('normalizes the allowlist it seeds members from', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAILS', ' You@Example.com, partner@example.com ');
    expect(getAllowedEmails()).toEqual(['you@example.com', 'partner@example.com']);
  });

  it('normalizes the bootstrap address and treats blank as unset', () => {
    vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', '  Admin@Example.COM ');
    expect(getBootstrapEmail()).toBe('admin@example.com');
    vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', '   ');
    expect(getBootstrapEmail()).toBeNull();
    vi.stubEnv('AUTH_BOOTSTRAP_EMAIL', undefined);
    expect(getBootstrapEmail()).toBeNull();
  });

  it('normalizes an address the way the member table stores it', () => {
    expect(normalizeEmail('  Ada@Example.com ')).toBe('ada@example.com');
  });

  it('counts only a production build without DESKTOP_MODE as hosted production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DESKTOP_MODE', 'false');
    expect(isHostedProduction()).toBe(true);
    vi.stubEnv('DESKTOP_MODE', 'true');
    expect(isHostedProduction()).toBe(false);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DESKTOP_MODE', 'false');
    expect(isHostedProduction()).toBe(false);
  });

  it('keeps the sign-in decision out of the edge-shared config (ADR 0029)', () => {
    // The membership check needs the database, so it lives on the Node instance.
    expect((authConfig.callbacks as Record<string, unknown>).signIn).toBeUndefined();
  });
});
