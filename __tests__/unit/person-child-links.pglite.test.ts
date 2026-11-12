import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPersonService, getPersonService } from '@/lib/services/people';
import { addChildToFamilyService, createFamilyService } from '@/lib/services/families';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** The person page tags a stepson or a half-sibling from each child's links (#49). */
const USER_ID = 4949;

describe('child links on a person’s relations (#49)', () => {
  let db: PGlite;
  let treeId: number;
  const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "Name", "GoogleId") VALUES ($1, $2, $3, $4)', [USER_ID, 'links@test.local', 'Links', 'links-49']);
    treeId = await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('carries each child’s link to each partner, for children and siblings', async () => {
    const dad = await createPersonService({ ...ctx(), body: { FirstName: 'Johan', Sex: 'M' } });
    const mum = await createPersonService({ ...ctx(), body: { FirstName: 'Kristina', Sex: 'F' } });
    const anna = await createPersonService({ ...ctx(), body: { FirstName: 'Anna', Sex: 'F' } });
    const erik = await createPersonService({ ...ctx(), body: { FirstName: 'Erik', Sex: 'M' } });
    const fam = await createFamilyService({ ...ctx(), body: { Partner1Id: dad.Id, Partner2Id: mum.Id } });
    await addChildToFamilyService({ ...ctx(), familyId: fam.Id, childId: anna.Id, relationship: 'Birth' });
    await addChildToFamilyService({ ...ctx(), familyId: fam.Id, childId: erik.Id, relationship: { partner1: 'Step', partner2: 'Birth' } });

    const asSibling = await getPersonService({ ...ctx(), id: anna.Id });
    expect(asSibling.parents?.[0].siblings).toEqual([expect.objectContaining({ Id: erik.Id, Partner1Relationship: 'Step', Partner2Relationship: 'Birth' })]);

    const asParent = await getPersonService({ ...ctx(), id: dad.Id });
    const kids = asParent.spouses?.[0].children ?? [];
    expect(kids.find((k) => k.Id === erik.Id)).toMatchObject({ Partner1Relationship: 'Step' });
    expect(kids.find((k) => k.Id === anna.Id)).toMatchObject({ Partner1Relationship: 'Birth' });
  });
});
