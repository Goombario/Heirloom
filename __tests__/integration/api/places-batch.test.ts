import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { POST as POST_COORDS } from '@/app/api/places/coords/route';
import { POST as POST_PIN_CHAINS } from '@/app/api/places/pin-chains/route';
import { POST as POST_TREE } from '@/app/api/trees/route';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import type { Tree } from '@/lib/db/schema';

const describeIf = hasTestDatabase() ? describe : describe.skip;

/**
 * Coverage for the two batch map-pin routes (POST bodies of place names):
 *   POST /api/places/coords     — name → {lat,lng}, filtered by tree scope.
 *   POST /api/places/pin-chains — name → ParentId chain, filtered by tree scope.
 * Both were untested at the route level. The key assertion is cross-tree
 * isolation: a name that exists (with coords) only in tree B must not resolve
 * when the request is scoped to tree A.
 */
describeIf('API /api/places batch routes (coords + pin-chains)', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createTree(name: string): Promise<Tree> {
    const res = await POST_TREE(
      createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name } })
    );
    expect(res.status).toBe(201);
    const { tree } = await parseResponse<{ tree: Tree }>(res);
    return tree;
  }

  async function seedPlace(
    treeId: number,
    ownerId: number,
    name: string,
    lat: number,
    lng: number,
    parentId: number | null = null
  ): Promise<number> {
    const r = await query(
      `INSERT INTO "Places" ("UserId","TreeId","Name","Latitude","Longitude","ParentId")
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING "Id"`,
      [ownerId, treeId, name, lat, lng, parentId]
    );
    return r.rows[0].Id as number;
  }

  function coordsReq(treeId: number, names: string[]) {
    return POST_COORDS(
      createRequest(`http://localhost:3000/api/places/coords?treeId=${treeId}`, {
        method: 'POST',
        body: { names },
      })
    );
  }

  function pinChainsReq(treeId: number, names: string[]) {
    return POST_PIN_CHAINS(
      createRequest(`http://localhost:3000/api/places/pin-chains?treeId=${treeId}`, {
        method: 'POST',
        body: { names },
      })
    );
  }

  // A place recorded loosely ("my home") is geotagged by way of its parent. The
  // coords lookup used to read only the leaf's own columns, so the person timeline
  // showed no map for it — even though the place was geotagged.
  describe('POST /api/places/coords — inherited pins', () => {
    async function seedPlaceNoCoords(
      treeId: number, ownerId: number, name: string, parentId: number | null,
      pinSuppressed = false,
    ): Promise<number> {
      const r = await query(
        `INSERT INTO "Places" ("UserId","TreeId","Name","ParentId","PinSuppressed")
         VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
        [ownerId, treeId, name, parentId, pinSuppressed]
      );
      return r.rows[0].Id as number;
    }

    it('inherits the nearest ancestor pin when the place has none', async () => {
      const tree = await createTree('Inherit Tree');
      const parent = await seedPlace(tree.Id, tree.OwnerId, 'Paris, Ontario, Canada', 43.2, -80.4);
      await seedPlaceNoCoords(tree.Id, tree.OwnerId, 'my home', parent);

      const res = await coordsReq(tree.Id, ['my home']);
      const body = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(res);
      expect(body.coords['my home']).toEqual({ lat: 43.2, lng: -80.4 });
    });

    it('prefers a place own pin over an ancestor pin', async () => {
      const tree = await createTree('Own Pin Tree');
      const parent = await seedPlace(tree.Id, tree.OwnerId, 'Paris, Ontario, Canada', 43.2, -80.4);
      await seedPlace(tree.Id, tree.OwnerId, 'my home', 44.4, -79.9, parent);

      const res = await coordsReq(tree.Id, ['my home']);
      const body = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(res);
      expect(body.coords['my home']).toEqual({ lat: 44.4, lng: -79.9 });
    });

    it('walks past an intermediate ancestor that has no pin', async () => {
      const tree = await createTree('Deep Tree');
      const country = await seedPlace(tree.Id, tree.OwnerId, 'Canada', 56.1, -106.3);
      const province = await seedPlaceNoCoords(tree.Id, tree.OwnerId, 'Ontario', country);
      await seedPlaceNoCoords(tree.Id, tree.OwnerId, 'my home', province);

      const res = await coordsReq(tree.Id, ['my home']);
      const body = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(res);
      expect(body.coords['my home']).toEqual({ lat: 56.1, lng: -106.3 });
    });

    it('yields no pin when suppression blocks the walk-up', async () => {
      const tree = await createTree('Suppressed Tree');
      const parent = await seedPlace(tree.Id, tree.OwnerId, 'Paris, Ontario, Canada', 43.2, -80.4);
      await seedPlaceNoCoords(tree.Id, tree.OwnerId, 'my home', parent, true);

      const res = await coordsReq(tree.Id, ['my home']);
      const body = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(res);
      expect(body.coords['my home']).toBeUndefined();
    });

    it('does not inherit across a tree boundary', async () => {
      const treeA = await createTree('Tree A');
      const treeB = await createTree('Tree B');
      await seedPlace(treeB.Id, treeB.OwnerId, 'Paris, Ontario, Canada', 43.2, -80.4);
      await seedPlaceNoCoords(treeA.Id, treeA.OwnerId, 'my home', null);

      const res = await coordsReq(treeA.Id, ['my home']);
      const body = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(res);
      expect(body.coords['my home']).toBeUndefined();
    });
  });

  describe('POST /api/places/coords', () => {
    it('resolves a seeded place name to its coordinates within the tree', async () => {
      const tree = await createTree('Coords Tree');
      await seedPlace(tree.Id, tree.OwnerId, 'Springfield', 42.1, -72.5);

      const res = await coordsReq(tree.Id, ['Springfield']);
      expect(res.status).toBe(200);
      const { coords } = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(res);
      expect(coords.Springfield).toEqual({ lat: 42.1, lng: -72.5 });
    });

    it('does NOT resolve a name whose coords live only in another tree (cross-tree isolation)', async () => {
      const A = await createTree('Coords Tree A');
      const B = await createTree('Coords Tree B');
      // "Rivertown" only exists (with coords) in tree B.
      await seedPlace(B.Id, B.OwnerId, 'Rivertown', 10.0, 20.0);

      // Scoped to tree A → empty (no leak of B's gazetteer coordinates).
      const resA = await coordsReq(A.Id, ['Rivertown']);
      const { coords: coordsA } = await parseResponse<{ coords: Record<string, unknown> }>(resA);
      expect(coordsA.Rivertown).toBeUndefined();
      expect(Object.keys(coordsA)).toHaveLength(0);

      // Scoped to tree B → present (proves the name really is resolvable, so the
      // negative above is isolation, not a bad fixture).
      const resB = await coordsReq(B.Id, ['Rivertown']);
      const { coords: coordsB } = await parseResponse<{ coords: Record<string, { lat: number; lng: number }> }>(resB);
      expect(coordsB.Rivertown).toEqual({ lat: 10.0, lng: 20.0 });
    });

    it('returns an empty map for an empty names array', async () => {
      const tree = await createTree('Coords Empty Tree');
      const res = await coordsReq(tree.Id, []);
      expect(res.status).toBe(200);
      const { coords } = await parseResponse<{ coords: Record<string, unknown> }>(res);
      expect(Object.keys(coords)).toHaveLength(0);
    });

    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await POST_COORDS(
        createRequest('http://localhost:3000/api/places/coords', {
          method: 'POST',
          body: { names: ['Anywhere'] },
        })
      );
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/places/pin-chains', () => {
    it('resolves a name to its root→leaf parent chain within the tree', async () => {
      const tree = await createTree('Chains Tree');
      const countryId = await seedPlace(tree.Id, tree.OwnerId, 'Wonderland', 0, 0);
      await seedPlace(tree.Id, tree.OwnerId, 'Heartsville', 1, 1, countryId);

      const res = await pinChainsReq(tree.Id, ['Heartsville']);
      expect(res.status).toBe(200);
      const { chains } = await parseResponse<{ chains: Record<string, { name: string }[]> }>(res);
      const chain = chains.Heartsville;
      expect(Array.isArray(chain)).toBe(true);
      // root first (depth DESC): Wonderland then Heartsville.
      expect(chain.map((r) => r.name)).toEqual(['Wonderland', 'Heartsville']);
    });

    it('does NOT resolve a chain for a name that lives only in another tree', async () => {
      const A = await createTree('Chains Tree A');
      const B = await createTree('Chains Tree B');
      await seedPlace(B.Id, B.OwnerId, 'Faraway', 5, 5);

      const resA = await pinChainsReq(A.Id, ['Faraway']);
      expect(resA.status).toBe(200);
      const { chains } = await parseResponse<{ chains: Record<string, unknown> }>(resA);
      expect(chains.Faraway).toBeUndefined();
      expect(Object.keys(chains)).toHaveLength(0);
    });

    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await POST_PIN_CHAINS(
        createRequest('http://localhost:3000/api/places/pin-chains', {
          method: 'POST',
          body: { names: ['Anywhere'] },
        })
      );
      expect(res.status).toBe(401);
    });
  });
});
