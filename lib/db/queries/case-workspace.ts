import { query } from '@/lib/db/connection';
import type {
    CaseTreeFact,
    CaseClaim, CaseClaimDecision, CaseClaimEvidence, CaseFinding, CaseInformation, CaseLead, CasePersonRef,
    CaseRequest, CaseRequestSentBy, CaseRequestState, CaseSourceNature, CaseWorkspace, Media,
} from '../schema';
import type { Queryable } from './audit-capture';
import { auditCreate } from './audit-capture';
import { primaryPhotoJoin } from './media-tags';
import { effectiveFirstName, integratedFullName, primaryNickname } from './people';
import { publicMediaColumns } from './media-projection';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { ValidationError } from '@/lib/validation';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { undecidedOnLead } from '@/lib/cases/lead-status';
import type { CaseCitationRaw } from './cases';
import type { ParsedCaseWorkspace } from '@/lib/gedcom/cases-sidecar';

/*
 * The research workspace (#58, ADR 0045): a case's leads, findings with their
 * claims, and requests. Reads are tree-scoped through the case; writes run inside
 * the caller's transaction (`exec`) after `lockOpenCase`.
 */

const defaultExec: Queryable = { query: (sql, params) => query(sql, params) };

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);
const dateOnly = (v: unknown): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
};
const num = (v: unknown): number | null => (v == null ? null : Number(v));

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The case's leads, findings and requests. The case must already be known to be in this tree. */
export async function getCaseWorkspace(caseId: number, treeId: number, exec: Queryable = defaultExec): Promise<CaseWorkspace> {
    // Sequential: a transaction's client runs one statement at a time.
    const leadRows = await exec.query(
        `SELECT l.* FROM "CaseLeads" l JOIN "Cases" c ON c."Id" = l."CaseId" AND c."TreeId" = $2
          WHERE l."CaseId" = $1 ORDER BY l."Position", l."Id"`,
        [caseId, treeId],
    );
    const leadPeople = await exec.query(
        `SELECT lp."LeadId", p."Id", p."FirstName", p."LastName",
                ${effectiveFirstName('p')} AS "EffectiveFirstName", ${primaryNickname('p')} AS "Nickname", p."Sex",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
           FROM "CaseLeadPerson" lp
           JOIN "CaseLeads" l ON l."Id" = lp."LeadId" AND l."CaseId" = $1
           JOIN "People" p ON p."Id" = lp."PersonId" AND p."TreeId" = $2
           ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
          ORDER BY p."LastName", p."FirstName", p."Id"`,
        [caseId, treeId],
    );
    // One citation per finding: the oldest, as for a journal entry. Correlated
    // subqueries keep it portable across pg and PGlite.
    const findingRows = await exec.query(
        `SELECT f.*, ${publicMediaColumns('m', 'media_')},
                ci."Id" AS "citationId", ci."SourceId" AS "citationSourceId", ci."Page" AS "citationPage",
                ci."Url" AS "citationUrl", ci."DataText" AS "citationDataText",
                s."Title" AS "sourceTitle", s."RepositoryName" AS "sourceRepo"
           FROM "CaseFindings" f
           JOIN "Cases" c ON c."Id" = f."CaseId" AND c."TreeId" = $2
           LEFT JOIN "Media" m ON m."Id" = f."MediaId" AND m."TreeId" = $2
           LEFT JOIN "Citation" ci ON ci."Id" = (
                SELECT x."Id" FROM "Citation" x
                 WHERE x."FactTable" = '${FACT_TABLES.CASE_FINDINGS}' AND x."FactId" = f."Id" AND x."TreeId" = $2
                 ORDER BY x."Id" LIMIT 1)
           LEFT JOIN "Sources" s ON s."Id" = ci."SourceId"
          WHERE f."CaseId" = $1
          ORDER BY f."CreatedAt", f."Id"`,
        [caseId, treeId],
    );
    const findingLeads = await exec.query(
        `SELECT fl."FindingId", fl."LeadId" FROM "CaseFindingLead" fl
           JOIN "CaseFindings" f ON f."Id" = fl."FindingId" AND f."CaseId" = $1`,
        [caseId],
    );
    const claimRows = await exec.query(
        `SELECT cl.*, (SELECT ${integratedFullName('p')} FROM "People" p WHERE p."Id" = cl."PersonId" AND p."TreeId" = $2) AS "personLabel"
           FROM "CaseClaims" cl
           JOIN "CaseFindings" f ON f."Id" = cl."FindingId" AND f."CaseId" = $1
          ORDER BY cl."FindingId", cl."Position", cl."Id"`,
        [caseId, treeId],
    );
    const requestRows = await exec.query(`SELECT * FROM "CaseRequests" WHERE "CaseId" = $1 ORDER BY "CreatedAt", "Id"`, [caseId]);
    // What the tree knows about the leads' people, dated, for each lead's timeline.
    const factRows = await exec.query(
        `WITH lp AS (
            SELECT DISTINCT lp."PersonId" FROM "CaseLeadPerson" lp JOIN "CaseLeads" l ON l."Id" = lp."LeadId" AND l."CaseId" = $1
         )
         SELECT p."Id" AS "PersonId", 'BIRT' AS "Type", p."BirthDate" AS "Date" FROM "People" p JOIN lp ON lp."PersonId" = p."Id"
          WHERE p."TreeId" = $2 AND p."BirthDate" IS NOT NULL
         UNION ALL
         SELECT p."Id", 'DEAT', p."DeathDate" FROM "People" p JOIN lp ON lp."PersonId" = p."Id"
          WHERE p."TreeId" = $2 AND p."DeathDate" IS NOT NULL
         UNION ALL
         SELECT e."PersonId", e."Type", e."Date" FROM "Events" e JOIN lp ON lp."PersonId" = e."PersonId"
          WHERE e."TreeId" = $2 AND e."Date" IS NOT NULL`,
        [caseId, treeId],
    );

    const peopleByLead = new Map<number, CasePersonRef[]>();
    for (const r of leadPeople.rows as Row[]) {
        const list = peopleByLead.get(Number(r.LeadId)) ?? [];
        list.push({
            Id: Number(r.Id),
            FirstName: (r.FirstName as string | null) ?? null,
            LastName: (r.LastName as string | null) ?? null,
            EffectiveFirstName: (r.EffectiveFirstName as string | null) ?? null,
            Nickname: (r.Nickname as string | null) ?? null,
            Sex: (r.Sex as string | null) ?? null,
            PrimaryMediaId: (r.PrimaryMediaId as number | null) ?? undefined,
            FocalX: (r.FocalX as number | null) ?? undefined,
            FocalY: (r.FocalY as number | null) ?? undefined,
            FocalRadius: (r.FocalRadius as number | null) ?? null,
        });
        peopleByLead.set(Number(r.LeadId), list);
    }
    const leads: CaseLead[] = (leadRows.rows as Row[]).map((r) => ({
        Id: Number(r.Id),
        CaseId: Number(r.CaseId),
        Question: String(r.Question),
        FromYear: num(r.FromYear),
        ToYear: num(r.ToYear),
        Position: Number(r.Position),
        CreatedAt: iso(r.CreatedAt)!,
        SettledAt: iso(r.SettledAt),
        DroppedAt: iso(r.DroppedAt),
        people: peopleByLead.get(Number(r.Id)) ?? [],
    }));

    const leadsByFinding = new Map<number, number[]>();
    for (const r of findingLeads.rows as Row[]) {
        const list = leadsByFinding.get(Number(r.FindingId)) ?? [];
        list.push(Number(r.LeadId));
        leadsByFinding.set(Number(r.FindingId), list);
    }
    const claimsByFinding = new Map<number, CaseClaim[]>();
    for (const r of claimRows.rows as Row[]) {
        const list = claimsByFinding.get(Number(r.FindingId)) ?? [];
        list.push({
            Id: Number(r.Id),
            FindingId: Number(r.FindingId),
            Position: Number(r.Position),
            What: String(r.What),
            PersonId: num(r.PersonId),
            PersonName: (r.PersonName as string | null) ?? null,
            personLabel: (r.personLabel as string | null) ?? null,
            Says: (r.Says as string | null) ?? null,
            Date: (r.Date as string | null) ?? null,
            Place: (r.Place as string | null) ?? null,
            Evidence: (r.Evidence as CaseClaimEvidence | null) ?? null,
            Decision: r.Decision as CaseClaimDecision,
            DecidedAt: iso(r.DecidedAt),
            AppliedAt: iso(r.AppliedAt),
            undoable: r.AppliedAt != null && r.AppliedAuditId != null,
        });
        claimsByFinding.set(Number(r.FindingId), list);
    }
    const findings: CaseFinding[] = (findingRows.rows as Row[]).map((r) => {
        const id = Number(r.Id);
        return {
            Id: id,
            CaseId: Number(r.CaseId),
            Kind: r.Kind as CaseFinding['Kind'],
            UserId: num(r.UserId),
            CreatedAt: iso(r.CreatedAt)!,
            MediaId: r.media_Id == null ? null : Number(r.media_Id),
            media: r.media_Id == null ? null : mediaFrom(r),
            SourceNature: (r.SourceNature as CaseSourceNature | null) ?? null,
            Information: (r.Information as CaseInformation | null) ?? null,
            Searched: (r.Searched as string | null) ?? null,
            Site: (r.Site as string | null) ?? null,
            Note: (r.Note as string | null) ?? null,
            RequestId: num(r.RequestId),
            citation: r.citationId == null ? null : {
                Id: Number(r.citationId),
                SourceId: Number(r.citationSourceId),
                sourceTitle: String(r.sourceTitle ?? ''),
                sourceRepo: (r.sourceRepo as string | null) ?? null,
                Page: (r.citationPage as string | null) ?? null,
                Url: (r.citationUrl as string | null) ?? null,
                DataText: (r.citationDataText as string | null) ?? null,
            },
            leadIds: leadsByFinding.get(id) ?? [],
            claims: claimsByFinding.get(id) ?? [],
        };
    });

    const requests: CaseRequest[] = (requestRows.rows as Row[]).map((r) => ({
        Id: Number(r.Id),
        CaseId: Number(r.CaseId),
        LeadId: num(r.LeadId),
        AskedFor: String(r.AskedFor),
        Holder: (r.Holder as string | null) ?? null,
        SentBy: (r.SentBy as CaseRequestSentBy | null) ?? null,
        SentOn: dateOnly(r.SentOn),
        Reference: (r.Reference as string | null) ?? null,
        RemindOn: dateOnly(r.RemindOn),
        State: r.State as CaseRequestState,
        RepliedAt: iso(r.RepliedAt),
        ReplyNote: (r.ReplyNote as string | null) ?? null,
        CreatedAt: iso(r.CreatedAt)!,
    }));

    const facts: CaseTreeFact[] = (factRows.rows as Row[]).map((r) => ({
        PersonId: Number(r.PersonId), Type: String(r.Type), Date: String(r.Date),
    }));

    return { leads, findings, requests, facts };
}

