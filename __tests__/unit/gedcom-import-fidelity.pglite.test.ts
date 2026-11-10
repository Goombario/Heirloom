import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { addChildToFamily, updateChildRelationshipType, updateFamily } from '@/lib/db/queries/families';
import { updateRepository } from '@/lib/db/queries/repositories';
import { revertAuditEntry } from '@/lib/db/queries/audit';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Import fidelity defects from the 2026-09 data audit (#870, phase 2). Each block
// imports the audit's reproduction through the real service into PGlite.

const USER_ID = 870200;

const ged = (text: string) => new File([text], 'tree.ged', { type: 'text/plain' });

let db: PGlite;
let treeId: number;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await query(
    'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
    [USER_ID, 'import-fidelity@test.local', 'import-fidelity'],
  );
  treeId = await resolveDefaultTree(USER_ID);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

async function names() {
  const people = await query(
    `SELECT "Id", "FirstName", "LastName" FROM "People" WHERE "TreeId" = $1 ORDER BY "Id"`,
    [treeId],
  );
  const variants = await query(
    `SELECT v."Type", v."Name",
            (SELECT COUNT(*)::int FROM "Citation" c WHERE c."FactTable" = 'NameVariant' AND c."FactId" = v."Id") AS "Citations"
       FROM "NameVariant" v WHERE v."TreeId" = $1 ORDER BY v."Id"`,
    [treeId],
  );
  return { people: people.rows as Array<{ FirstName: string; LastName: string }>, variants: variants.rows };
}

async function exportGed(): Promise<string> {
  const result = await exportGedcomService({
    requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: false,
  });
  if (result.kind !== 'ged') throw new Error(`expected a .ged, got ${result.kind}`);
  return result.content;
}

describe('several NAME records (#872)', () => {
  const ANNA = [
    '0 HEAD',
    '0 @S1@ SOUR', '1 TITL Marriage register',
    '0 @I1@ INDI',
    '1 NAME Anna /Smith/',
    '1 NAME Anna /Jones/', '2 TYPE married', '2 SOUR @S1@', '3 PAGE p. 12',
    '1 NAME Ann /Smith/', '2 NICK Nan',
    '1 NAME Anya /Smirnova/', '2 TYPE aka',
    '0 TRLR',
  ].join('\n');

  const EXPECTED_VARIANTS = [
    { Type: 'Married', Name: 'Anna Jones', Citations: 1 },
    { Type: 'Alias', Name: 'Ann Smith', Citations: 0 },
    { Type: 'Nickname', Name: 'Nan', Citations: 0 },
    { Type: 'Alias', Name: 'Anya Smirnova', Citations: 0 },
  ];

  beforeEach(async () => {
    await importGedcomService({ file: ged(ANNA), mode: 'overwrite', currentUserId: USER_ID });
  });

  it('keeps the first NAME as primary and every later one as a typed variant', async () => {
    const { people, variants } = await names();
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ FirstName: 'Anna', LastName: 'Smith' });
    expect(variants).toEqual(EXPECTED_VARIANTS);
  });

  it('round-trips all four names through a bare .ged export', async () => {
    const exported = await exportGed();
    expect(exported).toContain('1 NAME Anna Jones\n2 TYPE married');
    await importGedcomService({ file: ged(exported), mode: 'overwrite', currentUserId: USER_ID });
    const { people, variants } = await names();
    expect(people[0]).toMatchObject({ FirstName: 'Anna', LastName: 'Smith' });
    // The variant's citation rides in the sources.json sidecar, not the .ged. The
    // nickname comes back first: it exports as `2 NICK` under the primary name (#964).
    const byName = (a: { Name: string }, b: { Name: string }) => a.Name.localeCompare(b.Name);
    expect(variants.map((v) => ({ ...v, Citations: 0 })).sort(byName))
      .toEqual(EXPECTED_VARIANTS.map((v) => ({ ...v, Citations: 0 })).sort(byName));
  });

  it('re-merging the file adds no duplicate variants or citations', async () => {
    const before = await names();
    await importGedcomService({ file: ged(ANNA), mode: 'merge', currentUserId: USER_ID });
    expect(await names()).toEqual(before);
  });
});

