import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

const holder = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('@/lib/db/connection', () => ({
  query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
  getClient: () => { throw new Error('not used by listPlacesService'); },
  closePool: async () => {},
}));

import { listPlacesService } from '@/lib/services/places';
import { insertRecord } from '../setup/fact-places';
const USER = 1;

describe('listPlacesService hierarchy fields on PGlite', () => {
  beforeAll(async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (${USER},'a@b.c','g1')`);
    // Multi-tree: reads are TreeId-scoped now. Seed a Trees row whose Id mirrors
    // the owner id so the raw seeds below can stamp TreeId = USER, and
    // resolveDefaultTree (called with requestedTreeId: null) picks this row
    // (lowest Id per owner) as the caller's default tree.
    await db.query(`INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES (${USER},${USER},'My Tree')`);
    holder.db = db;
  });
  afterEach(async () => {
    await holder.db!.query(`DELETE FROM "People" WHERE "UserId" = ${USER}`);
    await holder.db!.query(`DELETE FROM "Places" WHERE "UserId" = ${USER}`);
  });

  it('returns id/parentId on fact places and a gazetteer including a 0-fact parent', async () => {
    const db = holder.db!;
    // England is a pure grouping parent (no person's BirthPlace is exactly "England").
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name") VALUES (100,${USER},${USER},'England')`);
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId","Latitude","Longitude") VALUES (101,${USER},${USER},'Dover, Kent, England',100,51.1,1.3)`);
    await insertRecord(db, 'People', { UserId: USER, TreeId: USER, FirstName: 'Ed', BirthPlace: 'Dover, Kent, England' });

    const { places, gazetteer } = await listPlacesService({ requestedOwnerId: null, currentUserId: USER });

    const dover = places.find((p) => p.name === 'Dover, Kent, England');
    expect(dover?.id).toBe(101);
    expect(dover?.parentId).toBe(100);
    // England has 0 facts so it is absent from `places` but present in the skeleton:
    expect(places.some((p) => p.name === 'England')).toBe(false);
    expect(gazetteer.find((g) => g.name === 'England')).toMatchObject({ id: 100, parentId: null });
    expect(gazetteer.find((g) => g.name === 'Dover, Kent, England')).toMatchObject({ id: 101, parentId: 100 });
  });
});