function mediaFrom(r: Row): Media {
    const media: Row = {};
    for (const [key, value] of Object.entries(r)) if (key.startsWith('media_')) media[key.slice(6)] = value;
    return media as unknown as Media;
}

/** Whether the case is in the tree. */
export async function caseInTree(caseId: number, treeId: number, exec: Queryable = defaultExec): Promise<boolean> {
    const res = await exec.query(`SELECT 1 FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2`, [caseId, treeId]);
    return res.rows.length > 0;
}

/** The leads each journal entry of a case is filed under. */
export async function getCommentLeads(caseIds: number[], exec: Queryable = defaultExec): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (caseIds.length === 0) return map;
    const res = await exec.query(
        `SELECT cl."CommentId", cl."LeadId" FROM "CaseCommentLead" cl
           JOIN "CaseComments" cc ON cc."Id" = cl."CommentId" WHERE cc."CaseId" = ANY($1)`,
        [caseIds],
    );
    for (const r of res.rows as Row[]) {
        const list = map.get(Number(r.CommentId)) ?? [];
        list.push(Number(r.LeadId));
        map.set(Number(r.CommentId), list);
    }
    return map;
}

// ─── Writes (inside the caller's transaction) ───────────────────────────────────

/** Locks an open case in the tree for a workspace write, or throws. */
export async function lockOpenCase(exec: Queryable, caseId: number, treeId: number): Promise<{ UserId: number }> {
    const res = await exec.query(
        `SELECT "UserId", "Status" FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2 FOR UPDATE`,
        [caseId, treeId],
    );
    const row = res.rows[0] as { UserId: number; Status: string } | undefined;
    if (!row) throw new NotFoundError('Case not found');
    if (row.Status === 'closed') throw new AccessError('Cannot modify a closed case');
    return { UserId: Number(row.UserId) };
}

