import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb, dumpDatabaseLogical, logicalToDatadir } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { confirmDataCheckService, listDataChecksService } from '@/lib/services/data-checks';
import { importGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * A confirmed data check (#830) is the user's judgement, so it must outlive
 * the ways a tree is re-read (#869): a merge re-import of the same file, a
 * merge of the tree's own export, and a backup restored into a fresh database.
 * An overwrite import clears confirmations by design (the overwrite gate counts
 * them); that is pinned in data-check-confirmations.pglite.test.ts.
 */
const OWNER = 869_001;
const GED = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Anne /Doyle/', '1 SEX F', '1 BIRT', '2 DATE 1 MAR 1802', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Patrick /Doyle/', '1 SEX M', '1 BIRT', '2 DATE 1 MAR 1858', '1 FAMC @F1@',
    '0 @F1@ FAM', '1 WIFE @I1@', '1 CHIL @I2@',
    '0 TRLR',
].join('\n');

describe('a data check confirmation survives re-reading the tree (#869)', () => {
    let db: PGlite;
    let treeId: number;
    const as = { requestedTreeId: null, requestedOwnerId: null, currentUserId: OWNER };
    const importFile = (text: string, mode: 'overwrite' | 'merge') =>
        importGedcomService({ file: new File([text], 'tree.ged'), mode, currentUserId: OWNER });
    const confirmation = async () =>
        (await listDataChecksService(as)).problems.find((p) => p.rule === 'mother_too_old')?.confirmation?.reason ?? null;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId", "Name") VALUES ($1, $2, $3, $4)', [OWNER, 'o@test.local', 'o', 'Owner']);
        treeId = await resolveDefaultTree(OWNER);
        await importFile(GED, 'overwrite');
        const problem = (await listDataChecksService(as)).problems.find((p) => p.rule === 'mother_too_old');
        expect(problem).toBeDefined();
        await confirmDataCheckService({ ...as, problemId: problem!.id, reason: 'Baptism register says so' });
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('after a merge re-import of the same file', async () => {
        await importFile(GED, 'merge');
        expect(await confirmation()).toBe('Baptism register says so');
    });

    it("after a merge of the tree's own export", async () => {
        const exported = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: OWNER, includeMedia: false });
        if (exported.kind !== 'ged') throw new Error(`unexpected export kind ${exported.kind}`);
        await importFile(exported.content, 'merge');
        expect(await confirmation()).toBe('Baptism register says so');
        expect((await query('SELECT count(*)::int AS n FROM "People" WHERE "TreeId" = $1', [treeId])).rows[0]).toEqual({ n: 2 });
    });

    it('after a backup is restored into a fresh database', async () => {
        const restored = await PGlite.create({ loadDataDir: await logicalToDatadir(await dumpDatabaseLogical()) });
        __setTestDb(restored);
        try {
            expect(await confirmation()).toBe('Baptism register says so');
        } finally {
            __setTestDb(db);
            await restored.close();
        }
    });
});