describe('two WIFE or two HUSB lines in one FAM (#873)', () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Ann /One/', '1 SEX F',
    '0 @I2@ INDI', '1 NAME Bea /Two/', '1 SEX F',
    '0 @I3@ INDI', '1 NAME Cal /Three/', '1 SEX M',
    '0 @I4@ INDI', '1 NAME Dan /Four/', '1 SEX M',
    '0 @I5@ INDI', '1 NAME Eve /Five/', '1 SEX F',
    '0 @F1@ FAM', '1 WIFE @I1@', '1 WIFE @I2@',
    '0 @F2@ FAM', '1 HUSB @I3@', '1 HUSB @I4@',
    '0 @F3@ FAM', '1 WIFE @I1@', '1 HUSB @I3@', '1 WIFE @I5@',
    '0 TRLR',
  ].join('\n');

  for (const mode of ['overwrite', 'merge'] as const) {
    it(`links both partners, and keeps a third raw with a warning (${mode})`, async () => {
      if (mode === 'merge') await query('DELETE FROM "Families" WHERE "TreeId" = $1', [treeId]);
      if (mode === 'merge') await query('DELETE FROM "People" WHERE "TreeId" = $1', [treeId]);
      const result = await importGedcomService({ file: ged(FILE), mode, currentUserId: USER_ID });
      expect(result.warnings).toContainEqual({ code: 'family_extra_partners', values: { count: 1 } });
      const rows = await query(
        `SELECT p1."FirstName" AS "P1", p2."FirstName" AS "P2", f."RawGedcom"
           FROM "Families" f
           LEFT JOIN "People" p1 ON p1."Id" = f."Partner1Id"
           LEFT JOIN "People" p2 ON p2."Id" = f."Partner2Id"
          WHERE f."TreeId" = $1 ORDER BY f."Id"`,
        [treeId],
      );
      // The kept pointer is stored as Eve's id (#979).
      const eve = await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = $2', [treeId, 'Eve']);
      expect(rows.rows).toEqual([
        { P1: 'Ann', P2: 'Bea', RawGedcom: null },
        { P1: 'Cal', P2: 'Dan', RawGedcom: null },
        { P1: 'Cal', P2: 'Ann', RawGedcom: `1 WIFE @~I:${(eve.rows[0] as { Id: number }).Id}@` },
      ]);
    });
  }
});

describe('a FAM listing the same child twice (#874)', () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Kid /Dup/', '1 FAMC @F1@', '2 PEDI adopted',
    '0 @I2@ INDI', '1 NAME Pa /Dup/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I2@', '1 CHIL @I1@', '1 CHIL @I1@',
    '0 TRLR',
  ].join('\n');

  for (const mode of ['overwrite', 'merge'] as const) {
    it(`imports one child link (${mode})`, async () => {
      await query('DELETE FROM "Families" WHERE "TreeId" = $1', [treeId]);
      await query('DELETE FROM "People" WHERE "TreeId" = $1', [treeId]);
      await importGedcomService({ file: ged(FILE), mode, currentUserId: USER_ID });
      const links = await query(
        `SELECT fp."Partner1Relationship", fp."Partner2Relationship" FROM "FamilyPerson" fp
           JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1`,
        [treeId],
      );
      expect(links.rows).toEqual([{ Partner1Relationship: 'Adoption', Partner2Relationship: 'Adoption' }]);
    });
  }
});

describe('mislabelled charset (#875)', () => {
  it('imports CP1252 under CHAR UTF-8 correctly and says it guessed', async () => {
    const head = new TextEncoder().encode('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Jos');
    const tail = new TextEncoder().encode(' /Moller/\n0 TRLR\n');
    const file = new File([head, new Uint8Array([0xe9]), tail], 'tree.ged', { type: 'text/plain' });
    const result = await importGedcomService({ file, mode: 'overwrite', currentUserId: USER_ID });
    expect(result.warnings).toContainEqual({ code: 'charset_guessed', values: { charset: 'Windows-1252' } });
    const { people } = await names();
    expect(people[0]).toMatchObject({ FirstName: 'José', LastName: 'Moller' });
  });
});

