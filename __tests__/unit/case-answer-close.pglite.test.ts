import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { createCaseService, deleteCaseService, getCaseService } from '@/lib/services/cases';
import {
    addFindingService, closeCaseService, decideClaimService, getCaseChangesService, undoAppliedClaimService,
} from '@/lib/services/case-workspace';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Answer and close (#58, ADR 0046): accepted claims fill empty births and deaths,
 * replace what differs only when ticked, become new events or cite the event the
 * tree has, each as audited changes with a citation; Undo puts each back.
 */

const OWNER = 1;
const CONTRIB = 2;
const TREE = 1;
type Row = Record<string, unknown>;

describe('Answer and close (#58)', () => {
    let db: PGlite;
    let ada: number;
    let bert: number;
    let census: number;
    const as = (currentUserId: number) => ({ requestedTreeId: TREE, requestedOwnerId: null, currentUserId });
    const rows = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows as Row[];

    beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
    afterAll(async () => { __setTestDb(null); await db.close(); });
    beforeEach(async () => {
        await truncateAllTables(db);
        for (const [id, name] of [[OWNER, 'owner'], [CONTRIB, 'contrib']] as const) {
            await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)`, [id, `${name}@example.test`, name]);
        }
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES ($1, $2, 'Arbor')`, [TREE, OWNER]);
        await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, 'contribute', $3)`, [OWNER, CONTRIB, TREE]);
        ada = Number((await rows(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "BirthDate") VALUES ($1, $2, 'Ada', 'Moss', '1851') RETURNING "Id"`, [OWNER, TREE]))[0].Id);
        bert = Number((await rows(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, 'Bert', 'Moss') RETURNING "Id"`, [OWNER, TREE]))[0].Id);
        census = Number((await rows(`INSERT INTO "Sources" ("Title", "TreeId", "OwnerId") VALUES ('1881 Census', $1, $2) RETURNING "Id"`, [TREE, OWNER]))[0].Id);
    });

    /** A case with one record whose claims are all accepted; resolves the case and claim ids by what. */
    async function caseWith(claims: Array<Record<string, unknown>>) {
        const caseId = (await createCaseService({ body: { Title: 'Who were the Mosses?', personIds: [ada, bert] }, ...as(OWNER) })).Id;
        const made = await addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: census }, page: 'RG11/4567', claims } });
        const ids = made.workspace.findings[0].claims.map((c) => c.Id);
        for (const claimId of ids) await decideClaimService({ caseId, claimId, ...as(OWNER), body: { decision: 'accepted' } });
        return { caseId, ids };
    }
    const person = async (id: number) => (await rows(`SELECT * FROM "People" WHERE "Id" = $1`, [id]))[0];

    it('plans each accepted claim: fill, replace when ticked, new event, by hand', async () => {
        const { caseId, ids } = await caseWith([
            { what: 'BIRT', personId: ada, date: '1852', place: 'Leeds' },
            { what: 'DEAT', personId: bert, date: '1920' },
            { what: 'OCCU', personId: bert, says: 'Weaver', date: '1881' },
            { what: 'PARENTS', personId: bert, says: 'John and Mary' },
            { what: 'BIRT', personName: 'Clara Moss', date: '1855' },
        ]);
        const changes = await getCaseChangesService({ caseId, ...as(OWNER) });
        expect(changes.map((c) => [c.claimId, c.kind])).toEqual([
            [ids[0], 'fill'], [ids[1], 'fill'], [ids[2], 'event'], [ids[3], 'by_hand'], [ids[4], 'by_hand'],
        ]);
        expect(changes[0]).toMatchObject({ fills: { date: false, place: true }, differs: { date: '1851', place: null }, sourceTitle: '1881 Census', personLabel: 'Ada Moss' });
        expect(changes[4].personLabel).toBe('Clara Moss');
    });

    it('applies the ticked changes with citations and audit entries, then closes', async () => {
        const { caseId, ids } = await caseWith([
            { what: 'BIRT', personId: ada, date: '1852', place: 'Leeds' },
            { what: 'DEAT', personId: bert, date: '1920' },
            { what: 'OCCU', personId: bert, says: 'Weaver', date: '1881', place: 'Leeds' },
        ]);
        const closed = await closeCaseService({
            caseId, ...as(OWNER),
            body: { conclusion: 'Found them.', outcome: 'answered', apply: [{ claimId: ids[0] }, { claimId: ids[1] }, { claimId: ids[2] }] },
        });
        // Ada keeps her birth year (Replace was not ticked) and gains the place; Bert dies.
        expect(await person(ada)).toMatchObject({ BirthDate: '1851' });
        expect((await rows(`SELECT pl."Name" FROM "People" p JOIN "Places" pl ON pl."Id" = p."BirthPlaceId" WHERE p."Id" = $1`, [ada]))[0].Name).toBe('Leeds');
        expect(await person(bert)).toMatchObject({ DeathDate: '1920', IsDeceased: 1 });
        const events = await rows(`SELECT * FROM "Events" WHERE "PersonId" = $1`, [bert]);
        expect(events).toMatchObject([{ Type: 'OCCU', Date: '1881', Description: 'Weaver' }]);
        const cites = await rows(`SELECT "FactTable", "FactId", "Page" FROM "Citation" WHERE "SourceId" = $1 AND "FactTable" <> 'CaseFindings' ORDER BY "Id"`, [census]);
        expect(cites).toEqual([
            { FactTable: 'PersonBirth', FactId: ada, Page: 'RG11/4567' },
            { FactTable: 'PersonDeath', FactId: bert, Page: 'RG11/4567' },
            { FactTable: 'Events', FactId: events[0].Id, Page: 'RG11/4567' },
        ]);
        expect(closed.workspace.findings[0].claims.every((c) => c.AppliedAt != null && c.undoable)).toBe(true);
        // Each change is its own entry: three facts and three citations.
        const audit = await rows(`SELECT "EntityType", "Action" FROM "AuditLog" WHERE "EntityType" IN ('person', 'event', 'citation') ORDER BY "Id"`);
        expect(audit.map((a) => `${a.EntityType}:${a.Action}`)).toEqual([
            'person:update', 'citation:create', 'person:update', 'citation:create', 'event:create', 'citation:create',
        ]);
        const theCase = await getCaseService({ id: caseId, ...as(OWNER) });
        expect(theCase).toMatchObject({ Status: 'closed', Outcome: 'answered' });
        // A case that changed the tree can't be deleted until it is undone.
        await expect(deleteCaseService({ id: caseId, ...as(OWNER) })).rejects.toThrow(/Undo its changes/);
    });

    it('replaces what the tree says only when ticked, and Undo puts it back', async () => {
        const { caseId, ids } = await caseWith([{ what: 'BIRT', personId: ada, date: '1852' }]);
        await closeCaseService({ caseId, ...as(OWNER), body: { conclusion: 'Born 1852.', outcome: 'answered', apply: [{ claimId: ids[0], replace: true }] } });
        expect(await person(ada)).toMatchObject({ BirthDate: '1852' });
        const undone = await undoAppliedClaimService({ caseId, claimId: ids[0], ...as(OWNER) });
        expect(await person(ada)).toMatchObject({ BirthDate: '1851' });
        expect(await rows(`SELECT 1 FROM "Citation" WHERE "FactTable" = 'PersonBirth'`)).toHaveLength(0);
        expect(undone.workspace.findings[0].claims[0]).toMatchObject({ AppliedAt: null, undoable: false });
        // Nothing applied now, so the case can go.
        await expect(deleteCaseService({ id: caseId, ...as(OWNER) })).resolves.toBeUndefined();
    });

    it('a change with only a difference needs Replace ticked', async () => {
        const { caseId, ids } = await caseWith([{ what: 'BIRT', personId: ada, date: '1852' }]);
        await expect(closeCaseService({ caseId, ...as(OWNER), body: { conclusion: 'x', outcome: 'answered', apply: [{ claimId: ids[0] }] } }))
            .rejects.toThrow(/Tick Replace/);
        // The failed close changed nothing.
        expect((await getCaseService({ id: caseId, ...as(OWNER) })).Status).not.toBe('closed');
        expect(await person(ada)).toMatchObject({ BirthDate: '1851' });
    });

    it('cites the event the tree already has, and Undo removes just that citation', async () => {
        const event = Number((await rows(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "PersonId") VALUES ($1, $2, 'RESI', '1881', $3) RETURNING "Id"`, [OWNER, TREE, bert]))[0].Id);
        const { caseId, ids } = await caseWith([{ what: 'RESI', personId: bert, date: '1881', place: 'Leeds' }]);
        expect((await getCaseChangesService({ caseId, ...as(OWNER) }))[0].kind).toBe('cite');
        await closeCaseService({ caseId, ...as(OWNER), body: { conclusion: 'x', outcome: 'answered', apply: [{ claimId: ids[0] }] } });
        expect(await rows(`SELECT "FactId" FROM "Citation" WHERE "FactTable" = 'Events'`)).toEqual([{ FactId: event }]);
        await undoAppliedClaimService({ caseId, claimId: ids[0], ...as(OWNER) });
        expect(await rows(`SELECT 1 FROM "Events" WHERE "Id" = $1`, [event])).toHaveLength(1);
        expect(await rows(`SELECT 1 FROM "Citation" WHERE "FactTable" = 'Events'`)).toHaveLength(0);
    });

    it('Undo of a new event deletes it; Undo refuses after the person is edited; contributors can’t undo', async () => {
        const { caseId, ids } = await caseWith([
            { what: 'BURI', personId: bert, date: '1920' },
            { what: 'DEAT', personId: bert, date: '1920' },
        ]);
        await closeCaseService({ caseId, ...as(OWNER), body: { conclusion: 'x', outcome: 'answered', apply: [{ claimId: ids[0] }, { claimId: ids[1] }] } });
        await expect(undoAppliedClaimService({ caseId, claimId: ids[0], ...as(CONTRIB) })).rejects.toThrow(/permission/);
        await undoAppliedClaimService({ caseId, claimId: ids[0], ...as(OWNER) });
        expect(await rows(`SELECT 1 FROM "Events" WHERE "PersonId" = $1`, [bert])).toHaveLength(0);
        await query(`UPDATE "People" SET "DeathDate" = '1921' WHERE "Id" = $1`, [bert]);
        await expect(undoAppliedClaimService({ caseId, claimId: ids[1], ...as(OWNER) })).rejects.toThrow(/edited since/);
    });

    it('plans each claim after the one before: a second claim cites, or needs Replace', async () => {
        const { caseId, ids } = await caseWith([
            { what: 'DEAT', personId: bert, date: '1920' },
            { what: 'DEAT', personId: bert, date: '1920' },
            { what: 'RESI', personId: bert, date: '1881' },
            { what: 'RESI', personId: bert, date: '1881' },
        ]);
        await closeCaseService({ caseId, ...as(OWNER), body: { conclusion: 'x', outcome: 'answered', apply: ids.map((claimId) => ({ claimId })) } });
        expect(await rows(`SELECT 1 FROM "Events" WHERE "PersonId" = $1`, [bert])).toHaveLength(1);
        const second = await createCaseService({ body: { Title: 'Again', personIds: [bert] }, ...as(OWNER) });
        const made = await addFindingService({ caseId: second.Id, ...as(OWNER), body: { kind: 'record', source: { id: census }, claims: [
            { what: 'BIRT', personId: bert, date: '1850' }, { what: 'BIRT', personId: bert, date: '1851' },
        ] } });
        const claimIds = made.workspace.findings[0].claims.map((c) => c.Id);
        for (const claimId of claimIds) await decideClaimService({ caseId: second.Id, claimId, ...as(OWNER), body: { decision: 'accepted' } });
        await expect(closeCaseService({ caseId: second.Id, ...as(OWNER), body: { conclusion: 'x', outcome: 'answered', apply: claimIds.map((claimId) => ({ claimId })) } }))
            .rejects.toThrow(/Tick Replace/);
        expect((await person(bert)).BirthDate).toBeNull();
    });

    it('Undo clears a change already undone from the audit log, and refuses an event edited since', async () => {
        const { caseId, ids } = await caseWith([
            { what: 'DEAT', personId: bert, date: '1920' },
            { what: 'BURI', personId: bert, date: '1920' },
        ]);
        await closeCaseService({ caseId, ...as(OWNER), body: { conclusion: 'x', outcome: 'answered', apply: ids.map((claimId) => ({ claimId })) } });
        await query(`UPDATE "People" SET "DeathDate" = NULL, "IsDeceased" = NULL WHERE "Id" = $1`, [bert]);
        const undone = await undoAppliedClaimService({ caseId, claimId: ids[0], ...as(OWNER) });
        expect(undone.workspace.findings[0].claims[0].AppliedAt).toBeNull();
        expect(await rows(`SELECT 1 FROM "Citation" WHERE "FactTable" = 'PersonDeath'`)).toHaveLength(0);
        await query(`UPDATE "Events" SET "Description" = 'Edited' WHERE "PersonId" = $1`, [bert]);
        await expect(undoAppliedClaimService({ caseId, claimId: ids[1], ...as(OWNER) })).rejects.toThrow(/edited or cited since/);
    });

    it('lets Contribute fill gaps but not replace', async () => {
        const { caseId, ids } = await caseWith([{ what: 'BIRT', personId: ada, date: '1852' }]);
        await expect(closeCaseService({ caseId, ...as(CONTRIB), body: { conclusion: 'x', outcome: 'answered', apply: [{ claimId: ids[0], replace: true }] } }))
            .rejects.toThrow(/permission to replace/);
    });
});

