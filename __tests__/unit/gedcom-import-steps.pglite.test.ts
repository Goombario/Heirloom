import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { GEDCOM_IMPORT_STEPS, type GedcomImportStep } from '@/lib/gedcom/import-steps';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The browser build's import runs in the page, so the service reports each
 * phase for the progress bar (ST-1). The steps arrive in order, and a listener
 * that throws never fails the import.
 */
const USER_ID = 987655;
const GEDCOM = [
  '0 HEAD',
  '0 @S1@ SOUR', '1 TITL Parish register',
  '0 @I1@ INDI', '1 NAME John /Doe/', '1 BIRT', '2 DATE 1850', '2 PLAC Dover', '2 SOUR @S1@',
  '0 @I2@ INDI', '1 NAME Mary /Roe/',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
  '0 TRLR',
].join('\n');

describe('GEDCOM import progress steps', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
      [USER_ID, 'import-steps@test.local', 'import-steps'],
    );
    await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  const file = () => new File([GEDCOM], 'steps.ged', { type: 'text/plain' });

  it('reports every phase in order on an overwrite import', async () => {
    const steps: GedcomImportStep[] = [];
    const result = await importGedcomService({ file: file(), mode: 'overwrite', currentUserId: USER_ID, onProgress: (step) => steps.push(step) });
    expect(result.peopleCount).toBe(2);
    expect(steps).toEqual([...GEDCOM_IMPORT_STEPS]);
  });

  it('never goes backwards on a merge import, and a throwing listener cannot fail it', async () => {
    const steps: GedcomImportStep[] = [];
    const result = await importGedcomService({
      file: file(),
      mode: 'merge',
      currentUserId: USER_ID,
      onProgress: (step) => { steps.push(step); throw new Error('listener failed'); },
    });
    expect(result.familiesCount).toBeGreaterThanOrEqual(0);
    const order = steps.map((step) => GEDCOM_IMPORT_STEPS.indexOf(step));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(steps).toContain('people');
    expect(steps.at(-1)).toBe('places');
  });
});