describe('import report and merge family matching (#880)', () => {
  const reset = async () => {
    await query('DELETE FROM "Families" WHERE "TreeId" = $1', [treeId]);
    await query('DELETE FROM "People" WHERE "TreeId" = $1', [treeId]);
  };
  const familyCount = async () =>
    Number((await query('SELECT COUNT(*)::int AS n FROM "Families" WHERE "TreeId" = $1', [treeId])).rows[0].n);

  it('counts dangling pointers by kind and duplicate xrefs', async () => {
    await reset();
    const file = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Dangle/', '1 SOUR @S9@', '1 NOTE @N9@', '1 OBJE @O9@', '1 FAMC @F9@',
      '0 @I1@ INDI', '1 NAME Ann /Again/',
      '0 @F1@ FAM', '1 HUSB @I9@', '1 WIFE @I1@', '1 CHIL @I8@',
      '0 TRLR',
    ].join('\n');
    const result = await importGedcomService({ file: ged(file), mode: 'overwrite', currentUserId: USER_ID });
    expect(result.warnings).toEqual(expect.arrayContaining([
      { code: 'dropped_links', values: { kind: 'source', count: 1 } },
      { code: 'dropped_links', values: { kind: 'note', count: 1 } },
      { code: 'dropped_links', values: { kind: 'media', count: 1 } },
      { code: 'dropped_links', values: { kind: 'family', count: 1 } },
      { code: 'dropped_links', values: { kind: 'person', count: 2 } },
      { code: 'duplicate_xrefs', values: { count: 1 } },
    ]));
  });

  it('refuses a merge of a file with no records', async () => {
    for (const text of ['', 'not a gedcom file', '0 head\n0 @i1@ indi\n1 name a /b/\n0 trlr']) {
      await expect(importGedcomService({ file: ged(text), mode: 'merge', currentUserId: USER_ID }))
        .rejects.toThrow(/no importable records/);
    }
  });

  it('matches a partnerless family on its children, across repeated merges', async () => {
    await reset();
    const file = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Kid /One/', '0 @I2@ INDI', '1 NAME Kid /Two/',
      '0 @F1@ FAM', '1 CHIL @I1@', '1 CHIL @I2@',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: ged(file), mode: 'overwrite', currentUserId: USER_ID });
    for (let i = 0; i < 2; i++) {
      const result = await importGedcomService({ file: ged(file), mode: 'merge', currentUserId: USER_ID });
      expect(result).toMatchObject({ matchedPeopleCount: 2, matchedFamiliesCount: 1, familiesCount: 0 });
    }
    expect(await familyCount()).toBe(1);
  });

  it('matches a couple whose HUSB and WIFE are swapped in the second file', async () => {
    await reset();
    const people = ['0 @I1@ INDI', '1 NAME Sam /Lee/', '0 @I2@ INDI', '1 NAME Alex /Lee/'];
    const first = ['0 HEAD', ...people, '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '0 TRLR'].join('\n');
    const swapped = ['0 HEAD', ...people, '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '0 TRLR'].join('\n');
    await importGedcomService({ file: ged(first), mode: 'overwrite', currentUserId: USER_ID });
    const result = await importGedcomService({ file: ged(swapped), mode: 'merge', currentUserId: USER_ID });
    expect(result).toMatchObject({ matchedFamiliesCount: 1, familiesCount: 0 });
    expect(await familyCount()).toBe(1);
  });
});

