import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { initializeSchema } from '@/lib/db/init-schema';
import { createCaseService, addCommentService, getCaseService, updateCaseService } from '@/lib/services/cases';
import {
    addClaimService, addFindingService, addLeadService, addRequestService, changeLeadService, decideClaimService,
    getCaseWorkspaceService, replyToRequestService,
} from '@/lib/services/case-workspace';
import { deletePerson } from '@/lib/db/queries/people';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { leadStatus } from '@/lib/cases/lead-status';
import { exportCasesData } from '@/lib/db/queries/cases';
import { buildCasesSidecar } from '@/lib/gedcom/cases-sidecar';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The research workspace's data (#58, ADR 0045): leads, findings with their
 * claims, requests, journal filing, the locks, a person delete and its Undo,
 * and the v69 backfill.
 */

const OWNER = 1;
const VIEWER = 2;
const OTHER = 3;
const TREE = 1;
const OTHER_TREE = 2;

type Row = Record<string, unknown>;

describe('the research workspace (#58)', () => {
    let db: PGlite;
    let ada: number;
    let bert: number;
    let stranger: number;
    let census: number;
    const as = (currentUserId: number, requestedTreeId = TREE) => ({ requestedTreeId, requestedOwnerId: null, currentUserId });
    const newCase = async (title = "Who were Ada's parents?") =>
        (await createCaseService({ body: { Title: title, personIds: [ada], FromYear: 1860, ToYear: 1880, Place: 'Leeds', QuestionKind: 'parents' }, ...as(OWNER) })).Id;
    const rows = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows as Row[];

    beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
    afterAll(async () => { __setTestDb(null); await db.close(); });
    beforeEach(async () => {
        await truncateAllTables(db);
        for (const [id, name] of [[OWNER, 'owner'], [VIEWER, 'viewer'], [OTHER, 'other']] as const) {
            await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)`, [id, `${name}@example.test`, name]);
        }
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES ($1, $2, 'Arbor'), ($3, $4, 'Elsewhere')`, [TREE, OWNER, OTHER_TREE, OTHER]);
        await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, 'view', $3)`, [OWNER, VIEWER, TREE]);
        const person = async (first: string, tree = TREE, owner = OWNER) =>
            Number((await rows(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, $3, 'Moss') RETURNING "Id"`, [owner, tree, first]))[0].Id);
        ada = await person('Ada');
        bert = await person('Bert');
        stranger = await person('Stranger', OTHER_TREE, OTHER);
        census = Number((await rows(`INSERT INTO "Sources" ("Title", "TreeId", "OwnerId") VALUES ('1881 Census', $1, $2) RETURNING "Id"`, [TREE, OWNER]))[0].Id);
    });

    it('gives a new case its scope and its question as the first lead, with its people', async () => {
        const caseId = await newCase();
        const theCase = await getCaseService({ id: caseId, ...as(OWNER) });
        expect(theCase).toMatchObject({ FromYear: 1860, ToYear: 1880, Place: 'Leeds', QuestionKind: 'parents' });
        const ws = await getCaseWorkspaceService({ caseId, ...as(OWNER) });
        expect(ws.leads).toHaveLength(1);
        expect(ws.leads[0]).toMatchObject({ Question: "Who were Ada's parents?", FromYear: 1860, ToYear: 1880, Position: 0 });
        expect(ws.leads[0].people.map((p) => p.Id)).toEqual([ada]);
        expect(leadStatus(ws.leads[0], ws.findings, ws.requests)).toBe('to_search');
    });

    it('adds leads, records and claims, and works out each lead’s status', async () => {
        const caseId = await newCase();
        const added = await addLeadService({ caseId, ...as(OWNER), body: { question: 'Find Bert in 1881', toYear: 1881, personIds: [bert, stranger] } });
        const leadId = added.id!;
        const lead = added.workspace.leads.find((l) => l.Id === leadId)!;
        // A person from another tree is dropped; one added on a lead joins the case.
        expect(lead.people.map((p) => p.Id)).toEqual([bert]);
        expect((await getCaseService({ id: caseId, ...as(OWNER) })).people.map((p) => p.Id).sort()).toEqual([ada, bert].sort());

        const record = await addFindingService({
            caseId, ...as(OWNER), body: {
                kind: 'record', leadIds: [leadId], source: { id: census }, page: 'RG11/4567', sourceNature: 'original', information: 'primary',
                claims: [
                    { what: 'BIRT', personId: bert, date: 'abt 1851', place: 'Leeds', evidence: 'direct' },
                    { what: 'Father', personName: 'John Moss', evidence: 'indirect' },
                ],
            },
        });
        const finding = record.workspace.findings.find((f) => f.Id === record.id)!;
        expect(finding).toMatchObject({ Kind: 'record', SourceNature: 'original', leadIds: [leadId], citation: { SourceId: census, sourceTitle: '1881 Census', Page: 'RG11/4567' } });
        expect(finding.claims.map((c) => [c.What, c.PersonId, c.personLabel, c.PersonName, c.Decision])).toEqual([
            ['BIRT', bert, expect.stringContaining('Bert'), null, 'undecided'],
            ['Father', null, null, 'John Moss', 'undecided'],
        ]);
        expect(leadStatus(record.workspace.leads.find((l) => l.Id === leadId)!, record.workspace.findings, record.workspace.requests)).toBe('in_progress');
        // The citation is a normal one: the source's cited-by sees it.
        expect(await rows(`SELECT "FactId" FROM "Citation" WHERE "FactTable" = 'CaseFindings'`)).toEqual([{ FactId: record.id }]);

        // A new source made from a finding is a real source, audited.
        const fresh = await addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { title: 'Parish register', repository: 'Leeds archive' } } });
        expect(fresh.workspace.findings.find((f) => f.Id === fresh.id)!.citation?.sourceTitle).toBe('Parish register');
        expect(await rows(`SELECT "EntityType" FROM "AuditLog" WHERE "Action" = 'create' AND "EntityType" = 'source'`)).toHaveLength(1);

        const nothing = await addFindingService({ caseId, ...as(OWNER), body: { kind: 'nothing', leadIds: [leadId], searched: '1871 census, Leeds', site: 'FreeCEN' } });
        expect(nothing.workspace.findings.find((f) => f.Id === nothing.id)).toMatchObject({ Kind: 'nothing', Searched: '1871 census, Leeds', citation: null, claims: [] });

        // The journal tells the story, each entry filed under its lead.
        const journal = (await getCaseService({ id: caseId, ...as(OWNER) })).comments;
        expect(journal.map((c) => [c.Kind, c.Body, c.leadIds])).toEqual(expect.arrayContaining([
            ['lead', 'added', [leadId]],
            ['finding', '1881 Census', [leadId]],
            ['finding', 'Parish register', []],
            ['search', '1871 census, Leeds', [leadId]],
        ]));
    });

    it('makes a journal note’s photo or citation a record under its leads, logged once, by the note', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        const note = await addCommentService({ id: caseId, body: 'Aunt May’s letter names her father', leadIds: [leadId], ...as(OWNER) });
        const made = await addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', leadIds: [leadId], source: { id: census }, page: 'f. 12', commentId: note.Id } });
        expect(made.workspace.findings.find((f) => f.Id === made.id)).toMatchObject({ leadIds: [leadId], claims: [], citation: { SourceId: census, Page: 'f. 12' } });
        // The note is its journal entry: no "Record found" line, and the note points at the record.
        const journal = (await getCaseService({ id: caseId, ...as(OWNER) })).comments;
        expect(journal.filter((c) => c.Kind === 'finding')).toEqual([]);
        expect(journal.find((c) => c.Id === note.Id)?.FindingId).toBe(made.id);
        // Claims are added on its card later.
        const claimed = await addClaimService({ caseId, findingId: made.id!, ...as(OWNER), body: { what: 'Father', personName: 'John Moss' } });
        expect(claimed.workspace.findings.find((f) => f.Id === made.id)!.claims).toHaveLength(1);

        // A note becomes one record only, and an app-written entry never does.
        await expect(addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: census }, commentId: note.Id } })).rejects.toThrow(/already a record/);
        await addFindingService({ caseId, ...as(OWNER), body: { kind: 'nothing', leadIds: [leadId], searched: '1871 census' } });
        const logged = (await getCaseService({ id: caseId, ...as(OWNER) })).comments.find((c) => c.Kind === 'search')!;
        await expect(addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: census }, commentId: logged.Id } })).rejects.toThrow(/not in this case/);
        const other = await newCase('Another question');
        const elsewhere = await addCommentService({ id: other, body: 'Elsewhere', ...as(OWNER) });
        await expect(addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: census }, commentId: elsewhere.Id } })).rejects.toThrow(/not in this case/);
    });

    it('settles a lead only when every claim is decided, then locks its claims until reopened', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        const record = await addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', leadIds: [leadId], source: { id: census }, claims: [{ what: 'BIRT', personId: ada }] } });
        const claimId = record.workspace.findings[0].claims[0].Id;

        await expect(changeLeadService({ caseId, leadId, ...as(OWNER), body: { action: 'settle' } })).rejects.toThrow(/1 undecided/);
        await decideClaimService({ caseId, claimId, ...as(OWNER), body: { decision: 'accepted' } });
        const settled = await changeLeadService({ caseId, leadId, ...as(OWNER), body: { action: 'settle' } });
        expect(leadStatus(settled.workspace.leads[0], settled.workspace.findings, settled.workspace.requests)).toBe('settled');

        await expect(decideClaimService({ caseId, claimId, ...as(OWNER), body: { decision: 'rejected' } })).rejects.toThrow(/settled lead/);
        await expect(addClaimService({ caseId, findingId: record.id!, ...as(OWNER), body: { what: 'DEAT' } })).rejects.toThrow(/settled lead/);
        await expect(addFindingService({ caseId, ...as(OWNER), body: { kind: 'nothing', leadIds: [leadId], searched: 'x' } })).rejects.toThrow(/settled/);

        await changeLeadService({ caseId, leadId, ...as(OWNER), body: { action: 'reopen' } });
        const decided = await decideClaimService({ caseId, claimId, ...as(OWNER), body: { decision: 'rejected' } });
        expect(decided.workspace.findings[0].claims[0].Decision).toBe('rejected');

        // A dropped lead keeps its findings and takes no new filing.
        const dropped = await changeLeadService({ caseId, leadId, ...as(OWNER), body: { action: 'drop' } });
        expect(dropped.workspace.leads[0].DroppedAt).toBeTruthy();
        expect(dropped.workspace.findings).toHaveLength(1);
        await expect(addCommentService({ id: caseId, body: 'note', leadIds: [leadId], ...as(OWNER) })).rejects.toThrow(/not in this case/);
    });

    it('tracks a request: its lead waits until the reply is logged', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        const asked = await addRequestService({ caseId, ...as(OWNER), body: { leadId, askedFor: 'Baptism entry', holder: 'Leeds archive', sentBy: 'email', sentOn: '2026-11-01', remindOn: '2026-12-01' } });
        expect(asked.workspace.requests[0]).toMatchObject({ AskedFor: 'Baptism entry', SentOn: '2026-11-01', RemindOn: '2026-12-01', State: 'waiting' });
        expect(leadStatus(asked.workspace.leads[0], asked.workspace.findings, asked.workspace.requests)).toBe('waiting');
        await expect(addRequestService({ caseId, ...as(OWNER), body: { askedFor: 'x', sentOn: '2026-13-45' } })).rejects.toThrow(/date/);

        const replied = await replyToRequestService({ caseId, requestId: asked.id!, ...as(OWNER), body: { state: 'nothing', note: 'No entry for 1851' } });
        expect(replied.workspace.requests[0]).toMatchObject({ State: 'nothing', ReplyNote: 'No entry for 1851' });
        expect(leadStatus(replied.workspace.leads[0], replied.workspace.findings, replied.workspace.requests)).toBe('to_search');
        await expect(replyToRequestService({ caseId, requestId: asked.id!, ...as(OWNER), body: { state: 'received' } })).rejects.toThrow(/already/);
        const kinds = (await getCaseService({ id: caseId, ...as(OWNER) })).comments.map((c) => c.Kind);
        expect(kinds).toEqual(expect.arrayContaining(['request', 'reply']));
    });

    it('refuses viewers, other trees, foreign files and closed cases', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        await expect(addLeadService({ caseId, ...as(VIEWER), body: { question: 'x' } })).rejects.toThrow(/view permission/);
        expect((await getCaseWorkspaceService({ caseId, ...as(VIEWER) })).leads).toHaveLength(1);
        await expect(getCaseWorkspaceService({ caseId, ...as(OTHER, OTHER_TREE) })).rejects.toThrow(/not found/);
        await expect(addLeadService({ caseId, ...as(OTHER, OTHER_TREE), body: { question: 'x' } })).rejects.toThrow(/not found/);

        const foreignSource = Number((await rows(`INSERT INTO "Sources" ("Title", "TreeId", "OwnerId") VALUES ('Theirs', $1, $2) RETURNING "Id"`, [OTHER_TREE, OTHER]))[0].Id);
        await expect(addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: foreignSource } } })).rejects.toThrow(/not in this tree/);
        const foreignMedia = Number((await rows(`INSERT INTO "Media" ("UserId", "TreeId", "FilePath", "Title") VALUES ($1, $2, 'x.jpg', 'x') RETURNING "Id"`, [OTHER, OTHER_TREE]))[0].Id);
        await expect(addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: census }, mediaId: foreignMedia } })).rejects.toThrow(/not in this tree/);
        await expect(addLeadService({ caseId, ...as(OWNER), body: { question: 'x', fromYear: 1900, toYear: 1850 } })).rejects.toThrow(/after/);

        const other = await newCase('Another case');
        const otherLead = (await getCaseWorkspaceService({ caseId: other, ...as(OWNER) })).leads[0].Id;
        await expect(changeLeadService({ caseId, leadId: otherLead, ...as(OWNER), body: { action: 'settle' } })).rejects.toThrow(/not found/);

        await updateCaseService({ id: caseId, body: { Status: 'closed', Conclusion: 'Ada was the daughter of John.', Outcome: 'answered' }, ...as(OWNER) });
        const closed = await getCaseService({ id: caseId, ...as(OWNER) });
        expect(closed).toMatchObject({ Status: 'closed', Outcome: 'answered' });
        expect(closed.ClosedAt).toBeTruthy();
        await expect(changeLeadService({ caseId, leadId, ...as(OWNER), body: { action: 'drop' } })).rejects.toThrow(/closed case/);
        await updateCaseService({ id: caseId, body: { Status: 'in_progress' }, ...as(OWNER) });
        expect(await getCaseService({ id: caseId, ...as(OWNER) })).toMatchObject({ Outcome: null, ClosedAt: null });
    });

    it('files a researcher’s note under leads', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        const note = await addCommentService({ id: caseId, body: 'Try the parish next.', leadIds: [leadId], ...as(OWNER) });
        expect(note.leadIds).toEqual([leadId]);
        expect((await getCaseService({ id: caseId, ...as(OWNER) })).comments.find((c) => c.Id === note.Id)?.leadIds).toEqual([leadId]);
    });

    it('keeps lead links and claims through a person delete and its Undo', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        await addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', source: { id: census }, claims: [{ what: 'BIRT', personId: ada, says: '1851' }] } });

        await deletePerson(ada, TREE, OWNER);
        const after = await getCaseWorkspaceService({ caseId, ...as(OWNER) });
        expect(after.leads[0].people).toEqual([]);
        expect(after.findings[0].claims[0]).toMatchObject({ PersonId: null, Says: '1851' });

        const auditId = Number((await rows(`SELECT "Id" FROM "AuditLog" WHERE "Action" = 'delete' AND "EntityType" = 'person'`))[0].Id);
        await revertAuditEntry(auditId, TREE, OWNER, OWNER);
        const back = await getCaseWorkspaceService({ caseId, ...as(OWNER) });
        expect(back.leads[0].people.map((p) => p.Id)).toEqual([ada]);
        expect(back.findings[0].claims[0].PersonId).toBe(ada);
        expect(back.leads[0].Id).toBe(leadId);
    });

    it('exports the workspace to cases.json by xref and index', async () => {
        const caseId = await newCase();
        const leadId = (await getCaseWorkspaceService({ caseId, ...as(OWNER) })).leads[0].Id;
        const request = await addRequestService({ caseId, ...as(OWNER), body: { leadId, askedFor: 'Baptism entry' } });
        await addFindingService({ caseId, ...as(OWNER), body: { kind: 'record', leadIds: [leadId], requestId: request.id, source: { id: census }, page: 'p. 4', claims: [{ what: 'BIRT', personId: ada }] } });
        const sidecar = buildCasesSidecar(await exportCasesData(TREE), {
            personIdToXref: new Map([[ada, '@I1@']]),
            sourceIdToXref: new Map([[census, '@S1@']]),
            mediaIdToXref: new Map(),
        });
        const c = sidecar.cases[0];
        expect(c).toMatchObject({ FromYear: 1860, ToYear: 1880, Place: 'Leeds', QuestionKind: 'parents' });
        expect(c.leads).toEqual([expect.objectContaining({ Question: "Who were Ada's parents?", people: ['@I1@'] })]);
        expect(c.requests).toEqual([expect.objectContaining({ AskedFor: 'Baptism entry', lead: 0, State: 'waiting' })]);
        expect(c.findings).toEqual([expect.objectContaining({
            Kind: 'record', leads: [0], request: 0, citation: expect.objectContaining({ source: '@S1@', page: 'p. 4' }),
            claims: [expect.objectContaining({ What: 'BIRT', person: '@I1@', Decision: 'undecided' })],
        })]);
        expect(c.comments.find((cm) => cm.Kind === 'finding')).toMatchObject({ leads: [0], finding: 0 });
        expect(c.comments.find((cm) => cm.Kind === 'request')).toMatchObject({ leads: [0], request: 0 });
    });
});

