import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import type {
    Case, NewCase, CaseCitation, CaseComment, CaseCommentKind, CaseOutcome, CaseStatusEntry, CaseWithRelations, MediaWithPerson,
} from '../schema';
import type { Media } from '../schema';
import { hasEditPermission } from './sharing';
import { auditCreate, auditUpdate, auditDelete, type Queryable } from './audit-capture';
import { primaryPhotoJoin } from './media-tags';
import { effectiveFirstName, primaryNickname } from './people';
import type { DbExecutor } from './owner-links';
import { publicMediaColumns } from './media-projection';
import { likeContains } from './like-pattern';
import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';
import { checkFiling, exportWorkspaceData, fileComment, getCommentLeads, type WorkspaceExportRaw } from './case-workspace';

export const ALLOWED_CASE_FIELDS: ReadonlySet<string> = new Set([
    'Title', 'Description', 'Status', 'Tags', 'FromYear', 'ToYear', 'Place', 'QuestionKind',
]);

/** Cheap tree-scoped case existence predicate for media upload validation. */
export async function caseExistsInTree(
    caseId: number,
    treeId: number,
    exec: DbExecutor = { query },
): Promise<boolean> {
    const result = await exec.query(
        'SELECT 1 FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2',
        [caseId, treeId],
    );
    return (result.rowCount ?? 0) > 0;
}

interface CasePersonRow {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    Sex: string | null;
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
}

// ─── Relation helpers ────────────────────────────────────────────────────────

async function fetchPeopleForCases(
    caseIds: number[],
    treeId: number
): Promise<Map<number, CasePersonRow[]>> {
    if (caseIds.length === 0) return new Map();
    // Tree-filter the People join: a CasePerson row could reference another tenant's
    // person id; without this filter their data would be disclosed (cross-tenant IDOR).
    const result = await query(
        `SELECT cp."CaseId", p."Id", p."FirstName", p."LastName",
                ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                p."Sex",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
         FROM "CasePerson" cp
         JOIN "People" p ON p."Id" = cp."PersonId" AND p."TreeId" = $2
         ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
         WHERE cp."CaseId" = ANY($1)
         ORDER BY p."LastName", p."FirstName"`,
        [caseIds, treeId]
    );
    const map = new Map<number, CasePersonRow[]>();
    for (const row of result.rows) {
        const list = map.get(row.CaseId) ?? [];
        list.push({
            Id: row.Id,
            FirstName: row.FirstName,
            LastName: row.LastName,
            EffectiveFirstName: row.EffectiveFirstName,
            Nickname: row.Nickname,
            Sex: row.Sex,
            PrimaryMediaId: row.PrimaryMediaId ?? undefined,
            FocalX: row.FocalX ?? undefined,
            FocalY: row.FocalY ?? undefined,
            FocalRadius: row.FocalRadius ?? null,
        });
        map.set(row.CaseId, list);
    }
    return map;
}

async function fetchMediaForCases(caseIds: number[], treeId: number): Promise<Map<number, Media[]>> {
    if (caseIds.length === 0) return new Map();
    // Tree-filter the Media join: a CaseMedia row could reference another tenant's
    // media id; without this filter their media metadata would be disclosed.
    const result = await query(
        `SELECT cm."CaseId", ${publicMediaColumns('m')}
         FROM "CaseMedia" cm
         JOIN "Media" m ON m."Id" = cm."MediaId" AND m."TreeId" = $2
         WHERE cm."CaseId" = ANY($1)`,
        [caseIds, treeId]
    );
    const map = new Map<number, Media[]>();
    for (const row of result.rows) {
        const list = map.get(row.CaseId) ?? [];
        list.push(row as Media);
        map.set(row.CaseId, list);
    }
    return map;
}

async function fetchCitationsForCases(caseIds: number[], treeId: number): Promise<Map<number, CaseCitation[]>> {
    if (caseIds.length === 0) return new Map();
    const result = await query(
        `SELECT c."Id", c."FactId" AS "CaseId", c."SourceId", c."Note",
                c."Page", c."Quay", c."DataText", c."Url",
                s."Title" AS "sourceTitle", s."Type" AS "sourceType", s."Text" AS "sourceUrl",
                s."RepositoryName" AS "sourceRepo"
         FROM "Citation" c
         JOIN "Sources" s ON s."Id" = c."SourceId"
         WHERE c."FactTable" = 'Cases' AND c."FactId" = ANY($1) AND c."TreeId" = $2
         ORDER BY c."Id" ASC`,
        [caseIds, treeId]
    );
    const map = new Map<number, CaseCitation[]>();
    for (const row of result.rows) {
        const list = map.get(row.CaseId) ?? [];
        list.push(row as CaseCitation);
        map.set(row.CaseId, list);
    }
    return map;
}

