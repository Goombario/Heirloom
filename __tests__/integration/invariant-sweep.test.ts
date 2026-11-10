import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { importGedcomService } from '@/lib/services/gedcom';
import { deletePersonService } from '@/lib/services/people';
import { deleteFamilyService } from '@/lib/services/families';
import { removeSourceService } from '@/lib/services/sources';
import { deleteTreeService } from '@/lib/services/trees';
import { runInvariantSweep, type SweepReport } from '@/scripts/audit/invariant-sweep';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';
import { TEST_USER } from '../setup/test-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;
const exec = { query: (text: string, params?: unknown[]) => query(text, params) };

const GEDCOM = [
  '0 HEAD',
  '0 @S1@ SOUR', '1 TITL Parish register',
  '0 @I1@ INDI', '1 NAME John /Smith/', '1 SEX M', '1 BIRT', '2 DATE 1900', '2 SOUR @S1@', '1 OCCU Miner',
  '0 @I2@ INDI', '1 NAME Mary /Smith/', '1 SEX F', '1 NICK Molly',
  '0 @I3@ INDI', '1 NAME Ann /Smith/', '1 SEX F',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 MARR', '2 DATE 1925',
  '0 TRLR',
].join('\n');
const ged = () => new File([GEDCOM], 'sweep.ged', { type: 'text/plain' });

/** Violations by check, so findings left by other suites in a shared database don't count. */
const violationCounts = (report: SweepReport) =>
  Object.fromEntries(report.violations.map((f) => [f.check, f.count]));

describeIf('invariant sweep on Postgres (#864)', () => {
  beforeEach(async () => { await cleanupTestData(); });
  afterEach(async () => { await cleanupTestData(); });

  it('adds no violations through overwrite, merge, deletes and a tree delete', async () => {
    const baseline = violationCounts(await runInvariantSweep(exec));
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const scope = { requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id };

    await importGedcomService({ file: ged(), mode: 'overwrite', currentUserId: TEST_USER.id, requestedTreeId: treeId });
    await importGedcomService({ file: ged(), mode: 'merge', currentUserId: TEST_USER.id, requestedTreeId: treeId });
    expect(violationCounts(await runInvariantSweep(exec))).toEqual(baseline);

    const id = async (sql: string) => ((await query(sql, [treeId])).rows[0] as { Id: number }).Id;
    await deletePersonService({ ...scope, id: await id(`SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = 'John'`) });
    await deleteFamilyService({ ...scope, id: await id(`SELECT "Id" FROM "Families" WHERE "TreeId" = $1`) });
    await removeSourceService({ ...scope, id: await id(`SELECT "Id" FROM "Sources" WHERE "TreeId" = $1`) });
    const afterDeletes = await runInvariantSweep(exec);
    expect(violationCounts(afterDeletes)).toEqual(baseline);
    expect(afterDeletes.strands.map((f) => f.check)).toContain('event_person_missing');

    const extra = (await query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Sweep extra') RETURNING "Id"`, [TEST_USER.id],
    )).rows[0] as { Id: number };
    await importGedcomService({ file: ged(), mode: 'overwrite', currentUserId: TEST_USER.id, requestedTreeId: extra.Id });
    await deleteTreeService({ id: extra.Id, currentUserId: TEST_USER.id });
    expect(violationCounts(await runInvariantSweep(exec))).toEqual(baseline);
  });
});