async function touchCase(exec: Queryable, caseId: number) {
    await exec.query(`UPDATE "Cases" SET "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`, [caseId]);
}

/** Of `leadIds`, the case's own leads that are still in play (not dropped); throws on any other id. */
async function caseLeads(exec: Queryable, caseId: number, leadIds: readonly number[], unsettledOnly = false): Promise<number[]> {
    const unique = [...new Set(leadIds)];
    if (unique.length === 0) return [];
    const res = await exec.query(
        `SELECT "Id", "SettledAt" FROM "CaseLeads" WHERE "CaseId" = $1 AND "Id" = ANY($2::int[]) AND "DroppedAt" IS NULL`,
        [caseId, unique],
    );
    if (res.rows.length !== unique.length) throw new ValidationError('A lead is not in this case');
    // A settled lead takes no new evidence: its claims would be undecided on a settled lead.
    if (unsettledOnly && (res.rows as Row[]).some(r => r.SettledAt != null)) {
        throw new ValidationError('This lead is settled. Reopen it to add to it.');
    }
    return unique;
}

/** Links tree people only; a foreign or unknown id is dropped, as for CasePerson. */
async function setLeadPeople(exec: Queryable, leadId: number, treeId: number, personIds: readonly number[]) {
    await exec.query(`DELETE FROM "CaseLeadPerson" WHERE "LeadId" = $1`, [leadId]);
    if (personIds.length === 0) return;
    await exec.query(
        `INSERT INTO "CaseLeadPerson" ("LeadId", "PersonId")
         SELECT $1, p."Id" FROM "People" p WHERE p."Id" = ANY($2::int[]) AND p."TreeId" = $3
         ON CONFLICT DO NOTHING`,
        [leadId, [...new Set(personIds)], treeId],
    );
}

/** Adds the people of a lead to the case too: people added on a lead join the case (#58). */
async function joinCasePeople(exec: Queryable, caseId: number, treeId: number, personIds: readonly number[]) {
    if (personIds.length === 0) return;
    await exec.query(
        `INSERT INTO "CasePerson" ("CaseId", "PersonId")
         SELECT $1, p."Id" FROM "People" p WHERE p."Id" = ANY($2::int[]) AND p."TreeId" = $3
         ON CONFLICT DO NOTHING`,
        [caseId, [...new Set(personIds)], treeId],
    );
}

/** Writes an app journal entry, filed under `leadIds` (none = the whole case). */
async function addJournalEntry(exec: Queryable, entry: {
    caseId: number;
    userId: number;
    kind: 'finding' | 'search' | 'request' | 'reply' | 'lead';
    body: string;
    findingId?: number | null;
    requestId?: number | null;
    leadIds: readonly number[];
}): Promise<number> {
    const res = await exec.query(
        `INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind", "FindingId", "RequestId")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING "Id"`,
        [entry.caseId, entry.userId, entry.body, entry.kind, entry.findingId ?? null, entry.requestId ?? null],
    );
    const id = Number((res.rows[0] as { Id: number }).Id);
    await fileComment(exec, id, entry.leadIds);
    return id;
}

