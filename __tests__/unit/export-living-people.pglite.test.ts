import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb, dumpDatabaseLogical, logicalToDatadir } from '@/lib/db/connection.pglite';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { getPersonService } from '@/lib/services/people';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { readBundle } from '../setup/gedcom-bundle';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';
import { insertRecord } from '../setup/fact-places';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #866: what each export surface carries about someone marked living. ADR 0002:
// an export is a full-fidelity copy, so a living person goes out in full, marked
// `1 _LIVING Y`. There is no redacted export; that is a product question, not a
// defect. These tests pin today's behaviour per surface, so any future
// redaction (or accidental leak of a new field) shows up as a deliberate change.

const OWNER = 866001;
const VIEWER = 866002;

let db: PGlite;
let treeId: number;
let livingId: number;

/** The `0 @Xn@ INDI` record for a person, as lines. */
function indiRecord(ged: string, firstName: string): string[] {
  const records = ged.split(/\r?\n(?=0 )/);
  const record = records.find((r) => r.includes(`1 NAME ${firstName} `));
  if (!record) throw new Error(`no INDI for ${firstName}`);
  return record.split(/\r?\n/);
}

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await query(
    'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3), ($4, $5, $6)',
    [OWNER, 'living-owner@test.local', 'living-owner', VIEWER, 'living-viewer@test.local', 'living-viewer'],
  );
  treeId = await resolveDefaultTree(OWNER);
  const person = async (first: string, isDeceased: number | null, death: string | null) => {
    const row = await insertRecord({ query }, 'People', {
      UserId: OWNER, TreeId: treeId, FirstName: first, LastName: 'Example', Sex: 'F',
      BirthDate: '1990-05-06', BirthPlace: 'Lyon', IsDeceased: isDeceased, DeathDate: death,
    });
    return row.Id;
  };
  livingId = await person('Lena', 0, null);
  await person('Dora', 1, '1980-01-02');
  await person('Una', null, null);
  await query(
    `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name") VALUES ($1, $2, $3, 'Maiden', 'Lena Former')`,
    [OWNER, treeId, livingId],
  );
  const caseRow = await query(
    `INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Where was Lena in 2010?') RETURNING "Id"`,
    [OWNER, treeId],
  );
  await query('INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ($1, $2)', [caseRow.rows[0].Id, livingId]);
  await query(
    `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`,
    [OWNER, VIEWER, treeId],
  );
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('living people on each export surface (#866, ADR 0002)', () => {
  it('GEDCOM: a living person goes out in full, marked _LIVING Y, with no DEAT', async () => {
    const result = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: OWNER, includeMedia: false });
    if (result.kind !== 'ged') throw new Error(result.kind);
    const lena = indiRecord(result.content, 'Lena');
    expect(lena).toEqual(expect.arrayContaining(['1 _LIVING Y', '1 BIRT', '2 DATE 6 MAY 1990', '2 PLAC Lyon', '1 NAME Lena Former', '2 TYPE maiden']));
    expect(lena.some((line) => line.startsWith('1 DEAT'))).toBe(false);
    // Deceased: DEAT, never _LIVING. Unknown: neither marker.
    const dora = indiRecord(result.content, 'Dora');
    expect(dora).toContain('1 DEAT');
    expect(dora).not.toContain('1 _LIVING Y');
    const una = indiRecord(result.content, 'Una');
    expect(una.filter((line) => line === '1 _LIVING Y' || line.startsWith('1 DEAT'))).toEqual([]);
  });

  it('bundle sidecars: name variants and case links name the living person', async () => {
    const result = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: OWNER, includeMedia: true });
    if (result.kind !== 'zip') throw new Error(result.kind);
    const bundle = await readBundle(result.buffer);
    const lenaXref = indiRecord(bundle.ged, 'Lena')[0].split(' ')[1];
    expect(bundle.sources.nameVariants).toContainEqual(expect.objectContaining({ person: lenaXref, type: 'Maiden', name: 'Lena Former' }));
    expect(bundle.cases.cases).toContainEqual(expect.objectContaining({ linkedPersonGedcomIds: [lenaXref] }));
  });

  it('shared view: a view-only share reads the living person in full', async () => {
    const asViewer = await getPersonService({ id: livingId, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: VIEWER });
    const asOwner = await getPersonService({ id: livingId, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: OWNER });
    expect(asViewer).toMatchObject({ FirstName: 'Lena', BirthDate: '1990-05-06', BirthPlace: 'Lyon', IsDeceased: 0 });
    expect(asViewer).toEqual(asOwner);
  });

  it('backup: the logical backup restores the living person unchanged', async () => {
    const container = await dumpDatabaseLogical();
    const restored = await PGlite.create({ loadDataDir: await logicalToDatadir(container) });
    try {
      const row = await restored.query(
        `SELECT p."FirstName", p."BirthDate", ${factPlaceTextColumns('people', 'p')}, p."IsDeceased" FROM "People" p WHERE p."Id" = $1`,
        [livingId],
      );
      expect(row.rows).toEqual([{ FirstName: 'Lena', BirthDate: '1990-05-06', BirthPlace: 'Lyon', DeathPlace: null, IsDeceased: 0 }]);
    } finally {
      await restored.close();
    }
  });
});
