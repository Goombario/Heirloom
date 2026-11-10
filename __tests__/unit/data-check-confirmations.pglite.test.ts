import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { confirmDataCheckService, listDataChecksService, reopenDataCheckService, summarizeDataChecksService } from '@/lib/services/data-checks';
import { getTreeCountsService } from '@/lib/services/tree-counts';
import { importGedcomService } from '@/lib/services/gedcom';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Confirmations of unlikely data checks (#830): confirm, reopen, confirm again;
 * a changed date expires a confirmation; viewers can read but not confirm;
 * another tree sees nothing; every change is audited; an overwrite import
 * clears the table. The HTTP routes are covered in
 * `__tests__/integration/api/data-checks.test.ts`.
 */
const OWNER = 983_001;
const VIEWER = 983_002;
const OTHER = 983_003;
const CONTRIBUTOR = 983_004;

describe('data check confirmations', () => {
    let db: PGlite;
    let treeId: number;
    let anne: number;
    let patrick: number;
    let thomas: number;
    const as = (currentUserId: number) => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId });

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        for (const [id, name] of [[OWNER, 'Owner'], [VIEWER, 'Viewer'], [OTHER, 'Other'], [CONTRIBUTOR, 'Contributor']] as const) {
            await query('INSERT INTO "Users" ("Id", "Email", "GoogleId", "Name") VALUES ($1, $2, $3, $4)', [id, `${name}@test.local`, name, name]);
        }
        treeId = await resolveDefaultTree(OWNER);
        await resolveDefaultTree(OTHER);
        await query(
            `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`,
            [OWNER, VIEWER, treeId],
        );
        await query(
            `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'contribute')`,
            [OWNER, CONTRIBUTOR, treeId],
        );
        const person = async (first: string, sex: string, birth: string, death: string | null = null) =>
            ((await query(
                `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex", "BirthDate", "DeathDate")
                 VALUES ($1, $2, $3, 'Doyle', $4, $5, $6) RETURNING "Id"`,
                [OWNER, treeId, first, sex, birth, death],
            )).rows[0] as { Id: number }).Id;
        anne = await person('Anne', 'F', '1802-03-01');
        patrick = await person('Patrick', 'M', '1858-03-01');
        // Death before birth: impossible, so it can't be confirmed.
        thomas = await person('Thomas', 'M', '1851-03-14', 'ABT 1841');
        const fam = ((await query(
            `INSERT INTO "Families" ("UserId", "TreeId", "Partner2Id") VALUES ($1, $2, $3) RETURNING "Id"`,
            [OWNER, treeId, anne],
        )).rows[0] as { Id: number }).Id;
        await query('INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2)', [fam, patrick]);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    const entry = async (userId = OWNER) =>
        (await listDataChecksService(as(userId))).problems.find((p) => p.id === `mother_too_old:${anne}`);
    const auditRows = async () => (await query(
        `SELECT "Action", "EntityId", "EntityLabel", "Changes" FROM "AuditLog" WHERE "EntityType" = 'datacheck' ORDER BY "Id"`,
    )).rows as Array<{ Action: string; EntityId: number; EntityLabel: string; Changes: { snapshot: Record<string, unknown> } }>;

    it('lists an unlikely problem as To check', async () => {
        expect(await entry()).toMatchObject({ kind: 'unlikely', threshold: 55, confirmation: null });
    });

    it('requires a reason, and refuses impossible checks', async () => {
        await expect(confirmDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${anne}`, reason: '   ' }))
            .rejects.toBeInstanceOf(ValidationError);
        await expect(confirmDataCheckService({ ...as(OWNER), problemId: `death_before_birth:${thomas}`, reason: 'Sure' }))
            .rejects.toBeInstanceOf(ValidationError);
        await expect(confirmDataCheckService({ ...as(OWNER), problemId: 'mother_too_old:x', reason: 'Sure' }))
            .rejects.toBeInstanceOf(ValidationError);
        await expect(reopenDataCheckService({ ...as(OWNER), problemId: 'constructor:1' }))
            .rejects.toBeInstanceOf(ValidationError);
        await expect(confirmDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${patrick}`, reason: 'Sure' }))
            .rejects.toBeInstanceOf(NotFoundError);
    });

    it('confirms, reopens, and confirms again, auditing each', async () => {
        const confirmed = await confirmDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${anne}`, reason: '  The register gives both years.  ' });
        expect(confirmed.confirmation).toMatchObject({ reason: 'The register gives both years.', confirmedBy: OWNER });
        expect((await entry())?.confirmation).toMatchObject({ reason: 'The register gives both years.', confirmedByName: 'Owner' });
        expect((await entry())?.confirmation?.confirmedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);

        await reopenDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${anne}` });
        expect((await entry())?.confirmation).toBeNull();
        await expect(reopenDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${anne}` })).rejects.toBeInstanceOf(NotFoundError);

        await confirmDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${anne}`, reason: 'Checked twice.' });
        expect((await entry())?.confirmation?.reason).toBe('Checked twice.');

        const rows = await auditRows();
        expect(rows.map((r) => r.Action)).toEqual(['create', 'delete', 'create']);
        expect(rows[0]).toMatchObject({ EntityId: anne, EntityLabel: 'Anne Doyle' });
        expect(rows[0].Changes.snapshot).toMatchObject({ Rule: 'mother_too_old', Threshold: 55, Reason: 'The register gives both years.', PersonId: anne, TreeId: treeId });
    });

    it('lets a viewer see Confirmed, but not change it', async () => {
        expect((await entry(VIEWER))?.confirmation?.reason).toBe('Checked twice.');
        await expect(confirmDataCheckService({ ...as(VIEWER), problemId: `mother_too_old:${anne}`, reason: 'Mine' }))
            .rejects.toBeInstanceOf(AccessError);
        await expect(reopenDataCheckService({ ...as(VIEWER), problemId: `mother_too_old:${anne}` }))
            .rejects.toBeInstanceOf(AccessError);
    });

    it("summarises what's still to check, without the confirmed or the rest of the list (#1270)", async () => {
        const all = (await listDataChecksService(as(OWNER))).problems;
        const open = all.filter((p) => p.confirmation == null);
        expect(open.length).toBeGreaterThan(0);
        expect(open.length).toBeLessThan(all.length);

        const summary = await summarizeDataChecksService(as(VIEWER));
        expect(summary.openCount).toBe(open.length);
        expect(summary.top.problems).toEqual(open.slice(0, 3));
        expect(summary.top.problems.some((p) => p.id === `mother_too_old:${anne}`)).toBe(false);

        const one = await summarizeDataChecksService({ ...as(OWNER), limit: 1 });
        expect(one.openCount).toBe(open.length);
        expect(one.top.problems).toEqual(open.slice(0, 1));
        const named = new Set([one.top.problems[0].personId, ...one.top.problems[0].relatedPersonIds]);
        expect(one.top.people.map((p) => p.Id).sort()).toEqual([...named].sort());

        expect(await summarizeDataChecksService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: OTHER }))
            .toEqual({ openCount: 0, top: { problems: [], people: [], families: [] } });
        await expect(summarizeDataChecksService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: OTHER }))
            .rejects.toBeInstanceOf(AccessError);
    });

    it('lets a contributor confirm, but not reopen: that deletes a confirmation', async () => {
        await expect(reopenDataCheckService({ ...as(CONTRIBUTOR), problemId: `mother_too_old:${anne}` }))
            .rejects.toBeInstanceOf(AccessError);
        const e = await confirmDataCheckService({ ...as(CONTRIBUTOR), problemId: `mother_too_old:${anne}`, reason: 'Checked twice.' });
        expect(e.confirmation?.confirmedBy).toBe(CONTRIBUTOR);
    });

    it("keeps another tree's rows invisible", async () => {
        await expect(listDataChecksService(as(OTHER))).rejects.toBeInstanceOf(AccessError);
        const own = await listDataChecksService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: OTHER });
        expect(own.problems).toEqual([]);
        await expect(reopenDataCheckService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: OTHER, problemId: `mother_too_old:${anne}` }))
            .rejects.toBeInstanceOf(NotFoundError);
    });

    it('expires when one of the involved dates changes', async () => {
        await query('UPDATE "People" SET "BirthDate" = $1 WHERE "Id" = $2', ['1858-04-01', patrick]);
        const e = await entry();
        expect(e?.kind).toBe('unlikely');
        expect(e?.confirmation).toBeNull();
        // Confirming again replaces the stale row rather than adding a second.
        await confirmDataCheckService({ ...as(OWNER), problemId: `mother_too_old:${anne}`, reason: 'Still right.' });
        expect((await query('SELECT COUNT(*)::int AS n FROM "DataCheckConfirmations"')).rows[0]).toEqual({ n: 1 });
    });

    it('is counted for the overwrite gate, and cleared by an overwrite import', async () => {
        const counts = await getTreeCountsService(as(OWNER));
        expect(counts.dataCheckConfirmations).toBe(1);
        const ged = ['0 HEAD', '0 @I1@ INDI', '1 NAME New /Tree/', '0 TRLR'].join('\n');
        await importGedcomService({ file: new File([ged], 'new.ged', { type: 'text/plain' }), mode: 'overwrite', currentUserId: OWNER });
        expect((await query('SELECT COUNT(*)::int AS n FROM "DataCheckConfirmations" WHERE "TreeId" = $1', [treeId])).rows[0]).toEqual({ n: 0 });
    });
});
