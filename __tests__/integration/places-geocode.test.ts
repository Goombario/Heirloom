import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { ValidationError } from '@/lib/validation';
import { TEST_USER } from '@/__tests__/setup/test-helpers';
import { hasTestDatabase } from '@/__tests__/setup/db-helpers';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { insertRecord } from '../setup/fact-places';
import {
  upsertPlaceGeocodeService, updatePlaceCoordinatesService, listPlacesService, upsertPlaceHierarchyService, getPlaceDependentCountService,
  getPlacePinChainsService, getPlaceDetailService,
} from '@/lib/services/places';

const PLACE = 'Canterbury, England, United Kingdom';

describe.skipIf(!hasTestDatabase())('places geocode service', () => {
  beforeAll(async () => {
    // Multi-tree: reads are TreeId-scoped now. This describe block's own
    // afterAll cleanup (below) never touches "Trees", so resolving once here
    // is safe (unlike files that run cleanupTestData()).
    const treeId = await resolveDefaultTree(TEST_USER.id);
    await insertRecord({ query }, 'People', { UserId: TEST_USER.id, TreeId: treeId, FirstName: 'Geo Test', BirthPlace: PLACE });
  });
  afterAll(async () => {
    await query(`DELETE FROM "People" WHERE "UserId"=$1 AND "FirstName"='Geo Test'`, [TEST_USER.id]);
    await query(`DELETE FROM "Places" WHERE "UserId"=$1 AND "Name"=$2`, [TEST_USER.id, PLACE]);
  });

  it('upserts coordinates and exposes them via listPlaces', async () => {
    await upsertPlaceGeocodeService({
      name: PLACE, latitude: 51.2802, longitude: 1.0789,
      displayName: PLACE, osmType: 'relation', osmId: 123,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const { places } = await listPlacesService({ requestedOwnerId: null, currentUserId: TEST_USER.id });
    const row = places.find((p) => p.name === PLACE);
    expect(row?.latitude).toBeCloseTo(51.2802, 5);
    expect(row?.longitude).toBeCloseTo(1.0789, 5);
    expect(row?.displayName).toBe(PLACE);
    expect(row?.id).toBeTypeOf('number');
    expect(row?.parentId === null || typeof row?.parentId === 'number').toBe(true);
    const { gazetteer } = await listPlacesService({ requestedOwnerId: null, currentUserId: TEST_USER.id });
    expect(gazetteer.some((g) => g.name === PLACE)).toBe(true);
  });

  it('is idempotent on (UserId, Name) — second upsert updates, not duplicates', async () => {
    await upsertPlaceGeocodeService({
      name: PLACE, latitude: 10, longitude: 20,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const dup = await query(`SELECT COUNT(*)::int AS n FROM "Places" WHERE "UserId"=$1 AND "Name"=$2`, [TEST_USER.id, PLACE]);
    expect((dup.rows[0] as { n: number }).n).toBe(1);
  });

  /**
   * ADR 0017: DisplayName and OsmType/OsmId are two halves of the same geocoder
   * provenance. The single-row upsert assigns the OSM columns with a bare
   * `= EXCLUDED`, so a caller that omits them NULLs a match the row already had —
   * which is why `getPlaceDetailService` has to hand them to the edit form and the
   * form has to send them back on a coordinates-only save (#447).
   */
  it('exposes OsmType/OsmId on the detail payload, so a save can echo them back', async () => {
    await upsertPlaceGeocodeService({
      name: PLACE, latitude: 51.2802, longitude: 1.0789,
      displayName: PLACE, osmType: 'relation', osmId: 123,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const detail = await getPlaceDetailService({
      name: PLACE, requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    expect(detail.osmType).toBe('relation');
    expect(detail.osmId).toBe(123);

    // The round-trip the form performs on Save: coordinates change, provenance is
    // echoed. Dropping either OSM field here is what erased them.
    await upsertPlaceGeocodeService({
      name: PLACE, latitude: 51.3, longitude: 1.1,
      displayName: detail.displayName ?? null,
      osmType: detail.osmType ?? null, osmId: detail.osmId ?? null,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const after = await getPlaceDetailService({
      name: PLACE, requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    expect(after.osmType).toBe('relation');
    expect(after.osmId).toBe(123);
    expect(after.displayName).toBe(PLACE);
  });

  it('updates manual coordinates without changing geocoder provenance', async () => {
    await upsertPlaceGeocodeService({
      name: PLACE, latitude: 51.2802, longitude: 1.0789,
      displayName: 'Canterbury Cathedral', osmType: 'way', osmId: 987654,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });

    await updatePlaceCoordinatesService({
      name: PLACE, latitude: 51.2798, longitude: 1.0833,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });

    const detail = await getPlaceDetailService({
      name: PLACE, requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    expect(detail.latitude).toBeCloseTo(51.2798, 5);
    expect(detail.longitude).toBeCloseTo(1.0833, 5);
    expect(detail.displayName).toBe('Canterbury Cathedral');
    expect(detail.osmType).toBe('way');
    expect(detail.osmId).toBe(987654);
  });

  it('rejects out-of-range latitude', async () => {
    await expect(upsertPlaceGeocodeService({
      name: PLACE, latitude: 999, longitude: 0,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    })).rejects.toThrow(ValidationError);
  });
});

describe.skipIf(!hasTestDatabase())('upsertPlaceHierarchyService', () => {
  afterEach(async () => {
    await query(`DELETE FROM "Places" WHERE "UserId" = $1`, [TEST_USER.id]);
  });

  it('creates a new chain, linking each level to the previous via ParentId', async () => {
    await upsertPlaceHierarchyService({
      levels: [
        { name: 'United Kingdom' },
        { name: 'England' },
        { name: 'Kent' },
        { name: 'Dover, Kent, England, United Kingdom', latitude: 51.1048, longitude: 1.2416 },
        { name: '67 Folkestone Road, Dover, Kent, England' },
      ],
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    });

    const rows = (await query(
      `SELECT "Name", "ParentId", "Latitude", "Longitude" FROM "Places" WHERE "UserId" = $1 ORDER BY "Id" ASC`,
      [TEST_USER.id]
    )).rows as { Name: string; ParentId: number | null; Latitude: number | null; Longitude: number | null }[];

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ Name: 'United Kingdom', ParentId: null });
    expect(rows[3]).toMatchObject({ Name: 'Dover, Kent, England, United Kingdom', Latitude: 51.1048, Longitude: 1.2416 });
    expect(rows[4]).toMatchObject({ Name: '67 Folkestone Road, Dover, Kent, England', Latitude: null, Longitude: null });

    const byName = new Map(rows.map((r) => [r.Name, r]));
    const dover = (await query(`SELECT "Id" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`, [TEST_USER.id, 'Dover, Kent, England, United Kingdom'])).rows[0] as { Id: number };
    const leaf = (await query(`SELECT "ParentId" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`, [TEST_USER.id, '67 Folkestone Road, Dover, Kent, England'])).rows[0] as { ParentId: number };
    expect(leaf.ParentId).toBe(dover.Id);
    void byName;
  });

  it('nests an already geocoded root under existing jurisdictions and keeps OSM provenance', async () => {
    const leaf = 'Lindsay, Ontario, Canada';
    await upsertPlaceGeocodeService({
      name: leaf, latitude: 44.3, longitude: -78.7,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceGeocodeService({
      name: 'Canada', latitude: 56.1, longitude: -106.3,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceHierarchyService({
      levels: [
        { name: 'Canada' },
        { name: 'Ontario' },
        { name: leaf, latitude: 44.35, longitude: -78.74,
          displayName: 'Lindsay, Ontario, Canada', osmType: 'relation', osmId: 123456 },
      ],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const detail = await getPlaceDetailService({ name: leaf, requestedOwnerId: null, currentUserId: TEST_USER.id });
    expect((detail.parents ?? []).map((parent) => parent.name)).toEqual(['Canada', 'Ontario']);
    expect(detail.latitude).toBeCloseTo(44.35);
    expect(detail.osmType).toBe('relation');
    expect(detail.osmId).toBe(123456);
    const country = await getPlaceDetailService({ name: 'Canada', requestedOwnerId: null, currentUserId: TEST_USER.id });
    expect(country.latitude).toBeCloseTo(56.1);
    expect(country.parents).toEqual([]);
  });

  it('replaces a stale parent only for an explicit re-match', async () => {
    const common = { requestedOwnerId: null, currentUserId: TEST_USER.id };
    await upsertPlaceHierarchyService({ levels: [{ name: 'Wrong country' }, { name: 'Lindsay', latitude: 44.3, longitude: -78.7 }], ...common });
    await upsertPlaceHierarchyService({ levels: [{ name: 'Canada' }, { name: 'Ontario' }, { name: 'Lindsay', latitude: 44.35, longitude: -78.74 }], ...common });
    expect((await getPlaceDetailService({ name: 'Lindsay', ...common })).parents?.map((parent) => parent.name)).toEqual(['Wrong country']);
    await upsertPlaceHierarchyService({ levels: [{ name: 'Canada' }, { name: 'Ontario' }, { name: 'Lindsay', latitude: 44.35, longitude: -78.74 }], reparent: true, ...common });
    expect((await getPlaceDetailService({ name: 'Lindsay', ...common })).parents?.map((parent) => parent.name)).toEqual(['Canada', 'Ontario']);
  });

  it('can reverse an existing chain without creating a cycle', async () => {
    const common = { requestedOwnerId: null, currentUserId: TEST_USER.id };
    await upsertPlaceHierarchyService({ levels: [{ name: 'Canada' }, { name: 'Ontario' }], ...common });
    await upsertPlaceHierarchyService({ levels: [{ name: 'Ontario' }, { name: 'Canada' }], reparent: true, ...common });
    expect((await getPlaceDetailService({ name: 'Ontario', ...common })).parents).toEqual([]);
    expect((await getPlaceDetailService({ name: 'Canada', ...common })).parents?.map((parent) => parent.name)).toEqual(['Ontario']);
  });

  it('maps an unpinned place by its geocoded descendants, else its nearest pinned ancestor (#923)', async () => {
    const common = { requestedOwnerId: null, currentUserId: TEST_USER.id };
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Canada' }, { name: 'Ontario' }, { name: 'Lindsay', latitude: 44.35, longitude: -78.74 }],
      ...common,
    });
    // An ungeocoded root with a geocoded grandchild: one marker there, no ancestor note.
    const root = await getPlaceDetailService({ name: 'Canada', ...common });
    expect(root.descendantPins?.map((p) => [p.name, p.lat, p.lng])).toEqual([['Lindsay', 44.35, -78.74]]);
    expect(root.inheritedFrom).toBeNull();

    // A geocoded ancestor and nothing below: the inherited pin still applies.
    await upsertPlaceGeocodeService({ name: 'Canada', latitude: 56.1, longitude: -106.3, ...common });
    await upsertPlaceHierarchyService({ levels: [{ name: 'Canada' }, { name: 'Manitoba' }], ...common });
    const manitoba = await getPlaceDetailService({ name: 'Manitoba', ...common });
    expect(manitoba.descendantPins).toEqual([]);
    expect(manitoba.inheritedFrom?.name).toBe('Canada');

    // A place with its own pin needs neither.
    const pinned = await getPlaceDetailService({ name: 'Canada', ...common });
    expect(pinned.descendantPins).toEqual([]);
    expect(pinned.inheritedFrom).toBeNull();
  });

  it('rejects malformed hierarchy levels before writing', async () => {
    const common = { requestedOwnerId: null, currentUserId: TEST_USER.id };
    await expect(upsertPlaceHierarchyService({ levels: [{ name: 'Canada' }, { name: 'canada' }], ...common })).rejects.toThrow(ValidationError);
    await expect(upsertPlaceHierarchyService({ levels: [{ name: 'Canada', latitude: 99, longitude: 0 }], ...common })).rejects.toThrow(ValidationError);
    await expect(upsertPlaceHierarchyService({ levels: [{ name: 'Canada', latitude: 44 }], ...common })).rejects.toThrow(ValidationError);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "Places" WHERE "UserId"=$1`, [TEST_USER.id])).rows[0]).toEqual({ n: 0 });
  });

  it('reuses an existing level by name instead of duplicating it', async () => {
    await upsertPlaceHierarchyService({
      levels: [{ name: 'United Kingdom' }, { name: 'England' }, { name: 'Kent' }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceHierarchyService({
      levels: [{ name: 'United Kingdom' }, { name: 'England' }, { name: 'Kent' }, { name: 'Folkestone, Kent, England, United Kingdom', latitude: 51.08, longitude: 1.18 }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });

    const kentRows = (await query(`SELECT "Id" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`, [TEST_USER.id, 'Kent'])).rows;
    expect(kentRows).toHaveLength(1);
    const all = (await query(`SELECT "Name" FROM "Places" WHERE "UserId" = $1`, [TEST_USER.id])).rows;
    expect(all).toHaveLength(4); // UK, England, Kent, Folkestone — not a duplicate Kent
  });

  it('updates only the leaf when re-run with a different leaf coordinate', async () => {
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Kent' }, { name: 'leafname', latitude: 1, longitude: 2 }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Kent' }, { name: 'leafname', latitude: 9, longitude: 9 }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const leaf = (await query(`SELECT "Latitude", "Longitude" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`, [TEST_USER.id, 'leafname'])).rows[0] as { Latitude: number; Longitude: number };
    expect(leaf).toEqual({ Latitude: 9, Longitude: 9 });
  });

  it('rejects an empty levels array', async () => {
    await expect(upsertPlaceHierarchyService({ levels: [], requestedOwnerId: null, currentUserId: TEST_USER.id }))
      .rejects.toThrow();
  });

  it('rejects a non-array levels payload', async () => {
    await expect(upsertPlaceHierarchyService({
      levels: {} as unknown as never, requestedOwnerId: null, currentUserId: TEST_USER.id,
    })).rejects.toThrow(ValidationError);
  });

  it('clears PinSuppressed on a level that receives a fresh coordinate in this write', async () => {
    await upsertPlaceGeocodeService({
      name: 'Suppressed Place', latitude: null, longitude: null, pinSuppressed: true,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Suppressed Place', latitude: 51.0, longitude: 1.0 }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const row = (await query(
      `SELECT "PinSuppressed" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`,
      [TEST_USER.id, 'Suppressed Place']
    )).rows[0] as { PinSuppressed: boolean };
    expect(row.PinSuppressed).toBe(false);
  });

  it('leaves a suppressed ancestor level untouched when it is only written structurally (no coordinate) in this write', async () => {
    await upsertPlaceGeocodeService({
      name: 'Kent', latitude: null, longitude: null, pinSuppressed: true,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Kent' }, { name: 'Some New Leaf', latitude: 1, longitude: 2 }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const row = (await query(
      `SELECT "PinSuppressed" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`,
      [TEST_USER.id, 'Kent']
    )).rows[0] as { PinSuppressed: boolean };
    expect(row.PinSuppressed).toBe(true);
  });

  it('writes DisplayName onto the coord-owning row only; structural ancestors stay NULL', async () => {
    await upsertPlaceHierarchyService({
      levels: [
        { name: 'United Kingdom' },
        { name: 'England' },
        { name: 'Greater London' },
        { name: 'London, Greater London, England, United Kingdom' },
        { name: 'London', latitude: 51.5074, longitude: -0.1278, displayName: 'London, England, United Kingdom' },
      ],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const rows = (await query(
      `SELECT "Name", "DisplayName" FROM "Places" WHERE "UserId" = $1`,
      [TEST_USER.id]
    )).rows as { Name: string; DisplayName: string | null }[];
    const byName = new Map(rows.map((r) => [r.Name, r.DisplayName]));
    expect(byName.get('London')).toBe('London, England, United Kingdom');
    expect(byName.get('United Kingdom')).toBeNull();
    expect(byName.get('England')).toBeNull();
    expect(byName.get('Greater London')).toBeNull();
    expect(byName.get('London, Greater London, England, United Kingdom')).toBeNull();
  });

  it('does not wipe an existing DisplayName on a later structural upsert (COALESCE)', async () => {
    await upsertPlaceHierarchyService({
      levels: [{ name: 'England', latitude: 52.35, longitude: -1.17, displayName: 'England, United Kingdom' }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    // A later write that only re-establishes England structurally (as an
    // ancestor of a new leaf), passing no displayName.
    await upsertPlaceHierarchyService({
      levels: [{ name: 'England' }, { name: 'Bristol, England', latitude: 51.45, longitude: -2.58, displayName: 'Bristol, England, United Kingdom' }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const england = (await query(
      `SELECT "DisplayName" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`,
      [TEST_USER.id, 'England']
    )).rows[0] as { DisplayName: string | null };
    expect(england.DisplayName).toBe('England, United Kingdom');
  });
});

describe.skipIf(!hasTestDatabase())('upsertPlaceGeocodeService — DisplayName preservation (Remove Pin regression)', () => {
  afterEach(async () => {
    await query(`DELETE FROM "Places" WHERE "UserId" = $1`, [TEST_USER.id]);
  });

  it('Remove Pin (no displayName, pinSuppressed) does not wipe an existing DisplayName', async () => {
    // First a real geocode establishes the canonical name.
    await upsertPlaceGeocodeService({
      name: 'Paris', latitude: 48.8566, longitude: 2.3522, displayName: 'Paris, Île-de-France, France',
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    // Then the user removes the pin — the service is called with no displayName.
    await upsertPlaceGeocodeService({
      name: 'Paris', latitude: null, longitude: null, pinSuppressed: true,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const row = (await query(
      `SELECT "DisplayName", "PinSuppressed" FROM "Places" WHERE "UserId" = $1 AND "Name" = $2`,
      [TEST_USER.id, 'Paris']
    )).rows[0] as { DisplayName: string | null; PinSuppressed: boolean };
    expect(row.DisplayName).toBe('Paris, Île-de-France, France');
    expect(row.PinSuppressed).toBe(true);
  });
});

describe.skipIf(!hasTestDatabase())('getPlacePinChainsService', () => {
  afterEach(async () => {
    await query(`DELETE FROM "Places" WHERE "UserId" = $1`, [TEST_USER.id]);
  });

  it('returns each chain root → leaf, handles multiple names, [] for unknown, surfaces flags un-applied', async () => {
    // Chain 1: leaf owns the pin (own-pin case).
    await upsertPlaceHierarchyService({
      levels: [
        { name: 'United Kingdom' },
        { name: 'England' },
        { name: 'London', latitude: 51.5074, longitude: -0.1278, displayName: 'London, England, United Kingdom' },
      ],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    // Chain 2: an inherited pin whose leaf is suppressed.
    await upsertPlaceHierarchyService({
      levels: [
        { name: 'France' },
        { name: 'Paris', latitude: 48.8566, longitude: 2.3522, displayName: 'Paris, Île-de-France, France' },
      ],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceGeocodeService({
      name: 'Paris', latitude: 48.8566, longitude: 2.3522, pinSuppressed: true,
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });

    const chains = await getPlacePinChainsService({
      names: ['London', 'Paris', 'Nowhere Land'],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });

    // Unknown name → empty (absent key).
    expect(chains['Nowhere Land']).toBeUndefined();

    // London chain: root → leaf ordering.
    const london = chains['London'];
    expect(london.map((r) => r.name)).toEqual(['United Kingdom', 'England', 'London']);
    const londonLeaf = london[london.length - 1];
    expect(londonLeaf.latitude).toBeCloseTo(51.5074, 4);
    expect(londonLeaf.displayName).toBe('London, England, United Kingdom');

    // Paris chain surfaces the suppression flag un-applied (service does not interpret it).
    const paris = chains['Paris'];
    expect(paris.map((r) => r.name)).toEqual(['France', 'Paris']);
    expect(paris[paris.length - 1].pinSuppressed).toBe(true);
  });

  it('returns {} for empty / whitespace-only name lists', async () => {
    expect(await getPlacePinChainsService({ names: [], requestedOwnerId: null, currentUserId: TEST_USER.id })).toEqual({});
    expect(await getPlacePinChainsService({ names: ['', '   '], requestedOwnerId: null, currentUserId: TEST_USER.id })).toEqual({});
  });

  it('terminates on a synthetic ParentId cycle and returns a bounded (≤ 12) number of rows', async () => {
    // Build a short chain A → B → C (C is the leaf we query by name).
    await upsertPlaceHierarchyService({
      levels: [{ name: 'CycleA' }, { name: 'CycleB' }, { name: 'CycleC', latitude: 1, longitude: 1 }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const ids = (await query(
      `SELECT "Id", "Name" FROM "Places" WHERE "UserId" = $1 AND "Name" = ANY($2)`,
      [TEST_USER.id, ['CycleA', 'CycleB', 'CycleC']]
    )).rows as { Id: number; Name: string }[];
    const byName = new Map(ids.map((r) => [r.Name, r.Id]));
    // Point the root (A) at the leaf (C): A → C → B → A → … a cycle.
    await query(
      `UPDATE "Places" SET "ParentId" = $1 WHERE "UserId" = $2 AND "Id" = $3`,
      [byName.get('CycleC'), TEST_USER.id, byName.get('CycleA')]
    );

    const chains = await getPlacePinChainsService({
      names: ['CycleC'], requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    // Must not hang; must be bounded by the depth cap (starting row + up to 12 hops).
    expect(chains['CycleC'].length).toBeLessThanOrEqual(13);
    expect(chains['CycleC'].length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasTestDatabase())('getPlaceDependentCountService', () => {
  afterEach(async () => {
    await query(`DELETE FROM "Places" WHERE "UserId" = $1`, [TEST_USER.id]);
  });

  it('counts places that inherit their pin from the named place', async () => {
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Kent', latitude: 51.2, longitude: 0.9 }, { name: 'leaf-a' }, ],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    await upsertPlaceHierarchyService({
      levels: [{ name: 'Kent' }, { name: 'leaf-b' }],
      requestedOwnerId: null, currentUserId: TEST_USER.id,
    });
    const count = await getPlaceDependentCountService({ name: 'Kent', requestedOwnerId: null, currentUserId: TEST_USER.id });
    expect(count).toBe(2);
  });

  it('returns 0 for a place with no dependents, or one that does not exist yet', async () => {
    expect(await getPlaceDependentCountService({ name: 'leaf-a', requestedOwnerId: null, currentUserId: TEST_USER.id })).toBe(0);
    expect(await getPlaceDependentCountService({ name: 'Not Saved Yet', requestedOwnerId: null, currentUserId: TEST_USER.id })).toBe(0);
  });
});