describe('merging an unchanged file again adds nothing (#960)', () => {
  const reset = async () => {
    for (const table of ['Citation', 'Families', 'People', 'Sources', 'Note', 'Media']) {
      await query(`DELETE FROM "${table}" WHERE "TreeId" = $1`, [treeId]);
    }
  };
  const count = async (sql: string) => Number((await query(sql, [treeId])).rows[0].n);
  const snapshot = async () => ({
    families: await count('SELECT COUNT(*)::int AS n FROM "Families" WHERE "TreeId" = $1'),
    childLinks: await count('SELECT COUNT(*)::int AS n FROM "FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1'),
    sources: await count('SELECT COUNT(*)::int AS n FROM "Sources" WHERE "TreeId" = $1'),
    citations: await count('SELECT COUNT(*)::int AS n FROM "Citation" WHERE "TreeId" = $1'),
    citedSources: await count('SELECT COUNT(DISTINCT "SourceId")::int AS n FROM "Citation" WHERE "TreeId" = $1'),
    notes: await count('SELECT COUNT(*)::int AS n FROM "Note" WHERE "TreeId" = $1'),
  });
  const importTwiceThenMerge = async (text: string) => {
    await reset();
    await importGedcomService({ file: ged(text), mode: 'overwrite', currentUserId: USER_ID });
    const before = await snapshot();
    for (let i = 0; i < 2; i++) await importGedcomService({ file: ged(text), mode: 'merge', currentUserId: USER_ID });
    return { before, after: await snapshot() };
  };

  it("keeps one couple's two families apart instead of moving the second one's children", async () => {
    const { before, after } = await importTwiceThenMerge([
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Sam /Lee/', '0 @I2@ INDI', '1 NAME Alex /Lee/',
      '0 @I3@ INDI', '1 NAME First /Lee/', '0 @I4@ INDI', '1 NAME Second /Lee/',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
      '0 @F2@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I4@',
      '0 TRLR',
    ].join('\n'));
    expect(before).toMatchObject({ families: 2, childLinks: 2 });
    expect(after).toEqual(before);
  });

  it('matches families with no partners or children on their stored facts', async () => {
    const { before, after } = await importTwiceThenMerge([
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Kin/',
      '0 @F1@ FAM', '1 CHAN', '2 DATE 11 OCT 2015',
      '0 @F2@ FAM', '1 CHAN', '2 DATE 12 OCT 2015',
      '0 @F3@ FAM', '1 MARR', '2 DATE 10 MAY 1463', '2 SOUR @S1@',
      '0 @F4@ FAM', '1 NOTE A family nobody is in yet.',
      '0 @S1@ SOUR', '1 TITL Register',
      '0 TRLR',
    ].join('\n'));
    expect(before).toMatchObject({ families: 4, notes: 1, citations: 1 });
    expect(after).toEqual(before);
  });

  it('keeps sources the file keeps apart, even with one title or none', async () => {
    const { before, after } = await importTwiceThenMerge([
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Src/', '2 SOUR @S1@', '1 BIRT', '2 SOUR @S3@',
      '0 @I2@ INDI', '1 NAME Bea /Src/', '2 SOUR @S2@', '1 BIRT', '2 SOUR @S4@',
      // TMG titles every source alike; EasyTree writes NAME, not TITL.
      '0 @S1@ SOUR', '1 TITL @R1@',
      '0 @S2@ SOUR', '1 TITL @R1@',
      '0 @S3@ SOUR', '1 NAME Rose, by Gail Cameron.',
      '0 @S4@ SOUR', '1 NAME New York Times, March 4, 1946.',
      '0 TRLR',
    ].join('\n'));
    expect(before).toMatchObject({ sources: 4, citations: 4, citedSources: 4 });
    expect(after).toEqual(before);
  });

  it("keeps two identical events apart instead of moving the second one's citation", async () => {
    const { before, after } = await importTwiceThenMerge([
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Event/', '0 @I2@ INDI', '1 NAME Bo /Event/',
      '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@',
      '1 DIV', '2 DATE 984', '1 DIV', '2 DATE 984', '2 SOUR @S1@', '3 PAGE Capet',
      '0 @S1@ SOUR', '1 TITL Register',
      '0 TRLR',
    ].join('\n'));
    expect(before).toMatchObject({ citations: 1 });
    expect(after).toEqual(before);
  });

  it('says how many media a merge added without their files', async () => {
    await reset();
    const text = ['0 HEAD', '0 @I1@ INDI', '1 NAME Ann /Photo/', '1 OBJE', '2 FILE photo.jpg', '1 OBJE', '2 TITL No file', '0 TRLR'].join('\n');
    const first = await importGedcomService({ file: ged(text), mode: 'overwrite', currentUserId: USER_ID });
    expect(first.warnings.map((w) => w.code)).not.toContain('merge_media_without_files');
    const merged = await importGedcomService({ file: ged(text), mode: 'merge', currentUserId: USER_ID });
    expect(merged.warnings).toContainEqual({ code: 'merge_media_without_files', values: { count: 2 } });
  });
});

