import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { exportCasesData } from '@/lib/db/queries/cases';
import { buildCasesSidecar } from '@/lib/gedcom/cases-sidecar';

/**
 * A struck-out journal note (#1251) rides in cases.json with when and why it was
 * struck, and an import keeps it: in place, in a fresh tree, and on a merge onto
 * a note that still stands. Who struck it stays behind, as the author does.
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

const GED = '0 HEAD\n0 @S1@ SOUR\n1 TITL Parish register\n0 TRLR';
const noMaps = { personIdToXref: new Map(), sourceIdToXref: new Map(), mediaIdToXref: new Map() };

describe('struck-out journal notes in cases.json (#1251)', () => {
  it('exports a struck note with StruckAt and StruckReason, and a standing one in the old shape', async () => {
    const client = new LocalDataClient();
    const created = await client.cases.create({ Title: 'Who was Ada’s father?' });
    const wrong = await client.cases.addComment(created.Id, { body: 'Ada was born in 1871.' });
    await client.cases.addComment(created.Id, { body: 'Wrote to the parish.' });
    await client.cases.strikeComment(created.Id, wrong.Id, 'A different Ada');
    expect((await client.cases.get(created.Id)).latestComment?.Body).toBe('Wrote to the parish.');

    const exported = (await exportCasesData(created.TreeId as number)).filter(c => c.Title === 'Who was Ada’s father?');
    const sidecar = buildCasesSidecar(exported, noMaps);
    const [struck, standing] = sidecar.cases[0].comments;
    expect(struck).toMatchObject({ Body: 'Ada was born in 1871.', StruckReason: 'A different Ada' });
    expect(Number.isFinite(new Date(struck.StruckAt as string).getTime())).toBe(true);
    expect(standing).not.toHaveProperty('StruckAt');
    expect(standing).not.toHaveProperty('StruckReason');

    // Round trip into a fresh tree: the strike comes back, with no striker.
    const ownerId = ((await query(`SELECT "OwnerId" FROM "Trees" WHERE "Id" = $1`, [created.TreeId])).rows[0] as { OwnerId: number }).OwnerId;
    const fresh = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Copy') RETURNING "Id"`, [ownerId])).rows[0] as { Id: number }).Id;
    const { importGedcomService } = await import('@/lib/services/gedcom');
    const run = (mode: 'overwrite' | 'merge', cases: unknown) => importGedcomService({
      file: new File([GED], 'family_tree.ged', { type: 'text/plain' }),
      mode, casesJson: JSON.stringify(cases), currentUserId: ownerId, requestedTreeId: fresh,
    });
    await run('overwrite', sidecar);
    const rows = async () => (await query(
      `SELECT cc."Body", cc."StruckAt", cc."StruckBy", cc."StruckReason" FROM "CaseComments" cc
         JOIN "Cases" c ON c."Id" = cc."CaseId" WHERE c."TreeId" = $1 ORDER BY cc."Id"`,
      [fresh],
    )).rows as Array<{ Body: string; StruckAt: Date | null; StruckBy: number | null; StruckReason: string | null }>;
    const copied = await rows();
    expect(copied.map(r => [r.Body, r.StruckAt?.toISOString() ?? null, r.StruckBy, r.StruckReason])).toEqual([
      ['Ada was born in 1871.', new Date(struck.StruckAt as string).toISOString(), null, 'A different Ada'],
      ['Wrote to the parish.', null, null, null],
    ]);

    // A merge onto the same notes, both standing, strikes the matching one.
    await query(`UPDATE "CaseComments" SET "StruckAt" = NULL, "StruckReason" = NULL
                  WHERE "CaseId" IN (SELECT "Id" FROM "Cases" WHERE "TreeId" = $1)`, [fresh]);
    await run('merge', sidecar);
    const merged = await rows();
    expect(merged).toHaveLength(2);
    expect(merged.map(r => [r.Body, r.StruckReason])).toEqual([['Ada was born in 1871.', 'A different Ada'], ['Wrote to the parish.', null]]);
  });

  it('ignores a strike on a status or conclusion line, and an unreadable time', async () => {
    const owner = ((await query(`INSERT INTO "Users" ("Email", "GoogleId") VALUES ('s@test.local', 's') RETURNING "Id"`, [])).rows[0] as { Id: number }).Id;
    const tree = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Odd') RETURNING "Id"`, [owner])).rows[0] as { Id: number }).Id;
    const { importGedcomService } = await import('@/lib/services/gedcom');
    await importGedcomService({
      file: new File([GED], 'family_tree.ged', { type: 'text/plain' }),
      mode: 'overwrite', currentUserId: owner, requestedTreeId: tree,
      casesJson: JSON.stringify({ version: 1, cases: [{
        Title: 'Odd', Description: null, Status: 'closed', Tags: [], CreatedAt: '2026-01-01T00:00:00.000Z', UpdatedAt: '2026-01-02T00:00:00.000Z',
        linkedPersonGedcomIds: [], sourceCitations: [],
        comments: [
          { Body: 'closed', Kind: 'status', CreatedAt: '2026-01-02T00:00:00.000Z', StruckAt: '2026-01-03T00:00:00.000Z' },
          { Body: 'Ivan.', Kind: 'conclusion', CreatedAt: '2026-01-02T00:00:00.000Z', StruckAt: '2026-01-03T00:00:00.000Z' },
          { Body: 'A note.', CreatedAt: '2026-01-01T00:00:00.000Z', StruckAt: 'not a time', StruckReason: 'x' },
        ],
      }] }),
    });
    const struck = (await query(
      `SELECT COUNT(*)::int AS n FROM "CaseComments" cc JOIN "Cases" c ON c."Id" = cc."CaseId" WHERE c."TreeId" = $1 AND cc."StruckAt" IS NOT NULL`,
      [tree],
    )).rows[0] as { n: number };
    expect(struck.n).toBe(0);
  });
});