async function fetchCommentsForCases(caseIds: number[], treeId: number): Promise<Map<number, CaseComment[]>> {
    if (caseIds.length === 0) return new Map();
    // Tree-filter the comment-media join: a comment's MediaId could reference another
    // tenant's media; the AND on the LEFT JOIN resolves foreign media to null instead.
    // Each comment may carry a single source citation (FactTable 'CaseComments'),
    // shown as an inline chip on the journal entry. Correlated subqueries keep
    // this portable across pg and PGlite (no LATERAL / DISTINCT ON needed).
    const result = await query(
        `SELECT cc.*, u."Name" AS "UserName", u."Email" AS "UserEmail",
                COALESCE(sb."Name", sb."Email") AS "StruckByName",
                m."Id" AS "media_Id", m."Title" AS "media_Title",
                m."FilePath" AS "media_FilePath", m."Format" AS "media_Format",
                m."ContentType" AS "media_ContentType", m."UserId" AS "media_UserId",
                (SELECT ci."Id" FROM "Citation" ci WHERE ci."FactTable" = 'CaseComments' AND ci."FactId" = cc."Id" AND ci."TreeId" = $2 ORDER BY ci."Id" ASC LIMIT 1) AS "citationId",
                (SELECT ci."SourceId" FROM "Citation" ci WHERE ci."FactTable" = 'CaseComments' AND ci."FactId" = cc."Id" AND ci."TreeId" = $2 ORDER BY ci."Id" ASC LIMIT 1) AS "citationSourceId",
                (SELECT s."Title" FROM "Citation" ci JOIN "Sources" s ON s."Id" = ci."SourceId" WHERE ci."FactTable" = 'CaseComments' AND ci."FactId" = cc."Id" AND ci."TreeId" = $2 ORDER BY ci."Id" ASC LIMIT 1) AS "citationLabel"
         FROM "CaseComments" cc
         LEFT JOIN "Users" u ON u."Id" = cc."UserId"
         LEFT JOIN "Users" sb ON sb."Id" = cc."StruckBy"
         LEFT JOIN "Media" m ON cc."MediaId" = m."Id" AND m."TreeId" = $2
         WHERE cc."CaseId" = ANY($1)
         ORDER BY cc."CreatedAt" ASC, cc."Id" ASC`,
        [caseIds, treeId]
    );
    const leadsByComment = await getCommentLeads(caseIds);
    const map = new Map<number, CaseComment[]>();
    for (const row of result.rows) {
        const comment: CaseComment = {
            Id: row.Id,
            CaseId: row.CaseId,
            UserId: row.UserId,
            Body: row.Body,
            CreatedAt: row.CreatedAt,
            Kind: row.Kind ?? null,
            UserName: row.UserName,
            UserEmail: row.UserEmail,
            MediaId: row.MediaId ?? null,
            media: row.media_Id ? {
                Id: row.media_Id,
                Title: row.media_Title,
                FilePath: row.media_FilePath,
                Format: row.media_Format,
                ContentType: row.media_ContentType,
                UserId: row.media_UserId,
            } : null,
            citationId: row.citationId ?? null,
            citationSourceId: row.citationSourceId ?? null,
            citationLabel: row.citationLabel ?? null,
            StruckAt: row.StruckAt ?? null,
            StruckBy: row.StruckBy ?? null,
            StruckByName: row.StruckByName ?? null,
            StruckReason: row.StruckReason ?? null,
            FindingId: row.FindingId ?? null,
            RequestId: row.RequestId ?? null,
            leadIds: leadsByComment.get(row.Id) ?? [],
        };
        const list = map.get(row.CaseId) ?? [];
        list.push(comment);
        map.set(row.CaseId, list);
    }
    return map;
}

function buildCaseWithRelations(
    c: Case,
    peopleMap: Map<number, CasePersonRow[]>,
    mediaMap: Map<number, Media[]>,
    citationsMap: Map<number, CaseCitation[]>,
    commentsMap: Map<number, CaseComment[]>
): CaseWithRelations {
    const comments = commentsMap.get(c.Id) ?? [];
    // A card previews what the researcher wrote (a note or the conclusion), never
    // a line the app wrote (status, a finding, a lead's change) or a note struck
    // out as no longer accurate (#1251).
    const written = comments.filter(cm => (cm.Kind == null || cm.Kind === 'conclusion') && cm.StruckAt == null);
    return {
        ...c,
        people: peopleMap.get(c.Id) ?? [],
        media: mediaMap.get(c.Id) ?? [],
        citations: citationsMap.get(c.Id) ?? [],
        comments,
        latestComment: written.length > 0 ? written[written.length - 1] : null,
    };
}

// ─── Public getters ──────────────────────────────────────────────────────────

/**
 * Get all cases in a tree with optional filters.
 */
