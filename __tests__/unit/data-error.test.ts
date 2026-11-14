import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleDataError, redirectIfUnauthorized, errorToastKey } from '@/lib/utils/data-error';
import { UnauthorizedError, NotFoundError, AccessError, FileTooLargeError, MediaTagConflictError, StorageLimitError, DatabaseInterruptedError, RateLimitError, ServerError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { throwForStatus } from '@/lib/data/http/shared';

afterEach(() => { vi.unstubAllGlobals(); });

describe('handleDataError', () => {
  it('redirects to sign-in and returns true on UnauthorizedError', () => {
    const loc = { href: '' };
    vi.stubGlobal('window', { location: loc } as unknown as Window & typeof globalThis);
    expect(handleDataError(new UnauthorizedError())).toBe(true);
    expect(loc.href).toBe('/api/auth/signin');
  });

  it('returns false for other errors', () => {
    expect(handleDataError(new NotFoundError())).toBe(false);
    expect(handleDataError(new Error('boom'))).toBe(false);
  });
});

describe('redirectIfUnauthorized', () => {
  it('redirects only UnauthorizedError and reports whether the caller should stop', () => {
    const loc = { href: '' };
    vi.stubGlobal('window', { location: loc } as unknown as Window & typeof globalThis);
    expect(redirectIfUnauthorized(new UnauthorizedError())).toBe(true);
    expect(loc.href).toBe('/api/auth/signin');
    expect(redirectIfUnauthorized(new Error('boom'))).toBe(false);
  });
});

describe('errorToastKey', () => {
  it('maps each typed error to its own message key', () => {
    expect(errorToastKey(new AccessError())).toBe('error_permission');
    expect(errorToastKey(new NotFoundError())).toBe('error_gone');
    expect(errorToastKey(new ValidationError('bad'))).toBe('error_invalid');
    expect(errorToastKey(new StorageLimitError())).toBe('error_storage_full');
    expect(errorToastKey(new DatabaseInterruptedError())).toBe('error_interrupted');
    expect(errorToastKey(new FileTooLargeError('big', 10))).toBe('error_file_too_large');
  });

  it('falls back to the generic key for anything unrecognised', () => {
    expect(errorToastKey(new Error('boom'))).toBe('error_generic');
    expect(errorToastKey('a bare string')).toBe('error_generic');
    expect(errorToastKey(undefined)).toBe('error_generic');
  });

  it('reports a fetch rejection as offline only when the browser agrees', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(errorToastKey(new TypeError('Failed to fetch'))).toBe('error_offline');
    vi.stubGlobal('navigator', { onLine: true });
    // Online: a TypeError is far more likely a genuine bug than a dropped connection.
    expect(errorToastKey(new TypeError('Failed to fetch'))).toBe('error_generic');
  });
});

describe('throwForStatus', () => {
  function res(status: number, body: unknown) {
    return { status, json: async () => body } as unknown as Response;
  }

  it('throws ServerError carrying the id of a 500 (#8)', async () => {
    const error = await throwForStatus(res(500, { error: 'Failed to fetch places', errorId: 'a1b2c3d4' }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).errorId).toBe('a1b2c3d4');
    expect(errorToastKey(error)).toBe('error_generic');
    const plain = await throwForStatus(res(500, { error: 'boom' })).catch((caught: unknown) => caught);
    expect(plain).not.toBeInstanceOf(ServerError);
  });

  it('throws StorageLimitError on 507 so the quota message can be shown', async () => {
    const error = await throwForStatus(res(507, {
      error: 'Storage limit reached',
      code: 'storage_limit',
      retryable: true,
      usedBytes: 90 * 1024 * 1024,
      limitBytes: 100 * 1024 * 1024,
      remainingBytes: 10 * 1024 * 1024,
    })).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StorageLimitError);
    expect(error).toMatchObject({
      code: 'storage_limit',
      retryable: true,
      usedBytes: 90 * 1024 * 1024,
      limitBytes: 100 * 1024 * 1024,
      remainingBytes: 10 * 1024 * 1024,
    });
  });

  it('throws FileTooLargeError with the limit on 413 (#1215)', async () => {
    const error = await throwForStatus(res(413, { error: 'File size exceeds 10MB limit', code: 'file_too_large', limitBytes: 10 * 1024 * 1024 }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FileTooLargeError);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: 'file_too_large', limitBytes: 10 * 1024 * 1024 });
  });

  it('still maps the existing statuses', async () => {
    await expect(throwForStatus(res(401, { error: 'no' }))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(throwForStatus(res(403, { error: 'no' }))).rejects.toBeInstanceOf(AccessError);
    await expect(throwForStatus(res(404, { error: 'no' }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(throwForStatus(res(400, { error: 'no' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('reconstructs a non-retryable media-tag conflict without calling it a primary conflict', async () => {
    const error = await throwForStatus(res(409, {
      error: 'This person is already tagged in this media',
      code: 'media_tag_conflict',
      retryable: false,
    })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MediaTagConflictError);
    expect(error).toMatchObject({ code: 'media_tag_conflict', retryable: false });
  });

  it('carries the retry delay a 429 sends (#1231)', async () => {
    const error = await throwForStatus(res(429, { error: 'Too many', retryAfterSeconds: 90 })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfterSeconds: 90 });
  });
});
