import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getPlaceDetailService, upsertPlaceGeocodeService, upsertPlaceHierarchyService, updatePlaceCoordinatesService } from '@/lib/services/places';
import { revertAuditEntry } from '@/lib/db/queries/audit';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #45: a place page says what kind of place it is, from the FORM an import kept.
const USER_ID = 4545;

describe('place detail kind (#45)', () => {
  let db: PGlite;
  let treeId: number;
  const add = async (name: string, form: string | null, parentId: number | null) =>
    ((await query(
      `INSERT INTO "Places" ("UserId", "TreeId", "Name", "Form", "ParentId") VALUES ($1, $2, $3, $4, $5) RETURNING "Id"`,
      [USER_ID, treeId, name, form, parentId],
    )).rows[0] as { Id: number }).Id;
  const kind = async (id: number) =>
    (await getPlaceDetailService({ id, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID })).kind;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'place-kind@test.local', 'place-kind']);
    treeId = await resolveDefaultTree(USER_ID);
  });
  afterAll(async () => { await db.close(); });

  it('gives the leaf its own kind and each parent the kind its descendant names', async () => {
    const usa = await add('USA', null, null);
    const mn = await add('Minnesota, USA', null, usa);
    const county = await add('Hennepin, Minnesota, USA', null, mn);
    const city = await add('Minneapolis, Hennepin, Minnesota, USA', 'City, County, State, Country', county);
    const lonely = await add('Nowhere', null, null);
    expect(await kind(city)).toBe('City');
    expect(await kind(county)).toBe('County');
    expect(await kind(mn)).toBe('State');
    expect(await kind(usa)).toBe('Country');
    expect(await kind(lonely)).toBeNull();
  });

  it('keeps the geocoder kind of each level a match writes, and undo takes it back (ADR 0050)', async () => {
    const ctx = { requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID };
    await upsertPlaceHierarchyService({ ...ctx, levels: [
      { name: 'Sweden', osmKind: 'place/country' },
      { name: 'Uppsala, Sweden', latitude: 59.86, longitude: 17.64, osmKind: 'place/city' },
      { name: 'Old Uppsala Cemetery, Uppsala, Sweden', latitude: 59.85, longitude: 17.63, osmKind: 'javascript:alert(1)' },
    ] });
    const row = async (name: string) => (await query(`SELECT "Id", "OsmKind" FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, name])).rows[0] as { Id: number; OsmKind: string | null };
    expect((await row('Sweden')).OsmKind).toBe('place/country');
    expect((await row('Old Uppsala Cemetery, Uppsala, Sweden')).OsmKind).toBeNull();
    const city = await row('Uppsala, Sweden');
    expect(city.OsmKind).toBe('place/city');
    expect(await getPlaceDetailService({ ...ctx, id: city.Id })).toMatchObject({ kind: null, osmKind: 'place/city' });

    // A structural level fills only an empty kind; a match replaces it.
    await upsertPlaceHierarchyService({ ...ctx, levels: [{ name: 'Sweden', osmKind: 'place/state' }, { name: 'Uppsala, Sweden', latitude: 59.9, longitude: 17.6, osmKind: 'place/town' }], reparent: true });
    expect((await row('Sweden')).OsmKind).toBe('place/country');
    expect((await row('Uppsala, Sweden')).OsmKind).toBe('place/town');
    const entry = (await query(`SELECT "Id" FROM "AuditLog" WHERE "TreeId" = $1 AND "EntityType" = 'place' ORDER BY "Id" DESC LIMIT 1`, [treeId])).rows[0] as { Id: number };
    await revertAuditEntry(entry.Id, treeId, USER_ID, USER_ID);
    expect((await row('Uppsala, Sweden')).OsmKind).toBe('place/city');

    // Moving the pin by hand leaves the kind alone.
    await updatePlaceCoordinatesService({ ...ctx, placeId: city.Id, latitude: 59.8, longitude: 17.5 });
    expect((await row('Uppsala, Sweden')).OsmKind).toBe('place/city');

    // A save that keeps the same match keeps the kind; another match drops it.
    await upsertPlaceGeocodeService({ ...ctx, placeId: city.Id, latitude: 59.8, longitude: 17.5, osmType: null, osmId: null });
    expect((await row('Uppsala, Sweden')).OsmKind).toBe('place/city');
    await upsertPlaceGeocodeService({ ...ctx, placeId: city.Id, latitude: 59.8, longitude: 17.5, osmType: 'node', osmId: 7 });
    expect((await row('Uppsala, Sweden')).OsmKind).toBeNull();
  });
});