/** Files a journal entry under leads already checked to be the case's own. */
export async function fileComment(exec: Queryable, commentId: number, leadIds: readonly number[]) {
    if (leadIds.length === 0) return;
    await exec.query(
        `INSERT INTO "CaseCommentLead" ("CommentId", "LeadId") SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
        [commentId, [...new Set(leadIds)]],
    );
}

/** Checks journal filing for a new note: every lead is the case's own and in play. */
export async function checkFiling(exec: Queryable, caseId: number, leadIds: readonly number[]): Promise<number[]> {
    return caseLeads(exec, caseId, leadIds);
}

export interface LeadInput {
    question: string;
    fromYear: number | null;
    toYear: number | null;
    personIds: number[];
}

/** A new lead at the end of the case's list, logged in the journal under itself. */
export async function insertLead(exec: Queryable, caseId: number, treeId: number, input: LeadInput, userId: number): Promise<number> {
    const res = await exec.query(
        `INSERT INTO "CaseLeads" ("CaseId", "Question", "FromYear", "ToYear", "Position", "CreatedBy")
         VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX("Position") + 1, 0) FROM "CaseLeads" WHERE "CaseId" = $1), $5)
         RETURNING "Id"`,
        [caseId, input.question, input.fromYear, input.toYear, userId],
    );
    const leadId = Number((res.rows[0] as { Id: number }).Id);
    await setLeadPeople(exec, leadId, treeId, input.personIds);
    await joinCasePeople(exec, caseId, treeId, input.personIds);
    await addJournalEntry(exec, { caseId, userId, kind: 'lead', body: 'added', leadIds: [leadId] });
    await touchCase(exec, caseId);
    return leadId;
}

async function lockLead(exec: Queryable, caseId: number, leadId: number) {
    const res = await exec.query(
        `SELECT "Id", "SettledAt", "DroppedAt" FROM "CaseLeads" WHERE "Id" = $1 AND "CaseId" = $2 FOR UPDATE`,
        [leadId, caseId],
    );
    const row = res.rows[0] as { SettledAt: unknown; DroppedAt: unknown } | undefined;
    if (!row) throw new NotFoundError('Lead not found');
    return { settled: row.SettledAt != null, dropped: row.DroppedAt != null };
}

/** Edits a lead's question, years and people. A dropped lead can't change. */
export async function updateLead(exec: Queryable, caseId: number, treeId: number, leadId: number, input: LeadInput) {
    const lead = await lockLead(exec, caseId, leadId);
    if (lead.dropped) throw new ValidationError('This lead was dropped');
    await exec.query(
        `UPDATE "CaseLeads" SET "Question" = $2, "FromYear" = $3, "ToYear" = $4 WHERE "Id" = $1`,
        [leadId, input.question, input.fromYear, input.toYear],
    );
    await setLeadPeople(exec, leadId, treeId, input.personIds);
    await joinCasePeople(exec, caseId, treeId, input.personIds);
    await touchCase(exec, caseId);
}

/**
 * Settles, reopens or drops a lead, logged in the journal under it. Settling waits
 * until none of its claims is undecided; a dropped lead's findings stay in the case.
 */
export async function setLeadState(exec: Queryable, caseId: number, treeId: number, leadId: number, action: 'settle' | 'reopen' | 'drop', userId: number) {
    const lead = await lockLead(exec, caseId, leadId);
    if (lead.dropped) throw new ValidationError('This lead was dropped');
    if (action === 'settle') {
        if (lead.settled) throw new ValidationError('This lead is already settled');
        const { findings } = await getCaseWorkspace(caseId, treeId, exec);
        const undecided = undecidedOnLead(leadId, findings);
        if (undecided > 0) throw new ValidationError(`Decide every claim on this lead before settling it (${undecided} undecided)`);
        await exec.query(`UPDATE "CaseLeads" SET "SettledAt" = CURRENT_TIMESTAMP, "SettledBy" = $2 WHERE "Id" = $1`, [leadId, userId]);
    } else if (action === 'reopen') {
        if (!lead.settled) throw new ValidationError('This lead is not settled');
        await exec.query(`UPDATE "CaseLeads" SET "SettledAt" = NULL, "SettledBy" = NULL WHERE "Id" = $1`, [leadId]);
    } else {
        await exec.query(`UPDATE "CaseLeads" SET "DroppedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`, [leadId]);
    }
    const body = action === 'settle' ? 'settled' : action === 'reopen' ? 'reopened' : 'dropped';
    await addJournalEntry(exec, { caseId, userId, kind: 'lead', body, leadIds: [leadId] });
    await touchCase(exec, caseId);
}

export interface ClaimInput {
    what: string;
    personId: number | null;
    personName: string | null;
    says: string | null;
    date: string | null;
    place: string | null;
    evidence: CaseClaimEvidence | null;
}

async function insertClaims(exec: Queryable, findingId: number, treeId: number, claims: readonly ClaimInput[]) {
    for (const claim of claims) {
        await exec.query(
            `INSERT INTO "CaseClaims" ("FindingId", "Position", "What", "PersonId", "PersonName", "Says", "Date", "Place", "Evidence")
             VALUES ($1, (SELECT COALESCE(MAX("Position") + 1, 0) FROM "CaseClaims" WHERE "FindingId" = $1), $2,
                     (SELECT "Id" FROM "People" WHERE "Id" = $3 AND "TreeId" = $4), $5, $6, $7, $8, $9)`,
            [findingId, claim.what, claim.personId, treeId, claim.personName, claim.says, claim.date, claim.place, claim.evidence],
        );
    }
}

export interface FindingInput {
    kind: 'record' | 'nothing';
    leadIds: number[];
    /** Record: an existing source in the tree, or a new one to create. */
    source: { id: number } | { title: string; repository: string | null } | null;
    page: string | null;
    url: string | null;
    transcription: string | null;
    mediaId: number | null;
    sourceNature: CaseSourceNature | null;
    information: CaseInformation | null;
    /** Nothing found. */
    searched: string | null;
    site: string | null;
    note: string | null;
    requestId: number | null;
    claims: ClaimInput[];
    /**
     * A record made from a journal note's photo or citation (#58): the note is its
     * journal entry, so no "Record found" line is added, and the note points at it.
     */
    commentId?: number | null;
}

/**
 * Adds a finding with its source citation and claims, files it under its leads,
 * and logs it in the journal. A new source is created in the tree (audited, as any
 * source is); the finding, its citation and claims are case work and are not.
 */
