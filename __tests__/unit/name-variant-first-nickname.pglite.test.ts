import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

async function defaultTreeId(): Promise<number> {
  await query(
    `INSERT INTO "Users" ("Id","Email","Name","GoogleId") VALUES (1,'local@web','Local User','local-web')
     ON CONFLICT ("Id") DO NOTHING`,
    [],
  );
  const existing = await query(`SELECT "Id" FROM "Trees" WHERE "OwnerId" = 1 ORDER BY "Id" LIMIT 1`, []);
  if (existing.rows[0]) return (existing.rows[0] as { Id: number }).Id;
  const created = await query(`INSERT INTO "Trees" ("OwnerId","Name") VALUES (1,'My Tree') RETURNING "Id"`, []);
  return (created.rows[0] as { Id: number }).Id;
}

async function seedPerson(id: number) {
  await query(
    `INSERT INTO "People" ("Id","UserId","TreeId","FirstName","LastName") VALUES ($1, 1, $2, 'William', 'Hartley')`,
    [id, await defaultTreeId()],
  );
}

/**
 * #436 — adding a person's first nickname must make it their preferred name, so
 * the add is visible somewhere. ADR 0001 fixes this on the WRITE path (set the
 * flag), never by relaxing the `IsPrimary` display rule.
 */
describe('createNameVariant first-nickname promotion (PGlite)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(mdb); __resetLocalUserCache(); await query('SELECT 1'); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('promotes a first nickname to the preferred name', async () => {
    const client = new LocalDataClient();
    await seedPerson(10);
    const created = await client.people.createNameVariant(10, { Type: 'Nickname', Name: 'Bill' });
    expect(created.IsPrimary).toBe(1);
  });

  it('leaves an existing preferred name alone when a second nickname is added', async () => {
    const client = new LocalDataClient();
    await seedPerson(11);
    const first = await client.people.createNameVariant(11, { Type: 'Nickname', Name: 'Bill' });
    const second = await client.people.createNameVariant(11, { Type: 'Nickname', Name: 'Billy' });
    expect(first.IsPrimary).toBe(1);
    expect(second.IsPrimary).toBe(0);

    const rows = await client.people.listNameVariants(11);
    expect(rows.filter((v) => v.IsPrimary).map((v) => v.Name)).toEqual(['Bill']);
  });

  it('does not promote a non-nickname variant', async () => {
    const client = new LocalDataClient();
    await seedPerson(12);
    const maiden = await client.people.createNameVariant(12, { Type: 'Maiden', Name: 'Ashby' });
    expect(maiden.IsPrimary).toBe(0);
  });

  it('does not override a preferred name the user set on another variant type', async () => {
    const client = new LocalDataClient();
    await seedPerson(13);
    const maiden = await client.people.createNameVariant(13, { Type: 'Maiden', Name: 'Ashby' });
    await client.people.setPrimaryNameVariant(13, maiden.Id, true);

    const nick = await client.people.createNameVariant(13, { Type: 'Nickname', Name: 'Bill' });
    expect(nick.IsPrimary).toBe(0);

    const rows = await client.people.listNameVariants(13);
    expect(rows.filter((v) => v.IsPrimary).map((v) => v.Name)).toEqual(['Ashby']);
  });
});
