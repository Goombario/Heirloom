import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_TREE } from '@/app/api/trees/route';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { query } from '@/lib/db/connection';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { createRequest, parseResponse } from '../../setup/test-helpers';

const disk = vi.hoisted(() => ({ root: '' }));

vi.mock('@/lib/data-dir', () => ({ getDataDir: () => disk.root }));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
  unlink: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
}));
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    metadata: vi.fn().mockResolvedValue({ width: 512, height: 512 }),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
  })),
}));

const describeIf = hasTestDatabase() ? describe : describe.skip;
const INTENT = '123e4567-e89b-12d3-a456-426614174100';
const OTHER_INTENT = '123e4567-e89b-12d3-a456-426614174101';

function file(bytes = 'same original bytes'): File {
  return new File([bytes], 'staged.jpg', { type: 'image/jpeg' });
}

async function count(table: 'Media' | 'MediaLink' | 'MediaBlob'): Promise<number> {
  const result = await query(`SELECT count(*)::int AS n FROM "${table}"`);
  return (result.rows[0] as { n: number }).n;
}

describeIf('POST /api/media/upload — staged upload intents', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  afterEach(async () => {
    await cleanupTestData();
    disk.root = '';
  });

  async function createTree(name: string): Promise<number> {
    const response = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', {
      method: 'POST', body: { name },
    }));
    expect(response.status).toBe(201);
    return (await parseResponse<{ tree: { Id: number } }>(response)).tree.Id;
  }

  async function createEvent(treeId?: number): Promise<{ id: number; treeId: number }> {
    const suffix = treeId == null ? '' : `?treeId=${treeId}`;
    const personResponse = await CREATE_PERSON(createRequest(`http://localhost:3000/api/people${suffix}`, {
      method: 'POST', body: { FirstName: 'Upload', LastName: 'Owner' },
    }));
    expect(personResponse.status).toBe(201);
    const person = (await parseResponse<{ person: { Id: number } }>(personResponse)).person;
    const eventResponse = await CREATE_EVENT(createRequest(`http://localhost:3000/api/events${suffix}`, {
      method: 'POST', body: { Type: 'EVEN', PersonId: person.Id },
    }));
    expect(eventResponse.status).toBe(201);
    const event = (await parseResponse<{ event: { Id: number; TreeId: number } }>(eventResponse)).event;
    return { id: event.Id, treeId: event.TreeId };
  }

  async function upload(owner: { id: number; treeId: number }, uploadIntentId: string, bytes = 'same original bytes'): Promise<Response> {
    const formData = new FormData();
    formData.append('file', file(bytes));
    formData.append('treeId', String(owner.treeId));
    formData.append('ownerTable', 'Events');
    formData.append('ownerRecordId', String(owner.id));
    formData.append('uploadIntentId', uploadIntentId);
    return UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
      method: 'POST', body: formData,
    }));
  }

  async function uploadWithoutOwner(owner: { treeId: number }, uploadIntentId: string): Promise<Response> {
    const formData = new FormData();
    formData.append('file', file());
    formData.append('treeId', String(owner.treeId));
    formData.append('uploadIntentId', uploadIntentId);
    return UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
      method: 'POST', body: formData,
    }));
  }

  async function mediaId(response: Response): Promise<number> {
    expect(response.status).toBe(201);
    const body = await parseResponse<{ media: Record<string, unknown> & { Id: number } }>(response);
    expect(body.media).not.toHaveProperty('UploadIntentId');
    expect(body.media).not.toHaveProperty('UploadIntentTarget');
    return body.media.Id;
  }

  it('replaying the same bytes and intent for one Events owner returns the same ID with one Media and one MediaLink', async () => {
    const owner = await createEvent();
    const first = await mediaId(await upload(owner, INTENT));
    const second = await mediaId(await upload(owner, INTENT));

    expect(second).toBe(first);
    expect(await count('Media')).toBe(1);
    expect(await count('MediaLink')).toBe(1);
    expect(await count('MediaBlob')).toBe(0);
    expect((await query(`SELECT "UploadIntentId" FROM "Media" WHERE "Id" = $1`, [first])).rows)
      .toEqual([{ UploadIntentId: INTENT }]);
    expect((await query(`SELECT "OwnerTable", "OwnerId" FROM "MediaLink" WHERE "MediaId" = $1`, [first])).rows)
      .toEqual([{ OwnerTable: 'Events', OwnerId: owner.id }]);
  });

  it('different intents deliberately create duplicate hosted media rows and links', async () => {
    const owner = await createEvent();
    const first = await mediaId(await upload(owner, INTENT));
    const second = await mediaId(await upload(owner, OTHER_INTENT));

    expect(second).not.toBe(first);
    expect(await count('Media')).toBe(2);
    expect(await count('MediaLink')).toBe(2);
  });

  it.each([
    ['different original content', { bytes: 'changed original bytes' }],
    ['different owner target', { owner: 'other' }],
  ] as const)('rejects a reused intent with %s as a stable conflict without exposing database text', async (kind, variation) => {
    const owner = await createEvent();
    const otherOwner = 'owner' in variation && variation.owner === 'other' ? await createEvent() : owner;
    const first = await mediaId(await upload(owner, INTENT));
    const response = await upload(otherOwner, INTENT, 'bytes' in variation ? variation.bytes : 'same original bytes');
    const body = await parseResponse<{ error: string; code: string; retryable: boolean }>(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'upload_intent_conflict', retryable: false });
    expect(body.error).toBe('Upload intent conflicts with existing media');
    expect(body.error).not.toMatch(/duplicate key|unique constraint|UploadIntentId|postgres|relation does not exist/i);
    expect(first).toBeGreaterThan(0);
    expect(await count('Media')).toBe(1);
    expect(await count('MediaLink')).toBe(1);
  });

  it('rejects a replay that omits the original Events owner target', async () => {
    const owner = await createEvent();
    await mediaId(await upload(owner, INTENT));

    const response = await uploadWithoutOwner(owner, INTENT);
    const body = await parseResponse<{ error: string; code: string; retryable: boolean }>(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'upload_intent_conflict', retryable: false });
    expect(body.error).toBe('Upload intent conflicts with existing media');
    expect(await count('Media')).toBe(1);
    expect(await count('MediaLink')).toBe(1);
  });

  it('does not reuse an intent across tree scopes', async () => {
    const firstOwner = await createEvent();
    const otherTree = await createTree('Other upload tree');
    const secondOwner = await createEvent(otherTree);

    const first = await mediaId(await upload(firstOwner, INTENT));
    const second = await mediaId(await upload(secondOwner, INTENT));

    expect(second).not.toBe(first);
    expect(await count('Media')).toBe(2);
    expect((await query(`SELECT "TreeId" FROM "Media" ORDER BY "Id"`)).rows)
      .toEqual([{ TreeId: firstOwner.treeId }, { TreeId: secondOwner.treeId }]);
  });

  it.each([
    ['malformed', 'not-a-uuid'],
    ['oversized', '123e4567-e89b-12d3-a456-426614174100-extra-upload-intent-data'],
  ])('rejects a %s uploadIntentId with 400 before any database or filesystem mutation', async (_kind, uploadIntentId) => {
    const owner = await createEvent();
    const response = await upload(owner, uploadIntentId);

    expect(response.status).toBe(400);
    const body = await parseResponse<{ error: string }>(response);
    expect(body.error).toBe('Invalid upload intent');
    expect(body.error).not.toMatch(/duplicate key|unique constraint|UploadIntentId/i);
    expect(await count('Media')).toBe(0);
    expect(await count('MediaLink')).toBe(0);
    expect(await count('MediaBlob')).toBe(0);
    const fs = await import('fs/promises');
    expect(vi.mocked(fs.mkdir)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
  });
});
