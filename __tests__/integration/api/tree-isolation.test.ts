import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST as POST_TREE, GET as GET_TREES } from '@/app/api/trees/route';
import { DELETE as DELETE_TREE } from '@/app/api/trees/[id]/route';
import { GET as GET_PEOPLE, POST as POST_PERSON } from '@/app/api/people/route';
import {
  GET as GET_PERSON,
  PUT as PUT_PERSON,
  DELETE as DELETE_PERSON,
} from '@/app/api/people/[id]/route';
import { GET as GET_FAMILIES, POST as POST_FAMILY } from '@/app/api/families/route';
import { POST as POST_EVENT } from '@/app/api/events/route';
import { PUT as PUT_EVENT } from '@/app/api/events/[id]/route';
import { GET as GET_PERSON_EVENTS } from '@/app/api/people/[id]/events/route';
import { GET as GET_MEDIA } from '@/app/api/media/route';
import { GET as GET_SOURCES, POST as POST_SOURCE } from '@/app/api/sources/route';
import { GET as GET_CITATIONS, POST as POST_CITATION } from '@/app/api/citations/route';
import { GET as GET_REPOSITORIES, POST as POST_REPOSITORY } from '@/app/api/repositories/route';
import { GET as GET_NOTES, POST as POST_NOTE } from '@/app/api/notes/route';
import { GET as GET_PLACES } from '@/app/api/places/route';
import { GET as GET_CASES, POST as POST_CASE } from '@/app/api/cases/route';
import { GET as GET_TREE } from '@/app/api/tree/route';
import { GET as GET_AUDIT } from '@/app/api/audit/route';
import { createMedia } from '@/lib/db/queries/media';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import type { Tree } from '@/lib/db/schema';

const describeIf = hasTestDatabase() ? describe : describe.skip;

const CONFIRM_DELETE_TREE = { 'X-Confirm-Delete-Tree': 'CONFIRM_DELETE_TREE' };

function idParams(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}

/** Create a fresh tree for TEST_USER via the POST /api/trees handler. */
async function createTree(name: string): Promise<Tree> {
  const res = await POST_TREE(
    createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name } })
  );
  expect(res.status).toBe(201);
  const { tree } = await parseResponse<{ tree: Tree }>(res);
  return tree;
}

/**
 * Two fresh trees per test. cleanupTestData() drops all Trees rows in afterEach,
 * so ids are never cached across tests — always created inside the it() block.
 */
async function makeTwoTrees(): Promise<{ A: Tree; B: Tree }> {
  const A = await createTree('Tree A (isolation)');
  const B = await createTree('Tree B (isolation)');
  return { A, B };
}

