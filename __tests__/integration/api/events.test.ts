import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET, POST } from '@/app/api/events/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/api/events/[id]/route';
import { POST as CREATE_PERSON_EVENT } from '@/app/api/people/[id]/events/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/events', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createTestPerson() {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Test', LastName: 'Subject' },
    }));
    const data = await parseResponse<{ person: { Id: number } }>(res);
    return data.person;
  }

  describe('POST /api/events', () => {
    it('creates an event with type', async () => {
      const person = await createTestPerson();
      const req = createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: {
          Type: 'BAPM',
          Date: '1990-05-20',
          Place: 'Anytown, USA',
          PersonId: person.Id,
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await parseResponse<{ event: { Type: string; Date: string } }>(res);
      expect(data.event.Type).toBe('BAPM');
      expect(data.event.Date).toBe('1990-05-20');
    });

    it('refuses a person BIRT or DEAT event: those facts live on the People row (#756)', async () => {
      const person = await createTestPerson();
      for (const Type of ['BIRT', 'deat']) {
        const res = await POST(createRequest('http://localhost:3000/api/events', {
          method: 'POST',
          body: { Type, Date: '1990', PersonId: person.Id },
        }));
        expect(res.status).toBe(400);
      }
    });

    it('returns 400 when Type is missing', async () => {
      const req = createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Date: '1990-01-01' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when no event owner is supplied', async () => {
      const req = createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'RESI' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/events', () => {
    it('returns events filtered by personId', async () => {
      const person = await createTestPerson();

      await POST(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'OCCU', Description: 'Engineer', PersonId: person.Id },
      }));

      const req = createRequest(`http://localhost:3000/api/events?personId=${person.Id}`);
      const res = await GET(req);
      const data = await parseResponse<{ events: { Type: string }[]; count: number }>(res);
      expect(data.count).toBe(1);
      expect(data.events[0].Type).toBe('OCCU');
    });
  });

  describe('GET /api/events/[id]', () => {
    it('returns event by ID', async () => {
      const person = await createTestPerson();
      const createRes = await POST(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'EDUC', Description: 'University', PersonId: person.Id },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/events/${event.Id}`);
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: String(event.Id) }) });
      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent event', async () => {
      const req = createRequest('http://localhost:3000/api/events/99999');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: '99999' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/events/[id]', () => {
    it('updates event fields', async () => {
      const person = await createTestPerson();
      const createRes = await POST(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'RESI', Place: 'Old Address', PersonId: person.Id },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/events/${event.Id}`, {
        method: 'PUT',
        body: { Place: 'New Address' },
      });
      const res = await PUT(req, { params: Promise.resolve({ id: String(event.Id) }) });
      expect(res.status).toBe(200);

      const data = await parseResponse<{ event: { Place: string } }>(res);
      expect(data.event.Place).toBe('New Address');
    });

    it('caps the phrase in an INT date submitted to the direct update route', async () => {
      const person = await createTestPerson();
      const createRes = await POST(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'RESI', PersonId: person.Id },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      const res = await PUT(createRequest(`http://localhost:3000/api/events/${event.Id}`, {
        method: 'PUT',
        body: { Date: `INT 1850 (${'z'.repeat(36)})` },
      }), { params: Promise.resolve({ id: String(event.Id) }) });

      expect(res.status).toBe(200);
      const data = await parseResponse<{ event: { Date: string } }>(res);
      expect(data.event.Date).toBe(`INT 1850 (${'z'.repeat(35)})`);
    });
  });

  describe('POST /api/people/[id]/events', () => {
    it('caps the phrase in an INT date submitted to the direct create route', async () => {
      const person = await createTestPerson();
      const res = await CREATE_PERSON_EVENT(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events`, {
          method: 'POST',
          body: { Type: 'BAPM', Date: `INT 1850 (${'z'.repeat(36)})` },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) },
      );

      expect(res.status).toBe(201);
      const data = await parseResponse<{ event: { Date: string } }>(res);
      expect(data.event.Date).toBe(`INT 1850 (${'z'.repeat(35)})`);
    });
  });

  it('PUT returns 404 for a missing event, like GET and DELETE', async () => {
    const res = await PUT(
      createRequest('http://localhost:3000/api/events/999999', { method: 'PUT', body: { Place: 'Nowhere' } }),
      { params: Promise.resolve({ id: '999999' }) },
    );
    expect(res.status).toBe(404);
  });

  describe('person BIRT/DEAT guard (#756)', () => {
    it('refuses to turn a person event into a death', async () => {
      const person = await createTestPerson();
      const createRes = await POST(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'RESI', PersonId: person.Id },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);
      const res = await PUT(
        createRequest(`http://localhost:3000/api/events/${event.Id}`, { method: 'PUT', body: { Type: 'DEAT' } }),
        { params: Promise.resolve({ id: String(event.Id) }) },
      );
      expect(res.status).toBe(400);
    });

    it('refuses a birth on the direct person create route', async () => {
      const person = await createTestPerson();
      const res = await CREATE_PERSON_EVENT(
        createRequest(`http://localhost:3000/api/people/${person.Id}/events`, { method: 'POST', body: { Type: 'BIRT', Date: '1850' } }),
        { params: Promise.resolve({ id: String(person.Id) }) },
      );
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/events/[id]', () => {
    it('deletes an event', async () => {
      const person = await createTestPerson();
      const createRes = await POST(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: 'BURI', PersonId: person.Id },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/events/${event.Id}`, { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: String(event.Id) }) });
      expect(res.status).toBe(200);
      const { auditIds } = await parseResponse<{ auditIds: number[] }>(res);
      expect(auditIds).toHaveLength(1);
    });
  });

  describe('auth', () => {
    it('GET returns 401 when unauthenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await GET(createRequest('http://localhost:3000/api/events?personId=1'));
      expect(res.status).toBe(401);
    });

    it('DELETE returns 401 when unauthenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/events/1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });
  });
});