export async function insertFinding(exec: Queryable, caseId: number, treeId: number, ownerId: number, userId: number, input: FindingInput): Promise<number> {
    const commentId = input.kind === 'record' ? input.commentId ?? null : null;
    if (commentId != null) {
        const res = await exec.query(
            `SELECT "Kind", "FindingId" FROM "CaseComments" WHERE "Id" = $1 AND "CaseId" = $2 FOR UPDATE`,
            [commentId, caseId],
        );
        const note = res.rows[0] as { Kind: string | null; FindingId: number | null } | undefined;
        if (!note || note.Kind != null) throw new ValidationError('That journal note is not in this case');
        if (note.FindingId != null) throw new ValidationError('That journal note is already a record');
    }
    // A note may be filed under a settled lead; its record is then locked there like any other.
    const leadIds = await caseLeads(exec, caseId, input.leadIds, commentId == null);
    let sourceId: number | null = null;
    let sourceTitle = '';
    if (input.kind === 'record') {
        if (!input.source) throw new ValidationError('A record needs its source');
        if ('id' in input.source) {
            const res = await exec.query(`SELECT "Id", "Title" FROM "Sources" WHERE "Id" = $1 AND "TreeId" = $2`, [input.source.id, treeId]);
            const row = res.rows[0] as { Id: number; Title: string } | undefined;
            if (!row) throw new ValidationError('That source is not in this tree');
            sourceId = Number(row.Id);
            sourceTitle = row.Title;
        } else {
            const res = await exec.query(
                `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "RepositoryName", "Type") VALUES ($1, $2, $3, $4, 'Document') RETURNING *`,
                [ownerId, treeId, input.source.title, input.source.repository],
            );
            const created = res.rows[0] as Row;
            sourceId = Number(created.Id);
            sourceTitle = String(created.Title);
            await auditCreate('source', created, ownerId, userId, exec);
        }
    }
    let mediaId: number | null = null;
    if (input.mediaId != null) {
        const res = await exec.query(`SELECT 1 FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2`, [input.mediaId, treeId]);
        if (res.rows.length === 0) throw new ValidationError('That file is not in this tree');
        mediaId = input.mediaId;
    }
    let requestId: number | null = null;
    if (input.requestId != null) {
        const res = await exec.query(`SELECT 1 FROM "CaseRequests" WHERE "Id" = $1 AND "CaseId" = $2`, [input.requestId, caseId]);
        if (res.rows.length === 0) throw new ValidationError('That request is not in this case');
        requestId = input.requestId;
    }
    const res = await exec.query(
        `INSERT INTO "CaseFindings" ("CaseId", "UserId", "Kind", "MediaId", "SourceNature", "Information", "Searched", "Site", "Note", "RequestId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING "Id"`,
        [caseId, userId, input.kind, input.kind === 'record' ? mediaId : null,
            input.kind === 'record' ? input.sourceNature : null, input.kind === 'record' ? input.information : null,
            input.searched, input.site, input.note, requestId],
    );
    const findingId = Number((res.rows[0] as { Id: number }).Id);
    if (sourceId != null) {
        await exec.query(
            `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page", "Url", "DataText")
             VALUES ($1, $2, '${FACT_TABLES.CASE_FINDINGS}', $3, $4, $5, $6, $7)`,
            [ownerId, treeId, findingId, sourceId, input.page, input.url, input.transcription],
        );
    }
    if (leadIds.length > 0) {
        await exec.query(
            `INSERT INTO "CaseFindingLead" ("FindingId", "LeadId") SELECT $1, unnest($2::int[])`,
            [findingId, leadIds],
        );
    }
    if (input.kind === 'record') await insertClaims(exec, findingId, treeId, input.claims);
    if (commentId != null) {
        await exec.query(`UPDATE "CaseComments" SET "FindingId" = $1 WHERE "Id" = $2`, [findingId, commentId]);
        await touchCase(exec, caseId);
        return findingId;
    }
    await addJournalEntry(exec, {
        caseId, userId, findingId,
        kind: input.kind === 'record' ? 'finding' : 'search',
        body: input.kind === 'record' ? sourceTitle : (input.searched ?? ''),
        leadIds,
    });
    await touchCase(exec, caseId);
    return findingId;
}

/** Whether any lead the finding is filed under is settled: its decisions are locked then. */
async function findingLocked(exec: Queryable, findingId: number): Promise<boolean> {
    const res = await exec.query(
        `SELECT 1 FROM "CaseFindingLead" fl JOIN "CaseLeads" l ON l."Id" = fl."LeadId"
          WHERE fl."FindingId" = $1 AND l."SettledAt" IS NOT NULL LIMIT 1`,
        [findingId],
    );
    return res.rows.length > 0;
}

async function caseFinding(exec: Queryable, caseId: number, findingId: number): Promise<{ Kind: string }> {
    const res = await exec.query(`SELECT "Kind" FROM "CaseFindings" WHERE "Id" = $1 AND "CaseId" = $2`, [findingId, caseId]);
    const row = res.rows[0] as { Kind: string } | undefined;
    if (!row) throw new NotFoundError('Finding not found');
    return row;
}

/** Adds a claim to a record finding of the case. */
export async function addClaim(exec: Queryable, caseId: number, treeId: number, findingId: number, claim: ClaimInput) {
    const finding = await caseFinding(exec, caseId, findingId);
    if (finding.Kind !== 'record') throw new ValidationError('Only a record makes claims');
    if (await findingLocked(exec, findingId)) throw new ValidationError('This finding is on a settled lead. Reopen the lead to change it.');
    await insertClaims(exec, findingId, treeId, [claim]);
    await touchCase(exec, caseId);
}

/** Decides a claim in place. Locked on a settled lead, and once applied to the tree. */
export async function decideClaim(exec: Queryable, caseId: number, claimId: number, decision: CaseClaimDecision, userId: number) {
    const res = await exec.query(
        `SELECT cl."FindingId", cl."AppliedAt" FROM "CaseClaims" cl
           JOIN "CaseFindings" f ON f."Id" = cl."FindingId" AND f."CaseId" = $2
          WHERE cl."Id" = $1 FOR UPDATE OF cl`,
        [claimId, caseId],
    );
    const row = res.rows[0] as { FindingId: number; AppliedAt: unknown } | undefined;
    if (!row) throw new NotFoundError('Claim not found');
    if (row.AppliedAt != null) throw new ValidationError('This claim is already in the tree');
    if (await findingLocked(exec, Number(row.FindingId))) throw new ValidationError('This claim is on a settled lead. Reopen the lead to change it.');
    await exec.query(
        `UPDATE "CaseClaims" SET "Decision" = $2,
                "DecidedAt" = CASE WHEN $2 = 'undecided' THEN NULL ELSE CURRENT_TIMESTAMP END,
                "DecidedBy" = CASE WHEN $2 = 'undecided' THEN NULL ELSE $3::int END
          WHERE "Id" = $1`,
        [claimId, decision, userId],
    );
    await touchCase(exec, caseId);
}

