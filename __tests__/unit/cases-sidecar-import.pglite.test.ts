import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { casesSidecarEvidence } from '@/lib/gedcom/cases-sidecar';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * cases.json photos (#1068) and full citations (#1035) on import: a bundle from
 * before them still imports with the new fields null, a merge of a newer bundle
 * fills them in, and a photo whose media isn't in the bundle is skipped.
 */

const USER_ID = 1068;

const GED = [
  '0 HEAD',
  '0 @S1@ SOUR',
  '1 TITL Parish register',
  '0 @O1@ OBJE',
  '1 FILE media/O1/register.jpg',
  '2 FORM jpg',
  '2 TITL Register page',
  '0 @O2@ OBJE',
  '1 FILE media/O2/letter.jpg',
  '2 FORM jpg',
  '2 TITL Letter',
  '0 TRLR',
].join('\n');

const OLD_CASES = {
  version: 1,
  cases: [{
    Title: 'Who was Anna?', Description: null, Status: 'in_progress', Tags: [], CreatedAt: '2026-01-01T00:00:00.000Z',
    comments: [{ Body: 'Wrote to the archive.', CreatedAt: '2026-01-02T00:00:00.000Z' }],
    linkedPersonGedcomIds: [],
    sourceCitations: [{ source: '@S1@', page: 'fol. 3', note: null }],
  }],
};

const NEW_CASES = {
  version: 1,
  cases: [{
    ...OLD_CASES.cases[0],
    comments: [{
      Body: 'Wrote to the archive.', CreatedAt: '2026-01-02T00:00:00.000Z', media: '@O2@',
      citation: { source: '@S1@', page: 'fol. 4', note: 'Reply', quay: '1', dataText: 'No record found.', url: 'https://archive.example/4' },
    }],
    sourceCitations: [{
      source: '@S1@', page: 'fol. 3', note: null, quay: '3', dataText: 'Anna, daughter of Ivan.',
      dataDate: '1 MAY 1890', even: 'BAPM', role: 'CHIL', url: 'https://archive.example/3',
    }],
    // @O9@ isn't in the bundle, so that link is skipped.
    media: ['@O1@', '@O9@'],
  }],
};

describe('cases.json photos and citations on import (#1068, #1035)', () => {
  let db: PGlite;
  let treeId: number;

  const importCases = async (cases: unknown, mode: 'overwrite' | 'merge') => {
    const { importGedcomService } = await import('@/lib/services/gedcom');
    await importGedcomService({
      file: new File([GED], 'family_tree.ged', { type: 'text/plain' }),
      mode,
      casesJson: JSON.stringify(cases),
      currentUserId: USER_ID,
      requestedTreeId: treeId,
    });
  };

  const caseState = async () => {
    const caseRow = (await query(`SELECT "Id" FROM "Cases" WHERE "TreeId" = $1`, [treeId])).rows as Array<{ Id: number }>;
    expect(caseRow).toHaveLength(1);
    const caseId = caseRow[0].Id;
    const citations = (await query(
      `SELECT ci."FactTable", ci."Page", ci."Note", ci."Quay", ci."DataText", ci."DataDate", ci."Even", ci."Role", ci."Url"
       FROM "Citation" ci WHERE ci."TreeId" = $1 AND ci."FactTable" IN ('Cases', 'CaseComments') ORDER BY ci."FactTable", ci."Page"`,
      [treeId],
    )).rows;
    const comments = (await query(
      `SELECT cc."Body", m."Title" AS "Photo" FROM "CaseComments" cc LEFT JOIN "Media" m ON m."Id" = cc."MediaId" WHERE cc."CaseId" = $1`,
      [caseId],
    )).rows;
    const photos = (await query(
      `SELECT m."Title" FROM "CaseMedia" cm JOIN "Media" m ON m."Id" = cm."MediaId" WHERE cm."CaseId" = $1 ORDER BY 1`,
      [caseId],
    )).rows.map((r) => (r as { Title: string }).Title);
    return { citations, comments, photos };
  };

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'cases-sidecar@test.local', 'cases-sidecar']);
    treeId = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Cases') RETURNING "Id"`, [USER_ID])).rows[0] as { Id: number }).Id;
  }, 60_000);

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('imports a cases.json from before the new fields with them null', async () => {
    await importCases(OLD_CASES, 'overwrite');
    expect(await caseState()).toEqual({
      citations: [{ FactTable: 'Cases', Page: 'fol. 3', Note: null, Quay: null, DataText: null, DataDate: null, Even: null, Role: null, Url: null }],
      comments: [{ Body: 'Wrote to the archive.', Photo: null }],
      photos: [],
    });
  });

  it('fills them in on a merge of a newer bundle, skipping a photo not in the bundle', async () => {
    await importCases(NEW_CASES, 'merge');
    const afterFirst = await caseState();
    expect(afterFirst).toEqual({
      citations: [
        { FactTable: 'CaseComments', Page: 'fol. 4', Note: 'Reply', Quay: '1', DataText: 'No record found.', DataDate: null, Even: null, Role: null, Url: 'https://archive.example/4' },
        { FactTable: 'Cases', Page: 'fol. 3', Note: null, Quay: '3', DataText: 'Anna, daughter of Ivan.', DataDate: '1 MAY 1890', Even: 'BAPM', Role: 'CHIL', Url: 'https://archive.example/3' },
      ],
      comments: [{ Body: 'Wrote to the archive.', Photo: 'Letter' }],
      photos: ['Register page'],
    });
    // A second merge adds no citation and leaves the entry's photo. Each merge
    // makes its own media rows (cross-import media identity is #629), so the
    // case photos aren't compared.
    await importCases(NEW_CASES, 'merge');
    const afterSecond = await caseState();
    expect(afterSecond.citations).toEqual(afterFirst.citations);
    expect(afterSecond.comments).toEqual(afterFirst.comments);
  });

  it('imports the newer bundle whole into an empty tree', async () => {
    await importCases(NEW_CASES, 'overwrite');
    const state = await caseState();
    expect(state.citations).toHaveLength(2);
    expect(state.comments).toEqual([{ Body: 'Wrote to the archive.', Photo: 'Letter' }]);
    expect(state.photos).toEqual(['Register page']);
  });
});

describe('casesSidecarEvidence', () => {
  it('reads a missing or malformed field as null', () => {
    expect(casesSidecarEvidence({ source: '@S1@', page: null, note: null })).toEqual({
      quay: null, dataText: null, dataDate: null, even: null, role: null, url: null,
    });
    expect(casesSidecarEvidence({ quay: '7', dataText: 42, url: 'https://a.example/\nx' })).toEqual({
      quay: null, dataText: null, dataDate: null, even: null, role: null, url: null,
    });
    expect(casesSidecarEvidence({ quay: '0', url: ' https://a.example/1 ' })).toMatchObject({ quay: '0', url: 'https://a.example/1' });
  });
});
