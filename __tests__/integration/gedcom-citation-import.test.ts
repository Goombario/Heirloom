import { describe, it, expect, beforeAll } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { TEST_USER } from '@/__tests__/setup/test-helpers';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

const GED = [
  '0 HEAD',
  '0 @I1@ INDI',
  '1 NAME Ada /Test/',
  '1 BIRT',
  '2 DATE 1901',
  '2 SOUR @S1@',
  '3 PAGE p.7',
  '0 @S1@ SOUR',
  '1 TITL Citation Test Source',
  '1 _TYPE Census',
  '1 REPO @R1@',
  '2 CALN C-1',
  '0 @R1@ REPO',
  '1 NAME Test Repo',
  '0 TRLR',
].join('\n');

d('GEDCOM source import', () => {
  beforeAll(async () => {
    await importGedcomService({ file: gedFile(GED), mode: 'overwrite', currentUserId: TEST_USER.id });
  });

  it('re-importing in merge mode does not duplicate sources or citations', async () => {
    await importGedcomService({ file: gedFile(GED), mode: 'merge', currentUserId: TEST_USER.id });
    const srcCount = await query(
      `SELECT COUNT(*)::int AS n FROM "Sources" WHERE "OwnerId" = $1 AND "Title" = 'Citation Test Source'`,
      [TEST_USER.id]
    );
    expect(srcCount.rows[0].n).toBe(1);
  });

  it('creates the source with custom fields and resolved repository', async () => {
    const res = await query(
      `SELECT * FROM "Sources" WHERE "OwnerId" = $1 AND "Title" = 'Citation Test Source'`,
      [TEST_USER.id]
    );
    expect(res.rows).toHaveLength(1);
    expect((res.rows[0] as Record<string, unknown>).Type).toBe('Census');
    expect((res.rows[0] as Record<string, unknown>).RepositoryName).toBe('Test Repo');
    expect((res.rows[0] as Record<string, unknown>).CallNumber).toBe('C-1');
  });

  it('creates a PersonBirth citation linked to the source', async () => {
    const personRes = await query(
      `SELECT "Id" FROM "People" WHERE "UserId" = $1 AND "FirstName" = 'Ada'`,
      [TEST_USER.id]
    );
    const personId = personRes.rows[0].Id;
    const cit = await query(
      `SELECT c.*, s."Title" AS "sourceTitle" FROM "Citation" c
       JOIN "Sources" s ON s."Id" = c."SourceId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'PersonBirth' AND c."FactId" = $2`,
      [TEST_USER.id, personId]
    );
    expect(cit.rows).toHaveLength(1);
    expect(cit.rows[0].Page).toBe('p.7');
    expect(cit.rows[0].sourceTitle).toBe('Citation Test Source');
  });
});

d('GEDCOM event-scoped citation import (§4.3)', () => {
  // A `2 SOUR` under a family DIV event and under a person OCCU event must each
  // land on the Events fact (Citation FactTable='Events', FactId=event row),
  // NOT on the enclosing family/person.
  const GED_EVENT_CITS = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Cal /EventCite/',
    '1 OCCU Farmer',
    '2 SOUR @S1@',
    '3 PAGE occ-p.2',
    '1 FAMS @F1@',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 DIV',
    '2 DATE 1950',
    '2 SOUR @S1@',
    '3 PAGE div-p.42',
    '0 @S1@ SOUR',
    '1 TITL Event Cite Source',
    '0 TRLR',
  ].join('\n');

  beforeAll(async () => {
    await importGedcomService({ file: gedFile(GED_EVENT_CITS), mode: 'overwrite', currentUserId: TEST_USER.id });
  });

  it('binds the family DIV event citation to its Events row, not the family', async () => {
    const evt = await query(
      `SELECT e."Id" FROM "Events" e
       WHERE e."UserId" = $1 AND e."Type" = 'DIV' AND e."FamilyId" IS NOT NULL`,
      [TEST_USER.id]
    );
    expect(evt.rows).toHaveLength(1);
    const eventId = evt.rows[0].Id;
    const cit = await query(
      `SELECT * FROM "Citation" WHERE "OwnerId" = $1 AND "FactTable" = 'Events' AND "FactId" = $2`,
      [TEST_USER.id, eventId]
    );
    expect(cit.rows).toHaveLength(1);
    expect(cit.rows[0].Page).toBe('div-p.42');
    // The family itself carries no whole-family citation.
    const famCit = await query(
      `SELECT * FROM "Citation" WHERE "OwnerId" = $1 AND "FactTable" = 'Families'`,
      [TEST_USER.id]
    );
    expect(famCit.rows).toHaveLength(0);
  });

  it('binds the person OCCU event citation to its Events row', async () => {
    const evt = await query(
      `SELECT e."Id" FROM "Events" e
       WHERE e."UserId" = $1 AND e."Type" = 'OCCU' AND e."PersonId" IS NOT NULL`,
      [TEST_USER.id]
    );
    expect(evt.rows).toHaveLength(1);
    const cit = await query(
      `SELECT * FROM "Citation" WHERE "OwnerId" = $1 AND "FactTable" = 'Events' AND "FactId" = $2`,
      [TEST_USER.id, evt.rows[0].Id]
    );
    expect(cit.rows).toHaveLength(1);
    expect(cit.rows[0].Page).toBe('occ-p.2');
  });
});