export async function getAllCases(
    treeId: number,
    filters: { status?: string; tag?: string; search?: string; personId?: number } = {}
): Promise<CaseWithRelations[]> {
    const conditions = [`c."TreeId" = $1`];
    const params: unknown[] = [treeId];

    if (filters.status) {
        params.push(filters.status);
        conditions.push(`c."Status" = $${params.length}`);
    }
    if (filters.tag) {
        params.push(filters.tag);
        conditions.push(`$${params.length} = ANY(c."Tags")`);
    }
    // Every word must match the title, a tag or the description, folded on both
    // sides like people search (#792), with "%"/"_" literal (#849). So a tag
    // finds its cases, and "parentage Arbor" can match a tag and a title (#915).
    for (const token of (filters.search ?? '').slice(0, 100).trim().split(/\s+/).filter(Boolean)) {
        params.push(token);
        const term = likeContains(`"SearchFold"($${params.length})`);
        conditions.push(`("SearchFold"(c."Title") LIKE ${term}
            OR EXISTS (SELECT 1 FROM unnest(c."Tags") tag WHERE "SearchFold"(tag) LIKE ${term})
            OR "SearchFold"(COALESCE(c."Description", '')) LIKE ${term})`);
    }

    let sql: string;
    if (filters.personId != null) {
        params.push(filters.personId);
        sql = `SELECT c.* FROM "Cases" c
               INNER JOIN "CasePerson" cp ON c."Id" = cp."CaseId"
               WHERE cp."PersonId" = $${params.length}
                 AND ${conditions.join(' AND ')}
               ORDER BY c."UpdatedAt" DESC, c."Id" DESC`;
    } else {
        sql = `SELECT c.* FROM "Cases" c WHERE ${conditions.join(' AND ')} ORDER BY c."UpdatedAt" DESC, c."Id" DESC`;
    }

    const result = await query(sql, params);
    const cases = result.rows as Case[];
    const caseIds = cases.map(c => c.Id);

    const [peopleMap, mediaMap, citationsMap, commentsMap, leadsMap] = await Promise.all([
        fetchPeopleForCases(caseIds, treeId),
        fetchMediaForCases(caseIds, treeId),
        fetchCitationsForCases(caseIds, treeId),
        fetchCommentsForCases(caseIds, treeId),
        fetchLeadTallies(caseIds, treeId),
    ]);

    return cases.map(c => ({
        ...buildCaseWithRelations(c, peopleMap, mediaMap, citationsMap, commentsMap),
        leads: leadsMap.get(c.Id) ?? { total: 0, settled: 0 },
    }));
}

/** Each case's leads for the Research list (#59): the ones not dropped, and how many are settled. */
async function fetchLeadTallies(caseIds: number[], treeId: number): Promise<Map<number, { total: number; settled: number }>> {
    if (caseIds.length === 0) return new Map();
    const result = await query(
        `SELECT l."CaseId", COUNT(*)::int AS "total", COUNT(l."SettledAt")::int AS "settled"
         FROM "CaseLeads" l
         JOIN "Cases" c ON c."Id" = l."CaseId" AND c."TreeId" = $2
         WHERE l."CaseId" = ANY($1) AND l."DroppedAt" IS NULL
         GROUP BY l."CaseId"`,
        [caseIds, treeId]
    );
    return new Map(result.rows.map((r) => [r.CaseId as number, { total: Number(r.total), settled: Number(r.settled) }]));
}

/**
 * Get a single case with all relations (tree-scoped).
 */
export async function getCaseById(id: number, treeId: number): Promise<CaseWithRelations | null> {
    const result = await query(
        `SELECT * FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId]
    );
    const c = result.rows[0] as Case | undefined;
    if (!c) return null;

    const [peopleMap, mediaMap, citationsMap, commentsMap] = await Promise.all([
        fetchPeopleForCases([c.Id], treeId),
        fetchMediaForCases([c.Id], treeId),
        fetchCitationsForCases([c.Id], treeId),
        fetchCommentsForCases([c.Id], treeId),
    ]);

    return buildCaseWithRelations(c, peopleMap, mediaMap, citationsMap, commentsMap);
}

/**
 * Get open (in_progress) cases for home page widget (tree-scoped).
 */
export async function getOpenCases(treeId: number, limit = 5): Promise<CaseWithRelations[]> {
    const result = await query(
        `SELECT * FROM "Cases" WHERE "TreeId" = $1 AND "Status" = 'in_progress'
         ORDER BY "UpdatedAt" DESC LIMIT $2`,
        [treeId, limit]
    );
    const cases = result.rows as Case[];
    const caseIds = cases.map(c => c.Id);

    const [peopleMap, mediaMap, citationsMap, commentsMap] = await Promise.all([
        fetchPeopleForCases(caseIds, treeId),
        fetchMediaForCases(caseIds, treeId),
        fetchCitationsForCases(caseIds, treeId),
        fetchCommentsForCases(caseIds, treeId),
    ]);

    return cases.map(c => buildCaseWithRelations(c, peopleMap, mediaMap, citationsMap, commentsMap));
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Create a new case. Uses a transaction.
 */
export async function createCase(
    data: NewCase,
    personIds: number[],
    actingUserId?: number
): Promise<Case> {
    const client = await getClient();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `INSERT INTO "Cases" ("UserId", "TreeId", "Title", "Description", "Status", "Tags", "FromYear", "ToYear", "Place", "QuestionKind")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                data.UserId,
                data.TreeId ?? null,
                data.Title,
                data.Description ?? null,
                data.Status ?? 'in_progress',
                data.Tags ?? [],
                data.FromYear ?? null,
                data.ToYear ?? null,
                data.Place ?? null,
                data.QuestionKind ?? null,
            ]
        );
        const newCase = result.rows[0] as Case;

        if (personIds.length > 0) {
            // Only link people that belong to this tree — filter out foreign/invalid ids
            // so a caller can't attach (and later read back) another tenant's person.
            await client.query(
                `INSERT INTO "CasePerson" ("CaseId", "PersonId")
                 SELECT $1, p."Id" FROM "People" p WHERE p."Id" = ANY($2) AND p."TreeId" = $3
                 ON CONFLICT DO NOTHING`,
                [newCase.Id, personIds, data.TreeId ?? null]
            );
        }

        // The question is the case's first lead, with the case's people and years (#58, ADR 0045).
        await client.query(
            `WITH lead AS (
               INSERT INTO "CaseLeads" ("CaseId", "Question", "FromYear", "ToYear", "Position", "CreatedBy")
               VALUES ($1, LEFT($2, 500), $3, $4, 0, $5) RETURNING "Id"
             )
             INSERT INTO "CaseLeadPerson" ("LeadId", "PersonId")
             SELECT lead."Id", cp."PersonId" FROM lead JOIN "CasePerson" cp ON cp."CaseId" = $1`,
            [newCase.Id, data.Title, data.FromYear ?? null, data.ToYear ?? null, actingUserId ?? data.UserId]
        );

        await auditCreate(
            'case',
            newCase as unknown as Record<string, unknown>,
            data.UserId,
            actingUserId ?? data.UserId,
            client
        );

        await client.query('COMMIT');
        return newCase;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * A case's status changed (#801, #58): closing records when and how it ended,
 * reopening clears both, and the journal logs the change, with the answer as the
 * final entry when it closes. Runs in the caller's transaction after the
 * "Status" column is written.
 */
