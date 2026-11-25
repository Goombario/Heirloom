import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { updatePersonService } from '@/lib/services/people';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { initializeSchema } from '@/lib/db/init-schema';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #37 (ADR 0053): NPFX, SPFX and NSFX become person fields on import, export writes
// them from there (so an edit wins), and the boot that adds the columns lifts the
// ones already kept as passthrough.

const USER_ID = 3737;
const GED = [
  '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME Dr Johann /von Habsburg/ PhD',
  '2 NPFX Dr', '2 GIVN Johann', '2 SPFX von', '2 SURN Habsburg', '2 NSFX PhD', '2 TYPE birth',
  '0 @I2@ INDI', '1 NAME Ada /Example/',
  '0 TRLR',
].join('\n');

let db: PGlite;
let treeId: number;

const person = async (first: string) => (await query(
  `SELECT "FirstName", "LastName", "NamePrefix", "SurnamePrefix", "NameSuffix", "NameRawGedcom", "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = $2`,
  [treeId, first],
)).rows[0] as Record<string, unknown> & { Id: number };

async function exported() {
  const out = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: false });
  if (out.kind !== 'ged') throw new Error(`expected a .ged, got ${out.kind}`);
  return out.content.split(/\r?\n/);
}
const load = (text: string) => importGedcomService({ file: new File([text], 'tree.ged'), mode: 'overwrite', currentUserId: USER_ID });
const nameBlock = (lines: string[], first: string) => {
  const i = lines.findIndex((l) => l.startsWith('1 NAME ') && l.includes(first));
  const out = [lines[i]];
  for (let k = i + 1; k < lines.length && /^[2-9] /.test(lines[k]); k++) out.push(lines[k]);
  return out;
};

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'parts@test.local', 'name-parts']);
  treeId = await resolveDefaultTree(USER_ID);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('name parts in GEDCOM (#37)', () => {
  it('imports the pieces as fields and keeps the name short', async () => {
    await load(GED);
    expect(await person('Johann')).toMatchObject({
      FirstName: 'Johann', LastName: 'Habsburg', NamePrefix: 'Dr', SurnamePrefix: 'von', NameSuffix: 'PhD', NameRawGedcom: '2 TYPE birth',
    });
  });

  it('exports them once, and a re-import is the same state', async () => {
    await load(GED);
    const block = nameBlock(await exported(), 'Johann');
    expect(block).toEqual([
      '1 NAME Dr Johann /von Habsburg/ PhD', '2 NPFX Dr', '2 GIVN Johann', '2 SPFX von', '2 SURN Habsburg', '2 NSFX PhD', '2 TYPE birth',
    ]);
    expect(nameBlock(await exported(), 'Ada')).toEqual(['1 NAME Ada /Example/', '2 GIVN Ada', '2 SURN Example']);
    await load((await exported()).join('\n'));
    expect(await person('Johann')).toMatchObject({ FirstName: 'Johann', LastName: 'Habsburg', NamePrefix: 'Dr', SurnamePrefix: 'von', NameSuffix: 'PhD' });
  });

  it('exports an edit, not the imported value', async () => {
    await load(GED);
    const { Id } = await person('Johann');
    await updatePersonService({ id: Id, body: { NamePrefix: 'Prof.', NameSuffix: null }, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });
    const block = nameBlock(await exported(), 'Johann');
    expect(block.slice(0, 2)).toEqual(['1 NAME Prof. Johann /von Habsburg/', '2 NPFX Prof.']);
    expect(block.some((l) => l.includes('NSFX'))).toBe(false);
  });

  it('lifts passthrough kept before v76 on the next boot, once', async () => {
    await load(GED);
    await query(
      `UPDATE "People" SET "NamePrefix" = NULL, "SurnamePrefix" = NULL, "NameSuffix" = NULL,
         "FirstName" = 'Dr Johann', "LastName" = 'von Habsburg', "NameRawGedcom" = $2 WHERE "TreeId" = $1 AND "FirstName" = 'Johann'`,
      [treeId, '2 NPFX Dr\n2 SPFX von\n2 NSFX PhD\n2 TYPE birth'],
    );
    await query(`COMMENT ON COLUMN "People"."NamePrefix" IS NULL`);
    await initializeSchema({ query: (text, params) => db.query(text, params) });
    expect(await person('Johann')).toMatchObject({
      FirstName: 'Johann', LastName: 'Habsburg', NamePrefix: 'Dr', SurnamePrefix: 'von', NameSuffix: 'PhD', NameRawGedcom: '2 TYPE birth',
    });
    // Cleared by hand afterwards: a later boot leaves it cleared.
    await query(`UPDATE "People" SET "NamePrefix" = NULL WHERE "TreeId" = $1 AND "FirstName" = 'Johann'`, [treeId]);
    await initializeSchema({ query: (text, params) => db.query(text, params) });
    expect((await person('Johann')).NamePrefix).toBeNull();
  });
});
