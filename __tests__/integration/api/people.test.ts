import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { GET, POST } from '@/app/api/people/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/api/people/[id]/route';
import { GET as SEARCH_PEOPLE } from '@/app/api/people/search/route';
import { POST as CREATE_VARIANT } from '@/app/api/people/[id]/name-variants/route';
import { GET as DESCENDANT_COUNT } from '@/app/api/people/[id]/descendant-count/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as ADD_CHILD } from '@/app/api/families/[id]/children/route';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { POST as CREATE_CITATION } from '@/app/api/citations/route';
import PeoplePage from '@/app/people/page';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import type { ListPeopleResult } from '@/lib/services/people';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

// PeoplePage (Server Component) calls connection() to opt out of static
// prerendering in the hosted build. That API only resolves inside Next's
// request scope; rendering the component directly here is outside one, so stub
// it to a no-op (all other next/server exports — NextRequest/NextResponse used
// by the route handlers — are preserved). The dynamic-rendering behavior itself
// is verified by the build output (ƒ /people); these tests target the
// initialPeople data path.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn().mockResolvedValue(undefined),
}));

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/people', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('POST /api/people', () => {
    it('creates a person with valid data', async () => {
      const req = createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Alice', LastName: 'Wonderland', Sex: 'F' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await parseResponse<{ person: { Id: number; FirstName: string; LastName: string } }>(res);
      expect(data.person.FirstName).toBe('Alice');
      expect(data.person.LastName).toBe('Wonderland');
      expect(data.person.Id).toBeGreaterThan(0);
    });

    it('returns 400 when no name provided', async () => {
      const req = createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { Sex: 'M' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid field type', async () => {
      const req = createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 123 },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/people', () => {
    it('returns empty list initially', async () => {
      const req = createRequest('http://localhost:3000/api/people');
      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = await parseResponse<{ people: unknown[]; count: number }>(res);
      expect(data.people).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('returns created people', async () => {
      // Create two people
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Bob', LastName: 'Builder' },
      }));
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Sue', LastName: 'Storm' },
      }));

      const req = createRequest('http://localhost:3000/api/people');
      const res = await GET(req);
      const data = await parseResponse<{ people: unknown[]; count: number }>(res);
      expect(data.people).toHaveLength(2);
      expect(data.count).toBe(2);
    });

    it('searches by name', async () => {
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Charlie', LastName: 'Brown' },
      }));
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Lucy', LastName: 'Van Pelt' },
      }));

      const req = createRequest('http://localhost:3000/api/people?q=Charlie');
      const res = await GET(req);
      const data = await parseResponse<{ people: { FirstName: string }[]; count: number }>(res);
      expect(data.count).toBe(1);
      expect(data.people[0].FirstName).toBe('Charlie');
    });

    // The People list search bar advertises nickname matching and filters
    // client-side over the row's AllNames, which the list query aggregates from
    // NameVariant. Asserted end-to-end rather than by reading the SQL.
    it('returns nickname variants in AllNames so the list search can match them', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Margaret', LastName: 'Tavington' },
      }));
      const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

      await CREATE_VARIANT(
        createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
          method: 'POST',
          body: { Type: 'Nickname', Name: 'Peggy' },
        }),
        { params: Promise.resolve({ id: String(person.Id) }) },
      );

      const res = await GET(createRequest('http://localhost:3000/api/people'));
      const data = await parseResponse<{ people: { Id: number; AllNames: string | null }[] }>(res);
      const row = data.people.find(p => p.Id === person.Id);
      expect(row?.AllNames ?? '').toContain('Peggy');
    });
  });

  // The person hero labels its Descendants button with this on every view. It has
  // its own endpoint because the descendants TREE endpoint returns the whole tree
  // to answer the same question.
  describe('GET /api/people/[id]/descendant-count', () => {
    async function makePerson(firstName: string) {
      const res = await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: firstName, LastName: 'Line' },
      }));
      return (await parseResponse<{ person: { Id: number } }>(res)).person;
    }

    async function makeFamilyWithChild(parentId: number, childId: number) {
      const famRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
        method: 'POST',
        body: { Partner1Id: parentId },
      }));
      const { family } = await parseResponse<{ family: { Id: number } }>(famRes);
      await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) },
      );
      return family.Id;
    }

    const countFor = async (id: number) => {
      const res = await DESCENDANT_COUNT(
        createRequest(`http://localhost:3000/api/people/${id}/descendant-count`),
        { params: Promise.resolve({ id: String(id) }) },
      );
      expect(res.status).toBe(200);
      return (await parseResponse<{ count: number }>(res)).count;
    };

    it('counts grandchildren, not just direct children', async () => {
      const gran = await makePerson('Gran');
      const parent = await makePerson('Parent');
      const child = await makePerson('Child');
      await makeFamilyWithChild(gran.Id, parent.Id);
      await makeFamilyWithChild(parent.Id, child.Id);

      expect(await countFor(gran.Id)).toBe(2);
      expect(await countFor(parent.Id)).toBe(1);
      expect(await countFor(child.Id)).toBe(0);
    });

    it('returns 0 for someone with no children', async () => {
      const loner = await makePerson('Loner');
      expect(await countFor(loner.Id)).toBe(0);
    });

    it('404s for a person outside the tree', async () => {
      const res = await DESCENDANT_COUNT(
        createRequest('http://localhost:3000/api/people/999999999/descendant-count'),
        { params: Promise.resolve({ id: '999999999' }) },
      );
      expect(res.status).toBe(404);
    });

    it('401s when signed out', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await DESCENDANT_COUNT(
        createRequest('http://localhost:3000/api/people/1/descendant-count'),
        { params: Promise.resolve({ id: '1' }) },
      );
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/people — citation / fact counts', () => {
    // Safety net for the correlated-subquery → pre-aggregated-CTE rewrite of
    // getAllPeople. These fields (CitationCount / TotalFacts / SourcedFacts) are
    // computed entirely in SQL, so they exercise the exact NULL-handling and
    // boolean-filter semantics the CTE rewrite must preserve byte-for-byte.
    type FactPerson = {
      FirstName: string;
      CitationCount: number;
      TotalFacts: number;
      SourcedFacts: number;
    };

    async function createPersonWithBody(body: Record<string, unknown>): Promise<number> {
      const res = await POST(createRequest('http://localhost:3000/api/people', { method: 'POST', body }));
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

    async function createEvent(personId: number, type: string): Promise<number> {
      const res = await CREATE_EVENT(createRequest('http://localhost:3000/api/events', {
        method: 'POST',
        body: { Type: type, PersonId: personId },
      }));
      const { event } = await parseResponse<{ event: { Id: number } }>(res);
      return event.Id;
    }

    async function addCitation(factTable: string, factId: number, sourceId: number): Promise<void> {
      const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
        method: 'POST',
        body: { FactTable: factTable, FactId: factId, SourceId: sourceId },
      }));
      expect(res.status).toBe(201);
    }

    it('computes CitationCount / TotalFacts / SourcedFacts to match hand-computed values', async () => {
      const sourceId = await createSource();
      const secondSourceId = await createSource();

      // Person A ("Rich"): a birth date, a death date, and two life events.
      //   - Two 'People' citations   → CitationCount = 2 (COUNT, not EXISTS)
      //   - One 'PersonBirth' citation → birth fact is sourced
      //   - NO 'PersonDeath' citation  → death fact counts toward Total but NOT Sourced
      //   - Two events, one (eventA) with TWO 'Events' citations from different
      //     sources, the other (eventB) intentionally uncited → 1 of 2 events sourced
      //
      // The second citation on eventA is the regression guard for the
      // `event_agg` CTE's `LEFT JOIN (SELECT DISTINCT c."FactId" ...) ec`: that
      // DISTINCT exists specifically so a fact with multiple citations still
      // joins at most once. Without it, eventA would fan out across two
      // citation rows and inflate event_count/sourced_event_count (i.e.
      // TotalFacts/SourcedFacts below) by counting the same event twice.
      const richId = await createPersonWithBody({
        FirstName: 'Rich', LastName: 'Ancestor',
        BirthDate: '1850-03-01', BirthPlace: 'Yorkshire',
        DeathDate: '1912-11-20',
      });
      await addCitation('People', richId, sourceId);
      await addCitation('People', richId, sourceId);
      await addCitation('PersonBirth', richId, sourceId);
      const eventA = await createEvent(richId, 'OCCU');
      await createEvent(richId, 'RESI'); // event B — intentionally uncited
      await addCitation('Events', eventA, sourceId);
      await addCitation('Events', eventA, secondSourceId); // 2nd citation, same event

      // Hand-computed for Rich:
      //   TotalFacts   = birth(1) + death(1) + events(2)            = 4
      //   SourcedFacts = birthSourced(1) + deathSourced(0) + eventsSourced(1) = 2
      //   CitationCount = 2 (two 'People' citations)
      //   NOTE: eventA's second citation must NOT change TotalFacts/SourcedFacts —
      //   the event is still counted once, not twice.

      // Person B ("Bare"): no dates, no events, no citations. Exercises the
      // LEFT JOIN null path → COALESCE(...,0) must yield 0 for every field.
      await createPersonWithBody({ FirstName: 'Bare', LastName: 'Soul' });

      const res = await GET(createRequest('http://localhost:3000/api/people'));
      expect(res.status).toBe(200);
      const data = await parseResponse<{ people: FactPerson[] }>(res);

      const rich = data.people.find((p) => p.FirstName === 'Rich')!;
      const bare = data.people.find((p) => p.FirstName === 'Bare')!;
      expect(rich).toBeDefined();
      expect(bare).toBeDefined();

      expect(rich.CitationCount).toBe(2);
      // Fan-out guard: eventA has TWO 'Events' citations, but TotalFacts/
      // SourcedFacts must still equal 4/2 (not 5/3) — if event_agg's
      // `DISTINCT` sub-join were removed, eventA would join twice and inflate
      // both counts.
      expect(rich.TotalFacts).toBe(4);
      expect(rich.SourcedFacts).toBe(2);

      expect(bare.CitationCount).toBe(0);
      expect(bare.TotalFacts).toBe(0);
      expect(bare.SourcedFacts).toBe(0);
    });

    // A cause of death with no date or place is still a death fact (#480) — the
    // GEDCOM generator emits a `1 DEAT` block for it. This SQL and
    // `hasDeathFact` in app/people/view/derive.ts must agree, because PersonHero
    // presents the detail page's ratio as the same number as this list column;
    // if only one side counted the cause, the list would badge such a person
    // "fully sourced" while the detail page showed them short a source.
    it('counts a cause-only death toward TotalFacts, matching the detail page', async () => {
      const sourceId = await createSource();
      const causeOnlyId = await createPersonWithBody({
        FirstName: 'Cause', LastName: 'Only',
        BirthDate: '1850-03-01',
        DeathCause: 'Heart failure',
      });
      await addCitation('PersonBirth', causeOnlyId, sourceId);

      const res = await GET(createRequest('http://localhost:3000/api/people'));
      const data = await parseResponse<{ people: FactPerson[] }>(res);
      const causeOnly = data.people.find((p) => p.FirstName === 'Cause')!;
      expect(causeOnly).toBeDefined();

      // birth(1) + death-by-cause(1) = 2, of which only birth is cited.
      expect(causeOnly.TotalFacts).toBe(2);
      expect(causeOnly.SourcedFacts).toBe(1);
    });

    it('counts a flag-only death while preserving IsDeceased=0 as living', async () => {
      const sourceId = await createSource();
      const flagDeathId = await createPersonWithBody({ FirstName: 'Flag', LastName: 'Death', IsDeceased: 1 });
      const livingId = await createPersonWithBody({ FirstName: 'Explicit', LastName: 'Living', IsDeceased: 0 });
      await addCitation('PersonDeath', flagDeathId, sourceId);

      const res = await GET(createRequest('http://localhost:3000/api/people'));
      const data = await parseResponse<{ people: (FactPerson & { Id: number })[] }>(res);
      const flagDeath = data.people.find((p) => p.FirstName === 'Flag')!;
      const explicitLiving = data.people.find((p) => p.Id === livingId)!;
      expect(flagDeath.TotalFacts).toBe(1);
      expect(flagDeath.SourcedFacts).toBe(1);
      expect(explicitLiving.TotalFacts).toBe(0);
      expect(explicitLiving.SourcedFacts).toBe(0);
    });
  });

  describe('GET /api/people/search — multi-token fuzzy search', () => {
    beforeEach(async () => {
      await cleanupTestData();
    });

    it('matches when all tokens appear in the name', async () => {
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Anne', LastName: 'Shirley' },
      }));
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Anne', LastName: 'Boleyn' },
      }));

      // "Anne Shirley" — both tokens must match
      const req = createRequest('http://localhost:3000/api/people/search?q=Anne+Shirley');
      const res = await SEARCH_PEOPLE(req);
      expect(res.status).toBe(200);

      const data = await parseResponse<{ people: { FirstName: string; LastName: string }[] }>(res);
      expect(data.people).toHaveLength(1);
      expect(data.people[0].LastName).toBe('Shirley');
    });

    it('returns no results when second token does not match', async () => {
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Anne', LastName: 'Shirley' },
      }));

      const req = createRequest('http://localhost:3000/api/people/search?q=Anne+Boleyn');
      const res = await SEARCH_PEOPLE(req);
      const data = await parseResponse<{ people: unknown[] }>(res);
      expect(data.people).toHaveLength(0);
    });

    it('falls back to single-token path for a one-word query', async () => {
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Diana', LastName: 'Prince' },
      }));

      const req = createRequest('http://localhost:3000/api/people/search?q=Diana');
      const res = await SEARCH_PEOPLE(req);
      const data = await parseResponse<{ people: { FirstName: string }[] }>(res);
      expect(data.people).toHaveLength(1);
      expect(data.people[0].FirstName).toBe('Diana');
    });
  });

  describe('GET /api/people/[id]', () => {
    it('returns person by ID', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Diana', LastName: 'Prince' },
      }));
      const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/people/${person.Id}`);
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(200);

      const data = await parseResponse<{ person: { FirstName: string } }>(res);
      expect(data.person.FirstName).toBe('Diana');
    });

    it('returns 404 for non-existent person', async () => {
      const req = createRequest('http://localhost:3000/api/people/99999');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: '99999' }) });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid ID', async () => {
      const req = createRequest('http://localhost:3000/api/people/abc');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: 'abc' }) });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/people/[id]', () => {
    it('updates person fields', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Ed', LastName: 'Elric' },
      }));
      const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/people/${person.Id}`, {
        method: 'PUT',
        body: { FirstName: 'Edward' },
      });
      const res = await PUT(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(200);

      const data = await parseResponse<{ person: { FirstName: string; LastName: string } }>(res);
      expect(data.person.FirstName).toBe('Edward');
      expect(data.person.LastName).toBe('Elric');
    });
  });

  describe('DELETE /api/people/[id]', () => {
    it('deletes a person', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Temp', LastName: 'Person' },
      }));
      const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/people/${person.Id}`, { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(res.status).toBe(204);

      // Verify person is gone
      const getReq = createRequest(`http://localhost:3000/api/people/${person.Id}`);
      const getRes = await GET_BY_ID(getReq, { params: Promise.resolve({ id: String(person.Id) }) });
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for non-existent person', async () => {
      const req = createRequest('http://localhost:3000/api/people/99999', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: '99999' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('PeoplePage (Server Component)', () => {
    // useSearchParams requires the client component to sit under Suspense.
    // Awaiting the Server Component therefore yields the boundary, whose child
    // is `<PeoplePageClient initialPeople={...} />`.
    type ClientProps = { initialPeople: ListPeopleResult | null };
    type PageProps = { children: ReactElement<ClientProps> };

    function clientProps(element: ReactElement<PageProps>): ClientProps {
      return element.props.children.props;
    }

    it('renders with server-fetched initial people data for the authenticated user', async () => {
      // Seed a person through the API route, which uses the same mocked
      // (own-tree) user the Server Component will resolve — so the fetch is
      // implicitly scoped to the test user, no direct query() needed.
      await POST(createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Server', LastName: 'Rendered' },
      }));

      const element = (await PeoplePage()) as ReactElement<PageProps>;
      const { initialPeople } = clientProps(element);

      expect(initialPeople).not.toBeNull();
      expect(initialPeople!.count).toBe(1);
      expect(initialPeople!.people).toHaveLength(1);
      expect(initialPeople!.people[0].FirstName).toBe('Server');
      expect(initialPeople!.people[0].LastName).toBe('Rendered');

      // The seed is always the user's default tree (the client seeds it into the
      // default-scope cache key), so no owner id accompanies it anymore.
    });

    it('passes initialPeople=null when unauthenticated', async () => {
      // Per this project's auth-mocking convention (CLAUDE.md Testing section),
      // override the globally-mocked getUserFromRequest for this call only.
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

      const element = (await PeoplePage()) as ReactElement<PageProps>;

      expect(clientProps(element).initialPeople).toBeNull();
    });
  });
});