describe('a PEDI with no relationship type stays on its link (#954)', () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Kid /Step/', '1 FAMC @F1@', '2 PEDI Step', '2 STAT proven',
    '0 @I2@ INDI', '1 NAME Pa /Step/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I2@', '1 CHIL @I1@',
    '0 TRLR',
  ].join('\n');

  const link = async () => (await query(
    `SELECT fp."FamiliesAsChildId", fp."ChildrenId", fp."Partner1Relationship", fp."Partner2Relationship", fp."FamcRawGedcom" FROM "FamilyPerson" fp
       JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1`,
    [treeId],
  )).rows[0] as { FamiliesAsChildId: number; ChildrenId: number; Partner1Relationship: string; Partner2Relationship: string; FamcRawGedcom: string | null };

  it('imports as Birth, warns, and exports the value back under that FAMC', async () => {
    const result = await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    expect(result.warnings).toContainEqual({ code: 'child_relationship_unmapped', values: { count: 1, values: 'Step' } });
    expect(await link()).toMatchObject({ Partner1Relationship: 'Birth', Partner2Relationship: 'Birth', FamcRawGedcom: '2 PEDI Step\n2 STAT proven' });
    const lines = (await exportGed()).split(/\r?\n/);
    const famc = lines.findIndex((l) => l.startsWith('1 FAMC '));
    expect(lines.slice(famc + 1, famc + 3)).toEqual(['2 PEDI Step', '2 STAT proven']);
  });

  it('drops the raw PEDI once a user picks the link type, keeping the rest', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await link();
    await updateChildRelationshipType(before.FamiliesAsChildId, before.ChildrenId, 'Foster', treeId, USER_ID);
    expect(await link()).toMatchObject({ Partner1Relationship: 'Foster', Partner2Relationship: 'Foster', FamcRawGedcom: '2 STAT proven' });
    const out = await exportGed();
    expect(out).toContain('2 PEDI foster');
    expect(out).not.toContain('PEDI Step');
  });
});

describe("FTM's per-parent _FREL / _MREL set each partner (#961, #982)", () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Kid /Ftm/', '1 FAMC @F1@',
    '0 @I2@ INDI', '1 NAME Pa /Ftm/', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Ma /Ftm/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I3@', '1 CHIL @I1@', '2 _FREL Step', '2 _MREL Guardian', '2 _PREF Y',
    '0 TRLR',
  ].join('\n');

  const link = async () => (await query(
    `SELECT fp."FamiliesAsChildId", fp."ChildrenId", fp."Partner1Relationship", fp."Partner2Relationship", fp."ChilRawGedcom" FROM "FamilyPerson" fp
       JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1`,
    [treeId],
  )).rows[0] as { FamiliesAsChildId: number; ChildrenId: number; Partner1Relationship: string; Partner2Relationship: string; ChilRawGedcom: string | null };

  it('imports each partner, without a warning, and exports the values back under that CHIL', async () => {
    const result = await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    expect(result.warnings.map((w) => w.code)).not.toContain('child_relationship_unmapped');
    expect(await link()).toMatchObject({ Partner1Relationship: 'Step', Partner2Relationship: 'Guardian', ChilRawGedcom: '2 _PREF Y' });
    const lines = (await exportGed()).split(/\r?\n/);
    const chil = lines.findIndex((l) => l.startsWith('1 CHIL '));
    expect(lines.slice(chil + 1, chil + 4)).toEqual(['2 _FREL Step', '2 _MREL Guardian', '2 _PREF Y']);
  });

  it('merging the same file again changes nothing on the link', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await link();
    const merged = await importGedcomService({ file: ged(FILE), mode: 'merge', currentUserId: USER_ID });
    expect(merged.matchedFamiliesCount).toBe(1);
    expect(await link()).toEqual(before);
  });

  it('drops _FREL / _MREL once a user picks the link type, keeping the rest', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await link();
    await updateChildRelationshipType(before.FamiliesAsChildId, before.ChildrenId, 'Adoption', treeId, USER_ID);
    expect(await link()).toMatchObject({ Partner1Relationship: 'Adoption', Partner2Relationship: 'Adoption', ChilRawGedcom: '2 _PREF Y' });
  });

  it('strips only whole relationship lines, with the lines under them', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await link();
    await query(
      `UPDATE "FamilyPerson" SET "ChilRawGedcom" = $1 WHERE "FamiliesAsChildId" = $2 AND "ChildrenId" = $3`,
      ['2 _FREL Step\n3 NOTE why\n2 _FRELX keep\n2 _MREL Guardian', before.FamiliesAsChildId, before.ChildrenId],
    );
    await updateChildRelationshipType(before.FamiliesAsChildId, before.ChildrenId, 'Foster', treeId, USER_ID);
    expect((await link()).ChilRawGedcom).toBe('2 _FRELX keep');
  });

  it('drops them too when re-adding the child with another type', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await link();
    await addChildToFamily(before.FamiliesAsChildId, before.ChildrenId, treeId, 'Foster', USER_ID);
    expect(await link()).toMatchObject({ Partner1Relationship: 'Foster', Partner2Relationship: 'Foster', ChilRawGedcom: '2 _PREF Y' });
  });
});