d('GEDCOM merge attaches citations to existing person', () => {
  const GED_BASE = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Boris /MergeTest/',
    '0 TRLR',
  ].join('\n');
  const GED_WITH_CIT = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Boris /MergeTest/',
    '2 SOUR @S1@',
    '3 PAGE pg-merge',
    '0 @S1@ SOUR',
    '1 TITL Merge Source',
    '0 TRLR',
  ].join('\n');

  beforeAll(async () => {
    await importGedcomService({ file: gedFile(GED_BASE), mode: 'overwrite', currentUserId: TEST_USER.id });
    await importGedcomService({ file: gedFile(GED_WITH_CIT), mode: 'merge', currentUserId: TEST_USER.id });
  });

  it('attaches a PersonName citation to the pre-existing person on merge', async () => {
    const cit = await query(
      `SELECT c.* FROM "Citation" c
       JOIN "People" p ON p."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'PersonName' AND c."Page" = 'pg-merge' AND p."FirstName" = 'Boris'`,
      [TEST_USER.id]
    );
    expect(cit.rows).toHaveLength(1);
  });
});

d('GEDCOM sources.json sidecar import', () => {
  const GED2 = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Mary /Sidecar/',
    '0 @S1@ SOUR',
    '1 TITL Sidecar Source',
    '0 TRLR',
  ].join('\n');

  const sourcesJson = JSON.stringify({
    version: 1,
    sources: [{ xref: '@S1@', repositoryName: 'Mirror Repo', callNumber: 'M-1' }],
    nameVariants: [
      { person: '@I1@', type: 'Maiden', name: 'Mary Jones', citations: [{ source: '@S1@', page: 'p.1', note: null }] },
    ],
  });

  beforeAll(async () => {
    await importGedcomService({ file: gedFile(GED2), mode: 'overwrite', sourcesJson, currentUserId: TEST_USER.id });
  });

  it('creates the NameVariant row from the sidecar', async () => {
    const res = await query(
      `SELECT nv.* FROM "NameVariant" nv JOIN "People" p ON p."Id" = nv."PersonId"
       WHERE nv."OwnerId" = $1 AND p."FirstName" = 'Mary'`,
      [TEST_USER.id]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].Name).toBe('Mary Jones');
    expect(res.rows[0].Type).toBe('Maiden');
  });

  it('creates the NameVariant citation', async () => {
    const res = await query(
      `SELECT c.* FROM "Citation" c
       JOIN "NameVariant" nv ON nv."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'NameVariant' AND c."Page" = 'p.1'`,
      [TEST_USER.id]
    );
    expect(res.rows).toHaveLength(1);
  });

  it('fills repository fields on the source from the sidecar mirror', async () => {
    const res = await query(
      `SELECT * FROM "Sources" WHERE "OwnerId" = $1 AND "Title" = 'Sidecar Source'`,
      [TEST_USER.id]
    );
    expect(res.rows[0].RepositoryName).toBe('Mirror Repo');
    expect(res.rows[0].CallNumber).toBe('M-1');
  });
});

d('GEDCOM cases.json structured citations', () => {
  const GED3 = ['0 HEAD', '0 @S1@ SOUR', '1 TITL Case Source', '0 TRLR'].join('\n');
  const casesJson = JSON.stringify({
    version: 1,
    cases: [{
      Title: 'Brick Wall', Description: null, Status: 'in_progress', Tags: [], CreatedAt: new Date().toISOString(),
      citations: [], comments: [], linkedPersonGedcomIds: [],
      sourceCitations: [{ source: '@S1@', page: 'fol.2', note: null }],
    }],
  });
  const sourcesJson = JSON.stringify({ version: 1, sources: [], nameVariants: [] });

  beforeAll(async () => {
    await importGedcomService({ file: gedFile(GED3), mode: 'overwrite', casesJson, sourcesJson, currentUserId: TEST_USER.id });
  });

  it('creates a Citation(Cases) row from cases.json sourceCitations', async () => {
    const res = await query(
      `SELECT c.* FROM "Citation" c JOIN "Cases" k ON k."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'Cases' AND k."Title" = 'Brick Wall'`,
      [TEST_USER.id]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].Page).toBe('fol.2');
  });
});

