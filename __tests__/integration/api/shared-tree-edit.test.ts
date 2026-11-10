import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET, POST, DELETE } from '@/app/api/people/[id]/events/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { GET as GET_SHARED_WITH_ME } from '@/app/api/sharing/with-me/route';
import { POST as CREATE_TREE } from '@/app/api/trees/route';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { query } from '@/lib/db/connection';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { POST as ADD_CHILD, DELETE as REMOVE_CHILD } from '@/app/api/families/[id]/children/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { PUT as PUT_PERSON } from '@/app/api/people/[id]/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
  }));
  return { default: mockSharp };
});

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Shared tree edit', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createTestPerson() {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Alice', LastName: 'Owner' },
    }));
    const data = await parseResponse<{ person: { Id: number } }>(res);
    return data.person;
  }

  async function shareWithUser2(permission: 'edit' | 'contribute' | 'view') {
    await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
      method: 'POST',
      body: { email: TEST_USER_2.email, permission },
    }));
  }

  describe('POST /api/people/[id]/events', () => {
    it('editor creates event stored under tree owner', async () => {
      const person = await createTestPerson();
      await shareWithUser2('edit');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { Type: 'BAPM', Date: '1900-01-01', Place: 'Paris' } }
      );
      const res = await POST(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(201);

      const data = await parseResponse<{ event: { UserId: number; Type: string } }>(res);
      expect(data.event.UserId).toBe(TEST_USER.id);
      expect(data.event.Type).toBe('BAPM');
    });

    it('contribute user creates event stored under tree owner', async () => {
      const person = await createTestPerson();
      await shareWithUser2('contribute');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { Type: 'BAPM', Date: '1920-05-01' } }
      );
      const res = await POST(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(201);

      const data = await parseResponse<{ event: { UserId: number } }>(res);
      expect(data.event.UserId).toBe(TEST_USER.id);
    });

    it('view-only user gets 403 creating event', async () => {
      const person = await createTestPerson();
      await shareWithUser2('view');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { Type: 'BAPM' } }
      );
      const res = await POST(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(403);
    });

    it('unshared user gets 403 creating event', async () => {
      const person = await createTestPerson();

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { Type: 'BAPM' } }
      );
      const res = await POST(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(403);
    });

    it('owner creates event on own tree without ownerId', async () => {
      const person = await createTestPerson();
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events`,
        { method: 'POST', body: { Type: 'BURI', Place: 'London' } }
      );
      const res = await POST(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(201);

      const data = await parseResponse<{ event: { UserId: number } }>(res);
      expect(data.event.UserId).toBe(TEST_USER.id);
    });
  });

  describe('GET /api/people/[id]/events', () => {
    it('editor sees owner events via ownerId', async () => {
      const person = await createTestPerson();
      await POST(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events`, {
          method: 'POST',
          body: { Type: 'OCCU', Description: 'Farmer' },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );

      await shareWithUser2('edit');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}`
      );
      const res = await GET(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(200);

      const data = await parseResponse<{ events: { Type: string }[] }>(res);
      expect(data.events).toHaveLength(1);
      expect(data.events[0].Type).toBe('OCCU');
    });
  });

  describe('DELETE /api/people/[id]/events', () => {
    it('editor deletes event on shared tree', async () => {
      const person = await createTestPerson();
      const createRes = await POST(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events`, {
          method: 'POST',
          body: { Type: 'RESI', Place: 'Berlin' },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      await shareWithUser2('edit');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}&eventId=${event.Id}`,
        { method: 'DELETE' }
      );
      const res = await DELETE(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(204);
    });

    it('contribute user gets 403 deleting event', async () => {
      const person = await createTestPerson();
      const createRes = await POST(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events`, {
          method: 'POST',
          body: { Type: 'RESI', Place: 'Rome' },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      await shareWithUser2('contribute');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}&eventId=${event.Id}`,
        { method: 'DELETE' }
      );
      const res = await DELETE(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(403);
    });

    it('view-only user gets 403 deleting event', async () => {
      const person = await createTestPerson();
      const createRes = await POST(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events`, {
          method: 'POST',
          body: { Type: 'RESI' },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      await shareWithUser2('view');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/people/${person.Id}/events?ownerId=${TEST_USER.id}&eventId=${event.Id}`,
        { method: 'DELETE' }
      );
      const res = await DELETE(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/media/upload', () => {
    function makeUploadRequest(personId: number, ownerId: number) {
      const formData = new FormData();
      formData.append('file', new Blob(['fake'], { type: 'image/jpeg' }), 'photo.jpg');
      formData.append('personId', String(personId));
      formData.append('title', 'Test Photo');
      formData.append('isPrimary', 'false');
      formData.append('ownerId', String(ownerId));
      return new NextRequest('http://localhost:3000/api/media/upload', {
        method: 'POST',
        body: formData,
      });
    }

    it('editor uploads photo stored under tree owner', async () => {
      const person = await createTestPerson();
      await shareWithUser2('edit');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const res = await UPLOAD_MEDIA(makeUploadRequest(person.Id, TEST_USER.id));
      expect(res.status).toBe(201);

      const data = await parseResponse<{ media: { Id: number; UserId: number } }>(res);
      expect(data.media.UserId).toBe(TEST_USER.id);
      expect((await query(
        `SELECT "OwnerId" FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'People'`,
        [data.media.Id],
      )).rows).toEqual([{ OwnerId: person.Id }]);
    });

    it('contribute user uploads photo stored under tree owner', async () => {
      const person = await createTestPerson();
      await shareWithUser2('contribute');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const res = await UPLOAD_MEDIA(makeUploadRequest(person.Id, TEST_USER.id));
      expect(res.status).toBe(201);

      const data = await parseResponse<{ media: { Id: number; UserId: number } }>(res);
      expect(data.media.UserId).toBe(TEST_USER.id);
      expect((await query(
        `SELECT "OwnerId" FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'People'`,
        [data.media.Id],
      )).rows).toEqual([{ OwnerId: person.Id }]);
    });

    it('view-only user gets 403 uploading photo', async () => {
      const person = await createTestPerson();
      await shareWithUser2('view');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const res = await UPLOAD_MEDIA(makeUploadRequest(person.Id, TEST_USER.id));
      expect(res.status).toBe(403);
    });

    it('unshared user gets 403 uploading photo', async () => {
      const person = await createTestPerson();

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const res = await UPLOAD_MEDIA(makeUploadRequest(person.Id, TEST_USER.id));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/[id]/children', () => {
    async function createTestFamily() {
      const res = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {},
      }));
      const data = await parseResponse<{ family: { Id: number } }>(res);
      return data.family;
    }

    it('editor adds child to shared family', async () => {
      const family = await createTestFamily();
      const child = await createTestPerson();
      await shareWithUser2('edit');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/families/${family.Id}/children?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { childId: child.Id } }
      );
      const res = await ADD_CHILD(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(201);
    });

    it('contribute user adds child to shared family', async () => {
      const family = await createTestFamily();
      const child = await createTestPerson();
      await shareWithUser2('contribute');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/families/${family.Id}/children?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { childId: child.Id } }
      );
      const res = await ADD_CHILD(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(201);
    });

    it('contribute user gets 403 removing child from shared family', async () => {
      const family = await createTestFamily();
      const child = await createTestPerson();

      await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId: child.Id },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );

      await shareWithUser2('contribute');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/families/${family.Id}/children?ownerId=${TEST_USER.id}`,
        { method: 'DELETE', body: { childId: child.Id } }
      );
      const res = await REMOVE_CHILD(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(403);
    });

    it('view-only user gets 403 adding child', async () => {
      const family = await createTestFamily();
      const child = await createTestPerson();
      await shareWithUser2('view');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/families/${family.Id}/children?ownerId=${TEST_USER.id}`,
        { method: 'POST', body: { childId: child.Id } }
      );
      const res = await ADD_CHILD(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(403);
    });

    it('view-only user gets 403 removing child from shared family', async () => {
      const family = await createTestFamily();
      const child = await createTestPerson();

      await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId: child.Id },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );

      await shareWithUser2('view');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/families/${family.Id}/children?ownerId=${TEST_USER.id}`,
        { method: 'DELETE', body: { childId: child.Id } }
      );
      const res = await REMOVE_CHILD(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(403);
    });

    it('editor removes child from shared family', async () => {
      const family = await createTestFamily();
      const child = await createTestPerson();

      // Add child first as owner
      await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId: child.Id },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );

      await shareWithUser2('edit');

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(
        `http://localhost:3000/api/families/${family.Id}/children?ownerId=${TEST_USER.id}`,
        { method: 'DELETE', body: { childId: child.Id } }
      );
      const res = await REMOVE_CHILD(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Per-tree sharing (Phase 5)', () => {
    it('guest reads shared tree A but gets 403 on unshared tree B', async () => {
      // Person lands in TEST_USER's default tree (A).
      const person = await createTestPerson();
      const treeA = await resolveDefaultTree(TEST_USER.id);

      // A second tree B, NOT shared.
      const treeBRes = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', {
        method: 'POST',
        body: { name: 'Unshared Tree B' },
      }));
      expect(treeBRes.status).toBe(201);
      const { tree: treeB } = await parseResponse<{ tree: { Id: number } }>(treeBRes);

      // Share ONLY tree A with user 2.
      const shareRes = await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: TEST_USER_2.email, permission: 'view', treeId: treeA },
      }));
      expect(shareRes.status).toBe(201);

      // Guest reads tree A → 200.
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const okRes = await GET(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events?treeId=${treeA}`),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );
      expect(okRes.status).toBe(200);

      // Guest requests tree B → 403 (share does not extend to the owner's other trees).
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const deniedRes = await GET(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events?treeId=${treeB.Id}`),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );
      expect(deniedRes.status).toBe(403);
    });

    it('mixed per-tree permissions: view on tree A does not block edits on tree B shared as edit', async () => {
      // Regression for the owner-keyed hasEditPermission: with two shares from
      // one owner it picked the LOWEST-Id share ('view' on A, created first)
      // and falsely denied every write on tree B despite its 'edit' share.
      const treeA = await resolveDefaultTree(TEST_USER.id);
      const treeBRes = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', {
        method: 'POST',
        body: { name: 'Edit-shared Tree B' },
      }));
      const { tree: treeB } = await parseResponse<{ tree: { Id: number } }>(treeBRes);

      // Share A as 'view' FIRST (lower share Id — the old bug's pick), then B as 'edit'.
      for (const [treeId, permission] of [[treeA, 'view'], [treeB.Id, 'edit']] as const) {
        const res = await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
          method: 'POST',
          body: { email: TEST_USER_2.email, permission, treeId },
        }));
        expect(res.status).toBe(201);
      }

      // A person in tree B, owned by user 1.
      const personRes = await CREATE_PERSON(createRequest(`http://localhost:3000/api/people?treeId=${treeB.Id}`, {
        method: 'POST',
        body: { FirstName: 'Editable', LastName: 'InB' },
      }));
      const { person } = await parseResponse<{ person: { Id: number } }>(personRes);

      // User 2 edits it under the tree-B scope — must succeed.
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const putRes = await PUT_PERSON(
        createRequest(`http://localhost:3000/api/people/${person.Id}?treeId=${treeB.Id}`, {
          method: 'PUT',
          body: { FirstName: 'Edited' },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) }
      );
      expect(putRes.status).toBe(200);

      const after = await parseResponse<{ person: { FirstName: string } }>(putRes);
      expect(after.person.FirstName).toBe('Edited');
    });

    it('getSharedWithMe returns one row per shared tree with the tree name', async () => {
      const treeA = await resolveDefaultTree(TEST_USER.id);
      const treeBRes = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', {
        method: 'POST',
        body: { name: 'Research Tree' },
      }));
      const { tree: treeB } = await parseResponse<{ tree: { Id: number } }>(treeBRes);

      // Share BOTH trees with user 2, with different permissions.
      for (const [treeId, permission] of [[treeA, 'view'], [treeB.Id, 'edit']] as const) {
        const res = await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
          method: 'POST',
          body: { email: TEST_USER_2.email, permission, treeId },
        }));
        expect(res.status).toBe(201);
      }

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const res = await GET_SHARED_WITH_ME();
      expect(res.status).toBe(200);
      const data = await parseResponse<{
        shares: { TreeId: number; Permission: string; TreeName: string | null; owner: { Id: number; Email: string } | null }[];
      }>(res);

      // One row per shared TREE.
      const mine = data.shares.filter(s => s.owner?.Id === TEST_USER.id);
      expect(mine).toHaveLength(2);

      const rowA = mine.find(s => s.TreeId === treeA);
      const rowB = mine.find(s => s.TreeId === treeB.Id);
      expect(rowA?.Permission).toBe('view');
      expect(typeof rowA?.TreeName).toBe('string'); // default tree name is user data
      expect(rowB?.Permission).toBe('edit');
      expect(rowB?.TreeName).toBe('Research Tree');
      expect(rowA?.owner?.Email).toBe(TEST_USER.email);
    });
  });
});