describe("Legacy's preferred-spouse flag stays under its partner (#989)", () => {
  // The WIFE comes first, so keying by pointer (not by line order) is what puts
  // each flag on the right partner. The third partner's flag stays under its raw line.
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Ann /Pref/', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Cal /Pref/', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Eve /Pref/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 WIFE @I1@', '2 _PREF N', '1 HUSB @I2@', '2 _PREF Y', '1 WIFE @I3@', '2 _PREF N',
    '0 TRLR',
  ].join('\n');

  const family = async () => (await query(
    `SELECT f."Id", p1."FirstName" AS "P1", p2."FirstName" AS "P2", f."Partner1RawGedcom", f."Partner2RawGedcom", f."RawGedcom"
       FROM "Families" f
       LEFT JOIN "People" p1 ON p1."Id" = f."Partner1Id"
       LEFT JOIN "People" p2 ON p2."Id" = f."Partner2Id"
      WHERE f."TreeId" = $1`,
    [treeId],
  )).rows[0] as { Id: number; P1: string; P2: string; Partner1RawGedcom: string | null; Partner2RawGedcom: string | null; RawGedcom: string | null };

  it('imports each flag on its partner and exports it back under that line', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const eve = (await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = $2', [treeId, 'Eve'])).rows[0] as { Id: number };
    expect(await family()).toMatchObject({
      P1: 'Cal', P2: 'Ann', Partner1RawGedcom: '2 _PREF Y', Partner2RawGedcom: '2 _PREF N',
      RawGedcom: `1 WIFE @~I:${eve.Id}@\n2 _PREF N`,
    });
    const lines = (await exportGed()).split(/\r?\n/);
    const under = (tag: string) => lines.flatMap((l, i) => (l.startsWith(`1 ${tag} `) ? [lines[i + 1]] : []));
    expect(under('HUSB')).toEqual(['2 _PREF Y']);
    expect(under('WIFE')).toEqual(['2 _PREF N', '2 _PREF N']);
  });

  it('merging the same file again changes nothing on the family', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await family();
    const merged = await importGedcomService({ file: ged(FILE), mode: 'merge', currentUserId: USER_ID });
    expect(merged.matchedFamiliesCount).toBe(1);
    expect(await family()).toEqual(before);
  });

  it("drops a partner's flag once a user puts someone else in that slot", async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await family();
    const p1 = (await query('SELECT "Partner1Id" FROM "Families" WHERE "Id" = $1', [before.Id])).rows[0] as { Partner1Id: number };
    await updateFamily(before.Id, { Partner1Id: p1.Partner1Id }, treeId, USER_ID);
    expect(await family()).toMatchObject({ Partner1RawGedcom: '2 _PREF Y', Partner2RawGedcom: '2 _PREF N' });
    await updateFamily(before.Id, { Partner2Id: null }, treeId, USER_ID);
    expect(await family()).toMatchObject({ P1: 'Cal', Partner1RawGedcom: '2 _PREF Y', Partner2RawGedcom: null });
  });

  it('drops it too when undoing an edit puts someone else in the slot', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const { Id } = await family();
    const id = async (name: string) => ((await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = $2', [treeId, name])).rows[0] as { Id: number }).Id;
    const revert = async (fields: Record<string, { old: number; new: number }>) => {
      const entry = await query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $1, $2, 'update', 'family', $3, 'Pref', $4) RETURNING "Id"`,
        [USER_ID, treeId, Id, JSON.stringify({ fields })],
      );
      await revertAuditEntry((entry.rows[0] as { Id: number }).Id, treeId, USER_ID, USER_ID);
    };
    await revert({ Partner1Id: { old: await id('Cal'), new: await id('Cal') } });
    expect(await family()).toMatchObject({ P1: 'Cal', Partner1RawGedcom: '2 _PREF Y' });
    await revert({ Partner1Id: { old: await id('Eve'), new: await id('Cal') } });
    expect(await family()).toMatchObject({ P1: 'Eve', Partner1RawGedcom: null, Partner2RawGedcom: '2 _PREF N' });
  });
});

describe('citations on name variants, NOTE records and inline SOUR (#963)', () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Ann /Lee/', '1 NAME Annie /Lee/', '2 SOUR @S1@', '3 PAGE p. 1',
    '1 _AKA Nan', '2 SOUR @S1@', '3 PAGE p. 2',
    '1 SOUR Inline Source 1',
    '0 @N1@ NOTE A note', '1 SOUR @S1@',
    '0 @S1@ SOUR', '1 TITL Register',
    '0 TRLR',
  ].join('\n');

  it('re-exports every variant citation from a bare .ged and reports the rest', async () => {
    const result = await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    expect(result.warnings).toContainEqual({ code: 'inline_citations_kept', values: { count: 1 } });
    expect(result.warnings).toContainEqual({ code: 'citations_unplaced', values: { count: 1 } });
    expect((await names()).variants).toEqual([
      { Type: 'Alias', Name: 'Annie Lee', Citations: 1 },
      { Type: 'Alias', Name: 'Nan', Citations: 1 },
    ]);
    const out = await exportGed();
    expect(out).toContain('1 SOUR Inline Source 1');

    const again = await importGedcomService({ file: ged(out), mode: 'overwrite', currentUserId: USER_ID });
    expect(again.warnings).toContainEqual({ code: 'inline_citations_kept', values: { count: 1 } });
    expect((await names()).variants).toEqual([
      { Type: 'Alias', Name: 'Annie Lee', Citations: 1 },
      { Type: 'Alias', Name: 'Nan', Citations: 1 },
    ]);
  });
});

describe('a marriage citation stays on the marriage (#962)', () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Pa /Wed/', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Ma /Wed/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
    '1 MARR', '2 DATE 1 JAN 1900', '2 SOUR @S1@', '3 PAGE banns',
    '1 SOUR @S1@', '2 PAGE family',
    '0 @S1@ SOUR', '1 TITL Parish',
    '0 TRLR',
  ].join('\n');

  const facts = async () => (await query(
    `SELECT "FactTable", "Page" FROM "Citation" WHERE "TreeId" = $1 ORDER BY "Page"`, [treeId],
  )).rows;

  it('imports it as a marriage fact and exports it under 1 MARR', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    expect(await facts()).toEqual([
      { FactTable: 'FamilyMarriage', Page: 'banns' },
      { FactTable: 'Families', Page: 'family' },
    ]);
    const lines = (await exportGed()).split(/\r?\n/);
    const marr = lines.indexOf('1 MARR');
    expect(lines.slice(marr + 1, marr + 4)).toEqual(['2 DATE 1 JAN 1900', '2 SOUR @S1@', '3 PAGE banns']);
    const fam = lines.findIndex((l) => l.endsWith(' FAM'));
    const famSour = lines.indexOf('1 SOUR @S1@', fam);
    expect(lines[famSour + 1]).toBe('2 PAGE family');
  });

  it('exports a bare marriage that only a citation holds', async () => {
    await importGedcomService({ file: ged(FILE.replace('2 DATE 1 JAN 1900\n', '')), mode: 'overwrite', currentUserId: USER_ID });
    const lines = (await exportGed()).split(/\r?\n/);
    expect(lines.slice(lines.indexOf('1 MARR') + 1).slice(0, 2)).toEqual(['2 SOUR @S1@', '3 PAGE banns']);
  });

  it('merging again adds nothing, even onto a tree that held it as a family citation', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    await importGedcomService({ file: ged(FILE), mode: 'merge', currentUserId: USER_ID });
    expect(await facts()).toHaveLength(2);
    await query(`UPDATE "Citation" SET "FactTable" = 'Families' WHERE "TreeId" = $1`, [treeId]);
    await importGedcomService({ file: ged(FILE), mode: 'merge', currentUserId: USER_ID });
    expect(await facts()).toHaveLength(2);
  });
});

describe('a repository keeps its details (#966)', () => {
  const FILE = [
    '0 HEAD',
    '0 @I1@ INDI', '1 NAME Ann /Repo/',
    '0 @R1@ REPO', '1 NAME Archive', '1 ADDR 1 High St', '2 CITY Leeds', '1 PHON 555-0100',
    '0 TRLR',
  ].join('\n');

  const repo = async () => (await query(
    `SELECT "Id", "Address", "RawGedcom", "AddressRawGedcom" FROM "Repository" WHERE "TreeId" = $1`, [treeId],
  )).rows as Array<{ Id: number; Address: string; RawGedcom: string | null; AddressRawGedcom: string | null }>;

  it('merging again changes nothing, and a new address drops the old ADDR lines', async () => {
    await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    const before = await repo();
    expect(before).toEqual([expect.objectContaining({ Address: '1 High St', RawGedcom: '1 PHON 555-0100', AddressRawGedcom: '2 CITY Leeds' })]);
    await importGedcomService({ file: ged(FILE), mode: 'merge', currentUserId: USER_ID });
    expect(await repo()).toEqual(before);
    await updateRepository(before[0].Id, treeId, { Address: '1 High St' });
    expect((await repo())[0].AddressRawGedcom).toBe('2 CITY Leeds');
    await updateRepository(before[0].Id, treeId, { Address: '2 Low Rd' });
    expect((await repo())[0]).toMatchObject({ Address: '2 Low Rd', AddressRawGedcom: null, RawGedcom: '1 PHON 555-0100' });
  });
});

describe("a kept line's pointer to a REPO record (#985)", () => {
  // Legacy writes a research to-do with the repository to search.
  const FILE = [
    '0 HEAD',
    '0 @R7@ REPO', '1 NAME County Archive',
    '0 @R8@ REPO', '1 NAME State Library',
    '0 @I1@ INDI', '1 NAME Tod /Do/',
    '1 _TODO', '2 DESC Find the will', '2 REPO @R7@',
    '0 TRLR',
  ].join('\n');

  it('stores it as the repository id and exports it pointing at that REPO record', async () => {
    const result = await importGedcomService({ file: ged(FILE), mode: 'overwrite', currentUserId: USER_ID });
    expect(result.warnings.find((w) => w.code === 'raw_pointers_dropped')).toBeUndefined();

    const repo = await query('SELECT "Id" FROM "Repository" WHERE "TreeId" = $1 AND "Name" = $2', [treeId, 'County Archive']);
    const person = await query('SELECT "RawGedcom" FROM "People" WHERE "TreeId" = $1', [treeId]);
    expect((person.rows[0] as { RawGedcom: string }).RawGedcom).toContain(`2 REPO @~R:${(repo.rows[0] as { Id: number }).Id}@`);

    const lines = (await exportGed()).split(/\r?\n/);
    const repoXref = lines.find((line) => /^0 @R\d+@ REPO$/.test(line) && lines[lines.indexOf(line) + 1] === '1 NAME County Archive')?.split(' ')[1];
    expect(repoXref).toBeTruthy();
    expect(lines).toContain(`2 REPO ${repoXref}`);
  });
});