export interface RequestInput {
    leadId: number | null;
    askedFor: string;
    holder: string | null;
    sentBy: CaseRequestSentBy | null;
    sentOn: string | null;
    reference: string | null;
    remindOn: string | null;
}

/** Starts tracking a request; its lead is Waiting until the reply is logged. */
export async function insertRequest(exec: Queryable, caseId: number, input: RequestInput, userId: number): Promise<number> {
    const leadIds = await caseLeads(exec, caseId, input.leadId == null ? [] : [input.leadId]);
    const res = await exec.query(
        `INSERT INTO "CaseRequests" ("CaseId", "LeadId", "UserId", "AskedFor", "Holder", "SentBy", "SentOn", "Reference", "RemindOn")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING "Id"`,
        [caseId, input.leadId, userId, input.askedFor, input.holder, input.sentBy, input.sentOn, input.reference, input.remindOn],
    );
    const requestId = Number((res.rows[0] as { Id: number }).Id);
    await addJournalEntry(exec, { caseId, userId, kind: 'request', body: input.askedFor, requestId, leadIds });
    await touchCase(exec, caseId);
    return requestId;
}

/** Logs a reply: they sent it, they have nothing, or it is still waiting (a note only). */
export async function replyToRequest(exec: Queryable, caseId: number, requestId: number, state: CaseRequestState, note: string | null, userId: number) {
    const res = await exec.query(
        `SELECT "LeadId", "AskedFor", "State" FROM "CaseRequests" WHERE "Id" = $1 AND "CaseId" = $2 FOR UPDATE`,
        [requestId, caseId],
    );
    const row = res.rows[0] as { LeadId: number | null; AskedFor: string; State: string } | undefined;
    if (!row) throw new NotFoundError('Request not found');
    if (row.State !== 'waiting') throw new ValidationError('This request already has its reply');
    await exec.query(
        `UPDATE "CaseRequests" SET "State" = $2, "ReplyNote" = $3,
                "RepliedAt" = CASE WHEN $2 = 'waiting' THEN NULL ELSE CURRENT_TIMESTAMP END
          WHERE "Id" = $1`,
        [requestId, state, note],
    );
    await addJournalEntry(exec, {
        caseId, userId, kind: 'reply', body: row.AskedFor, requestId,
        leadIds: row.LeadId == null ? [] : [Number(row.LeadId)],
    });
    await touchCase(exec, caseId);
}

// ─── Export (cases.json, ADR 0045 §9) ────────────────────────────────────────────

