import { describe, it, expect, afterEach } from 'vitest';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { PUT as UPDATE_PERSON } from '@/app/api/people/[id]/route';
import { vitalPatchFor } from '@/app/components/person-form/vitalEvent';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse, TEST_USER } from '../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';

/**
 * Option A (locked): saving a `BIRT`/`DEAT` "event" from the intrinsic row or the
 * Add-event flow does NOT create an `Events` row — it routes through
 * `vitalPatchFor` to the People COLUMNS. This test exercises the exact server-side
 * effect of `InlineEventEditor.handleSave` for a vital: the person-update route
 * fed the vital patch. It asserts the columns move, `IsDeceased` flips on death,
 * and that no `Events` row of type BIRT/DEAT is ever created for the person.
 *
 * Every direct `query()` is scoped by `WHERE "UserId" = $1` — the local
 * integration DB is shared, so unscoped reads would pick up other users' rows.
 */

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('vital events write person columns (Option A)', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createTestPerson(): Promise<number> {
    const res = await CREATE_PERSON(
      createRequest('http://localhost:3000/api/people', {
        method: 'POST',
        body: { FirstName: 'Vital', LastName: 'Columns' },
      }),
    );
    const data = await parseResponse<{ person: { Id: number } }>(res);
    return data.person.Id;
  }

  async function putVital(personId: number, patch: Record<string, unknown>) {
    const res = await UPDATE_PERSON(
      createRequest(`http://localhost:3000/api/people/${personId}`, {
        method: 'PUT',
        body: patch,
      }),
      { params: Promise.resolve({ id: String(personId) }) },
    );
    expect(res.status).toBe(200);
    return res;
  }

  it('writes BirthDate/BirthPlace to the People row and creates no BIRT event', async () => {
    const personId = await createTestPerson();

    await putVital(personId, vitalPatchFor('BIRT', '1901-03-14', 'Boston, MA'));

    const person = await query(
      `SELECT p."BirthDate", ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."Id" = $2 AND p."UserId" = $1`,
      [TEST_USER.id, personId],
    );
    expect(person.rows).toHaveLength(1);
    expect(person.rows[0].BirthDate).toBe('1901-03-14');
    expect(person.rows[0].BirthPlace).toBe('Boston, MA');

    const events = await query(
      `SELECT COUNT(*)::int AS n FROM "Events"
       WHERE "UserId" = $1 AND "PersonId" = $2 AND "Type" = 'BIRT'`,
      [TEST_USER.id, personId],
    );
    expect(events.rows[0].n).toBe(0);
  });

  it('writes DeathDate/DeathPlace + IsDeceased=1 to the People row and creates no DEAT event', async () => {
    const personId = await createTestPerson();

    await putVital(personId, vitalPatchFor('DEAT', '1970-11-02', 'Portland, ME'));

    const person = await query(
      `SELECT p."DeathDate", ${factPlaceTextColumns('people', 'p')}, p."IsDeceased" FROM "People" p
       WHERE p."Id" = $2 AND p."UserId" = $1`,
      [TEST_USER.id, personId],
    );
    expect(person.rows).toHaveLength(1);
    expect(person.rows[0].DeathDate).toBe('1970-11-02');
    expect(person.rows[0].DeathPlace).toBe('Portland, ME');
    expect(person.rows[0].IsDeceased).toBe(1);

    const events = await query(
      `SELECT COUNT(*)::int AS n FROM "Events"
       WHERE "UserId" = $1 AND "PersonId" = $2 AND "Type" = 'DEAT'`,
      [TEST_USER.id, personId],
    );
    expect(events.rows[0].n).toBe(0);
  });
});
