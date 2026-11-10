import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** The services resolve user 1's default (lowest-Id) tree; seeded rows must
 *  carry that TreeId or the events in-tree FK guard correctly rejects them.
 *  Seeds the local user first (same identity local-user.ts provisions) so the
 *  Trees.OwnerId FK holds after truncateAllTables. */
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
    `INSERT INTO "People" ("Id","UserId","TreeId","FirstName","LastName") VALUES ($1, 1, $2, 'Test', 'Person')`,
    [id, await defaultTreeId()],
  );
}

describe('LocalEventsClient update / remove (PGlite)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(mdb); __resetLocalUserCache(); await query('SELECT 1'); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('update mutates the event fields and writes an audit entry', async () => {
    const client = new LocalDataClient();
    await seedPerson(10);
    const ev = await client.events.create({
      Type: 'OCCU', Date: '1911', Place: 'Deptford', Description: 'Shipwright', PersonId: 10,
    });

    const updated = await client.events.update(ev.Id, { Place: 'Greenwich', Description: 'Foreman' });
    expect(updated.Place).toBe('Greenwich');
    expect(updated.Description).toBe('Foreman');
    expect(updated.Type).toBe('OCCU'); // untouched fields preserved

    const audit = await query(
      `SELECT 1 FROM "AuditLog" WHERE "EntityType" = 'event' AND "Action" = 'update'`, [],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('remove deletes the event and writes an audit entry', async () => {
    const client = new LocalDataClient();
    await seedPerson(11);
    const ev = await client.events.create({
      Type: 'RESI', Date: '1920', Place: 'London', Description: null, PersonId: 11,
    });

    await client.events.remove(ev.Id);

    const rows = await query(`SELECT "Id" FROM "Events" WHERE "Id" = $1`, [ev.Id]);
    expect(rows.rows).toHaveLength(0);

    const audit = await query(
      `SELECT 1 FROM "AuditLog" WHERE "EntityType" = 'event' AND "Action" = 'delete'`, [],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('a family event (FamilyId) updates and deletes', async () => {
    const client = new LocalDataClient();
    await query(`INSERT INTO "Families" ("Id","UserId","TreeId") VALUES (100, 1, $1)`, [await defaultTreeId()]);

    const ev = await client.events.create({ Type: 'DIV', Date: '1984', Place: 'Glasgow', Description: null, FamilyId: 100 });
    expect(ev.FamilyId).toBe(100);

    const updated = await client.events.update(ev.Id, { Date: '1985' });
    expect(updated.Date).toBe('1985');
    expect(updated.Type).toBe('DIV');

    await client.events.remove(ev.Id);
    const rows = await query(`SELECT "Id" FROM "Events" WHERE "Id" = $1`, [ev.Id]);
    expect(rows.rows).toHaveLength(0);
  });
});
