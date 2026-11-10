import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { NextRequest } from 'next/server';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { POST as CREATE_MEDIA } from '@/app/api/media/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_CASE } from '@/app/api/cases/route';
import { POST as CREATE_TREE } from '@/app/api/trees/route';
import { POST as SHARE_TREE } from '@/app/api/sharing/route';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { query } from '@/lib/db/connection';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';

const disk = vi.hoisted(() => ({ root: '' }));

vi.mock('@/lib/data-dir', () => ({ getDataDir: () => disk.root }));
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed-image')),
  })),
}));

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('POST /api/media/upload target validation', () => {
  beforeEach(async () => {
    disk.root = await mkdtemp(path.join(tmpdir(), 'heirloom-media-targets-'));
  });

  afterEach(async () => {
    await cleanupTestData();
    if (disk.root) await rm(disk.root, { recursive: true, force: true });
    disk.root = '';
  });

  async function count(table: 'Media' | 'MediaBlob' | 'CaseMedia' | 'MediaLink'): Promise<number> {
    const result = await query(`SELECT count(*)::int AS n FROM "${table}"`);
    return (result.rows[0] as { n: number }).n;
  }

  async function scopedUploadFiles(ownerId = TEST_USER.id): Promise<string[]> {
    const dir = path.join(disk.root, 'uploads', String(ownerId), 'media');
    try {
      return (await readdir(dir, { recursive: true })).map(String);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async function expectZeroMutation(): Promise<void> {
    expect(await count('Media')).toBe(0);
    expect(await count('MediaBlob')).toBe(0);
    expect(await count('CaseMedia')).toBe(0);
    expect(await count('MediaLink')).toBe(0);
    expect(await scopedUploadFiles()).toEqual([]);
  }

  async function createTree(name: string): Promise<number> {
    const response = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', {
      method: 'POST', body: { name },
    }));
    expect(response.status).toBe(201);
    return (await parseResponse<{ tree: { Id: number } }>(response)).tree.Id;
  }

  async function createPerson(treeId?: number): Promise<number> {
    const suffix = treeId == null ? '' : `?treeId=${treeId}`;
    const response = await CREATE_PERSON(createRequest(`http://localhost:3000/api/people${suffix}`, {
      method: 'POST', body: { FirstName: 'Target', LastName: 'Person' },
    }));
    expect(response.status).toBe(201);
    return (await parseResponse<{ person: { Id: number } }>(response)).person.Id;
  }

  async function createCase(treeId: number): Promise<number> {
    const response = await CREATE_CASE(createRequest(`http://localhost:3000/api/cases?treeId=${treeId}`, {
      method: 'POST', body: { Title: 'Foreign case' },
    }));
    expect(response.status).toBe(201);
    return (await parseResponse<{ case: { Id: number } }>(response)).case.Id;
  }

  function upload(fields: Record<string, string>, treeId?: number): Promise<Response> {
    const formData = new FormData();
    formData.append('file', new File(['image'], 'photo.jpg', { type: 'image/jpeg' }));
    for (const [name, value] of Object.entries(fields)) formData.append(name, value);
    if (treeId != null) formData.append('treeId', String(treeId));
    return UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
      method: 'POST', body: formData,
    }));
  }

  it('rejects a foreign person before any database or filesystem mutation', async () => {
    const requestedTree = await createTree('Requested tree');
    const foreignTree = await createTree('Foreign tree');
    const foreignPerson = await createPerson(foreignTree);

    const response = await upload({ personId: String(foreignPerson) }, requestedTree);

    expect(response.status).toBe(404);
    await expectZeroMutation();
  });

  it('rejects a foreign case before any database or filesystem mutation', async () => {
    const requestedTree = await createTree('Requested tree');
    const foreignTree = await createTree('Foreign tree');
    const foreignCase = await createCase(foreignTree);

    const response = await upload({ caseId: String(foreignCase) }, requestedTree);

    expect(response.status).toBe(404);
    await expectZeroMutation();
  });

  it('rejects a foreign polymorphic owner before any database or filesystem mutation', async () => {
    const requestedTree = await createTree('Requested tree');
    const foreignTree = await createTree('Foreign tree');
    const foreignPerson = await createPerson(foreignTree);

    const response = await upload({ ownerTable: 'People', ownerRecordId: String(foreignPerson) }, requestedTree);

    expect(response.status).toBe(404);
    await expectZeroMutation();
  });

  it('rejects an invalid owner table before any database or filesystem mutation', async () => {
    const response = await upload({ ownerTable: 'Places', ownerRecordId: '1' });

    expect(response.status).toBe(400);
    await expectZeroMutation();
  });

  it('rejects an incomplete owner pair before any database or filesystem mutation', async () => {
    const response = await upload({ ownerTable: 'Families' });

    expect(response.status).toBe(400);
    await expectZeroMutation();
  });

  it('rejects an invalid explicit tree before any database or filesystem mutation', async () => {
    const response = await upload({}, 2_147_483_647);

    expect(response.status).toBe(403);
    await expectZeroMutation();
  });

  it('rejects view permission before any database or filesystem mutation', async () => {
    const personId = await createPerson();
    const share = await SHARE_TREE(createRequest('http://localhost:3000/api/sharing', {
      method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
    }));
    expect(share.status).toBe(201);
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);

    const response = await upload({ personId: String(personId), ownerId: String(TEST_USER.id) });

    expect(response.status).toBe(403);
    await expectZeroMutation();
  });

  it('validates metadata-only creation through the same foreign-person guard', async () => {
    const requestedTree = await createTree('Requested tree');
    const foreignTree = await createTree('Foreign tree');
    const foreignPerson = await createPerson(foreignTree);

    const response = await CREATE_MEDIA(createRequest(`http://localhost:3000/api/media?treeId=${requestedTree}`, {
      method: 'POST', body: { Title: 'Metadata only', PersonId: foreignPerson },
    }));

    expect(response.status).toBe(404);
    await expectZeroMutation();
  });
});
