import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { getAuditRecords } from '@/lib/db/queries/audit-records';
import type { AuditLogEntry } from '@/lib/db/schema';
import { addCommentService, getCaseService, strikeCaseNoteService, unstrikeCaseNoteService } from '@/lib/services/cases';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Journal entries are append-only (#1251, ADR 0042): never edited or deleted, only
 * struck out as no longer accurate. The author with Contribute access, or anyone
 * with Edit access, strikes a note or undoes the strike; each change is an audit
 * entry that reverts. Status and conclusion entries are the case's history and
 * can't be struck.
 */

const OWNER = 1;
const EDITOR = 2;
const CONTRIBUTOR = 3;
const VIEWER = 4;
const TREE = 1;

type Row = Record<string, unknown>;

describe('striking out journal entries (#1251)', () => {
    let db: PGlite;
    let caseId: number;
    let sourceId: number;
    const as = (currentUserId: number) => ({ requestedTreeId: TREE, requestedOwnerId: null, currentUserId });
    const comment = async (id: number): Promise<Row | undefined> =>
        (await query(`SELECT * FROM "CaseComments" WHERE "Id" = $1`, [id])).rows[0] as Row | undefined;
    const citations = async (id: number) =>
        (await query(`SELECT "Id", "SourceId", "Page" FROM "Citation" WHERE "FactTable" = 'CaseComments' AND "FactId" = $1`, [id])).rows;
    const entry = async (id: number): Promise<Row> =>
        (await query(`SELECT * FROM "AuditLog" WHERE "Id" = $1`, [id])).rows[0] as Row;
    const post = async (userId: number, body: string) =>
        (await addCommentService({ id: caseId, body, ...as(userId) })).Id;

    beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
    afterAll(async () => { __setTestDb(null); await db.close(); });
    beforeEach(async () => {
        await truncateAllTables(db);
        for (const [id, name] of [[OWNER, 'owner'], [EDITOR, 'editor'], [CONTRIBUTOR, 'contributor'], [VIEWER, 'viewer']] as const) {
            await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)`, [id, `${name}@example.test`, name]);
        }
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES ($1, $2, 'Arbor')`, [TREE, OWNER]);
        for (const [userId, permission] of [[EDITOR, 'edit'], [CONTRIBUTOR, 'contribute'], [VIEWER, 'view']] as const) {
            await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, $3, $4)`, [OWNER, userId, permission, TREE]);
        }
        caseId = ((await query(`INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Who were Ada''s parents?') RETURNING "Id"`, [OWNER, TREE])).rows[0] as { Id: number }).Id;
        sourceId = ((await query(`INSERT INTO "Sources" ("Title", "TreeId", "OwnerId") VALUES ('1901 Census', $1, $2) RETURNING "Id"`, [TREE, OWNER])).rows[0] as { Id: number }).Id;
    });

    it('strikes an entry out with a reason, keeps its text and citation, audits it and reverts it', async () => {
        const id = await post(CONTRIBUTOR, 'Ada was born in 1871.');
        await query(
            `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page") VALUES ($1, $2, 'CaseComments', $3, $4, 'p. 12')`,
            [OWNER, TREE, id, sourceId],
        );
        const result = await strikeCaseNoteService({ caseId, commentId: id, reason: '  A different Ada:\n born in 1872  ', ...as(EDITOR) });
        expect(result).toMatchObject({ StruckBy: EDITOR, StruckReason: 'A different Ada: born in 1872' });
        const row = await comment(id);
        expect(row).toMatchObject({ Body: 'Ada was born in 1871.', StruckBy: EDITOR, StruckReason: 'A different Ada: born in 1872' });
        expect(row?.StruckAt).toBeTruthy();
        expect(await citations(id)).toHaveLength(1);

        // The case shows it in place, struck, with who struck it.
        const theCase = await getCaseService({ id: caseId, ...as(OWNER) });
        expect(theCase.comments.find((c) => c.Id === id)).toMatchObject({ Body: 'Ada was born in 1871.', StruckByName: 'editor@example.test', StruckReason: 'A different Ada: born in 1872' });

        const audit = await entry(result.auditIds[0]);
        expect(audit).toMatchObject({
            Action: 'update', EntityType: 'casenote', EntityId: id, UserId: EDITOR, TreeId: TREE,
            EntityLabel: "Journal note — Who were Ada's parents?",
            Changes: { snapshot: expect.objectContaining({ struck: true, StruckBy: EDITOR, before: { StruckAt: null, StruckBy: null, StruckReason: null } }) },
        });
        // The log's Record column names the case.
        const records = await getAuditRecords(TREE, [audit as unknown as AuditLogEntry]);
        expect(records[result.auditIds[0]]).toMatchObject({ kind: 'case', id: caseId, name: "Who were Ada's parents?", item: { kind: 'journalEntry' } });

        await revertAuditEntry(result.auditIds[0], TREE, OWNER, OWNER);
        expect(await comment(id)).toMatchObject({ StruckAt: null, StruckBy: null, StruckReason: null, Body: 'Ada was born in 1871.' });

        // The revert left an entry of its own, which strikes it again as it was.
        const marker = (await query(`SELECT "Id", "Changes" FROM "AuditLog" WHERE "EntityType" = 'casenote' ORDER BY "Id" DESC LIMIT 1`, [])).rows[0] as { Id: number; Changes: { snapshot: { struck: boolean } } };
        expect(marker.Changes.snapshot.struck).toBe(false);
        await revertAuditEntry(marker.Id, TREE, OWNER, OWNER);
        expect(await comment(id)).toMatchObject({ StruckAt: row?.StruckAt, StruckBy: EDITOR, StruckReason: 'A different Ada: born in 1872' });
    });

    it('undoes a strike, audited, and refuses to strike twice or undo an entry that stands', async () => {
        const id = await post(OWNER, 'Checked the 1901 census.');
        await expect(unstrikeCaseNoteService({ caseId, commentId: id, ...as(OWNER) })).rejects.toThrow(/not struck out/);
        await strikeCaseNoteService({ caseId, commentId: id, ...as(OWNER) });
        expect((await comment(id))?.StruckReason).toBeNull();
        await expect(strikeCaseNoteService({ caseId, commentId: id, reason: 'again', ...as(OWNER) })).rejects.toThrow(/already struck/);
        const { auditIds } = await unstrikeCaseNoteService({ caseId, commentId: id, ...as(EDITOR) });
        expect(await comment(id)).toMatchObject({ StruckAt: null, StruckBy: null, StruckReason: null });
        expect((await entry(auditIds[0])).Changes).toMatchObject({ snapshot: { struck: false, before: { StruckBy: OWNER } } });
    });

    it('lets a contributor strike and undo only their own entries, and a viewer none', async () => {
        const own = await post(CONTRIBUTOR, 'My entry.');
        const others = await post(OWNER, 'Owner entry.');
        await strikeCaseNoteService({ caseId, commentId: own, ...as(CONTRIBUTOR) });
        await unstrikeCaseNoteService({ caseId, commentId: own, ...as(CONTRIBUTOR) });
        await expect(strikeCaseNoteService({ caseId, commentId: others, ...as(CONTRIBUTOR) })).rejects.toThrow(/your own/);
        await expect(strikeCaseNoteService({ caseId, commentId: own, ...as(VIEWER) })).rejects.toThrow(/view permission/);
        await strikeCaseNoteService({ caseId, commentId: others, ...as(OWNER) });
        await expect(unstrikeCaseNoteService({ caseId, commentId: others, ...as(CONTRIBUTOR) })).rejects.toThrow(/your own/);
        expect((await comment(own))?.StruckAt).toBeNull();
        expect((await comment(others))?.StruckAt).not.toBeNull();
    });

    it('never strikes status or conclusion entries, or a closed case, and the table refuses it too', async () => {
        const status = ((await query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind") VALUES ($1, $2, 'on_hold', 'status') RETURNING "Id"`, [caseId, OWNER])).rows[0] as { Id: number }).Id;
        await expect(strikeCaseNoteService({ caseId, commentId: status, ...as(OWNER) })).rejects.toThrow(/not found/);
        await expect(query(`UPDATE "CaseComments" SET "StruckAt" = NOW() WHERE "Id" = $1`, [status])).rejects.toThrow(/casecomments_struck_check/);

        const id = await post(OWNER, 'Last entry.');
        await expect(query(`UPDATE "CaseComments" SET "StruckReason" = 'why' WHERE "Id" = $1`, [id])).rejects.toThrow(/casecomments_struck_check/);
        await query(`UPDATE "Cases" SET "Status" = 'closed' WHERE "Id" = $1`, [caseId]);
        await expect(strikeCaseNoteService({ caseId, commentId: id, ...as(OWNER) })).rejects.toThrow(/closed case/);
    });

    it('refuses a reason that is not text or is too long', async () => {
        const id = await post(OWNER, 'Entry.');
        await expect(strikeCaseNoteService({ caseId, commentId: id, reason: 5, ...as(OWNER) })).rejects.toThrow(/text/);
        await expect(strikeCaseNoteService({ caseId, commentId: id, reason: 'x'.repeat(501), ...as(OWNER) })).rejects.toThrow(/500/);
        expect((await comment(id))?.StruckAt).toBeNull();
    });

    it('keeps a closed case read-only on revert, and forgets a gone striker', async () => {
        const id = await post(CONTRIBUTOR, 'Contributor entry.');
        const { auditIds } = await strikeCaseNoteService({ caseId, commentId: id, ...as(EDITOR) });
        await query(`UPDATE "Cases" SET "Status" = 'closed' WHERE "Id" = $1`, [caseId]);
        await expect(revertAuditEntry(auditIds[0], TREE, OWNER, OWNER)).rejects.toThrow(/closed/);
        expect((await comment(id))?.StruckAt).not.toBeNull();

        await query(`DELETE FROM "TreeSharing" WHERE "SharedWithId" = $1`, [EDITOR]);
        await query(`DELETE FROM "Users" WHERE "Id" = $1`, [EDITOR]);
        expect(await comment(id)).toMatchObject({ StruckBy: null, Body: 'Contributor entry.' });
        expect((await comment(id))?.StruckAt).not.toBeNull();
    });

    it('reverts an undo whose striker has gone since, leaving no striker', async () => {
        const id = await post(OWNER, 'Entry.');
        await strikeCaseNoteService({ caseId, commentId: id, reason: 'Wrong', ...as(EDITOR) });
        const { auditIds } = await unstrikeCaseNoteService({ caseId, commentId: id, ...as(OWNER) });
        await query(`DELETE FROM "TreeSharing" WHERE "SharedWithId" = $1`, [EDITOR]);
        await query(`DELETE FROM "Users" WHERE "Id" = $1`, [EDITOR]);
        await revertAuditEntry(auditIds[0], TREE, OWNER, OWNER);
        expect(await comment(id)).toMatchObject({ StruckBy: null, StruckReason: 'Wrong' });
        expect((await comment(id))?.StruckAt).not.toBeNull();
    });

    it('no longer reverts the edits and deletes entries had before they became append-only', async () => {
        const id = await post(OWNER, 'Checked the 1911 census.');
        const legacy = async (action: string, changes: unknown) => ((await query(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $1, $2, $3, 'casenote', $4, 'Journal note — Who were Ada''s parents?', $5) RETURNING *`,
            [OWNER, TREE, action, id, JSON.stringify(changes)],
        )).rows[0] as AuditLogEntry);
        const snapshot = { CommentId: id, CaseId: caseId, TreeId: TREE, CaseTitle: "Who were Ada's parents?", UserId: OWNER, Text: 'Checked the 1911 census.', MediaId: null, CreatedAt: null, Citations: [] };
        const edit = await legacy('update', { fields: { Text: { old: 'Checked the 1901 census.', new: 'Checked the 1911 census.' } }, snapshot });
        const deleted = await legacy('delete', { snapshot: { ...snapshot, CommentId: id + 100 } });

        // They still name their case in the log.
        const records = await getAuditRecords(TREE, [edit, deleted]);
        expect(records[edit.Id]).toMatchObject({ kind: 'case', id: caseId, item: { kind: 'journalEntry' } });
        await expect(revertAuditEntry(edit.Id, TREE, OWNER, OWNER)).rejects.toThrow(/append-only/);
        await expect(revertAuditEntry(deleted.Id, TREE, OWNER, OWNER)).rejects.toThrow(/append-only/);
        expect((await comment(id))?.Body).toBe('Checked the 1911 census.');
    });

    it('does not reach an entry through another case', async () => {
        const id = await post(OWNER, 'Entry.');
        const other = ((await query(`INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Other') RETURNING "Id"`, [OWNER, TREE])).rows[0] as { Id: number }).Id;
        await expect(strikeCaseNoteService({ caseId: other, commentId: id, ...as(OWNER) })).rejects.toThrow(/not found/);
        expect((await comment(id))?.StruckAt).toBeNull();
    });
});