describeIf('API cross-tree isolation (multi-tree)', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  // --- person ------------------------------------------------------------
  it('person: created in tree A is invisible to tree B (list + by-id)', async () => {
    const { A, B } = await makeTwoTrees();

    const createRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Isolation', LastName: 'Alpha' },
      })
    );
    expect(createRes.status).toBe(201);
    const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

    // (2) tree-A list contains it.
    const listA = await GET_PEOPLE(createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`));
    const { people: peopleA } = await parseResponse<{ people: { Id: number }[] }>(listA);
    expect(peopleA.some((p) => p.Id === person.Id)).toBe(true);

    // (1) tree-B list does NOT.
    const listB = await GET_PEOPLE(createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`));
    const { people: peopleB } = await parseResponse<{ people: { Id: number }[] }>(listB);
    expect(peopleB.some((p) => p.Id === person.Id)).toBe(false);

    // (2) by-id read under tree A returns it.
    const getA = await GET_PERSON(
      createRequest(`http://localhost:3000/api/people/${person.Id}?treeId=${A.Id}`),
      idParams(person.Id)
    );
    expect(getA.status).toBe(200);

    // (3) by-id read under tree B is 404 (not the record).
    const getB = await GET_PERSON(
      createRequest(`http://localhost:3000/api/people/${person.Id}?treeId=${B.Id}`),
      idParams(person.Id)
    );
    expect(getB.status).toBe(404);
  });

  // --- family ------------------------------------------------------------
  it('family: created in tree A is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    const createRes = await POST_FAMILY(
      createRequest(`http://localhost:3000/api/families?treeId=${A.Id}`, {
        method: 'POST',
        body: { Type: 'Marriage' },
      })
    );
    expect(createRes.status).toBe(201);
    const { family } = await parseResponse<{ family: { Id: number } }>(createRes);

    const listA = await GET_FAMILIES(createRequest(`http://localhost:3000/api/families?treeId=${A.Id}`));
    const { families: famA } = await parseResponse<{ families: { Id: number }[] }>(listA);
    expect(famA.some((f) => f.Id === family.Id)).toBe(true);

    const listB = await GET_FAMILIES(createRequest(`http://localhost:3000/api/families?treeId=${B.Id}`));
    const { families: famB } = await parseResponse<{ families: { Id: number }[] }>(listB);
    expect(famB.some((f) => f.Id === family.Id)).toBe(false);
  });

  // --- event -------------------------------------------------------------
  it('event: created in tree A (on a tree-A person) is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    // A person in tree A to hang the event on.
    const personRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Event', LastName: 'Subject' },
      })
    );
    const { person } = await parseResponse<{ person: { Id: number } }>(personRes);

    const eventRes = await POST_EVENT(
      createRequest(`http://localhost:3000/api/events?treeId=${A.Id}`, {
        method: 'POST',
        body: { Type: 'BAPM', Date: '1900', PersonId: person.Id },
      })
    );
    expect(eventRes.status).toBe(201);
    const { event } = await parseResponse<{ event: { Id: number } }>(eventRes);

    // Listed via the person's events route under tree A.
    const evtA = await GET_PERSON_EVENTS(
      createRequest(`http://localhost:3000/api/people/${person.Id}/events?treeId=${A.Id}`),
      idParams(person.Id)
    );
    const { events: eventsA } = await parseResponse<{ events: { Id: number }[] }>(evtA);
    expect(eventsA.some((e) => e.Id === event.Id)).toBe(true);

    // The same person id under tree B resolves to a different tree — no events.
    const evtB = await GET_PERSON_EVENTS(
      createRequest(`http://localhost:3000/api/people/${person.Id}/events?treeId=${B.Id}`),
      idParams(person.Id)
    );
    const { events: eventsB } = await parseResponse<{ events: { Id: number }[] }>(evtB);
    expect(eventsB.some((e) => e.Id === event.Id)).toBe(false);
  });

  it('event: PUT cannot re-point a tree-A event at a tree-B person', async () => {
    const { A, B } = await makeTwoTrees();
    const makePerson = async (treeId: number) => {
      const res = await POST_PERSON(createRequest(`http://localhost:3000/api/people?treeId=${treeId}`, {
        method: 'POST',
        body: { FirstName: 'Event', LastName: 'Subject' },
      }));
      return (await parseResponse<{ person: { Id: number } }>(res)).person;
    };
    const personA = await makePerson(A.Id);
    const personB = await makePerson(B.Id);
    const eventRes = await POST_EVENT(createRequest(`http://localhost:3000/api/events?treeId=${A.Id}`, {
      method: 'POST',
      body: { Type: 'BAPM', PersonId: personA.Id },
    }));
    const { event } = await parseResponse<{ event: { Id: number } }>(eventRes);

    const res = await PUT_EVENT(
      createRequest(`http://localhost:3000/api/events/${event.Id}?treeId=${A.Id}`, { method: 'PUT', body: { PersonId: personB.Id } }),
      idParams(event.Id),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // --- media metadata ----------------------------------------------------
  it('media: a row inserted with TreeId A is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    const media = await createMedia({
      UserId: TEST_USER.id,
      TreeId: A.Id,
      Title: 'Isolation Media A',
      FilePath: 'isolation-a.jpg',
      Format: 'jpg',
      ContentType: 'image/jpeg',
    });

    const listA = await GET_MEDIA(createRequest(`http://localhost:3000/api/media?treeId=${A.Id}`));
    const { media: mediaA } = await parseResponse<{ media: { Id: number }[] }>(listA);
    expect(mediaA.some((m) => m.Id === media.Id)).toBe(true);

    const listB = await GET_MEDIA(createRequest(`http://localhost:3000/api/media?treeId=${B.Id}`));
    const { media: mediaB } = await parseResponse<{ media: { Id: number }[] }>(listB);
    expect(mediaB.some((m) => m.Id === media.Id)).toBe(false);
  });

  // --- source ------------------------------------------------------------
  it('source: created in tree A is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    const createRes = await POST_SOURCE(
      createRequest(`http://localhost:3000/api/sources?treeId=${A.Id}`, {
        method: 'POST',
        body: { Title: 'Isolation Source A' },
      })
    );
    expect(createRes.status).toBe(201);
    const { source } = await parseResponse<{ source: { Id: number } }>(createRes);

    const listA = await GET_SOURCES(createRequest(`http://localhost:3000/api/sources?treeId=${A.Id}`));
    const { sources: sourcesA } = await parseResponse<{ sources: { Id: number }[] }>(listA);
    expect(sourcesA.some((s) => s.Id === source.Id)).toBe(true);

    const listB = await GET_SOURCES(createRequest(`http://localhost:3000/api/sources?treeId=${B.Id}`));
    const { sources: sourcesB } = await parseResponse<{ sources: { Id: number }[] }>(listB);
    expect(sourcesB.some((s) => s.Id === source.Id)).toBe(false);
  });

  // --- citation ----------------------------------------------------------
  it('citation: created in tree A is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    // Person + source in tree A to cite.
    const personRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Cited', LastName: 'Person' },
      })
    );
    const { person } = await parseResponse<{ person: { Id: number } }>(personRes);
    const sourceRes = await POST_SOURCE(
      createRequest(`http://localhost:3000/api/sources?treeId=${A.Id}`, {
        method: 'POST',
        body: { Title: 'Citing Source A' },
      })
    );
    const { source } = await parseResponse<{ source: { Id: number } }>(sourceRes);

    const citeRes = await POST_CITATION(
      createRequest(`http://localhost:3000/api/citations?treeId=${A.Id}`, {
        method: 'POST',
        body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
      })
    );
    expect(citeRes.status).toBe(201);
    const { citation } = await parseResponse<{ citation: { Id: number } }>(citeRes);

    const photos = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "FocalX", "FocalY", "FocalRadius")
       VALUES ($1, $2, 'Unlinked portrait A', 'unlinked-a.jpg', 5, 6, 7),
              ($1, $2, 'Canonical portrait B', 'canonical-b.jpg', 80, 81, 82)
       RETURNING "Id"`,
      [TEST_USER.id, A.Id],
    );
    const legacyPhotoId = photos.rows[0].Id as number;
    const canonicalPhotoId = photos.rows[1].Id as number;
    await query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
       VALUES ($1, 'People', $2, 1)`,
      [canonicalPhotoId, person.Id],
    );
    await query(
      `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
       VALUES ($1, $2, 10, 20, 30, 40)`,
      [canonicalPhotoId, person.Id],
    );

    const factQs = `factTable=People&factId=${person.Id}`;
    const listA = await GET_CITATIONS(
      createRequest(`http://localhost:3000/api/citations?${factQs}&treeId=${A.Id}`)
    );
    const { citations: citesA } = await parseResponse<{ citations: { Id: number }[] }>(listA);
    expect(citesA.some((c) => c.Id === citation.Id)).toBe(true);

    const listB = await GET_CITATIONS(
      createRequest(`http://localhost:3000/api/citations?${factQs}&treeId=${B.Id}`)
    );
    const { citations: citesB } = await parseResponse<{ citations: { Id: number }[] }>(listB);
    expect(citesB.some((c) => c.Id === citation.Id)).toBe(false);

    const sourceList = await GET_SOURCES(
      createRequest(`http://localhost:3000/api/sources?treeId=${A.Id}&withCounts=true`),
    );
    const counted = await parseResponse<{
      sources: Array<{ Id: number; citedByPeople: Array<{ Id: number; PrimaryMediaId: number | null }> }>;
    }>(sourceList);
    expect(counted.sources.find((row) => row.Id === source.Id)?.citedByPeople[0]?.PrimaryMediaId)
      .toBe(canonicalPhotoId);

    const treeRes = await GET_TREE(createRequest(
      `http://localhost:3000/api/tree?treeId=${A.Id}&id=${person.Id}&mode=descendants`,
    ));
    const tree = await parseResponse<{ tree: { id: number; photoMediaId: number | null; focalX?: number; focalY?: number; focalRadius?: number | null } }>(treeRes);
    expect(tree.tree.photoMediaId).toBe(canonicalPhotoId);
    expect(tree.tree.focalX).toBeCloseTo(25);
    expect(tree.tree.focalY).toBeCloseTo(40);
    expect(tree.tree.focalRadius).toBeCloseTo(40);
    expect(tree.tree.photoMediaId).not.toBe(legacyPhotoId);
  });

  // --- repository --------------------------------------------------------
  it('repository: created in tree A is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    const createRes = await POST_REPOSITORY(
      createRequest(`http://localhost:3000/api/repositories?treeId=${A.Id}`, {
        method: 'POST',
        body: { Name: 'Isolation Repo A' },
      })
    );
    expect(createRes.status).toBe(201);
    const { repository } = await parseResponse<{ repository: { Id: number } }>(createRes);

    const listA = await GET_REPOSITORIES(
      createRequest(`http://localhost:3000/api/repositories?treeId=${A.Id}`)
    );
    const { repositories: reposA } = await parseResponse<{ repositories: { Id: number }[] }>(listA);
    expect(reposA.some((r) => r.Id === repository.Id)).toBe(true);

    const listB = await GET_REPOSITORIES(
      createRequest(`http://localhost:3000/api/repositories?treeId=${B.Id}`)
    );
    const { repositories: reposB } = await parseResponse<{ repositories: { Id: number }[] }>(listB);
    expect(reposB.some((r) => r.Id === repository.Id)).toBe(false);
  });

  // --- note --------------------------------------------------------------
  it('note: attached to a tree-A person is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    const personRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Noted', LastName: 'Person' },
      })
    );
    const { person } = await parseResponse<{ person: { Id: number } }>(personRes);

    const noteRes = await POST_NOTE(
      createRequest(`http://localhost:3000/api/notes?treeId=${A.Id}`, {
        method: 'POST',
        body: { ownerTable: 'People', recordId: person.Id, text: 'Isolation note A' },
      })
    );
    expect(noteRes.status).toBe(201);
    const { note } = await parseResponse<{ note: { Id: number } }>(noteRes);

    const listA = await GET_NOTES(
      createRequest(`http://localhost:3000/api/notes?ownerTable=People&recordId=${person.Id}&treeId=${A.Id}`)
    );
    const { notes: notesA } = await parseResponse<{ notes: { Id: number }[] }>(listA);
    expect(notesA.some((n) => n.Id === note.Id)).toBe(true);

    const listB = await GET_NOTES(
      createRequest(`http://localhost:3000/api/notes?ownerTable=People&recordId=${person.Id}&treeId=${B.Id}`)
    );
    const { notes: notesB } = await parseResponse<{ notes: { Id: number }[] }>(listB);
    expect(notesB.some((n) => n.Id === note.Id)).toBe(false);
  });

  // --- place (implicit) --------------------------------------------------
  it('place: a tree-A person BirthPlace is not aggregated under tree B', async () => {
    const { A, B } = await makeTwoTrees();
    const PLACE = 'Isolation Test Town';

    const personRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Placed', LastName: 'Person', BirthPlace: PLACE },
      })
    );
    expect(personRes.status).toBe(201);

    const listA = await GET_PLACES(createRequest(`http://localhost:3000/api/places?treeId=${A.Id}`));
    const { places: placesA } = await parseResponse<{ places: { name: string }[] }>(listA);
    expect(placesA.some((p) => p.name === PLACE)).toBe(true);

    const listB = await GET_PLACES(createRequest(`http://localhost:3000/api/places?treeId=${B.Id}`));
    const { places: placesB } = await parseResponse<{ places: { name: string }[] }>(listB);
    expect(placesB.some((p) => p.name === PLACE)).toBe(false);
  });

  // --- case --------------------------------------------------------------
  it('case: created in tree A is not listed under tree B', async () => {
    const { A, B } = await makeTwoTrees();

    const createRes = await POST_CASE(
      createRequest(`http://localhost:3000/api/cases?treeId=${A.Id}`, {
        method: 'POST',
        body: { Title: 'Isolation Case A' },
      })
    );
    expect(createRes.status).toBe(201);
    const { case: created } = await parseResponse<{ case: { Id: number } }>(createRes);

    const listA = await GET_CASES(createRequest(`http://localhost:3000/api/cases?treeId=${A.Id}`));
    const { cases: casesA } = await parseResponse<{ cases: { Id: number }[] }>(listA);
    expect(casesA.some((c) => c.Id === created.Id)).toBe(true);

    const listB = await GET_CASES(createRequest(`http://localhost:3000/api/cases?treeId=${B.Id}`));
    const { cases: casesB } = await parseResponse<{ cases: { Id: number }[] }>(listB);
    expect(casesB.some((c) => c.Id === created.Id)).toBe(false);
  });

  // --- audit -------------------------------------------------------------
  it('audit: the tree-A person create is logged under tree A, not tree B', async () => {
    const { A, B } = await makeTwoTrees();

    await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Audited', LastName: 'Person' },
      })
    );

    const auditA = await GET_AUDIT(createRequest(`http://localhost:3000/api/audit?treeId=${A.Id}`));
    const { entries: entriesA } = await parseResponse<{ entries: { EntityType: string }[] }>(auditA);
    expect(entriesA.some((e) => e.EntityType === 'person')).toBe(true);

    const auditB = await GET_AUDIT(createRequest(`http://localhost:3000/api/audit?treeId=${B.Id}`));
    const { entries: entriesB } = await parseResponse<{ entries: { EntityType: string }[] }>(auditB);
    expect(entriesB.some((e) => e.EntityType === 'person')).toBe(false);
  });

  // === Cross-cutting cases ===============================================

  it('legacy bridge: ?ownerId (no treeId) lands in the DEFAULT tree, not tree B', async () => {
    const { B } = await makeTwoTrees();

    // No treeId; ownerId === the caller → resolveTreeScope falls through to the
    // caller's DEFAULT tree.
    const createRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?ownerId=${TEST_USER.id}`, {
        method: 'POST',
        body: { FirstName: 'Legacy', LastName: 'Bridge' },
      })
    );
    expect(createRes.status).toBe(201);
    const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

    // Appears in the default-scope list (no params).
    const listDefault = await GET_PEOPLE(createRequest('http://localhost:3000/api/people'));
    const { people: defaultPeople } = await parseResponse<{ people: { Id: number }[] }>(listDefault);
    expect(defaultPeople.some((p) => p.Id === person.Id)).toBe(true);

    // Does NOT appear under tree B.
    const listB = await GET_PEOPLE(createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`));
    const { people: peopleB } = await parseResponse<{ people: { Id: number }[] }>(listB);
    expect(peopleB.some((p) => p.Id === person.Id)).toBe(false);
  });

  it('mutate-by-id: PUT/DELETE of a tree-A person scoped to tree B does not touch it', async () => {
    const { A, B } = await makeTwoTrees();

    const createRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Original', LastName: 'Name' },
      })
    );
    const { person } = await parseResponse<{ person: { Id: number } }>(createRes);

    // PUT scoped to tree B must not modify the tree-A row.
    const putRes = await PUT_PERSON(
      createRequest(`http://localhost:3000/api/people/${person.Id}?treeId=${B.Id}`, {
        method: 'PUT',
        body: { FirstName: 'Hijacked' },
      }),
      idParams(person.Id)
    );
    expect(putRes.status).toBe(404); // wrong-tree id reads as "not found", never 200/500

    const afterPut = await query(
      `SELECT "FirstName" FROM "People" WHERE "Id" = $1 AND "UserId" = $2`,
      [person.Id, TEST_USER.id]
    );
    expect((afterPut.rows[0] as { FirstName: string }).FirstName).toBe('Original');

    // DELETE scoped to tree B must not delete the tree-A row.
    const delRes = await DELETE_PERSON(
      createRequest(`http://localhost:3000/api/people/${person.Id}?treeId=${B.Id}`, {
        method: 'DELETE',
      }),
      idParams(person.Id)
    );
    expect(delRes.status).toBe(404); // wrong-tree id reads as "not found", never 200/500

    const afterDelete = await query(
      `SELECT count(*)::int AS n FROM "People" WHERE "Id" = $1 AND "UserId" = $2`,
      [person.Id, TEST_USER.id]
    );
    expect((afterDelete.rows[0] as { n: number }).n).toBe(1);
  });

  it('tree delete isolation: deleting tree B leaves tree A data intact', async () => {
    const { A, B } = await makeTwoTrees();

    const personARes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`, {
        method: 'POST',
        body: { FirstName: 'Survivor', LastName: 'A' },
      })
    );
    const { person: personA } = await parseResponse<{ person: { Id: number } }>(personARes);

    await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`, {
        method: 'POST',
        body: { FirstName: 'Doomed', LastName: 'B' },
      })
    );

    const delRes = await DELETE_TREE(
      createRequest(`http://localhost:3000/api/trees/${B.Id}`, {
        method: 'DELETE',
        headers: CONFIRM_DELETE_TREE,
      }),
      idParams(B.Id)
    );
    expect(delRes.status).toBe(200);

    // Tree A's person survives and is still listed under tree A.
    const listA = await GET_PEOPLE(createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`));
    const { people: peopleA } = await parseResponse<{ people: { Id: number }[] }>(listA);
    expect(peopleA.some((p) => p.Id === personA.Id)).toBe(true);

    const survived = await query(
      `SELECT count(*)::int AS n FROM "People" WHERE "Id" = $1 AND "UserId" = $2`,
      [personA.Id, TEST_USER.id]
    );
    expect((survived.rows[0] as { n: number }).n).toBe(1);

    // Tree B is gone.
    const treesRes = await GET_TREES(createRequest('http://localhost:3000/api/trees'));
    const { trees } = await parseResponse<{ trees: Tree[] }>(treesRes);
    expect(trees.some((t) => t.Id === B.Id)).toBe(false);
  });

  // --- security regressions (from the multi-tree security review) --------

  it('addMediaTag rejects a person from another same-owner tree (PII leak guard)', async () => {
    const { A, B } = await makeTwoTrees();
    // A media item in tree A, and a person in the OTHER tree B (same owner).
    const media = await createMedia(
      { UserId: TEST_USER.id, TreeId: A.Id, Title: 'Tag target', FilePath: null, Format: 'jpeg', ContentType: 'image/jpeg' },
      TEST_USER.id
    );
    const personBRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`, {
        method: 'POST',
        body: { FirstName: 'Private', LastName: 'Bravo' },
      })
    );
    const { person: personB } = await parseResponse<{ person: { Id: number } }>(personBRes);

    // addMediaTag is exercised via the query layer (the tag route is media-scoped);
    // the tree-A scope must reject tagging tree B's person.
    const { addMediaTag } = await import('@/lib/db/queries/media-tags');
    await expect(
      addMediaTag(
        { MediaId: media.Id, PersonId: personB.Id, RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 },
        A.Id,
        TEST_USER.id
      )
    ).rejects.toThrow(/not found in this tree/i);
  });

  it('canonical media linking rejects a person from another tree', async () => {
    const { A, B } = await makeTwoTrees();
    const media = await createMedia(
      { UserId: TEST_USER.id, TreeId: A.Id, Title: 'Relink target', FilePath: null, Format: 'jpeg', ContentType: 'image/jpeg' },
      TEST_USER.id
    );
    const personBRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`, {
        method: 'POST',
        body: { FirstName: 'Foreign', LastName: 'Person' },
      })
    );
    const { person: personB } = await parseResponse<{ person: { Id: number } }>(personBRes);

    const { linkMediaForOwnerService } = await import('@/lib/services/media-links');
    await expect(
      linkMediaForOwnerService({
        mediaId: media.Id,
        ownerTable: 'People',
        ownerId: personB.Id,
        requestedTreeId: A.Id,
        requestedOwnerId: null,
        currentUserId: TEST_USER.id,
      })
    ).rejects.toThrow(/not found in this tree/i);

    // No canonical relationship was created.
    const after = await query(
      `SELECT COUNT(*)::int AS "count" FROM "MediaLink" WHERE "MediaId" = $1`,
      [media.Id]
    );
    expect((after.rows[0] as { count: number }).count).toBe(0);
  });

  it('event create rejects a PersonId from another tree (IDOR guard)', async () => {
    const { A, B } = await makeTwoTrees();
    const personBRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`, {
        method: 'POST',
        body: { FirstName: 'Other', LastName: 'Tree' },
      })
    );
    const { person: personB } = await parseResponse<{ person: { Id: number } }>(personBRes);

    const res = await POST_EVENT(
      createRequest(`http://localhost:3000/api/events?treeId=${A.Id}`, {
        method: 'POST',
        body: { Type: 'RESI', Date: '1900', PersonId: personB.Id },
      })
    );
    expect(res.status).toBe(404); // person is not in the resolved tree

    const rows = await query(
      `SELECT count(*)::int AS n FROM "Events" WHERE "PersonId" = $1 AND "UserId" = $2`,
      [personB.Id, TEST_USER.id]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it('overwrite GEDCOM import is rejected for a contribute-only collaborator', async () => {
    const { A } = await makeTwoTrees();
    const { importGedcomService } = await import('@/lib/services/gedcom');
    const { AccessError } = await import('@/lib/data/errors');
    // Simulate a contribute-tier caller on tree A by stubbing the scope resolver.
    const trees = await import('@/lib/db/queries/trees');
    const spy = vi.spyOn(trees, 'resolveTreeScope').mockResolvedValue({
      treeId: A.Id,
      ownerId: TEST_USER.id,
      permission: 'contribute',
    });
    try {
      const gedcom = '0 HEAD\n1 SOUR Test\n0 @I1@ INDI\n1 NAME Should /NotImport/\n0 TRLR\n';
      const file = new File([gedcom], 'test.ged', { type: 'text/plain' });
      await expect(
        importGedcomService({
          file,
          mode: 'overwrite',
          currentUserId: TEST_USER.id,
          requestedTreeId: A.Id,
          requestedOwnerId: null,
        })
      ).rejects.toBeInstanceOf(AccessError);
    } finally {
      spy.mockRestore();
    }
  });
});
