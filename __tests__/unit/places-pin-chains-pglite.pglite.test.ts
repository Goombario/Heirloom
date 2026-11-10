import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

/**
 * `getPlacePinChainsService` on PGlite.
 *
 * The recursive ParentId walk is exercised against real PostgreSQL in
 * `__tests__/integration/places-geocode.test.ts`, but the local/offline build
 * (Cloudflare + Tauri) runs this exact service in-browser against PGlite via
 * `LocalPlacesClient.pinChains`. PGlite is PostgreSQL compiled to WASM, so
 * `WITH RECURSIVE` is expected to behave identically — this file proves it,
 * per the design spec's §7 risk 1 ("must run identically on PostgreSQL and
 * PGlite") and §8 ("Run against PGlite as well as PostgreSQL").
 */

const holder = vi.hoisted(() => ({ db: null as PGlite | null }));

// Route the service's global query() at our in-memory PGlite instance.
vi.mock('@/lib/db/connection', () => ({
  query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
  getClient: () => { throw new Error('not used by getPlacePinChainsService'); },
  closePool: async () => {},
}));

import { getPlacePinChainsService } from '@/lib/services/places';

const USER = 1;

async function seedChain(db: PGlite) {
  // United Kingdom → England → Kent → Dover(coords) → 67 Folkestone Road(leaf, no coords)
  await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name") VALUES (10,${USER},${USER},'United Kingdom')`);
  await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId") VALUES (11,${USER},${USER},'England',10)`);
  await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId") VALUES (12,${USER},${USER},'Kent',11)`);
  await db.query(
    `INSERT INTO "Places" ("Id","UserId","TreeId","Name","Latitude","Longitude","DisplayName","ParentId")
     VALUES (13,${USER},${USER},'Dover, Kent, England, United Kingdom',51.1048,1.2416,'Dover, England, United Kingdom',12)`
  );
  await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId") VALUES (14,${USER},${USER},'67 Folkestone Road, Dover, Kent, England',13)`);
}

describe('getPlacePinChainsService on PGlite', () => {
  beforeAll(async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (${USER},'a@b.c','g1')`);
    // Multi-tree: reads are TreeId-scoped now. Seed a Trees row whose Id mirrors
    // the owner id so seedChain()'s raw inserts can stamp TreeId = USER, and
    // resolveDefaultTree (called with requestedTreeId: null) picks this row
    // (lowest Id per owner) as the caller's default tree.
    await db.query(`INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES (${USER},${USER},'My Tree')`);
    holder.db = db;
  });

  afterEach(async () => {
    await holder.db!.query(`DELETE FROM "Places" WHERE "UserId" = ${USER}`);
  });

  it('walks ParentId and returns the chain root → leaf', async () => {
    await seedChain(holder.db!);
    const chains = await getPlacePinChainsService({
      names: ['67 Folkestone Road, Dover, Kent, England'],
      requestedOwnerId: null,
      currentUserId: USER,
    });

    const chain = chains['67 Folkestone Road, Dover, Kent, England'];
    expect(chain.map((r) => r.name)).toEqual([
      'United Kingdom',
      'England',
      'Kent',
      'Dover, Kent, England, United Kingdom',
      '67 Folkestone Road, Dover, Kent, England',
    ]);
    // Raw rows: the coord-owning ancestor keeps its canonical DisplayName, the
    // leaf is structural. Suppression/pin-picking is resolvePin's job, not the query's.
    expect(chain[3]).toMatchObject({ latitude: 51.1048, displayName: 'Dover, England, United Kingdom' });
    expect(chain[4]).toMatchObject({ latitude: null, displayName: null });
  });

  it('resolves several names in one call and omits an unknown name', async () => {
    await seedChain(holder.db!);
    const chains = await getPlacePinChainsService({
      names: ['Kent', 'Nowhere Real'],
      requestedOwnerId: null,
      currentUserId: USER,
    });
    expect(chains['Kent'].map((r) => r.name)).toEqual(['United Kingdom', 'England', 'Kent']);
    expect(chains['Nowhere Real']).toBeUndefined();
  });

  it('surfaces PinSuppressed un-applied, leaving interpretation to resolvePin', async () => {
    await seedChain(holder.db!);
    await holder.db!.query(`UPDATE "Places" SET "PinSuppressed" = TRUE WHERE "Id" = 13`);
    const chains = await getPlacePinChainsService({
      names: ['67 Folkestone Road, Dover, Kent, England'],
      requestedOwnerId: null,
      currentUserId: USER,
    });
    const dover = chains['67 Folkestone Road, Dover, Kent, England'].find((r) => r.name.startsWith('Dover'));
    expect(dover!.pinSuppressed).toBe(true);
    expect(dover!.latitude).toBe(51.1048); // still returned; the walk-up decides, not the query
  });

  it('terminates on a ParentId cycle instead of hanging', async () => {
    await seedChain(holder.db!);
    await holder.db!.query(`UPDATE "Places" SET "ParentId" = 14 WHERE "Id" = 10`); // UK → leaf: cycle
    const chains = await getPlacePinChainsService({
      names: ['67 Folkestone Road, Dover, Kent, England'],
      requestedOwnerId: null,
      currentUserId: USER,
    });
    expect(chains['67 Folkestone Road, Dover, Kent, England'].length).toBeLessThanOrEqual(13); // depth < 12 cap
  });

  it('never returns another user\'s ancestor rows', async () => {
    await seedChain(holder.db!);
    await holder.db!.query(`INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (2,'x@y.z','g2')`);
    await holder.db!.query(`INSERT INTO "Places" ("Id","UserId","Name") VALUES (20,2,'Other Root')`);
    await holder.db!.query(`UPDATE "Places" SET "ParentId" = 20 WHERE "Id" = 10`); // UK's parent belongs to user 2

    const chains = await getPlacePinChainsService({
      names: ['67 Folkestone Road, Dover, Kent, England'],
      requestedOwnerId: null,
      currentUserId: USER,
    });
    const names = chains['67 Folkestone Road, Dover, Kent, England'].map((r) => r.name);
    expect(names).not.toContain('Other Root');
    expect(names[0]).toBe('United Kingdom'); // walk stops at the ownership boundary
  });
});
