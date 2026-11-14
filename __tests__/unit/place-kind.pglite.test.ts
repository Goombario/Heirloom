import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getPlaceDetailService } from '@/lib/services/places';

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
});