export async function recordStatusChange(
    exec: Queryable,
    id: number,
    actor: number,
    from: string,
    to: string,
    conclusion: string | null,
    outcome: CaseOutcome | null,
): Promise<void> {
    const closing = to === 'closed';
    if (closing) {
        await exec.query(`UPDATE "Cases" SET "ClosedAt" = CURRENT_TIMESTAMP, "Outcome" = $2 WHERE "Id" = $1`, [id, outcome]);
    } else if (from === 'closed') {
        await exec.query(`UPDATE "Cases" SET "ClosedAt" = NULL, "Outcome" = NULL WHERE "Id" = $1`, [id]);
    }
    const entry: CaseStatusEntry = from === 'closed' ? 'reopened' : to as CaseStatusEntry;
    await exec.query(
        `INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind") VALUES ($1, $2, $3, 'status')`,
        [id, actor, entry]
    );
    if (closing) {
        await exec.query(
            `INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind") VALUES ($1, $2, $3, 'conclusion')`,
            [id, actor, conclusion]
        );
    }
}

/**
 * Update case fields and re-sync people/media. Uses a transaction.
 * Authorization = the tree-scoped SELECT (the row must be in the caller's
 * resolved tree) + the user-keyed edit check kept as defense in depth.
 * `actingUserId` defaults to the tree owner for callers that predate the
 * scope split.
 */
