import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpDataClient } from '@/lib/data/http';
import { AccessError, UnauthorizedError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import type { UploadMediaInput } from '@/lib/data/types';

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpDataClient.people.list', () => {
  it('requests /api/people and returns the parsed payload', async () => {
    const payload = { people: [{ Id: 1, FirstName: 'Ada' }], count: 1 };
    const fetchMock = mockFetchOnce(200, payload);

    const client = new HttpDataClient();
    const result = await client.people.list();

    expect(fetchMock).toHaveBeenCalledWith('/api/people');
    expect(result).toEqual(payload);
  });

  it('adds treeId and q query params when provided', async () => {
    const fetchMock = mockFetchOnce(200, { people: [], count: 0 });

    const client = new HttpDataClient();
    await client.people.list({ treeId: 42, search: 'smith' });

    expect(fetchMock).toHaveBeenCalledWith('/api/people?treeId=42&q=smith');
  });

  it('throws UnauthorizedError on 401', async () => {
    mockFetchOnce(401, { error: 'Unauthorized' });
    const client = new HttpDataClient();
    await expect(client.people.list()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws AccessError on 403', async () => {
    mockFetchOnce(403, { error: 'Access denied' });
    const client = new HttpDataClient();
    await expect(client.people.list()).rejects.toBeInstanceOf(AccessError);
  });
});

describe('HttpDataClient.people.create', () => {
  it('POSTs JSON and returns the created person', async () => {
    const fetchMock = mockFetchOnce(201, { person: { Id: 7, FirstName: 'Grace' } });

    const client = new HttpDataClient();
    const person = await client.people.create({ FirstName: 'Grace' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/people',
      expect.objectContaining({ method: 'POST' })
    );
    expect(person).toEqual({ Id: 7, FirstName: 'Grace', auditIds: [] });
  });

  it('throws ValidationError on 400', async () => {
    mockFetchOnce(400, { error: 'At least FirstName or LastName is required' });
    const client = new HttpDataClient();
    await expect(client.people.create({})).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('HttpDataClient.media.upload', () => {
  it('serializes malformed-but-present owner pair values for server validation', async () => {
    const fetchMock = mockFetchOnce(201, { media: { Id: 9 } });
    const client = new HttpDataClient();
    const input = {
      file: new File(['image'], 'photo.jpg', { type: 'image/jpeg' }),
      ownerTable: '',
      ownerRecordId: 0,
    } as unknown as UploadMediaInput;

    await client.media.upload(input);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const form = request.body as FormData;
    expect(form.has('ownerTable')).toBe(true);
    expect(form.get('ownerTable')).toBe('');
    expect(form.has('ownerRecordId')).toBe(true);
    expect(form.get('ownerRecordId')).toBe('0');
  });
});

describe('HttpDataClient.media.removeMany', () => {
  it('DELETEs JSON ids with the tree scope and returns the batch result', async () => {
    const payload = {
      results: [
        { id: 9, status: 'deleted', cleanupWarning: null },
        { id: 4, status: 'skipped', code: 'not_found', retryable: false },
      ],
      deletedCount: 1,
      skippedCount: 1,
      failedCount: 0,
      cleanupWarningCount: 0,
    };
    const fetchMock = mockFetchOnce(200, payload);

    const client = new HttpDataClient();
    const result = await client.media.removeMany([9, 4], 42);

    expect(fetchMock).toHaveBeenCalledWith('/api/media?treeId=42', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [9, 4] }),
    });
    expect(result).toEqual(payload);
  });
});

describe('HttpDataClient audit ids for Undo (#1044)', () => {
  it('reads auditIds from a delete response', async () => {
    mockFetchOnce(200, { auditIds: [7, 'x', 8] });
    const client = new HttpDataClient();
    expect(await client.events.remove(3)).toEqual({ auditIds: [7, 8] });
  });

  it('yields no ids from a body-less 204 (an older server)', async () => {
    mockFetchOnce(204, null);
    const client = new HttpDataClient();
    expect(await client.citations.remove(3)).toEqual({ auditIds: [] });
  });

  it('keeps the ids a written record carries, and defaults them when absent', async () => {
    mockFetchOnce(200, { person: { Id: 1, FirstName: 'Ada', auditIds: [4] } });
    const client = new HttpDataClient();
    expect((await client.people.update(1, { FirstName: 'Ada' })).auditIds).toEqual([4]);

    mockFetchOnce(200, { event: { Id: 2, Type: 'OCCU' } });
    expect((await client.events.update(2, { Type: 'OCCU' })).auditIds).toEqual([]);
  });
});
