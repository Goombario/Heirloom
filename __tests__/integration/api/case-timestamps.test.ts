import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GET as GET_CASE } from '@/app/api/cases/[id]/route';
import { query } from '@/lib/db/connection';
import { exportCasesData } from '@/lib/db/queries/cases';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getTestUserIds } from '../../setup/test-user-ids';

/**
 * #789 (task audit CS-1): case and journal timestamps were TIMESTAMP (no zone).
 * node-pg reads those in the Node process's zone, so a server or desktop
 * process outside UTC showed and exported them hours off.
 */
const describeIf = hasTestDatabase() ? describe : describe.skip;
const USER_ID = getTestUserIds().user1;
const INSTANT = '2026-09-24T23:05:38.000Z';

describeIf('case timestamps are instants (#789)', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Toronto'; });
  afterAll(() => { process.env.TZ = originalTz; });
  afterEach(async () => { await cleanupTestData(); });

  it('reads back and exports a case comment at the instant it was written, outside UTC', async () => {
    const tree = await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Timestamps') RETURNING "Id"`, [USER_ID]);
    const treeId = (tree.rows[0] as { Id: number }).Id;
    const created = await query(
      `INSERT INTO "Cases" ("UserId", "TreeId", "Title", "CreatedAt", "UpdatedAt")
       VALUES ($1, $2, 'Fictional case', $3, $3) RETURNING "Id"`,
      [USER_ID, treeId, INSTANT],
    );
    const caseId = (created.rows[0] as { Id: number }).Id;
    await query(
      `INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "CreatedAt") VALUES ($1, $2, 'A journal entry', $3)`,
      [caseId, USER_ID, INSTANT],
    );

    const res = await GET_CASE(
      createRequest(`http://localhost:3000/api/cases/${caseId}?treeId=${treeId}`),
      { params: Promise.resolve({ id: String(caseId) }) },
    );
    const { case: record } = await parseResponse<{ case: { CreatedAt: string; UpdatedAt: string; comments: { CreatedAt: string }[] } }>(res);
    expect(record.CreatedAt).toBe(INSTANT);
    expect(record.UpdatedAt).toBe(INSTANT);
    expect(record.comments[0].CreatedAt).toBe(INSTANT);

    const [exported] = await exportCasesData(treeId);
    expect(new Date(exported.CreatedAt as unknown as string).toISOString()).toBe(INSTANT);
    expect(new Date(exported.comments[0].CreatedAt).toISOString()).toBe(INSTANT);
  });
});
