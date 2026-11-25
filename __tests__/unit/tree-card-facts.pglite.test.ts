import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

const holder = vi.hoisted(() => ({ db: null as PGlite | null, treeId: 0 }));

vi.mock('@/lib/db/connection', () => ({
  query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
  getClient: async () => ({
    query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
    release: () => {},
  }),
  closePool: async () => {},
}));
vi.mock('@/lib/db/queries/trees', async (orig) => ({
  ...(await orig<typeof import('@/lib/db/queries/trees')>()),
  resolveTreeScope: async () => ({ treeId: holder.treeId, ownerId: 1, role: 'owner' }),
}));

import { getTreeService, townOf } from '@/lib/services/tree';

let db: PGlite;
const ids: Record<string, number> = {};

beforeAll(async () => {
  db = await newEmptyClusterDb();
  holder.db = db;
  await initializeSchema(db as unknown as DbExecutor);
  await db.query(`INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (1,'u1@test.local','g-1') ON CONFLICT DO NOTHING`);
  holder.treeId = (await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId","Name") VALUES (1,'t') RETURNING "Id"`)).rows[0].Id;
  const place = async (name: string) =>
    (await db.query<{ Id: number }>(`INSERT INTO "Places" ("UserId","TreeId","Name") VALUES (1,$1,$2) RETURNING "Id"`, [holder.treeId, name])).rows[0].Id;
  const lviv = await place('Lviv, Lviv Oblast, Ukraine');
  const krakow = await place('Kraków, Poland');
  const toronto = await place('Toronto, Ontario, Canada');
  const person = async (name: string, birthPlaceId: number | null) =>
    (await db.query<{ Id: number }>(
      `INSERT INTO "People" ("UserId","TreeId","FirstName","LastName","BirthPlaceId") VALUES (1,$1,$2,'X',$3) RETURNING "Id"`,
      [holder.treeId, name, birthPlaceId],
    )).rows[0].Id;
  ids.Ada = await person('Ada', lviv);
  ids.Ben = await person('Ben', null);
  const event = (pid: number, type: string, date: string | null, description: string | null, placeId: number | null) =>
    db.query(`INSERT INTO "Events" ("UserId","TreeId","PersonId","Type","Date","Description","PlaceId") VALUES (1,$1,$2,$3,$4,$5,$6)`,
      [holder.treeId, pid, type, date, description, placeId]);
  await event(ids.Ada, 'OCCU', '1890', 'Seamstress', null);
  await event(ids.Ada, 'OCCU', '1910', 'Shopkeeper', null);
  await event(ids.Ada, 'OCCU', null, 'Undated job', null);
  await event(ids.Ada, 'RESI', '1900', null, krakow);
  await event(ids.Ada, 'RESI', '1920', null, toronto);
  await event(ids.Ada, 'RESI', '1930', null, null);
  const fam = (await db.query<{ Id: number }>(`INSERT INTO "Families" ("UserId","TreeId","Partner1Id") VALUES (1,$1,$2) RETURNING "Id"`, [holder.treeId, ids.Ada])).rows[0].Id;
  await db.query(`INSERT INTO "FamilyPerson" VALUES ($1,$2)`, [fam, ids.Ben]);
});

// #12: the facts the card's line under the name can show.
describe('tree card facts', () => {
  it('gives the latest occupation, the town of the latest residence with a place, and the birth town', async () => {
    const data = await getTreeService({ id: ids.Ada, mode: 'descendants', requestedTreeId: null, requestedOwnerId: null, currentUserId: 1 });
    expect(data.cardFacts?.[ids.Ada]).toEqual({ occupation: 'Shopkeeper', residence: 'Toronto', birthplace: 'Lviv' });
  });

  it('leaves out a person with no facts', async () => {
    const data = await getTreeService({ id: ids.Ada, mode: 'descendants', requestedTreeId: null, requestedOwnerId: null, currentUserId: 1 });
    expect(data.cardFacts?.[ids.Ben]).toBeUndefined();
  });

  it('takes the town as the first part of a place name', () => {
    expect(townOf('Lviv, Lviv Oblast, Ukraine')).toBe('Lviv');
    expect(townOf('  Paris ')).toBe('Paris');
    expect(townOf(', France')).toBeUndefined();
    expect(townOf(null)).toBeUndefined();
  });
});