d('GEDCOM cases.json legacy citation compatibility', () => {
  const GED4 = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Remy /LegacyCase/',
    '0 TRLR',
  ].join('\n');
  const casesJson = JSON.stringify({
    version: 1,
    cases: [{
      Title: 'Legacy case bundle', Description: null, Status: 'in_progress', Tags: [], CreatedAt: new Date().toISOString(),
      citations: [
        { Title: 'Old archive page', Url: 'https://example.test/archive/12', Notes: 'Check the marginal note.', CreatedAt: new Date().toISOString() },
        { Title: 'Old archive page', Url: 'https://example.test/archive/12', Notes: 'Check the index too.', CreatedAt: new Date().toISOString() },
        { Title: 'Old archive page', Url: 'https://example.test/archive/13', Notes: 'Different scan.', CreatedAt: new Date().toISOString() },
      ],
      comments: [], linkedPersonGedcomIds: [],
    }],
  });

  beforeAll(async () => {
    await importGedcomService({ file: gedFile(GED4), mode: 'overwrite', casesJson, currentUserId: TEST_USER.id });
  });

  it('imports old free-text citations into Sources and Citation(Cases)', async () => {
    const result = await query(
      `SELECT s."Title", s."Text", s."Type", c."FactTable", c."Page", c."Note"
       FROM "Citation" c
       JOIN "Sources" s ON s."Id" = c."SourceId"
       JOIN "Cases" k ON k."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND k."Title" = 'Legacy case bundle'`,
      [TEST_USER.id],
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows).toContainEqual(expect.objectContaining({
      Title: 'Old archive page', Text: 'https://example.test/archive/12', Type: 'Other',
      FactTable: 'Cases', Page: null, Note: 'Check the marginal note.',
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      Title: 'Old archive page', Text: 'https://example.test/archive/12', Type: 'Other',
      FactTable: 'Cases', Page: null, Note: 'Check the index too.',
    }));
    expect(result.rows).toContainEqual(expect.objectContaining({
      Title: 'Old archive page', Text: 'https://example.test/archive/13', Type: 'Other',
      FactTable: 'Cases', Page: null, Note: 'Different scan.',
    }));
    const sources = await query(
      `SELECT COUNT(*)::int AS n FROM "Sources"
       WHERE "OwnerId" = $1 AND "Title" = 'Old archive page'`,
      [TEST_USER.id],
    );
    expect(sources.rows[0].n).toBe(2);
  });

  it('does not duplicate the structured citation on merge re-import', async () => {
    await importGedcomService({ file: gedFile(GED4), mode: 'merge', casesJson, currentUserId: TEST_USER.id });
    const result = await query(
      `SELECT COUNT(*)::int AS n
       FROM "Citation" c JOIN "Cases" k ON k."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'Cases' AND k."Title" = 'Legacy case bundle'`,
      [TEST_USER.id],
    );
    expect(result.rows[0].n).toBe(3);
  });

  it('prefers structured data when an older bundle contains both citation arrays', async () => {
    const dualCasesJson = JSON.stringify({
      version: 1,
      cases: [{
        Title: 'Dual-array case', Description: null, Status: 'in_progress', Tags: [], CreatedAt: new Date().toISOString(),
        citations: [{ Title: 'Dual archive source', Url: 'https://example.test/dual', Notes: 'Legacy duplicate.', CreatedAt: new Date().toISOString() }],
        comments: [], linkedPersonGedcomIds: [],
        sourceCitations: [{ source: '@S1@', page: null, note: 'Structured citation.' }],
      }],
    });
    const dualGed = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Sacha /DualArray/',
      '0 @S1@ SOUR',
      '1 TITL Dual archive source',
      '1 _URL https://example.test/dual',
      '0 TRLR',
    ].join('\n');

    await importGedcomService({ file: gedFile(dualGed), mode: 'overwrite', casesJson: dualCasesJson, currentUserId: TEST_USER.id });
    const result = await query(
      `SELECT s."Title", c."Page", c."Note"
       FROM "Citation" c JOIN "Sources" s ON s."Id" = c."SourceId"
       JOIN "Cases" k ON k."Id" = c."FactId"
       WHERE c."FactTable" = 'Cases' AND k."Title" = 'Dual-array case'`,
    );
    expect(result.rows).toEqual([{ Title: 'Dual archive source', Page: null, Note: 'Structured citation.' }]);
  });
});