describe('the v69 migration (#58)', () => {
    it('gives every existing case its question as a first lead once, and widens the journal kinds', async () => {
        const db = await newEmptyClusterDb();
        const exec = { query: (text: string, params?: unknown[]) => db.query(text, params) };
        await initializeSchema(exec);
        await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'v69@test.local', 'v69')`);
        await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Old')`);
        const caseId = (await db.query<{ Id: number }>(`INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES (1, 1, 'An old case') RETURNING "Id"`)).rows[0].Id;
        const person = (await db.query<{ Id: number }>(`INSERT INTO "People" ("UserId", "TreeId", "FirstName") VALUES (1, 1, 'Ada') RETURNING "Id"`)).rows[0].Id;
        await db.query(`INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ($1, $2)`, [caseId, person]);
        // An old database: its Kind check is the inline one that allowed status and conclusion only.
        await db.query(`ALTER TABLE "CaseComments" DROP CONSTRAINT casecomments_kind_check`);
        await db.query(`ALTER TABLE "CaseComments" ADD CONSTRAINT "CaseComments_Kind_check" CHECK ("Kind" IN ('status', 'conclusion'))`);

        await initializeSchema(exec);
        await initializeSchema(exec);

        const leads = (await db.query<Row>(`SELECT "Id", "Question", "Position" FROM "CaseLeads" WHERE "CaseId" = $1`, [caseId])).rows;
        expect(leads).toEqual([expect.objectContaining({ Question: 'An old case', Position: 0 })]);
        const people = (await db.query<Row>(`SELECT "PersonId" FROM "CaseLeadPerson" WHERE "LeadId" = $1`, [leads[0].Id])).rows;
        expect(people).toEqual([{ PersonId: person }]);
        await db.query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind") VALUES ($1, 1, 'added', 'lead')`, [caseId]);
        await expect(db.query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind") VALUES ($1, 1, 'x', 'bogus')`, [caseId])).rejects.toThrow();
        const checks = (await db.query<Row>(`SELECT conname FROM pg_constraint WHERE conrelid = '"CaseComments"'::regclass AND contype = 'c' AND conname <> 'casecomments_struck_check' AND pg_get_constraintdef(oid) LIKE '%Kind%' ORDER BY 1`)).rows;
        expect(checks.map((c) => c.conname)).toEqual(['casecomments_kind_check']);
        await db.close();
    });
});
