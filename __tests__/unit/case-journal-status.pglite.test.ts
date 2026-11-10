import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { exportCasesData } from '@/lib/db/queries/cases';
import { ValidationError } from '@/lib/validation';

/**
 * #801 (CS-2): a status change writes a system entry to the case journal, and
 * closing a case needs a conclusion, which becomes its final entry.
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

const entries = async (id: number) =>
  (await new LocalDataClient().cases.get(id)).comments.map(c => [c.Kind ?? null, c.Body]);

describe('case status history (#801)', () => {
  it('logs each status change, and closes only with a conclusion', async () => {
    const client = new LocalDataClient();
    const created = await client.cases.create({ Title: 'Who were Anna Weber’s parents?' });
    await client.cases.update(created.Id, { Status: 'on_hold' });
    await client.cases.update(created.Id, { Status: 'in_progress' });
    // Saving without a status change logs nothing.
    await client.cases.update(created.Id, { Title: 'Who were Anna Weber’s parents?', Status: 'in_progress' });

    await expect(client.cases.update(created.Id, { Status: 'closed' })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.cases.update(created.Id, { Status: 'closed', Conclusion: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect((await client.cases.get(created.Id)).Status).toBe('in_progress');

    await client.cases.update(created.Id, { Status: 'closed', Conclusion: 'Johann and Maria Weber, per the 1851 baptism.' });
    const closed = await client.cases.get(created.Id);
    expect(closed.Status).toBe('closed');
    expect(await entries(created.Id)).toEqual([
      ['status', 'on_hold'],
      ['status', 'in_progress'],
      ['status', 'closed'],
      ['conclusion', 'Johann and Maria Weber, per the 1851 baptism.'],
    ]);
    // The card previews the conclusion, never a status line.
    expect(closed.latestComment?.Kind).toBe('conclusion');

    // Reopening needs no conclusion and is logged as a reopen.
    await client.cases.update(created.Id, { Status: 'in_progress' });
    expect((await entries(created.Id)).at(-1)).toEqual(['status', 'reopened']);
    expect((await client.cases.get(created.Id)).latestComment?.Kind).toBe('conclusion');
  });

  it('exports the status entries with their Kind, and notes in the old shape', async () => {
    const client = new LocalDataClient();
    const created = await client.cases.create({ Title: 'Where was Ivan born?' });
    await client.cases.addComment(created.Id, { body: 'Checked the 1897 census.' });
    await client.cases.update(created.Id, { Status: 'closed', Conclusion: 'Tver.' });

    const exported = (await exportCasesData(created.TreeId as number)).find(c => c.Title === 'Where was Ivan born?');
    expect(exported?.comments.map(({ Body, Kind }) => ({ Body, Kind }))).toEqual([
      { Body: 'Checked the 1897 census.', Kind: undefined },
      { Body: 'closed', Kind: 'status' },
      { Body: 'Tver.', Kind: 'conclusion' },
    ]);
    expect(exported?.comments[0]).not.toHaveProperty('Kind');
  });
});