/** A case's workspace rows for export, still keyed by DB ids; the sidecar maps them to xrefs and indexes. */
export interface WorkspaceExportRaw {
    leads: Array<{
        Id: number; Question: string; FromYear: number | null; ToYear: number | null; Position: number;
        CreatedAt: string; SettledAt: string | null; DroppedAt: string | null; personDbIds: number[];
    }>;
    requests: Array<{
        Id: number; LeadId: number | null; AskedFor: string; Holder: string | null; SentBy: string | null;
        SentOn: string | null; Reference: string | null; RemindOn: string | null; State: string;
        RepliedAt: string | null; ReplyNote: string | null; CreatedAt: string;
    }>;
    findings: Array<{
        Id: number; Kind: string; leadIds: number[]; MediaId: number | null; SourceNature: string | null;
        Information: string | null; Searched: string | null; Site: string | null; Note: string | null;
        RequestId: number | null; CreatedAt: string; citationRaw: CaseCitationRaw | null;
        claims: Array<{
            What: string; PersonId: number | null; PersonName: string | null; Says: string | null; Date: string | null;
            Place: string | null; Evidence: string | null; Decision: string; DecidedAt: string | null; AppliedAt: string | null;
        }>;
    }>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

/** Every workspace row of the tree's cases, for cases.json. Media and people outside the tree export as none. */
export async function exportWorkspaceData(caseIds: number[], treeId: number, exec: Queryable = defaultExec): Promise<Map<number, WorkspaceExportRaw>> {
    const out = new Map<number, WorkspaceExportRaw>();
    if (caseIds.length === 0) return out;
    const leads = await exec.query(`SELECT * FROM "CaseLeads" WHERE "CaseId" = ANY($1::int[]) ORDER BY "Position", "Id"`, [caseIds]);
    const leadPeople = await exec.query(
        `SELECT lp."LeadId", lp."PersonId" FROM "CaseLeadPerson" lp
           JOIN "CaseLeads" l ON l."Id" = lp."LeadId" JOIN "People" p ON p."Id" = lp."PersonId" AND p."TreeId" = $2
          WHERE l."CaseId" = ANY($1::int[]) ORDER BY lp."PersonId"`,
        [caseIds, treeId],
    );
    const requests = await exec.query(`SELECT * FROM "CaseRequests" WHERE "CaseId" = ANY($1::int[]) ORDER BY "CreatedAt", "Id"`, [caseIds]);
    const findings = await exec.query(
        `SELECT f.*, m."Id" AS "TreeMediaId" FROM "CaseFindings" f
           LEFT JOIN "Media" m ON m."Id" = f."MediaId" AND m."TreeId" = $2
          WHERE f."CaseId" = ANY($1::int[]) ORDER BY f."CreatedAt", f."Id"`,
        [caseIds, treeId],
    );
    const findingLeads = await exec.query(
        `SELECT fl."FindingId", fl."LeadId" FROM "CaseFindingLead" fl
           JOIN "CaseFindings" f ON f."Id" = fl."FindingId" WHERE f."CaseId" = ANY($1::int[])`,
        [caseIds],
    );
    const citations = await exec.query(
        `SELECT ci."FactId", ci."SourceId", ci."Page", ci."Note", ci."Quay", ci."DataText", ci."DataDate", ci."Even", ci."Role", ci."Url"
           FROM "Citation" ci JOIN "CaseFindings" f ON f."Id" = ci."FactId"
          WHERE ci."FactTable" = '${FACT_TABLES.CASE_FINDINGS}' AND ci."TreeId" = $2 AND f."CaseId" = ANY($1::int[])
          ORDER BY ci."Id"`,
        [caseIds, treeId],
    );
    const claims = await exec.query(
        `SELECT cl.*, p."Id" AS "TreePersonId" FROM "CaseClaims" cl
           JOIN "CaseFindings" f ON f."Id" = cl."FindingId"
           LEFT JOIN "People" p ON p."Id" = cl."PersonId" AND p."TreeId" = $2
          WHERE f."CaseId" = ANY($1::int[]) ORDER BY cl."FindingId", cl."Position", cl."Id"`,
        [caseIds, treeId],
    );

    const peopleByLead = new Map<number, number[]>();
    for (const r of leadPeople.rows as Row[]) push(peopleByLead, Number(r.LeadId), Number(r.PersonId));
    const leadsByFinding = new Map<number, number[]>();
    for (const r of findingLeads.rows as Row[]) push(leadsByFinding, Number(r.FindingId), Number(r.LeadId));
    const citationByFinding = new Map<number, CaseCitationRaw>();
    for (const r of citations.rows as Row[]) {
        const id = Number(r.FactId);
        if (citationByFinding.has(id)) continue;
        citationByFinding.set(id, {
            SourceId: Number(r.SourceId), Page: (r.Page as string | null) ?? null, Note: (r.Note as string | null) ?? null,
            Quay: (r.Quay as string | null) ?? null, DataText: (r.DataText as string | null) ?? null,
            DataDate: (r.DataDate as string | null) ?? null, Even: (r.Even as string | null) ?? null,
            Role: (r.Role as string | null) ?? null, Url: (r.Url as string | null) ?? null,
        });
    }
    const claimsByFinding = new Map<number, WorkspaceExportRaw['findings'][number]['claims']>();
    for (const r of claims.rows as Row[]) {
        push(claimsByFinding, Number(r.FindingId), {
            What: String(r.What), PersonId: num(r.TreePersonId), PersonName: (r.PersonName as string | null) ?? null,
            Says: (r.Says as string | null) ?? null, Date: (r.Date as string | null) ?? null, Place: (r.Place as string | null) ?? null,
            Evidence: (r.Evidence as string | null) ?? null, Decision: String(r.Decision),
            DecidedAt: iso(r.DecidedAt), AppliedAt: iso(r.AppliedAt),
        });
    }

    const of = (caseId: number) => {
        let ws = out.get(caseId);
        if (!ws) { ws = { leads: [], requests: [], findings: [] }; out.set(caseId, ws); }
        return ws;
    };
    for (const r of leads.rows as Row[]) {
        of(Number(r.CaseId)).leads.push({
            Id: Number(r.Id), Question: String(r.Question), FromYear: num(r.FromYear), ToYear: num(r.ToYear),
            Position: Number(r.Position), CreatedAt: iso(r.CreatedAt)!, SettledAt: iso(r.SettledAt), DroppedAt: iso(r.DroppedAt),
            personDbIds: peopleByLead.get(Number(r.Id)) ?? [],
        });
    }
    for (const r of requests.rows as Row[]) {
        of(Number(r.CaseId)).requests.push({
            Id: Number(r.Id), LeadId: num(r.LeadId), AskedFor: String(r.AskedFor), Holder: (r.Holder as string | null) ?? null,
            SentBy: (r.SentBy as string | null) ?? null, SentOn: dateOnly(r.SentOn), Reference: (r.Reference as string | null) ?? null,
            RemindOn: dateOnly(r.RemindOn), State: String(r.State), RepliedAt: iso(r.RepliedAt),
            ReplyNote: (r.ReplyNote as string | null) ?? null, CreatedAt: iso(r.CreatedAt)!,
        });
    }
    for (const r of findings.rows as Row[]) {
        const id = Number(r.Id);
        of(Number(r.CaseId)).findings.push({
            Id: id, Kind: String(r.Kind), leadIds: leadsByFinding.get(id) ?? [], MediaId: num(r.TreeMediaId),
            SourceNature: (r.SourceNature as string | null) ?? null, Information: (r.Information as string | null) ?? null,
            Searched: (r.Searched as string | null) ?? null, Site: (r.Site as string | null) ?? null, Note: (r.Note as string | null) ?? null,
            RequestId: num(r.RequestId), CreatedAt: iso(r.CreatedAt)!,
            citationRaw: citationByFinding.get(id) ?? null,
            claims: claimsByFinding.get(id) ?? [],
        });
    }
    return out;
}

// ─── Import (cases.json, ADR 0045 §9) ───────────────────────────────────────────

/** The DB ids an imported workspace's entries became, by their index in the file; undefined for one dropped. */
export interface ImportedWorkspaceIds {
    leads: Array<number | undefined>;
    requests: Array<number | undefined>;
    findings: Array<number | undefined>;
}

/**
 * Rebuilds a case's workspace from cases.json, in order: leads, requests, then
 * findings with their citation and claims, and their filing. Only into a case this
 * import created, inside its transaction. Every person, image and source resolves
 * through the import's own maps and must be in `treeId`; one that doesn't is dropped.
 */
export async function importWorkspace(exec: Queryable, caseId: number, treeId: number, userId: number, ws: ParsedCaseWorkspace, refs: {
    person: (xref: string) => number | undefined;
    media: (xref: string) => number | undefined;
    /** Writes the finding's source citation through the import's citation path. */
    cite: (findingId: number, citation: NonNullable<NonNullable<ParsedCaseWorkspace['findings'][number]>['citation']>) => Promise<void>;
}): Promise<ImportedWorkspaceIds> {
    const ids: ImportedWorkspaceIds = { leads: [], requests: [], findings: [] };
    const personIds = (xrefs: string[]) => [...new Set(xrefs.map(refs.person).filter((n): n is number => n !== undefined))];

    for (const [position, lead] of ws.leads.entries()) {
        if (!lead) { ids.leads.push(undefined); continue; }
        const res = await exec.query(
            `INSERT INTO "CaseLeads" ("CaseId", "Question", "FromYear", "ToYear", "Position", "CreatedBy", "CreatedAt", "SettledAt", "SettledBy", "DroppedAt")
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, CURRENT_TIMESTAMP), $8::timestamptz,
                     CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE $6::int END, $9::timestamptz)
             RETURNING "Id"`,
            [caseId, lead.Question, lead.FromYear, lead.ToYear, position, userId, lead.CreatedAt, lead.SettledAt, lead.DroppedAt],
        );
        const leadId = Number((res.rows[0] as { Id: number }).Id);
        ids.leads.push(leadId);
        await setLeadPeople(exec, leadId, treeId, personIds(lead.people));
        await joinCasePeople(exec, caseId, treeId, personIds(lead.people));
    }

    for (const request of ws.requests) {
        if (!request) { ids.requests.push(undefined); continue; }
        const res = await exec.query(
            `INSERT INTO "CaseRequests" ("CaseId", "LeadId", "UserId", "AskedFor", "Holder", "SentBy", "SentOn", "Reference", "RemindOn",
                                         "State", "RepliedAt", "ReplyNote", "CreatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::date, $10, $11::timestamptz, $12, COALESCE($13::timestamptz, CURRENT_TIMESTAMP))
             RETURNING "Id"`,
            [caseId, request.lead == null ? null : ids.leads[request.lead] ?? null, userId, request.AskedFor, request.Holder,
                request.SentBy, request.SentOn, request.Reference, request.RemindOn, request.State, request.RepliedAt,
                request.ReplyNote, request.CreatedAt],
        );
        ids.requests.push(Number((res.rows[0] as { Id: number }).Id));
    }

    for (const finding of ws.findings) {
        if (!finding) { ids.findings.push(undefined); continue; }
        const mediaId = finding.media == null ? null : refs.media(finding.media) ?? null;
        const res = await exec.query(
            `INSERT INTO "CaseFindings" ("CaseId", "UserId", "Kind", "MediaId", "SourceNature", "Information", "Searched", "Site", "Note",
                                         "RequestId", "CreatedAt")
             VALUES ($1, $2, $3, (SELECT "Id" FROM "Media" WHERE "Id" = $4 AND "TreeId" = $12), $5, $6, $7, $8, $9, $10,
                     COALESCE($11::timestamptz, CURRENT_TIMESTAMP))
             RETURNING "Id"`,
            [caseId, userId, finding.Kind, mediaId, finding.SourceNature, finding.Information, finding.Searched, finding.Site,
                finding.Note, finding.request == null ? null : ids.requests[finding.request] ?? null, finding.CreatedAt, treeId],
        );
        const findingId = Number((res.rows[0] as { Id: number }).Id);
        ids.findings.push(findingId);
        if (finding.citation) await refs.cite(findingId, finding.citation);
        const leadIds = [...new Set(finding.leads.map((i) => ids.leads[i]).filter((n): n is number => n !== undefined))];
        if (leadIds.length > 0) {
            await exec.query(
                `INSERT INTO "CaseFindingLead" ("FindingId", "LeadId") SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
                [findingId, leadIds],
            );
        }
        for (const [position, claim] of finding.claims.entries()) {
            const personId = claim.person == null ? null : refs.person(claim.person) ?? null;
            await exec.query(
                `INSERT INTO "CaseClaims" ("FindingId", "Position", "What", "PersonId", "PersonName", "Says", "Date", "Place", "Evidence",
                                           "Decision", "DecidedAt", "DecidedBy", "AppliedAt")
                 VALUES ($1, $2, $3, (SELECT "Id" FROM "People" WHERE "Id" = $4 AND "TreeId" = $5), $6, $7, $8, $9, $10, $11,
                         $12::timestamptz, CASE WHEN $11 = 'undecided' THEN NULL ELSE $13::int END, $14::timestamptz)`,
                [findingId, position, claim.What, personId, treeId, claim.PersonName, claim.Says, claim.Date, claim.Place,
                    claim.Evidence, claim.Decision, claim.Decision === 'undecided' ? null : claim.DecidedAt, userId, claim.AppliedAt],
            );
        }
    }
    return ids;
}

/** Gives a case with no lead its question as the first lead, with the case's people (ADR 0045 §1). */
export async function ensureFirstLead(exec: Queryable, caseId: number, userId: number) {
    await exec.query(
        `WITH made AS (
           INSERT INTO "CaseLeads" ("CaseId", "Question", "FromYear", "ToYear", "Position", "CreatedBy", "CreatedAt")
           SELECT c."Id", LEFT(c."Title", 500), c."FromYear", c."ToYear", 0, $2, c."CreatedAt" FROM "Cases" c
            WHERE c."Id" = $1 AND NOT EXISTS (SELECT 1 FROM "CaseLeads" l WHERE l."CaseId" = c."Id")
           RETURNING "Id"
         )
         INSERT INTO "CaseLeadPerson" ("LeadId", "PersonId")
         SELECT made."Id", cp."PersonId" FROM made JOIN "CasePerson" cp ON cp."CaseId" = $1
         ON CONFLICT DO NOTHING`,
        [caseId, userId],
    );
}

/** The status of the case a finding belongs to, when the finding is in the tree; null otherwise. */
export async function getCaseFindingStatus(findingId: number, treeId: number, exec: Queryable = defaultExec): Promise<string | null> {
    const res = await exec.query(
        `SELECT c."Status" FROM "CaseFindings" f JOIN "Cases" c ON c."Id" = f."CaseId" WHERE f."Id" = $1 AND c."TreeId" = $2`,
        [findingId, treeId],
    );
    return (res.rows[0] as { Status: string } | undefined)?.Status ?? null;
}
