import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as GET_PLACES } from '@/app/api/places/route';
import { GET as GET_PLACE_DETAIL } from '@/app/api/places/detail/route';
import { POST as POST_COORDINATES } from '@/app/api/places/coordinates/route';
import { POST as POST_COORDS } from '@/app/api/places/coords/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { createRequest, parseResponse, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { insertRecord } from '../../setup/fact-places';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface PlaceFaceResponse {
    id: number;
    firstName: string | null;
    lastName: string | null;
    sex: string | null;
    primaryMediaId: number | null;
}

interface PlaceListResponse {
    places: { name: string; count: number; peopleCount: number; faces: PlaceFaceResponse[] }[];
    count: number;
}

interface PlaceDetailResponse {
    name: string;
    people: unknown[];
    eventCounts: { type: string; count: number }[];
    eventCount: number;
    familyCount: number;
    id?: number | null;
    form?: string | null;
    parents?: { id: number; name: string }[];
    children?: { id: number; name: string }[];
    inheritedFrom?: { id: number; name: string; lat: number; lng: number } | null;
}

describeIf('API /api/places', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createPersonWithPlaces() {
        await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: 'P', LastName: 'X', BirthPlace: 'Edinburgh, Scotland', DeathPlace: 'Glasgow, Scotland' },
        }));
    }

    it('returns 401 without a user (list)', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await GET_PLACES(createRequest('http://localhost:3000/api/places'));
        expect(res.status).toBe(401);
    });

    it('lists distinct places aggregated from People rows', async () => {
        await createPersonWithPlaces();
        const res = await GET_PLACES(createRequest('http://localhost:3000/api/places'));
        expect(res.status).toBe(200);
        const data = await parseResponse<PlaceListResponse>(res);
        const names = data.places.map(p => p.name);
        expect(names).toContain('Edinburgh, Scotland');
        expect(names).toContain('Glasgow, Scotland');
    });

    it('counts distinct people per place, not raw fact occurrences', async () => {
        // One person born AND died in Aberdeen: 2 occurrences, 1 distinct person.
        await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: 'Q', LastName: 'Y', BirthPlace: 'Aberdeen, Scotland', DeathPlace: 'Aberdeen, Scotland' },
        }));
        const res = await GET_PLACES(createRequest('http://localhost:3000/api/places'));
        const data = await parseResponse<PlaceListResponse>(res);
        const aberdeen = data.places.find((p) => p.name === 'Aberdeen, Scotland')!;
        expect(aberdeen.count).toBe(2); // raw occurrence count (existing behavior, unchanged)
        expect(aberdeen.peopleCount).toBe(1); // distinct person count (new)
        expect(aberdeen.faces).toHaveLength(1);
        expect(aberdeen.faces[0].firstName).toBe('Q');
    });

    it('includes a sampled person\'s primary photo thumbnail reference in faces', async () => {
        const createRes = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: 'Photo', LastName: 'Haver', Sex: 'F', BirthPlace: 'Dundee, Scotland' },
        }));
        const created = await parseResponse<{ person: { Id: number } }>(createRes);
        const personId = created.person.Id;
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const mediaRes = await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "FocalX", "FocalY")
             VALUES ($1, $2, 'Portrait', 'portrait.jpg', 40, 30) RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        const mediaId = (mediaRes.rows[0] as { Id: number }).Id;
        // Canonical ownership/primary wins over the deliberately stale legacy mirror.
        await query(
            `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
             VALUES ($1, 'People', $2, 1)`,
            [mediaId, personId],
        );

        const res = await GET_PLACES(createRequest('http://localhost:3000/api/places'));
        const data = await parseResponse<PlaceListResponse>(res);
        const dundee = data.places.find((p) => p.name === 'Dundee, Scotland')!;
        expect(dundee.faces[0].primaryMediaId).toBe(mediaId);
    });

    it('place detail returns people associated with the requested place', async () => {
        await createPersonWithPlaces();
        const res = await GET_PLACE_DETAIL(
            createRequest('http://localhost:3000/api/places/detail?name=Edinburgh%2C%20Scotland'),
        );
        expect(res.status).toBe(200);
        const data = await parseResponse<PlaceDetailResponse>(res);
        expect(data.name).toBe('Edinburgh, Scotland');
        expect(data.people).toHaveLength(1);
        // No events/families seeded → aggregated counts are zero (audit #10 shape).
        expect(data.eventCount).toBe(0);
        expect(data.familyCount).toBe(0);
        expect(Array.isArray(data.eventCounts)).toBe(true);
    });

    it('place detail returns the jurisdiction hierarchy (ancestors root-first + children) and the gazetteer id', async () => {
        // Seed a four-level hierarchy: Russia › Moscow Oblast › Moscow › Arbat.
        // Multi-tree: reads are TreeId-scoped now. This describe's afterEach runs
        // cleanupTestData() (drops the test user's "Trees" row), so the tree id is
        // resolved fresh on every call rather than cached.
        async function insertPlace(
            name: string,
            parentId: number | null,
            form: string | null = null,
            latitude: number | null = null,
            longitude: number | null = null,
        ): Promise<number> {
            const treeId = await resolveDefaultTree(TEST_USER.id);
            const res = await query(
                `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId", "Form", "Latitude", "Longitude") VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING "Id"`,
                [TEST_USER.id, treeId, name, parentId, form, latitude, longitude],
            );
            return (res.rows[0] as { Id: number }).Id;
        }
        const russia = await insertPlace('Russia', null, null, 55, 37);
        const oblast = await insertPlace('Moscow Oblast, Russia', russia, null, 56, 38);
        const moscow = await insertPlace('Moscow, Moscow Oblast, Russia', oblast, 'City, Region, Country');
        await insertPlace('Arbat, Moscow, Moscow Oblast, Russia', moscow);

        const res = await GET_PLACE_DETAIL(
            createRequest(`http://localhost:3000/api/places/detail?name=${encodeURIComponent('Moscow, Moscow Oblast, Russia')}`),
        );
        expect(res.status).toBe(200);
        const data = await parseResponse<PlaceDetailResponse>(res);
        expect(data.id).toBe(moscow);
        expect(data.form).toBe('City, Region, Country');
        // Ancestors are root-first for the breadcrumb.
        expect(data.parents?.map(p => p.name)).toEqual(['Russia', 'Moscow Oblast, Russia']);
        expect(data.children?.map(c => c.name)).toEqual(['Arbat, Moscow, Moscow Oblast, Russia']);
        expect(data.inheritedFrom).toEqual({ id: oblast, name: 'Moscow Oblast, Russia', lat: 56, lng: 38 });
    });

    it('does not inherit a pin through a suppressed ancestor', async () => {
        async function insertPlace(name: string, parentId: number | null, pinSuppressed = false, latitude: number | null = null, longitude: number | null = null): Promise<number> {
            const treeId = await resolveDefaultTree(TEST_USER.id);
            const result = await query(
                `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId", "Latitude", "Longitude", "PinSuppressed")
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING "Id"`,
                [TEST_USER.id, treeId, name, parentId, latitude, longitude, pinSuppressed],
            );
            return (result.rows[0] as { Id: number }).Id;
        }

        const grandparent = await insertPlace('Suppression Country', null, false, 10, 20);
        const parent = await insertPlace('Suppression Region', grandparent, true);
        await insertPlace('Suppression City', parent);

        const res = await GET_PLACE_DETAIL(
            createRequest(`http://localhost:3000/api/places/detail?name=${encodeURIComponent('Suppression City')}`),
        );
        expect(res.status).toBe(200);
        const data = await parseResponse<PlaceDetailResponse>(res);
        expect(data.inheritedFrom).toBeNull();
    });

    it('place detail rolls up people from descendant places (via ParentId)', async () => {
        // Multi-tree: reads are TreeId-scoped now. Resolved fresh per raw insert —
        // this describe's afterEach runs cleanupTestData(), which drops the test
        // user's "Trees" row, so a value cached earlier would go stale.
        async function insertPlace(name: string, parentId: number | null): Promise<number> {
            const treeId = await resolveDefaultTree(TEST_USER.id);
            const res = await query(
                `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
                [TEST_USER.id, treeId, name, parentId],
            );
            return (res.rows[0] as { Id: number }).Id;
        }
        const russia = await insertPlace('Russia', null);
        const oblast = await insertPlace('Moscow Oblast, Russia', russia);
        await insertPlace('Moscow, Moscow Oblast, Russia', oblast);
        // Born in the descendant (Moscow) — nobody is born in "Russia" exactly.
        const treeId = await resolveDefaultTree(TEST_USER.id);
        await insertRecord({ query }, 'People', { UserId: TEST_USER.id, TreeId: treeId, FirstName: 'Leo', LastName: 'Tolstoy', BirthPlace: 'Moscow, Moscow Oblast, Russia' });

        const res = await GET_PLACE_DETAIL(
            createRequest('http://localhost:3000/api/places/detail?name=Russia'),
        );
        expect(res.status).toBe(200);
        const data = await parseResponse<PlaceDetailResponse>(res);
        // The roll-up surfaces the Moscow-born person on Russia's detail, tagged 'born'.
        const people = data.people as Array<{ LastName: string; PlaceRole: string }>;
        const tolstoy = people.find(p => p.LastName === 'Tolstoy');
        expect(tolstoy).toBeDefined();
        expect(tolstoy?.PlaceRole).toBe('born');
    });

    it('addresses a place by id: detail, coordinates and the coords lookup (#1186)', async () => {
        await createPersonWithPlaces();
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const id = ((await query(`SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Glasgow, Scotland'`, [treeId])).rows[0] as { Id: number }).Id;

        const detail = await parseResponse<PlaceDetailResponse>(await GET_PLACE_DETAIL(createRequest(`http://localhost:3000/api/places/detail?id=${id}`)));
        expect(detail).toMatchObject({ id, name: 'Glasgow, Scotland' });

        const saved = await POST_COORDINATES(createRequest('http://localhost:3000/api/places/coordinates', {
            method: 'POST', body: { placeId: id, latitude: 55.86, longitude: -4.25 },
        }));
        expect(saved.status).toBe(200);
        const coords = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(await POST_COORDS(createRequest('http://localhost:3000/api/places/coords', {
            method: 'POST', body: { ids: [id, 'x'] },
        })));
        expect(coords.coords).toEqual({ [`#${id}`]: { lat: 55.86, lng: -4.25 } });

        const bad = await GET_PLACE_DETAIL(createRequest('http://localhost:3000/api/places/detail?id=abc'));
        expect(bad.status).toBe(400);
        const missing = await POST_COORDINATES(createRequest('http://localhost:3000/api/places/coordinates', {
            method: 'POST', body: { placeId: 2147483000, latitude: 1, longitude: 1 },
        }));
        expect(missing.status).toBe(404);
    });

    it('place detail requires the name query parameter (400 when missing)', async () => {
        const res = await GET_PLACE_DETAIL(createRequest('http://localhost:3000/api/places/detail'));
        expect(res.status).toBe(400);
    });

    it('place detail does not allow SQL injection via the name query param', async () => {
        // The param is positional-parameterized — pg treats it as a literal.
        const res = await GET_PLACE_DETAIL(
            createRequest("http://localhost:3000/api/places/detail?name='%20OR%201%3D1--"),
        );
        expect(res.status).toBeLessThan(500);
    });
});
