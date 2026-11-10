import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { GET, POST } from '@/app/api/families/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/api/families/[id]/route';
import { POST as ADD_CHILD, PATCH as UPDATE_CHILD_TYPE, DELETE as REMOVE_CHILD } from '@/app/api/families/[id]/children/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { DELETE as DELETE_PERSON } from '@/app/api/people/[id]/route';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { POST as CREATE_CITATION } from '@/app/api/citations/route';
import FamiliesPage from '@/app/families/page';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import type { ListFamiliesResult } from '@/lib/services/families';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

// FamiliesPage (Server Component) calls connection() to opt out of static
// prerendering in the hosted build. That API only resolves inside Next's request
// scope; rendering the component directly here is outside one, so stub it to a
// no-op (all other next/server exports — NextRequest/NextResponse used by the
// route handlers — are preserved). The dynamic-rendering behavior itself is
// verified by the build output (ƒ /families); these tests target the
// initialFamilies data path.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn().mockResolvedValue(undefined),
}));

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/families', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createTestPerson(firstName: string, lastName: string) {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: firstName, LastName: lastName },
    }));
    const data = await parseResponse<{ person: { Id: number } }>(res);
    return data.person;
  }

  describe('POST /api/families', () => {
    it('creates a family with spouses', async () => {
      const husband = await createTestPerson('Romeo', 'Montague');
      const wife = await createTestPerson('Juliet', 'Capulet');

      const req = createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {
          Partner1Id: husband.Id,
          Partner2Id: wife.Id,
          MarriageDate: '1595-06-15',
          MarriagePlace: 'Verona, Italy',
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await parseResponse<{ family: { Id: number; Partner1Id: number; Partner2Id: number } }>(res);
      expect(data.family.Partner1Id).toBe(husband.Id);
      expect(data.family.Partner2Id).toBe(wife.Id);
    });

    it('creates a family without spouses', async () => {
      const req = createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {},
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/families', () => {
    it('returns empty list initially', async () => {
      const req = createRequest('http://localhost:3000/api/families');
      const res = await GET(req);
      const data = await parseResponse<{ families: unknown[]; count: number }>(res);
      expect(data.families).toEqual([]);
      expect(data.count).toBe(0);
    });
  });

  describe('GET /api/families/[id]', () => {
    it('returns family with relations', async () => {
      const husband = await createTestPerson('Mister', 'Family');
      const wife = await createTestPerson('Missus', 'Family');

      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { HusbandId: husband.Id, WifeId: wife.Id },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/families/${family.Id}`);
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(200);

      const data = await parseResponse<{ family: unknown; husband: { FirstName: string }; wife: { FirstName: string } }>(res);
      expect(data.husband.FirstName).toBe('Mister');
      expect(data.wife.FirstName).toBe('Missus');
    });

    it('returns 404 for non-existent family', async () => {
      const req = createRequest('http://localhost:3000/api/families/99999');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: '99999' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/families/[id]', () => {
    it('updates family fields', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { MarriagePlace: 'Old Town' },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/families/${family.Id}`, {
        method: 'PUT',
        body: { MarriagePlace: 'New Town' },
      });
      const res = await PUT(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/families/[id]', () => {
    it('deletes a family', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {},
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/families/${family.Id}`, { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Type field', () => {
    // Ended status moved from EndedDate/EndedReason columns to timeline events (Phase 2);
    // the family create/read/update surface now only carries Type + marriage anchor fields.
    it('round-trips Type through create and read', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { Type: 'Civil union' },
      }));
      const { family } = await parseResponse<{ family: { Id: number; Type: string } }>(createRes);
      expect(family.Type).toBe('Civil union');

      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/families/${family.Id}`),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      const data = await parseResponse<{ family: { Type: string } }>(getRes);
      expect(data.family.Type).toBe('Civil union');
    });

    it('updates Type via PUT', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {},
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      const putRes = await PUT(
        createRequest(`http://localhost:3000/api/families/${family.Id}`, {
          method: 'PUT',
          body: { Type: 'Common-law' },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      expect(putRes.status).toBe(200);
      const { family: updated } = await parseResponse<{ family: { Type: string } }>(putRes);
      expect(updated.Type).toBe('Common-law');
    });
  });

  describe('Children management', () => {
    it('adds a child with a non-Birth relationship type', async () => {
      const parent = await createTestPerson('Adoptive', 'Parent');
      const child = await createTestPerson('Adopted', 'Kid');

      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { HusbandId: parent.Id },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      const addRes = await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId: child.Id, relationshipType: 'Adoption' },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      expect(addRes.status).toBe(201);

      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/families/${family.Id}`),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      const familyData = await parseResponse<{ children: { Id: number; Partner1Relationship?: string; Partner2Relationship?: string }[] }>(getRes);
      expect(familyData.children[0]).toMatchObject({ Partner1Relationship: 'Adoption', Partner2Relationship: 'Adoption' });
    });

    it('adds and removes a child from a family', async () => {
      const parent = await createTestPerson('Parent', 'One');
      const child = await createTestPerson('Kid', 'One');

      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { HusbandId: parent.Id },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      // Add child
      const addReq = createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'POST',
        body: { childId: child.Id },
      });
      const addRes = await ADD_CHILD(addReq, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(addRes.status).toBe(201);

      // Verify child is in family
      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/families/${family.Id}`),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      const familyData = await parseResponse<{ children: { Id: number }[] }>(getRes);
      expect(familyData.children).toHaveLength(1);
      expect(familyData.children[0].Id).toBe(child.Id);

      // Remove child
      const removeReq = createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'DELETE',
        body: { childId: child.Id },
      });
      const removeRes = await REMOVE_CHILD(removeReq, { params: Promise.resolve({ id: String(family.Id) }) });
      expect(removeRes.status).toBe(200);
    });

    it('updates a child relationship type via PATCH and persists it', async () => {
      const parent = await createTestPerson('Patch', 'Parent');
      const child = await createTestPerson('Patch', 'Kid');

      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { HusbandId: parent.Id },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId: child.Id },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );

      const patchRes = await UPDATE_CHILD_TYPE(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'PATCH',
          body: { childId: child.Id, relationshipType: 'Foster' },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      expect(patchRes.status).toBe(200);

      const getRes = await GET_BY_ID(
        createRequest(`http://localhost:3000/api/families/${family.Id}`),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
      const familyData = await parseResponse<{ children: { Id: number; Partner1Relationship?: string; Partner2Relationship?: string }[] }>(getRes);
      expect(familyData.children[0]).toMatchObject({ Partner1Relationship: 'Foster', Partner2Relationship: 'Foster' });
    });

    it('rejects an invalid relationship type on PATCH with 400', async () => {
      const patchRes = await UPDATE_CHILD_TYPE(
        createRequest('http://localhost:3000/api/families/1/children', {
          method: 'PATCH',
          body: { childId: 1, relationshipType: 'Imaginary' },
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(patchRes.status).toBe(400);
    });

    it('returns 404 when PATCHing children of a non-existent family', async () => {
      const patchRes = await UPDATE_CHILD_TYPE(
        createRequest('http://localhost:3000/api/families/999999/children', {
          method: 'PATCH',
          body: { childId: 1, relationshipType: 'Foster' },
        }),
        { params: Promise.resolve({ id: '999999' }) }
      );
      expect(patchRes.status).toBe(404);
    });
  });

  describe('GET /api/families — child / fact counts', () => {
    // Safety net for the correlated-subquery → pre-aggregated-CTE rewrite of
    // getAllFamiliesWithSpouses (mirrors the getAllPeople rewrite's test). These
    // fields (childCount / youngDeathCount / TotalFacts / SourcedFacts) are
    // computed entirely in SQL, so they exercise the exact NULL-handling and
    // fan-out semantics the CTE rewrite must preserve byte-for-byte.
    type FactFamily = {
      Partner1Id: number | null;
      childCount: number;
      youngDeathCount: number;
      TotalFacts: number;
      SourcedFacts: number;
    };

    async function createPersonWithBody(body: Record<string, unknown>): Promise<number> {
      const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', { method: 'POST', body }));
      const { person } = await parseResponse<{ person: { Id: number } }>(res);
      return person.Id;
    }

    async function createSource(): Promise<number> {
      const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
        method: 'POST',
        body: { Title: 'Parish Register', Type: 'Vital' },
      }));
      const { source } = await parseResponse<{ source: { Id: number } }>(res);
      return source.Id;
    }

    async function createFamilyEvent(familyId: number, type: string): Promise<number> {
      const res = await CREATE_EVENT(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: type, FamilyId: familyId },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(res);
      return event.Id;
    }

    async function addChild(familyId: number, childId: number): Promise<void> {
      const res = await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${familyId}/children`, {
          method: 'POST',
          body: { childId },
        }),
        { params: Promise.resolve({ id: String(familyId) }) }
      );
      expect(res.status).toBe(201);
    }

    async function addCitation(factTable: string, factId: number, sourceId: number): Promise<void> {
      const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
        method: 'POST',
        body: { FactTable: factTable, FactId: factId, SourceId: sourceId },
      }));
      expect(res.status).toBe(201);
    }

    it('computes childCount / youngDeathCount / TotalFacts / SourcedFacts to match hand-computed values', async () => {
      const husband = await createTestPerson('Fact', 'Husband');
      const wife = await createTestPerson('Fact', 'Wife');

      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {
          Partner1Id: husband.Id,
          Partner2Id: wife.Id,
          MarriageDate: '1900-06-01',
          MarriagePlace: 'Anytown',
        },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      const sourceId = await createSource();
      const secondSourceId = await createSource();

      // Marriage citation on the family record itself (FactTable='Families').
      await addCitation('Families', family.Id, sourceId);

      // Two children: one died young (<18 at death — counts toward
      // youngDeathCount), one lived to old age (doesn't).
      const youngDeathChildId = await createPersonWithBody({
        FirstName: 'Young', LastName: 'Death',
        BirthDate: '1900-01-01', DeathDate: '1910-01-01', // age 10
      });
      const survivingChildId = await createPersonWithBody({
        FirstName: 'Survivor', LastName: 'Child',
        BirthDate: '1905-01-01', DeathDate: '1980-01-01', // age 75
      });
      await addChild(family.Id, youngDeathChildId);
      await addChild(family.Id, survivingChildId);

      // Two family events: eventA gets TWO citations from different sources
      // (the fan-out guard — see below), eventB is intentionally uncited.
      //
      // The second citation on eventA is the regression guard for the
      // `family_event_agg` CTE's `LEFT JOIN (SELECT DISTINCT c."FactId" ...) ec`:
      // that DISTINCT exists specifically so a fact with multiple citations
      // still joins at most once. Without it, eventA would fan out across two
      // citation rows and inflate event_count/sourced_event_count (i.e.
      // TotalFacts/SourcedFacts below) by counting the same event twice.
      const eventA = await createFamilyEvent(family.Id, 'OCCU');
      await createFamilyEvent(family.Id, 'RESI'); // event B — intentionally uncited
      await addCitation('Events', eventA, sourceId);
      await addCitation('Events', eventA, secondSourceId); // 2nd citation, same event

      // Hand-computed for this family:
      //   childCount       = 2
      //   youngDeathCount  = 1 (only the age-10 death)
      //   TotalFacts       = marriage(1) + events(2)             = 3
      //   SourcedFacts     = marriageSourced(1) + eventsSourced(1) = 2
      //   NOTE: eventA's second citation must NOT change TotalFacts/SourcedFacts —
      //   the event is still counted once, not twice.

      const res = await GET(createRequest('http://localhost:3000/api/families'));
      expect(res.status).toBe(200);
      const data = await parseResponse<{ families: FactFamily[] }>(res);

      const target = data.families.find((f) => f.Partner1Id === husband.Id)!;
      expect(target).toBeDefined();

      // childCount/youngDeathCount come back as either a numeric-string
      // (bigint COUNT(*), the pre-rewrite behavior — no ::int cast) or a
      // native number (post-rewrite, cast in the new CTE) — coerce with
      // Number() so this assertion is a value check, not a wire-type check.
      expect(Number(target.childCount)).toBe(2);
      expect(Number(target.youngDeathCount)).toBe(1);
      expect(target.TotalFacts).toBe(3);
      // Fan-out guard: eventA has TWO 'Events' citations, but TotalFacts/
      // SourcedFacts must still equal 3/2 (not 4/3) — if family_event_agg's
      // `DISTINCT` sub-join were removed, eventA would join twice and inflate
      // both counts.
      expect(target.SourcedFacts).toBe(2);
    });

    it('leaves a stranded FamilyPerson row out of childCount (deleted child, no cascade)', async () => {
      // "FamilyPerson" has no FK/cascade on "ChildrenId" and deletePerson() runs a
      // bare DELETE FROM "People", so a FamilyPerson row can outlive its child.
      // Stranded rows are kept for revert but never counted (ADR 0022, #881).
      const parent = await createTestPerson('Orphan', 'Parent');
      const childId = await createPersonWithBody({ FirstName: 'Doomed', LastName: 'Child' });

      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { Partner1Id: parent.Id },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

      await addChild(family.Id, childId);

      // Delete the child directly — NOT via removeChildFromFamily — so the
      // FamilyPerson row is left dangling.
      const delRes = await DELETE_PERSON(
        createRequest(`http://localhost:3000/api/people/${childId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(childId) }) }
      );
      expect(delRes.status).toBe(204);

      const res = await GET(createRequest('http://localhost:3000/api/families'));
      expect(res.status).toBe(200);
      const data = await parseResponse<{ families: FactFamily[] }>(res);
      const target = data.families.find((f) => f.Partner1Id === parent.Id)!;
      expect(target).toBeDefined();
      expect(target.childCount).toBe(0);
    });

    it('yields zero counts for a bare family with no children, events, or citations', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: {},
      }));
      expect(createRes.status).toBe(201);

      const res = await GET(createRequest('http://localhost:3000/api/families'));
      expect(res.status).toBe(200);
      const data = await parseResponse<{ families: FactFamily[] }>(res);

      const target = data.families.find((f) => f.Partner1Id === null)!;
      expect(target).toBeDefined();
      expect(Number(target.childCount)).toBe(0);
      expect(Number(target.youngDeathCount)).toBe(0);
      expect(target.TotalFacts).toBe(0);
      expect(target.SourcedFacts).toBe(0);
    });
  });

  describe('FamiliesPage (Server Component)', () => {
    // The Server Component returns
    // `<FamiliesPageClient initialFamilies={...} initialOwnerId={...} />`.
    // Awaiting it yields that element; `initialFamilies` is the server fetch's
    // result and `initialOwnerId` is the owner it was fetched for — the client
    // seeds its cache under exactly that owner's key and no other.
    type ClientProps = { initialFamilies: ListFamiliesResult | null };

    it('renders with server-fetched initial families data for the authenticated user', async () => {
      // Seed through the API routes, which use the same mocked (own-tree) user
      // the Server Component will resolve — no direct query() needed.
      const husband = await createTestPerson('Server', 'Rendered');
      const wife = await createTestPerson('Also', 'Rendered');
      await POST(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { HusbandId: husband.Id, WifeId: wife.Id, MarriageDate: '1950' },
      }));

      const element = (await FamiliesPage()) as ReactElement<ClientProps>;
      const { initialFamilies } = element.props;

      expect(initialFamilies).not.toBeNull();
      expect(initialFamilies!.count).toBe(1);
      expect(initialFamilies!.families).toHaveLength(1);
      expect(initialFamilies!.families[0].husbandName).toContain('Server');
      expect(initialFamilies!.families[0].wifeName).toContain('Also');

      // The seed is always the user's default tree (the client seeds it into the
      // default-scope cache key), so no owner id accompanies it anymore.
    });

    it('passes initialFamilies=null when unauthenticated', async () => {
      // Per this project's auth-mocking convention (CLAUDE.md Testing section),
      // override the globally-mocked getUserFromRequest for this call only.
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

      const element = (await FamiliesPage()) as ReactElement<ClientProps>;

      expect(element.props.initialFamilies).toBeNull();
    });
  });
});
