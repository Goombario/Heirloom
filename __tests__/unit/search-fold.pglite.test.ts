import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb, dumpDatabaseLogical, logicalToDatadir } from '@/lib/db/connection.pglite';
import { initializeSchema } from '@/lib/db/init-schema';
import { foldForSearch } from '@/lib/utils/search-fold';
import { likeContains } from '@/lib/db/queries/like-pattern';
import { searchFamilies, suggestFamiliesForPerson } from '@/lib/db/queries/families';
import { searchSources } from '@/lib/db/queries/sources';
import { getAllCases } from '@/lib/db/queries/cases';
import { getAuditLog } from '@/lib/db/queries/audit';

/**
 * #792 (task audit FR-4) on PGlite, which backs the static and desktop builds.
 * The hosted twin is __tests__/integration/api/search-fold.test.ts.
 */
let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

const names = (rows: { FirstName: string | null; LastName: string | null }[]) =>
  rows.map(p => `${p.FirstName} ${p.LastName}`).sort();

describe('accent- and ё-insensitive search on PGlite (#792)', () => {
  it('finds Étienne Lefèvre and Ксения Белозёрова from unaccented and е queries', async () => {
    const client = new LocalDataClient();
    const etienne = await client.people.create({ FirstName: 'Étienne', LastName: 'Lefèvre' });
    await client.people.create({ FirstName: 'Ксения', LastName: 'Белозёрова' });
    await client.people.createNameVariant(etienne.Id, { Type: 'Alias', Name: 'Père Brûlé' });

    expect(names(await client.people.search('Etienne'))).toEqual(['Étienne Lefèvre']);
    expect(names(await client.people.search('lefevre'))).toEqual(['Étienne Lefèvre']);
    expect(names(await client.people.search('Étienne'))).toEqual(['Étienne Lefèvre']);
    expect(names(await client.people.search('Белозерова'))).toEqual(['Ксения Белозёрова']);
    expect(names(await client.people.search('КСЕНИЯ белозерова'))).toEqual(['Ксения Белозёрова']);
    expect(names(await client.people.search('pere brule'))).toEqual(['Étienne Lefèvre']);
  });

  it('matches the birthplace only when asked, folded like a name (#1128)', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Sigrid', LastName: 'Moe', BirthPlace: 'Trøndelag, Växjö' });
    expect(await client.people.search('vaxjo')).toEqual([]);
    const hit = await client.people.search('vaxjo', null, 10, { places: true });
    expect(names(hit)).toEqual(['Sigrid Moe']);
    expect(hit[0].BirthPlace).toBe('Trøndelag, Växjö');
    expect(names(await client.people.search('sigrid vaxjo', null, 10, { places: true }))).toEqual(['Sigrid Moe']);
  });

  it('backfills the folded column for rows written before the migration', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Jérôme', LastName: 'Val-Brûlé' });
    await db.exec(`ALTER TABLE "People" DROP COLUMN "SearchName"; ALTER TABLE "NameVariant" DROP COLUMN "SearchName";`);
    await db.exec(`DROP FUNCTION "SearchFold"(text)`);

    await initializeSchema({ query: (text, params) => db.query(text, params as unknown[]) });

    const row = await db.query<{ SearchName: string }>(`SELECT "SearchName" FROM "People" WHERE "Id" = $1`, [person.Id]);
    expect(row.rows[0].SearchName).toBe('jerome val-brule');
    expect(names(await client.people.search('val-brule'))).toEqual(['Jérôme Val-Brûlé']);
  });

  it('refills the folded column when a backup is restored', async () => {
    const container = await dumpDatabaseLogical();
    const restored = await PGlite.create({ loadDataDir: await logicalToDatadir(container) });
    try {
      const row = await restored.query<{ SearchName: string }>(
        `SELECT "SearchName" FROM "People" WHERE "LastName" = 'Белозёрова'`,
      );
      expect(row.rows[0].SearchName).toBe('ксения белозерова');
      const variant = await restored.query<{ SearchName: string }>(`SELECT "SearchName" FROM "NameVariant" WHERE "Name" = 'Père Brûlé'`);
      expect(variant.rows[0].SearchName).toBe('pere brule');
    } finally {
      await restored.close();
    }
  });

  it('folds in the browser exactly as the database does', async () => {
    for (const text of ['Étienne Lefèvre', 'Ксения Белозёрова', 'ЁЛКА Йошкар-Ола', 'Val-Brûlé', 'Søren Œuvre']) {
      const sql = await db.query<{ f: string }>(`SELECT "SearchFold"($1) AS f`, [text]);
      expect(foldForSearch(text)).toBe(sql.rows[0].f);
    }
  });
});

describe('a literal % or _ in a search matches only itself on PGlite (#849)', () => {
  it('escapes LIKE wildcards in the contains pattern', async () => {
    const matches = async (value: string, term: string) =>
      (await db.query<{ m: boolean }>(`SELECT $1 LIKE ${likeContains('$2')} AS m`, [value, term])).rows[0].m;
    expect(await matches('Anne_Marie', '_')).toBe(true);
    expect(await matches('Anne Marie', '_')).toBe(false);
    expect(await matches('100% Smith', '100%')).toBe(true);
    expect(await matches('1000 Smith', '100%')).toBe(false);
    expect(await matches('C:\\path', '\\')).toBe(true);
    expect(await matches('Cpath', '\\')).toBe(false);
    expect(await matches('Étienne', 'tien')).toBe(true);
  });

  it('keeps person, family, source, case and audit search literal', async () => {
    const client = new LocalDataClient();
    const under = await client.people.create({ FirstName: 'Anne_Marie', LastName: 'Du%Pont' });
    const plain = await client.people.create({ FirstName: 'Annemarie', LastName: 'Dupont' });
    const treeId = (await query(`SELECT "TreeId" FROM "People" WHERE "Id" = $1`, [under.Id])).rows[0] as { TreeId: number };
    const tid = treeId.TreeId;

    expect(names(await client.people.search('_'))).toEqual(['Anne_Marie Du%Pont']);
    expect(names(await client.people.search('%'))).toEqual(['Anne_Marie Du%Pont']);
    expect(names(await client.people.search('Etienne'))).toEqual(['Étienne Lefèvre']);
    expect(names(await client.people.search('Белозерова'))).toEqual(['Ксения Белозёрова']);

    await query(`INSERT INTO "Families" ("Partner1Id", "TreeId") VALUES ($1, $3), ($2, $3)`, [under.Id, plain.Id, tid]);
    expect((await searchFamilies('_', tid)).map(f => f.Partner1Id)).toEqual([under.Id]);
    expect((await suggestFamiliesForPerson(tid, 'Du%')).length).toBe(1);

    await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('Parish_register', $1), ('Parish register', $1)`, [tid]);
    expect((await searchSources(tid, '_')).map(s => s.Title)).toEqual(['Parish_register']);

    const owner = (await query(`SELECT "OwnerId" FROM "Trees" WHERE "Id" = $1`, [tid])).rows[0] as { OwnerId: number };
    await query(`INSERT INTO "Cases" ("UserId", "Title", "TreeId") VALUES ($1, '100% sure', $2), ($1, '1000 leads', $2)`, [owner.OwnerId, tid]);
    expect((await getAllCases(tid, { search: '100%' })).map(c => c.Title)).toEqual(['100% sure']);

    const { entries } = await getAuditLog(tid, { search: '_', page: 1, pageSize: 50 });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(e => e.EntityLabel?.includes('_'))).toBe(true);
  });
});
