import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPersonService } from '@/lib/services/people';
import { addChildToFamilyService, createFamilyService } from '@/lib/services/families';
import { createEventService } from '@/lib/services/events';
import { createSourceService } from '@/lib/services/sources';
import { createCitationService } from '@/lib/services/citations';
import { addCommentService, createCaseService } from '@/lib/services/cases';
import { getDashboardService } from '@/lib/services/dashboard';
import { getPersonNextSteps } from '@/lib/db/queries/home';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** The desktop home's data (#53): Next steps, the year span, place countries, case comment authors. */
const USER_ID = 5353;

describe('desktop home data (#53)', () => {
  let db: PGlite;
  let treeId: number;
  const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });
  let anna: { Id: number };
  let mother: { Id: number };
  let father: { Id: number };
  let occupation: { Id: number };

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "Name", "GoogleId") VALUES ($1, $2, $3, $4)', [USER_ID, 'home@test.local', 'Sam Archivist', 'home-53']);
    treeId = await resolveDefaultTree(USER_ID);

    const grandma = await createPersonService({ ...ctx(), body: { FirstName: 'Elsa', LastName: 'Berg', Sex: 'F' } });
    const grandpa = await createPersonService({ ...ctx(), body: { FirstName: 'Per', LastName: 'Berg', Sex: 'M' } });
    father = await createPersonService({ ...ctx(), body: { FirstName: 'Johan', LastName: 'Lind', Sex: 'M', BirthDate: '1838' } });
    mother = await createPersonService({ ...ctx(), body: { FirstName: 'Kristina', LastName: 'Berg', Sex: 'F', BirthDate: '1840' } });
    const gp = await createFamilyService({ ...ctx(), body: { Partner1Id: grandpa.Id, Partner2Id: grandma.Id } });
    await addChildToFamilyService({ ...ctx(), familyId: gp.Id, childId: father.Id });

    // Anna: born 1868 in a place, died 1931 with no place; birth unsourced, an unsourced event.
    anna = await createPersonService({ ...ctx(), body: { FirstName: 'Anna', LastName: 'Lind', Sex: 'F', BirthDate: '3 MAR 1868', BirthPlace: 'Österbybruk, Uppland, Sweden', DeathDate: '1931', IsDeceased: 1 } });
    const fam = await createFamilyService({ ...ctx(), body: { Partner1Id: father.Id, Partner2Id: mother.Id } });
    await addChildToFamilyService({ ...ctx(), familyId: fam.Id, childId: anna.Id });
    occupation = await createEventService({ ...ctx(), body: { Type: 'OCCU', PersonId: anna.Id, Date: '1891', Place: 'Duluth, Minnesota, USA' } });
    const source = await createSourceService({ ...ctx(), input: { Title: 'Parish register' } });
    await createCitationService({ ...ctx(), input: { FactTable: 'PersonDeath', FactId: anna.Id, SourceId: source.Id } });

    const kase = await createCaseService({ ...ctx(), body: { Title: 'Where did Anna live?' } });
    await query('UPDATE "Cases" SET "Status" = \'in_progress\' WHERE "Id" = $1', [kase.Id]);
    await addCommentService({ ...ctx(), id: kase.Id, body: 'Found her in the 1900 census.' });
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('lists one gap from each group first, and counts them all', async () => {
    const { steps, total } = await getPersonNextSteps(anna.Id, treeId);
    // Vitals: no death place. Sources: birth, then the 1891 occupation (death is cited).
    // Family: the mother has no parents; the father does.
    expect(steps).toEqual([
      { kind: 'death_place' },
      { kind: 'source', fact: 'birth', year: 1868 },
      { kind: 'grandparents', parentId: mother.Id, parentSex: 'F', parentName: 'Kristina' },
    ]);
    expect(total).toBe(4);
    const all = await getPersonNextSteps(anna.Id, treeId, 10);
    expect(all.steps).toContainEqual({ kind: 'source', fact: 'event', eventId: occupation.Id, eventType: 'OCCU', year: 1891 });
  });

  it('asks for parents when a person has none', async () => {
    const { steps } = await getPersonNextSteps(father.Id, treeId, 10);
    expect(steps).not.toContainEqual({ kind: 'parents' });
    const { steps: grandmaSteps } = await getPersonNextSteps(mother.Id, treeId, 10);
    expect(grandmaSteps).toContainEqual({ kind: 'parents' });
  });

  it('gives the band its years, the places their countries, and each case its last author', async () => {
    const dash = await getDashboardService(ctx());
    expect(dash.yearSpan).toEqual({ first: 1838, last: 1931 });
    const duluth = dash.places.find((p) => p.place_name.startsWith('Duluth'));
    expect(duluth?.country).toBe('USA');
    expect(dash.placeTotals).toEqual({ places: 2, countries: 2 });
    expect(dash.openCases[0]).toMatchObject({ LastComment: 'Found her in the 1900 census.', LastCommentAuthor: 'Sam Archivist', LastCommentUserId: USER_ID });
    expect(dash.openCases[0].LastCommentAt).toBeTruthy();
    expect(dash.resumedPerson?.nextSteps.total).toBeGreaterThanOrEqual(0);
  });
});