export async function updateCase(
    id: number,
    updates: Partial<Omit<NewCase, 'UserId'>>,
    personIds: number[] | undefined,
    mediaIds: number[] | undefined,
    treeId: number,
    actingUserId?: number,
    conclusion: string | null = null,
    outcome: CaseOutcome | null = null
): Promise<Case> {
    const existing = await getCaseById(id, treeId);
    if (!existing) throw new Error('Case not found');

    // #801: a status change is logged in the journal, and closing an open case
    // needs the answer it reached, written as the final entry.
    const nextStatus = updates.Status;
    const statusChanged = nextStatus !== undefined && nextStatus !== existing.Status;
    const closing = statusChanged && nextStatus === 'closed';
    if (closing && !conclusion) throw new Error('Conclusion required');

    const actor = actingUserId ?? existing.UserId;
    if (!(await hasEditPermission(existing.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const fields = Object.keys(updates).filter(
        key => (updates as Record<string, unknown>)[key] !== undefined && ALLOWED_CASE_FIELDS.has(key)
    );

    const client = await getClient();
    try {
        await client.query('BEGIN');

        if (fields.length > 0) {
            const values: unknown[] = [];
            const setClauses = fields.map((field, i) => {
                values.push((updates as Record<string, unknown>)[field]);
                return `"${field}" = $${i + 1}`;
            });
            values.push(id);
            await client.query(
                `UPDATE "Cases" SET ${setClauses.join(', ')}, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $${values.length}`,
                values
            );
        }

        // Re-sync people (tree-filtered so foreign person ids can't be attached).
        // Left alone when the caller didn't send a list (#51, L-5): an update
        // that only changes a field must not unlink everyone.
        if (personIds !== undefined) await client.query(`DELETE FROM "CasePerson" WHERE "CaseId" = $1`, [id]);
        if (personIds !== undefined && personIds.length > 0) {
            await client.query(
                `INSERT INTO "CasePerson" ("CaseId", "PersonId")
                 SELECT $1, p."Id" FROM "People" p WHERE p."Id" = ANY($2) AND p."TreeId" = $3
                 ON CONFLICT DO NOTHING`,
                [id, personIds, treeId]
            );
        }

        // Re-sync media (tree-filtered so foreign media ids can't be attached).
        if (mediaIds !== undefined) await client.query(`DELETE FROM "CaseMedia" WHERE "CaseId" = $1`, [id]);
        if (mediaIds !== undefined && mediaIds.length > 0) {
            await client.query(
                `INSERT INTO "CaseMedia" ("CaseId", "MediaId")
                 SELECT $1, m."Id" FROM "Media" m WHERE m."Id" = ANY($2) AND m."TreeId" = $3
                 ON CONFLICT DO NOTHING`,
                [id, mediaIds, treeId]
            );
        }

        if (statusChanged && nextStatus) {
            await recordStatusChange(client, id, actor, existing.Status, nextStatus, conclusion, outcome);
        }

        const updatedResult = await client.query(`SELECT * FROM "Cases" WHERE "Id" = $1`, [id]);
        const updatedCase = updatedResult.rows[0] as Case;

        await auditUpdate(
            'case',
            existing as unknown as Record<string, unknown>,
            updatedCase as unknown as Record<string, unknown>,
            ALLOWED_CASE_FIELDS,
            existing.UserId,
            actor,
            client
        );

        await client.query('COMMIT');
        return updatedCase;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Delete a case (cascades to all sub-tables). Uses a transaction.
 * Authorization = the tree-scoped SELECT + the user-keyed edit check kept as
 * defense in depth.
 */
export async function deleteCase(id: number, treeId: number, actingUserId?: number): Promise<boolean> {
    const existing = await getCaseById(id, treeId);
    if (!existing) return false;

    const actor = actingUserId ?? existing.UserId;
    if (!(await hasEditPermission(existing.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');

        // A case that put something into the tree keeps its record of it (#58, ADR 0046):
        // undo those changes first.
        const applied = await client.query(
            `SELECT 1 FROM "CaseClaims" cl JOIN "CaseFindings" f ON f."Id" = cl."FindingId"
              WHERE f."CaseId" = $1 AND cl."AppliedAt" IS NOT NULL LIMIT 1`,
            [id],
        );
        if (applied.rows.length > 0) throw new ValidationError('This case has changed the tree. Undo its changes before deleting it.');

        await auditDelete(
            'case',
            existing as unknown as Record<string, unknown>,
            existing.UserId,
            actor,
            client
        );

        await client.query(`DELETE FROM "Cases" WHERE "Id" = $1`, [id]);

        await client.query('COMMIT');
        return true;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

// ─── Sub-records ─────────────────────────────────────────────────────────────

/**
 * Append a researcher's note to a case. The journal is append-only (#1251, ADR
 * 0042): a note is never edited or deleted, only struck out with setCaseNoteStrike.
 */
export async function addComment(
    caseId: number,
    userId: number,
    body: string,
    mediaId?: number | null,
    leadIds: readonly number[] = []
): Promise<CaseComment> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        // Filed under the case's own leads still in play (#58); none = the whole case.
        const filed = await checkFiling(client, caseId, leadIds);
        // Touch UpdatedAt on the parent case
        await client.query(
            `UPDATE "Cases" SET "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`,
            [caseId]
        );
        const result = await client.query(
            `INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "MediaId")
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [caseId, userId, body, mediaId ?? null]
        );
        const comment = result.rows[0] as CaseComment;
        await fileComment(client, comment.Id, filed);
        await client.query('COMMIT');
        return { ...comment, leadIds: filed };
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

// ─── Struck-out journal entries (#1251, ADR 0042) ────────────────────────────

type Exec = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> };

/** A closed case's journal is read-only, revert included; reopening the case opens it again. */
const CLOSED_CASE_JOURNAL = 'This case is closed. Reopen it to change its journal.';

/** A note's struck-out marker; all null while it stands. */
export interface CaseNoteStrike {
    StruckAt: string | null;
    StruckBy: number | null;
    StruckReason: string | null;
}

/**
 * What a strike's audit entry keeps (#1251): the note, its case, and its marker
 * after (`struck` and the Struck* fields) and `before` the change, so a revert
 * puts the old marker back. `Text` is the note's body, which never changes.
 */
export interface CaseNoteStrikeSnapshot extends CaseNoteStrike {
    CommentId: number;
    CaseId: number;
    TreeId: number;
    CaseTitle: string;
    /** The note's author. */
    UserId: number;
    Text: string;
    /** True when this change struck the note out, false when it undid one. */
    struck: boolean;
    before: CaseNoteStrike;
}

const instant = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);

/**
 * A researcher's note on a case in the tree, with its case's status, or null.
 * Status and conclusion entries are the case's own history, so they are never
 * returned here and can't be struck out.
 */
export async function getCaseNote(exec: Exec, treeId: number, caseId: number, commentId: number, lock = false) {
    const res = await exec.query(
        `SELECT cc."Id", cc."CaseId", cc."UserId", cc."Body", cc."StruckAt", cc."StruckBy", cc."StruckReason",
                c."Title", c."Status", c."TreeId"
           FROM "CaseComments" cc JOIN "Cases" c ON c."Id" = cc."CaseId"
          WHERE cc."Id" = $1 AND cc."CaseId" = $2 AND c."TreeId" = $3 AND cc."Kind" IS NULL${lock ? ' FOR UPDATE OF cc' : ''}`,
        [commentId, caseId, treeId],
    );
    const row = res.rows[0] as {
        Id: number; CaseId: number; UserId: number; Body: string; StruckAt: unknown; StruckBy: number | null;
        StruckReason: string | null; Title: string; Status: string; TreeId: number;
    } | undefined;
    if (!row) return null;
    return {
        CommentId: row.Id,
        CaseId: row.CaseId,
        TreeId: row.TreeId,
        CaseTitle: row.Title,
        CaseStatus: row.Status,
        UserId: row.UserId,
        Text: row.Body,
        StruckAt: instant(row.StruckAt),
        StruckBy: row.StruckBy ?? null,
        StruckReason: row.StruckReason ?? null,
    };
}

/**
 * Strike a note out, or undo a strike, inside an open transaction (#1251). The
 * note's text, photo and citations never change. `strike` null undoes; `at`
 * null stamps the strike now, and a revert passes the time it puts back.
 */
export async function setCaseNoteStrike(
    exec: Exec,
    treeId: number,
    caseId: number,
    commentId: number,
    strike: { at: string | null; by: number | null; reason: string | null } | null,
): Promise<CaseNoteStrikeSnapshot> {
    const note = await getCaseNote(exec, treeId, caseId, commentId, true);
    if (!note) throw new NotFoundError('Journal note not found');
    if (note.CaseStatus === 'closed') throw new ValidationError(CLOSED_CASE_JOURNAL);
    if (strike && note.StruckAt !== null) throw new ValidationError('This journal entry is already struck out');
    if (!strike && note.StruckAt === null) throw new ValidationError('This journal entry is not struck out');
    const res = await exec.query(
        `UPDATE "CaseComments"
            SET "StruckAt" = CASE WHEN $2::boolean THEN COALESCE($3::timestamptz, CURRENT_TIMESTAMP) END,
                -- A revert may name a striker whose account has gone since (ON DELETE SET NULL).
                "StruckBy" = (SELECT "Id" FROM "Users" WHERE "Id" = $4), "StruckReason" = $5
          WHERE "Id" = $1
          RETURNING "StruckAt", "StruckBy", "StruckReason"`,
        [commentId, strike !== null, strike?.at ?? null, strike?.by ?? null, strike?.reason ?? null],
    );
    await exec.query(`UPDATE "Cases" SET "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`, [caseId]);
    const after = res.rows[0] as { StruckAt: unknown; StruckBy: number | null; StruckReason: string | null };
    const { CaseStatus: _status, StruckAt, StruckBy, StruckReason, ...rest } = note;
    return {
        ...rest,
        struck: strike !== null,
        StruckAt: instant(after.StruckAt),
        StruckBy: after.StruckBy ?? null,
        StruckReason: after.StruckReason ?? null,
        before: { StruckAt, StruckBy, StruckReason },
    };
}

// ─── Junction helpers ─────────────────────────────────────────────────────────

/**
 * Get media from people linked to a case (for the library picker).
 * Excludes media already attached to the case.
 */
export async function getMediaForCaseLinkedPeople(
    caseId: number,
    treeId: number
): Promise<MediaWithPerson[]> {
    const result = await query(
        `SELECT chosen.* FROM (
           SELECT DISTINCT ON (m."Id")
                  ${publicMediaColumns('m')}, p."FirstName" AS "PersonFirstName", p."LastName" AS "PersonLastName",
                  ${effectiveFirstName('p')} AS "PersonEffectiveFirstName",
                  ${primaryNickname('p')} AS "PersonNickname"
           FROM "CasePerson" cp
           JOIN "People" p ON cp."PersonId" = p."Id" AND p."TreeId" = $2
           JOIN "MediaLink" ml ON ml."OwnerTable" = 'People' AND ml."OwnerId" = p."Id"
           JOIN "Media" m ON m."Id" = ml."MediaId" AND m."TreeId" = p."TreeId"
           WHERE cp."CaseId" = $1 AND m."TreeId" = $2
             AND m."Id" NOT IN (
               SELECT "MediaId" FROM "CaseMedia" WHERE "CaseId" = $1
             )
           ORDER BY m."Id", p."LastName", p."FirstName", p."Id"
         ) chosen
         ORDER BY chosen."PersonLastName", chosen."PersonFirstName", chosen."Id"`,
        [caseId, treeId]
    );
    return result.rows as MediaWithPerson[];
}

/**
 * Remove media from a case. The media itself is deleted only when nothing else
 * uses it: no link to any record (person, family, fact, source, place, …), no
 * face tag, no other case, no journal entry and no case finding. Anything else only loses this
 * case's link (#1223, security audit M-2).
 * Returns 'deleted', 'unlinked', or null if not found.
 */
export async function unlinkOrDeleteCaseMedia(
    caseId: number,
    mediaId: number,
    treeId: number
): Promise<'deleted' | 'unlinked' | null> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        // Lock the media row so a link added at the same moment can't be lost
        // to the delete below.
        const media = await client.query(
            `SELECT 1 FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2 FOR UPDATE`,
            [mediaId, treeId]
        );
        const removed = media.rows.length === 0 ? { rowCount: 0 } : await client.query(
            `DELETE FROM "CaseMedia" WHERE "CaseId" = $1 AND "MediaId" = $2`,
            [caseId, mediaId]
        );
        if (!removed.rowCount) {
            await client.query('ROLLBACK');
            return null;
        }

        const used = await client.query(
            `SELECT EXISTS (SELECT 1 FROM "MediaLink" WHERE "MediaId" = $1)
                 OR EXISTS (SELECT 1 FROM "MediaTag" WHERE "MediaId" = $1)
                 OR EXISTS (SELECT 1 FROM "CaseMedia" WHERE "MediaId" = $1)
                 OR EXISTS (SELECT 1 FROM "CaseComments" WHERE "MediaId" = $1)
                 OR EXISTS (SELECT 1 FROM "CaseFindings" WHERE "MediaId" = $1) AS "InUse"`,
            [mediaId]
        );
        const inUse = Boolean((used.rows[0] as { InUse: boolean }).InUse);
        if (!inUse) {
            await client.query(`DELETE FROM "Media" WHERE "Id" = $1`, [mediaId]);
        }
        await client.query('COMMIT');
        return inUse ? 'unlinked' : 'deleted';
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Link media to a case (used by upload shortcut and the library picker).
 * Only links media that belongs to this tree — filters out foreign/invalid ids
 * so a caller can't attach (and later read back) another tenant's media.
 */
export async function linkMedia(caseId: number, mediaIds: number[], treeId: number): Promise<void> {
    if (mediaIds.length === 0) return;
    await query(
        `INSERT INTO "CaseMedia" ("CaseId", "MediaId")
         SELECT $1, m."Id" FROM "Media" m WHERE m."Id" = ANY($2) AND m."TreeId" = $3
         ON CONFLICT DO NOTHING`,
        [caseId, mediaIds, treeId]
    );
}

// ─── Export / Import helpers ──────────────────────────────────────────────────

/** A Citation row's fields, its SourceId still a DB id — the caller maps it to the @Sn@ xref. */
export interface CaseCitationRaw {
    SourceId: number;
    Page: string | null;
    Note: string | null;
    Quay: string | null;
    DataText: string | null;
    DataDate: string | null;
    Even: string | null;
    Role: string | null;
    Url: string | null;
}

interface CaseExportComment {
    Body: string;
    CreatedAt: string;
    Kind?: CaseCommentKind;
    /** The entry's photo as a DB media id — caller maps it to the media xref (#1068). */
    mediaDbId?: number;
    /** The entry's citation (#1035). An entry shows one, the oldest, so one is exported. */
    citationRaw?: CaseCitationRaw;
    /** When a struck-out note was struck, and why (#1251). Who struck it stays behind, as the author does. */
    StruckAt?: string;
    StruckReason?: string;
    /** The leads the entry is filed under, and the finding or request it tells of, as DB ids (#58). */
    leadDbIds?: number[];
    findingDbId?: number;
    requestDbId?: number;
}

export interface CaseExportRecord {
    Title: string;
    Description: string | null;
    Status: string;
    Tags: string[];
    CreatedAt: string;
    UpdatedAt: string;
    comments: CaseExportComment[];
    /** DB person IDs — caller maps to GEDCOM IDs for portability */
    linkedPersonDbIds: number[];
    /** Structured citations from the Citation table — caller maps SourceId to @Sn@ xref */
    sourceCitationsRaw: CaseCitationRaw[];
    /** The case's attached photos as DB media ids — caller maps them to media xrefs (#1068). */
    mediaDbIds: number[];
    /** The case's scope and outcome (#58). */
    FromYear?: number | null;
    ToYear?: number | null;
    Place?: string | null;
    QuestionKind?: string | null;
    Outcome?: string | null;
    ClosedAt?: string | null;
    /** Leads, requests and findings with their claims (#58, ADR 0045). */
    workspace?: WorkspaceExportRaw;
}

function citationRaw(row: CaseCitationRaw): CaseCitationRaw {
    return {
        SourceId: row.SourceId, Page: row.Page, Note: row.Note, Quay: row.Quay, DataText: row.DataText,
        DataDate: row.DataDate, Even: row.Even, Role: row.Role, Url: row.Url,
    };
}

/**
 * Return all cases for a tree in a format suitable for cases.json export.
 */
export async function exportCasesData(treeId: number): Promise<CaseExportRecord[]> {
    const casesResult = await query(
        `SELECT * FROM "Cases" WHERE "TreeId" = $1 ORDER BY "CreatedAt" ASC`,
        [treeId]
    );
    const cases = casesResult.rows as Case[];
    if (cases.length === 0) return [];

    const caseIds = cases.map(c => c.Id);

    const [commentsResult, peopleResult, structuredResult, mediaResult, commentCitationResult] = await Promise.all([
        // Tree-filtered like fetchCommentsForCases: a photo from another tree exports as none.
        query(
            `SELECT cc."CaseId", cc."Body", cc."CreatedAt", cc."Kind", cc."Id", cc."StruckAt", cc."StruckReason", m."Id" AS "MediaId",
                    cc."FindingId", cc."RequestId"
             FROM "CaseComments" cc
             LEFT JOIN "Media" m ON m."Id" = cc."MediaId" AND m."TreeId" = $2
             WHERE cc."CaseId" = ANY($1) ORDER BY cc."CreatedAt" ASC, cc."Id" ASC`,
            [caseIds, treeId]
        ),
        query(`SELECT "CaseId", "PersonId" FROM "CasePerson" WHERE "CaseId" = ANY($1)`, [caseIds]),
        query(
            `SELECT "FactId" AS "CaseId", "SourceId", "Page", "Note", "Quay", "DataText", "DataDate", "Even", "Role", "Url"
             FROM "Citation" WHERE "FactTable" = 'Cases' AND "FactId" = ANY($1) AND "TreeId" = $2 ORDER BY "Id" ASC`,
            [caseIds, treeId]
        ),
        query(
            `SELECT cm."CaseId", cm."MediaId" FROM "CaseMedia" cm
             JOIN "Media" m ON m."Id" = cm."MediaId" AND m."TreeId" = $2
             WHERE cm."CaseId" = ANY($1) ORDER BY cm."MediaId" ASC`,
            [caseIds, treeId]
        ),
        query(
            `SELECT ci."FactId" AS "CommentId", ci."SourceId", ci."Page", ci."Note", ci."Quay", ci."DataText",
                    ci."DataDate", ci."Even", ci."Role", ci."Url"
             FROM "Citation" ci JOIN "CaseComments" cc ON cc."Id" = ci."FactId"
             WHERE ci."FactTable" = 'CaseComments' AND cc."CaseId" = ANY($1) AND ci."TreeId" = $2 ORDER BY ci."Id" ASC`,
            [caseIds, treeId]
        ),
    ]);

    const workspaces = await exportWorkspaceData(caseIds, treeId);
    const commentLeads = await getCommentLeads(caseIds);

    const citationByComment = new Map<number, CaseCitationRaw>();
    for (const row of commentCitationResult.rows as Array<CaseCitationRaw & { CommentId: number }>) {
        if (!citationByComment.has(row.CommentId)) citationByComment.set(row.CommentId, citationRaw(row));
    }

    const cmtMap = new Map<number, CaseExportComment[]>();
    for (const row of commentsResult.rows) {
        const list = cmtMap.get(row.CaseId) ?? [];
        // Kind, the photo and the citation are additive (ADR 0009): a plain
        // researcher's note keeps the old shape.
        const comment: CaseExportComment = { Body: row.Body, CreatedAt: row.CreatedAt };
        if (row.Kind) comment.Kind = row.Kind;
        if (row.MediaId != null) comment.mediaDbId = row.MediaId;
        const citation = citationByComment.get(row.Id);
        if (citation) comment.citationRaw = citation;
        if (row.StruckAt != null) {
            comment.StruckAt = row.StruckAt instanceof Date ? row.StruckAt.toISOString() : row.StruckAt;
            if (row.StruckReason) comment.StruckReason = row.StruckReason;
        }
        const leads = commentLeads.get(row.Id);
        if (leads && leads.length > 0) comment.leadDbIds = leads;
        if (row.FindingId != null) comment.findingDbId = row.FindingId;
        if (row.RequestId != null) comment.requestDbId = row.RequestId;
        list.push(comment);
        cmtMap.set(row.CaseId, list);
    }

    const pplMap = new Map<number, number[]>();
    for (const row of peopleResult.rows) {
        const list = pplMap.get(row.CaseId) ?? [];
        list.push(row.PersonId);
        pplMap.set(row.CaseId, list);
    }

    const structuredByCase = new Map<number, CaseCitationRaw[]>();
    for (const r of structuredResult.rows as Array<CaseCitationRaw & { CaseId: number }>) {
        const list = structuredByCase.get(r.CaseId) ?? [];
        list.push(citationRaw(r));
        structuredByCase.set(r.CaseId, list);
    }

    const mediaByCase = new Map<number, number[]>();
    for (const r of mediaResult.rows as Array<{ CaseId: number; MediaId: number }>) {
        const list = mediaByCase.get(r.CaseId) ?? [];
        list.push(r.MediaId);
        mediaByCase.set(r.CaseId, list);
    }

    return cases.map(c => ({
        Title: c.Title,
        Description: c.Description,
        Status: c.Status,
        Tags: c.Tags,
        CreatedAt: c.CreatedAt,
        UpdatedAt: c.UpdatedAt,
        comments: cmtMap.get(c.Id) ?? [],
        linkedPersonDbIds: pplMap.get(c.Id) ?? [],
        sourceCitationsRaw: structuredByCase.get(c.Id) ?? [],
        mediaDbIds: mediaByCase.get(c.Id) ?? [],
        FromYear: c.FromYear ?? null,
        ToYear: c.ToYear ?? null,
        Place: c.Place ?? null,
        QuestionKind: c.QuestionKind ?? null,
        Outcome: c.Outcome ?? null,
        ClosedAt: c.ClosedAt == null ? null : (c.ClosedAt as unknown) instanceof Date ? (c.ClosedAt as unknown as Date).toISOString() : c.ClosedAt,
        workspace: workspaces.get(c.Id),
    }));
}
