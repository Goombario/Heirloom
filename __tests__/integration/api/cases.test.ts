import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/cases/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/api/cases/[id]/route';
import { POST as POST_COMMENT } from '@/app/api/cases/[id]/comments/route';
import { POST as POST_MEDIA } from '@/app/api/cases/[id]/media/route';
import { DELETE as DELETE_MEDIA } from '@/app/api/cases/[id]/media/[mediaId]/route';
import { GET as GET_LIBRARY } from '@/app/api/cases/[id]/media/library/route';
import { GET as GET_MEDIA } from '@/app/api/media/route';
import { createMedia } from '@/lib/db/queries/media';
import { query } from '@/lib/db/connection';
import { createPerson } from '@/lib/db/queries/people';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import * as trees from '@/lib/db/queries/trees';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/cases', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  // --- Cross-tenant isolation (IDOR regression) ---
  describe('cross-tenant isolation', () => {
    it('does not attach or leak another tenant\'s person or media', async () => {
      // Seed a person + media owned by a DIFFERENT user.
      const fp = await query(
        `INSERT INTO "People" ("UserId","FirstName","LastName") VALUES ($1,'Foreign','Person') RETURNING "Id"`,
        [TEST_USER_2.id],
      );
      const foreignPersonId = (fp.rows[0] as { Id: number }).Id;
      const fm = await query(
        `INSERT INTO "Media" ("UserId","Title","FilePath") VALUES ($1,'Foreign Doc','f.jpg') RETURNING "Id"`,
        [TEST_USER_2.id],
      );
      const foreignMediaId = (fm.rows[0] as { Id: number }).Id;

      // As TEST_USER, create a case trying to attach the foreign person…
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST', body: { Title: 'Sneaky', personIds: [foreignPersonId] },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

      // …then update it to attach the foreign media.
      await PUT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`, {
          method: 'PUT', body: { personIds: [foreignPersonId], mediaIds: [foreignMediaId] },
        }),
        { params: Promise.resolve({ id: String(created.Id) }) },
      );

      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`),
        { params: Promise.resolve({ id: String(created.Id) }) },
      );
      const { case: full } = await parseResponse<{ case: { people: unknown[]; media: unknown[] } }>(getRes);
      // Foreign person/media must be neither attached nor disclosed.
      expect(full.people).toHaveLength(0);
      expect(full.media).toHaveLength(0);
    });
  });

  // --- GET /api/cases ---
  describe('GET /api/cases', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns empty list initially', async () => {
      const req = createRequest('http://localhost:3000/api/cases');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await parseResponse<{ cases: unknown[]; count: number }>(res);
      expect(data.cases).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('returns created cases', async () => {
      await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Origins Research', Status: 'in_progress' },
      }));
      const res = await GET(createRequest('http://localhost:3000/api/cases'));
      const data = await parseResponse<{ cases: { Title: string }[]; count: number }>(res);
      expect(data.count).toBe(1);
      expect(data.cases[0].Title).toBe('Origins Research');
    });

    it('filters by status', async () => {
      await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Open Case', Status: 'in_progress' },
      }));
      await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Closed Case', Status: 'closed' },
      }));
      const res = await GET(createRequest('http://localhost:3000/api/cases?status=closed'));
      const data = await parseResponse<{ cases: { Title: string }[] }>(res);
      expect(data.cases.length).toBe(1);
      expect(data.cases[0].Title).toBe('Closed Case');
    });

    it('filters by tag', async () => {
      await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'Tagged Case', Tags: ['immigration'] } }));
      await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'Untagged Case', Tags: [] } }));
      const res = await GET(createRequest('http://localhost:3000/api/cases?tag=immigration'));
      const data = await parseResponse<{ cases: { Title: string }[] }>(res);
      expect(data.cases.length).toBe(1);
      expect(data.cases[0].Title).toBe('Tagged Case');
    });

    it('filters by search term', async () => {
      await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'Search Alpha' } }));
      await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'Search Beta' } }));
      const res = await GET(createRequest('http://localhost:3000/api/cases?search=Alpha'));
      const data = await parseResponse<{ cases: { Title: string }[] }>(res);
      expect(data.cases.length).toBe(1);
      expect(data.cases[0].Title).toBe('Search Alpha');
    });
  });

  // --- POST /api/cases ---
  describe('POST /api/cases', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Test' },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('creates a case with valid data', async () => {
      const req = createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Birth Year Query', Description: 'Was it 1888 or 1890?', Status: 'in_progress', Tags: ['vital-records'] },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await parseResponse<{ case: { Id: number; Title: string; Status: string } }>(res);
      expect(data.case.Title).toBe('Birth Year Query');
      expect(data.case.Status).toBe('in_progress');
      expect(data.case.Id).toBeGreaterThan(0);
    });

    it('returns 400 when Title is missing', async () => {
      const req = createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Description: 'No title' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when Title is empty string', async () => {
      const req = createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: '' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/cases/:id ---
  describe('GET /api/cases/:id', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases/1');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 404 for nonexistent case', async () => {
      const req = createRequest('http://localhost:3000/api/cases/999999');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });

    it('returns case with relations', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Ship Records', Tags: ['immigration'] },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);
      const res = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(res.status).toBe(200);
      const data = await parseResponse<{ case: { Title: string; people: unknown[]; citations: unknown[]; comments: unknown[] } }>(res);
      expect(data.case.Title).toBe('Ship Records');
      expect(Array.isArray(data.case.people)).toBe(true);
      expect(Array.isArray(data.case.citations)).toBe(true);
      expect(Array.isArray(data.case.comments)).toBe(true);
    });
  });

  // --- PUT /api/cases/:id ---
  describe('PUT /api/cases/:id', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases/1', { method: 'PUT', body: {} });
      const res = await PUT(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('updates case fields', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Original Title', Status: 'in_progress' },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

      const res = await PUT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`, {
          method: 'PUT',
          body: { Title: 'Updated Title', Status: 'on_hold', personIds: [], mediaIds: [] },
        }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(res.status).toBe(200);
      const data = await parseResponse<{ case: { Title: string; Status: string } }>(res);
      expect(data.case.Title).toBe('Updated Title');
      expect(data.case.Status).toBe('on_hold');
    });

    it('returns 400 when Title is set to empty string', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Will be emptied' },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

      const res = await PUT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`, {
          method: 'PUT',
          body: { Title: '', personIds: [], mediaIds: [] },
        }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid Status value', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'Status Test' } }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);
      const res = await PUT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`, { method: 'PUT', body: { Status: 'invalid_value', personIds: [], mediaIds: [] } }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent case', async () => {
      const res = await PUT(
        createRequest('http://localhost:3000/api/cases/999999', { method: 'PUT', body: { Title: 'x', personIds: [], mediaIds: [] } }),
        { params: Promise.resolve({ id: '999999' }) }
      );
      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /api/cases/:id ---
  describe('DELETE /api/cases/:id', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases/1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 404 for nonexistent case', async () => {
      const req = createRequest('http://localhost:3000/api/cases/999999', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });

    it('deletes a case', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'To Be Deleted' },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

      const deleteRes = await DELETE(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(deleteRes.status).toBe(204);

      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/cases/${created.Id}`),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(getRes.status).toBe(404);
    });
  });

  // --- POST /api/cases/:id/comments ---
  describe('POST /api/cases/:id/comments', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases/1/comments', {
        method: 'POST',
        body: { body: 'Note' },
      });
      const res = await POST_COMMENT(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('appends a comment', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Comment Test Case' },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

      const commentRes = await POST_COMMENT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}/comments`, {
          method: 'POST',
          body: { body: 'Found a matching record in parish registers.' },
        }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(commentRes.status).toBe(201);
      const data = await parseResponse<{ comment: { Body: string; CaseId: number } }>(commentRes);
      expect(data.comment.Body).toBe('Found a matching record in parish registers.');
      expect(data.comment.CaseId).toBe(created.Id);
    });

    it('returns 400 when body is empty', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Empty Comment Case' },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

      const res = await POST_COMMENT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}/comments`, {
          method: 'POST',
          body: { body: '' },
        }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent case', async () => {
      const res = await POST_COMMENT(
        createRequest('http://localhost:3000/api/cases/999999/comments', { method: 'POST', body: { body: 'Note' } }),
        { params: Promise.resolve({ id: '999999' }) }
      );
      expect(res.status).toBe(404);
    });
  });

  // Case citations now use the shared /api/citations endpoint (FactTable='Cases')
  // and are surfaced via the case GET's `citations` relation, exercised above.

  // --- Auth / Access ---
  describe('Access control', () => {
    it('returns 403 when accessing another users case without sharing', async () => {
      // Create case as user 1 (default mock)
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', {
        method: 'POST',
        body: { Title: 'Private Case' },
      }));
      const { case: created } = await parseResponse<{ case: { Id: number; UserId: number } }>(createRes);

      // Try to access as user 2 with ownerId=1
      vi.mocked(getUserFromRequest).mockResolvedValueOnce({ id: 2, email: 'other@example.com', name: 'Other', googleId: 'other' });
      const res = await GET(
        createRequest(`http://localhost:3000/api/cases?ownerId=${created.UserId}`)
      );
      expect(res.status).toBe(403);
    });

    it('default list only returns own cases', async () => {
      await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'User 1 Private Case' } }));

      vi.mocked(getUserFromRequest).mockResolvedValueOnce({ id: 2, email: 'other@example.com', name: 'Other', googleId: 'other' });
      const res = await GET(createRequest('http://localhost:3000/api/cases'));
      expect(res.status).toBe(200);
      const data = await parseResponse<{ cases: { Title: string }[] }>(res);
      expect(data.cases.every(c => c.Title !== 'User 1 Private Case')).toBe(true);
    });
  });

  // --- View-only permission blocks writes ---
  describe('View-only permission blocks writes', () => {
    beforeEach(() => {
      // Multi-tree: services resolve scope via resolveTreeScope (not the old
      // validateTreeAccess) — mock the choke point to simulate a view-only share.
      vi.spyOn(trees, 'resolveTreeScope').mockResolvedValue({
        treeId: 1,
        ownerId: TEST_USER_2.id,
        permission: 'view',
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('POST /api/cases returns 403 for view-only', async () => {
      const res = await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'x' } }));
      expect(res.status).toBe(403);
    });

    it('PUT /api/cases/:id returns 403 for view-only', async () => {
      const res = await PUT(
        createRequest('http://localhost:3000/api/cases/1', { method: 'PUT', body: { personIds: [], mediaIds: [] } }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(403);
    });

    it('DELETE /api/cases/:id returns 403 for view-only', async () => {
      const res = await DELETE(
        createRequest('http://localhost:3000/api/cases/1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(403);
    });

    it('POST comment returns 403 for view-only', async () => {
      const res = await POST_COMMENT(
        createRequest('http://localhost:3000/api/cases/1/comments', { method: 'POST', body: { body: 'x' } }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(403);
    });
  });

  // --- Closed case write protection ---
  describe('Closed case write protection', () => {
    it('POST comment returns 403 on a closed case', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/cases', { method: 'POST', body: { Title: 'Closed Case Comments', Status: 'closed' } }));
      const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);
      const res = await POST_COMMENT(
        createRequest(`http://localhost:3000/api/cases/${created.Id}/comments`, { method: 'POST', body: { body: 'Should fail' } }),
        { params: Promise.resolve({ id: String(created.Id) }) }
      );
      expect(res.status).toBe(403);
    });
  });

  // Helper to create a test case
  async function createTestCase(title = 'Test Case'): Promise<number> {
    const res = await POST(createRequest('http://localhost:3000/api/cases', {
      method: 'POST',
      body: { Title: title, Status: 'in_progress' },
    }));
    const data = await parseResponse<{ case: { Id: number } }>(res);
    return data.case.Id;
  }

  // Helper to create a test person — NewPerson requires all fields
  async function createTestPerson(firstName = 'Test', lastName = 'Person'): Promise<{ Id: number }> {
    return createPerson({
      UserId: TEST_USER.id,
      // Multi-tree: person must land in the default tree or the tree-filtered
      // CasePerson sync refuses to link it.
      TreeId: await trees.resolveDefaultTree(TEST_USER.id),
      FirstName: firstName,
      LastName: lastName,
      Sex: null,
      GedcomId: null,
      BirthDate: null,
      BirthPlace: null,
      DeathDate: null,
      DeathPlace: null,
      IsDeceased: null,
    }, TEST_USER.id);
  }

  // Helper to create a test media record (optionally linked to a person)
  async function createTestMedia(personId: number | null = null): Promise<number> {
    // Multi-tree: media reads are TreeId-scoped; stamp the user's default tree.
    const { resolveDefaultTree } = await import('@/lib/db/queries/trees');
    const media = await createMedia({
      UserId: TEST_USER.id,
      TreeId: await resolveDefaultTree(TEST_USER.id),
      Title: 'Test Image',
      FilePath: 'test_image.jpg',
      Format: 'JPG',
      ContentType: 'image/jpeg',
    }, TEST_USER.id);
    if (personId != null) {
      await query(
        `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES ($1, 'People', $2)`,
        [media.Id, personId],
      );
    }
    return media.Id;
  }

  // --- POST /api/cases/[id]/media ---
  describe('POST /api/cases/:id/media', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/cases/1/media', {
        method: 'POST',
        body: { mediaIds: [1] },
      });
      const res = await POST_MEDIA(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown case', async () => {
      const req = createRequest('http://localhost:3000/api/cases/999999/media', {
        method: 'POST',
        body: { mediaIds: [1] },
      });
      const res = await POST_MEDIA(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });

    it('returns 400 for empty mediaIds array', async () => {
      const caseId = await createTestCase();
      const req = createRequest(`http://localhost:3000/api/cases/${caseId}/media`, {
        method: 'POST',
        body: { mediaIds: [] },
      });
      const res = await POST_MEDIA(req, { params: Promise.resolve({ id: String(caseId) }) });
      expect(res.status).toBe(400);
    });

    it('links media to a case and returns linked count', async () => {
      const caseId = await createTestCase();
      const mediaId = await createTestMedia();
      const req = createRequest(`http://localhost:3000/api/cases/${caseId}/media`, {
        method: 'POST',
        body: { mediaIds: [mediaId] },
      });
      const res = await POST_MEDIA(req, { params: Promise.resolve({ id: String(caseId) }) });
      expect(res.status).toBe(201);
      const data = await parseResponse<{ linked: number }>(res);
      expect(data.linked).toBe(1);

      // Verify media appears on the case
      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/cases/${caseId}`),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      const caseData = await parseResponse<{ case: { media: { Id: number }[] } }>(getRes);
      expect(caseData.case.media.some(m => m.Id === mediaId)).toBe(true);
    });

    it('closes only with a conclusion, and journals the change (#801)', async () => {
      const caseId = await createTestCase();
      const put = (body: Record<string, unknown>) => PUT(
        createRequest(`http://localhost:3000/api/cases/${caseId}`, { method: 'PUT', body: { personIds: [], mediaIds: [], ...body } }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      expect((await put({ Status: 'closed' })).status).toBe(400);
      expect((await put({ Status: 'closed', Conclusion: 'Tver, per the 1897 census.' })).status).toBe(200);
      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/cases/${caseId}`),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      const { case: closed } = await parseResponse<{ case: { Status: string; comments: Array<{ Kind: string | null; Body: string }> } }>(getRes);
      expect(closed.Status).toBe('closed');
      expect(closed.comments.map(c => [c.Kind, c.Body])).toEqual([
        ['status', 'closed'],
        ['conclusion', 'Tver, per the 1897 census.'],
      ]);
    });

    it('returns 403 on closed case', async () => {
      const caseId = await createTestCase();
      await PUT(
        createRequest(`http://localhost:3000/api/cases/${caseId}`, {
          method: 'PUT',
          body: { Status: 'closed', Conclusion: 'Answered.', personIds: [], mediaIds: [] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      const mediaId = await createTestMedia();
      const req = createRequest(`http://localhost:3000/api/cases/${caseId}/media`, {
        method: 'POST',
        body: { mediaIds: [mediaId] },
      });
      const res = await POST_MEDIA(req, { params: Promise.resolve({ id: String(caseId) }) });
      expect(res.status).toBe(403);
    });
  });

  // --- DELETE /api/cases/[id]/media/[mediaId] ---
  describe('DELETE /api/cases/:id/media/:mediaId', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await DELETE_MEDIA(
        createRequest('http://localhost:3000/api/cases/1/media/1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '1', mediaId: '1' }) }
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown case', async () => {
      const res = await DELETE_MEDIA(
        createRequest('http://localhost:3000/api/cases/999999/media/1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '999999', mediaId: '1' }) }
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when media is not linked to the case', async () => {
      const caseId = await createTestCase();
      const mediaId = await createTestMedia();
      const res = await DELETE_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/${mediaId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(caseId), mediaId: String(mediaId) }) }
      );
      expect(res.status).toBe(404);
    });

    it('unlinks person-linked media without deleting the media record', async () => {
      const caseId = await createTestCase();
      const person = await createTestPerson();
      const mediaId = await createTestMedia(person.Id);
      // Link media to case
      await POST_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media`, {
          method: 'POST',
          body: { mediaIds: [mediaId] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );

      // Remove from case
      const res = await DELETE_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/${mediaId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(caseId), mediaId: String(mediaId) }) }
      );
      expect(res.status).toBe(204);

      // Media record should still exist (only unlinked from case)
      const mediaCheckRes = await GET_MEDIA(
        createRequest(`http://localhost:3000/api/media?personId=${person.Id}`)
      );
      const mediaData = await parseResponse<{ media: { Id: number }[] }>(mediaCheckRes);
      expect(mediaData.media.some(m => m.Id === mediaId)).toBe(true);
    });

    it('deletes case-only media completely', async () => {
      const caseId = await createTestCase();
      const mediaId = await createTestMedia(null);

      // Link to case
      await POST_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media`, {
          method: 'POST',
          body: { mediaIds: [mediaId] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );

      // Remove from case
      const res = await DELETE_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/${mediaId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(caseId), mediaId: String(mediaId) }) }
      );
      expect(res.status).toBe(204);

      // Media should be gone from the case
      const caseRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/cases/${caseId}`),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      const caseData = await parseResponse<{ case: { media: { Id: number }[] } }>(caseRes);
      expect(caseData.case.media.some(m => m.Id === mediaId)).toBe(false);

      // Media DB record itself should be deleted (not just unlinked)
      const check = await query('SELECT "Id" FROM "Media" WHERE "Id" = $1', [mediaId]);
      expect(check.rows).toHaveLength(0);
    });

    // #1223 (audit M-2): media used anywhere else only loses the case link.
    describe('keeps media that is used elsewhere', () => {
      async function linkToCase(caseId: number, mediaId: number) {
        await POST_MEDIA(
          createRequest(`http://localhost:3000/api/cases/${caseId}/media`, { method: 'POST', body: { mediaIds: [mediaId] } }),
          { params: Promise.resolve({ id: String(caseId) }) }
        );
      }
      async function removeFromCase(caseId: number, mediaId: number) {
        const res = await DELETE_MEDIA(
          createRequest(`http://localhost:3000/api/cases/${caseId}/media/${mediaId}`, { method: 'DELETE' }),
          { params: Promise.resolve({ id: String(caseId), mediaId: String(mediaId) }) }
        );
        expect(res.status).toBe(204);
      }
      async function mediaExists(mediaId: number) {
        return (await query('SELECT 1 FROM "Media" WHERE "Id" = $1', [mediaId])).rows.length === 1;
      }
      async function caseLinkExists(caseId: number, mediaId: number) {
        return (await query('SELECT 1 FROM "CaseMedia" WHERE "CaseId" = $1 AND "MediaId" = $2', [caseId, mediaId])).rows.length === 1;
      }

      it.each(['Families', 'Events', 'Sources', 'Places'])('linked to a %s record', async (ownerTable) => {
        const caseId = await createTestCase();
        const mediaId = await createTestMedia(null);
        await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES ($1, $2, 1)`, [mediaId, ownerTable]);
        await linkToCase(caseId, mediaId);
        await removeFromCase(caseId, mediaId);
        expect(await caseLinkExists(caseId, mediaId)).toBe(false);
        expect(await mediaExists(mediaId)).toBe(true);
        const links = await query('SELECT 1 FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = $2', [mediaId, ownerTable]);
        expect(links.rows).toHaveLength(1);
      });

      it('scoped to a vital fact', async () => {
        const caseId = await createTestCase();
        const person = await createTestPerson();
        const mediaId = await createTestMedia(null);
        await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "OwnerFact") VALUES ($1, 'People', $2, 'Birth')`, [mediaId, person.Id]);
        await linkToCase(caseId, mediaId);
        await removeFromCase(caseId, mediaId);
        expect(await mediaExists(mediaId)).toBe(true);
      });

      it('with a face tag', async () => {
        const caseId = await createTestCase();
        const person = await createTestPerson();
        const mediaId = await createTestMedia(null);
        await query(
          `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, $2, 10, 10, 20, 20)`,
          [mediaId, person.Id]
        );
        await linkToCase(caseId, mediaId);
        await removeFromCase(caseId, mediaId);
        expect(await mediaExists(mediaId)).toBe(true);
      });

      it('attached to another case', async () => {
        const caseId = await createTestCase('First');
        const otherCaseId = await createTestCase('Second');
        const mediaId = await createTestMedia(null);
        await linkToCase(caseId, mediaId);
        await linkToCase(otherCaseId, mediaId);
        await removeFromCase(caseId, mediaId);
        expect(await mediaExists(mediaId)).toBe(true);
        expect(await caseLinkExists(otherCaseId, mediaId)).toBe(true);
      });

      it('attached to a journal entry', async () => {
        const caseId = await createTestCase();
        const mediaId = await createTestMedia(null);
        await linkToCase(caseId, mediaId);
        await query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "MediaId") VALUES ($1, $2, 'See photo', $3)`, [caseId, TEST_USER.id, mediaId]);
        await removeFromCase(caseId, mediaId);
        expect(await mediaExists(mediaId)).toBe(true);
        const note = await query('SELECT "MediaId" FROM "CaseComments" WHERE "CaseId" = $1', [caseId]);
        expect((note.rows[0] as { MediaId: number }).MediaId).toBe(mediaId);
      });
    });

    it('returns 403 on closed case', async () => {
      const caseId = await createTestCase();
      const mediaId = await createTestMedia();
      await POST_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media`, {
          method: 'POST',
          body: { mediaIds: [mediaId] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      await PUT(
        createRequest(`http://localhost:3000/api/cases/${caseId}`, {
          method: 'PUT',
          body: { Status: 'closed', Conclusion: 'Answered.', personIds: [], mediaIds: [mediaId] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      const res = await DELETE_MEDIA(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/${mediaId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(caseId), mediaId: String(mediaId) }) }
      );
      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/cases/[id]/media/library ---
  describe('GET /api/cases/:id/media/library', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await GET_LIBRARY(
        createRequest('http://localhost:3000/api/cases/1/media/library'),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown case', async () => {
      const res = await GET_LIBRARY(
        createRequest('http://localhost:3000/api/cases/999999/media/library'),
        { params: Promise.resolve({ id: '999999' }) }
      );
      expect(res.status).toBe(404);
    });

    it('returns empty array when no people are linked to the case', async () => {
      const caseId = await createTestCase();
      const res = await GET_LIBRARY(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/library`),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      expect(res.status).toBe(200);
      const data = await parseResponse<{ media: unknown[] }>(res);
      expect(data.media).toEqual([]);
    });

    it('returns media from people linked to the case', async () => {
      const caseId = await createTestCase();
      const person = await createTestPerson();
      const mediaId = await createTestMedia(person.Id);
      // Link person to case
      await PUT(
        createRequest(`http://localhost:3000/api/cases/${caseId}`, {
          method: 'PUT',
          body: { personIds: [person.Id], mediaIds: [] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) }
      );

      const res = await GET_LIBRARY(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/library`),
        { params: Promise.resolve({ id: String(caseId) }) }
      );
      expect(res.status).toBe(200);
      const data = await parseResponse<{ media: { Id: number }[] }>(res);
      expect(data.media.some(m => m.Id === mediaId)).toBe(true);
    });

    it('returns one deterministic label for media shared by two case people', async () => {
      const caseId = await createTestCase();
      const alpha = await createTestPerson('Alpha', 'Ancestor');
      const zeta = await createTestPerson('Zeta', 'Zephyr');
      const mediaId = await createTestMedia(null);
      await query(
        `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId")
         VALUES ($1, 'People', $2), ($1, 'People', $3)`,
        [mediaId, zeta.Id, alpha.Id],
      );
      await PUT(
        createRequest(`http://localhost:3000/api/cases/${caseId}`, {
          method: 'PUT',
          body: { personIds: [zeta.Id, alpha.Id], mediaIds: [] },
        }),
        { params: Promise.resolve({ id: String(caseId) }) },
      );

      const res = await GET_LIBRARY(
        createRequest(`http://localhost:3000/api/cases/${caseId}/media/library`),
        { params: Promise.resolve({ id: String(caseId) }) },
      );
      const data = await parseResponse<{ media: Array<{ Id: number; PersonFirstName: string }> }>(res);

      const shared = data.media.filter((row) => row.Id === mediaId);
      expect(shared).toHaveLength(1);
      expect(shared[0].PersonFirstName).toBe('Alpha');
    });
  });
});
