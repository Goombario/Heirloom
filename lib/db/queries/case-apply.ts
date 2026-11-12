import type { CaseChange, CaseChangeKind } from '@/lib/db/schema';
import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';
import { auditCreate, auditUpdate, type Queryable } from './audit-capture';
import { revertAuditEntriesWith } from './audit';
import { createCitation } from './citations';
import { integratedFullName } from './people';
import { factPlaceRefChanges, factPlaceRefs, factPlaceTextColumns } from './place-links';

/*
 * Answer and close (#58, ADR 0046): what the case's accepted claims would change
 * in the tree, applying the ticked ones, and Undo. Every function runs in the
 * caller's transaction (`exec`), after the case is locked.
 *
 * - A birth or death fills the person's empty date or place; what the tree says
 *   otherwise is replaced only when the researcher ticks it.
 * - Baptism, burial, residence, occupation, census, emigration, immigration and
 *   naturalisation become a new event, or cite the person's event of that type
 *   on the same date when there is one.
 * - Each change cites the claim's record on the fact it changed: two audit
 *   entries, kept on the claim so Undo reverts both.
 * - Marriage, parents, free text and people not in the tree are entered by hand.
 */

type Row = Record<string, unknown>;

const VITALS = {
    BIRT: { date: 'BirthDate', place: 'BirthPlace', fact: FACT_TABLES.PERSON_BIRTH },
    DEAT: { date: 'DeathDate', place: 'DeathPlace', fact: FACT_TABLES.PERSON_DEATH },
} as const;
type Vital = keyof typeof VITALS;
const isVital = (what: string): what is Vital => what === 'BIRT' || what === 'DEAT';

const EVENT_KEYS: ReadonlySet<string> = new Set(['BAPM', 'BURI', 'RESI', 'OCCU', 'CENS', 'EMIG', 'IMMI', 'NATU']);

/** The person fields Answer and close writes; the audit diff covers just these. */
const PERSON_FIELDS: ReadonlySet<string> = new Set(['BirthDate', 'BirthPlace', 'DeathDate', 'DeathPlace', 'IsDeceased']);

const same = (a: string | null, b: string | null) => (a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === (b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const str = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v));

interface PlannedChange extends CaseChange {
    /** Where the citation goes: the fact table and id (the person for a birth or death, an event otherwise). */
    target: { table: FactTableValue; id: number } | null;
    citation: { SourceId: number; Page: string | null; Url: string | null; DataText: string | null } | null;
}

async function cited(exec: Queryable, treeId: number, table: FactTableValue, factId: number, sourceId: number, page: string | null): Promise<boolean> {
    const res = await exec.query(
        `SELECT 1 FROM "Citation" WHERE "TreeId" = $1 AND "FactTable" = $2 AND "FactId" = $3 AND "SourceId" = $4
            AND COALESCE("Page", '') = COALESCE($5, '') LIMIT 1`,
        [treeId, table, factId, sourceId, page],
    );
    return res.rows.length > 0;
}

/**
 * What Answer and close would do with each accepted claim not yet applied, in the
 * order the findings were added. Read inside the close transaction too, so what
 * is applied is worked out again from the rows as they are then.
 */
async function planChanges(exec: Queryable, caseId: number, treeId: number): Promise<PlannedChange[]> {
    const claims = await exec.query(
        `SELECT cl."Id", cl."FindingId", cl."What", cl."PersonId", cl."PersonName", cl."Says", cl."Date", cl."Place",
                p."Id" AS "TreePersonId", ${integratedFullName('p')} AS "personLabel",
                p."BirthDate", p."DeathDate", ${factPlaceTextColumns('people', 'p')},
                ci."SourceId", ci."Page", ci."Url", ci."DataText", s."Title" AS "sourceTitle"
           FROM "CaseClaims" cl
           JOIN "CaseFindings" f ON f."Id" = cl."FindingId" AND f."CaseId" = $1
           LEFT JOIN "People" p ON p."Id" = cl."PersonId" AND p."TreeId" = $2
           LEFT JOIN "Citation" ci ON ci."Id" = (
                SELECT x."Id" FROM "Citation" x
                 WHERE x."FactTable" = '${FACT_TABLES.CASE_FINDINGS}' AND x."FactId" = f."Id" AND x."TreeId" = $2
                 ORDER BY x."Id" LIMIT 1)
           LEFT JOIN "Sources" s ON s."Id" = ci."SourceId" AND s."TreeId" = $2
          WHERE cl."Decision" = 'accepted' AND cl."AppliedAt" IS NULL
          ORDER BY f."CreatedAt", f."Id", cl."Position", cl."Id"`,
        [caseId, treeId],
    );
    const leads = await exec.query(
        `SELECT fl."FindingId", fl."LeadId" FROM "CaseFindingLead" fl
           JOIN "CaseFindings" f ON f."Id" = fl."FindingId" AND f."CaseId" = $1
           JOIN "CaseLeads" l ON l."Id" = fl."LeadId" AND l."DroppedAt" IS NULL
          ORDER BY fl."LeadId"`,
        [caseId],
    );
    const leadsOf = new Map<number, number[]>();
    for (const r of leads.rows as Row[]) {
        const list = leadsOf.get(Number(r.FindingId)) ?? [];
        list.push(Number(r.LeadId));
        leadsOf.set(Number(r.FindingId), list);
    }

    const out: PlannedChange[] = [];
    for (const r of claims.rows as Row[]) {
        const what = String(r.What);
        const personId = r.TreePersonId == null ? null : Number(r.TreePersonId);
        const date = str(r.Date);
        const place = str(r.Place);
        const citation = r.SourceId == null ? null : {
            SourceId: Number(r.SourceId), Page: str(r.Page), Url: str(r.Url), DataText: str(r.DataText),
        };
        const change: PlannedChange = {
            claimId: Number(r.Id),
            findingId: Number(r.FindingId),
            leadIds: leadsOf.get(Number(r.FindingId)) ?? [],
            kind: 'by_hand',
            what,
            personId,
            personLabel: personId != null ? str(r.personLabel) : str(r.PersonName),
            says: str(r.Says),
            date,
            place,
            fills: { date: false, place: false },
            differs: { date: null, place: null },
            sourceTitle: str(r.sourceTitle),
            target: null,
            citation,
        };
        out.push(change);
        if (personId == null || !citation) continue;

        if (isVital(what)) {
            const v = VITALS[what];
            const treeDate = str(r[v.date]);
            const treePlace = str(r[v.place]);
            change.fills = { date: date != null && treeDate == null, place: place != null && treePlace == null };
            change.differs = {
                date: date != null && treeDate != null && !same(date, treeDate) ? treeDate : null,
                place: place != null && treePlace != null && !same(place, treePlace) ? treePlace : null,
            };
            change.target = { table: v.fact, id: personId };
            const writes = change.fills.date || change.fills.place || change.differs.date != null || change.differs.place != null;
            change.kind = writes ? 'fill' : await settled(exec, treeId, change);
            continue;
        }
        if (EVENT_KEYS.has(what)) {
            const match = date == null ? null : await exec.query(
                `SELECT "Id", "Date" FROM "Events" WHERE "TreeId" = $1 AND "PersonId" = $2 AND UPPER("Type") = $3 AND "Date" IS NOT NULL ORDER BY "Id"`,
                [treeId, personId, what],
            ).then((res) => (res.rows as Row[]).find((e) => same(str(e.Date), date)) ?? null);
            if (match) {
                change.target = { table: FACT_TABLES.EVENTS, id: Number(match.Id) };
                change.kind = await settled(exec, treeId, change);
            } else {
                change.kind = 'event';
            }
        }
    }
    return out;
}

/** A fact the tree already states: cite the record on it, unless it is cited there already. */
async function settled(exec: Queryable, treeId: number, change: PlannedChange): Promise<CaseChangeKind> {
    const { target, citation } = change;
    return target && citation && await cited(exec, treeId, target.table, target.id, citation.SourceId, citation.Page) ? 'in_tree' : 'cite';
}

/** What Answer and close would change, for the page to show before it closes. */
export async function caseChanges(exec: Queryable, caseId: number, treeId: number): Promise<CaseChange[]> {
    return (await planChanges(exec, caseId, treeId)).map(({ target: _target, citation: _citation, ...change }) => change);
}

export interface ApplyChoice { claimId: number; replace: boolean }

/**
 * Applies the chosen claims (#58): each as its own audited change plus the
 * citation of its record, both kept on the claim with "AppliedAt". A choice that
 * is not a change any more (applied since, no longer accepted, nothing left to
 * write) throws, so the researcher sees the page again rather than a partial close.
 */
export async function applyChanges(
    exec: Queryable,
    caseId: number,
    scope: { treeId: number; ownerId: number },
    userId: number,
    choices: readonly ApplyChoice[],
): Promise<number> {
    if (choices.length === 0) return 0;
    let applied = 0;
    for (const choice of choices) {
        // Planned again for each claim: an earlier one in this close may have filled the
        // same field or made the same event, which this one then cites rather than repeats.
        const change = (await planChanges(exec, caseId, scope.treeId)).find((c) => c.claimId === choice.claimId);
        // Already said and cited, by an earlier claim in this close: nothing to write.
        if (change?.kind === 'in_tree') continue;
        if (!change || change.kind === 'by_hand' || !change.citation) {
            throw new ValidationError('A change is no longer there to make. Look over the list again.');
        }
        let auditId: number | null;
        let target = change.target;
        if (change.kind === 'fill') {
            const written = await fillVital(exec, scope.treeId, userId, change, choice.replace);
            if (written === undefined) {
                throw new ValidationError('A change would replace what the tree says, or what another claim just filled. Tick Replace, or leave one of them out.');
            }
            auditId = written;
        } else if (change.kind === 'event') {
            const made = await addEvent(exec, scope, userId, change);
            auditId = made.auditId;
            target = { table: FACT_TABLES.EVENTS, id: made.eventId };
        } else {
            auditId = null;
        }
        if (!target) throw new ValidationError('A change is no longer there to make. Look over the list again.');
        const citation = await createCitation({
            OwnerId: scope.ownerId, TreeId: scope.treeId, FactTable: target.table, FactId: target.id,
            SourceId: change.citation.SourceId, Page: change.citation.Page, Url: change.citation.Url, DataText: change.citation.DataText,
        }, userId, exec);
        const citationAuditId = citation.auditIds[0] ?? null;
        // A citation alone is the change itself; otherwise it rides beside it.
        await exec.query(
            `UPDATE "CaseClaims" SET "AppliedAt" = CURRENT_TIMESTAMP, "AppliedAuditId" = $2, "AppliedCitationAuditId" = $3 WHERE "Id" = $1`,
            [change.claimId, auditId ?? citationAuditId, auditId == null ? null : citationAuditId],
        );
        applied++;
    }
    return applied;
}

async function personRow(exec: Queryable, personId: number, treeId: number): Promise<Row> {
    const res = await exec.query(
        `SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2 FOR UPDATE OF p`,
        [personId, treeId],
    );
    const row = res.rows[0] as Row | undefined;
    if (!row) throw new NotFoundError('Person not found');
    return row;
}

/**
 * Fills a birth or death: empty fields from the claim, and differing ones too
 * when `replace`. A death also marks the person deceased. Resolves the audit id,
 * null when the tree already said it all, or undefined when nothing was chosen.
 */
async function fillVital(exec: Queryable, treeId: number, userId: number, change: PlannedChange, replace: boolean): Promise<number | null | undefined> {
    const v = VITALS[change.what as Vital];
    const writeDate = change.fills.date || (replace && change.differs.date != null);
    const writePlace = change.fills.place || (replace && change.differs.place != null);
    if (!writeDate && !writePlace) return undefined;
    const before = await personRow(exec, change.personId!, treeId);
    const columns: [string, unknown][] = [];
    if (writeDate) columns.push([`"${v.date}"`, change.date]);
    if (writePlace) columns.push(...await factPlaceRefs(exec, treeId, Number(before.UserId), { [v.place]: change.place }));
    if (change.what === 'DEAT' && Number(before.IsDeceased) !== 1) columns.push(['"IsDeceased"', 1]);
    await exec.query(
        `UPDATE "People" SET ${columns.map(([c], i) => `${c} = $${i + 1}`).join(', ')}, "UpdatedAt" = CURRENT_TIMESTAMP
          WHERE "Id" = $${columns.length + 1} AND "TreeId" = $${columns.length + 2}`,
        [...columns.map(([, value]) => value), change.personId, treeId],
    );
    const after = await personRow(exec, change.personId!, treeId);
    return auditUpdate('person', before, after, PERSON_FIELDS, Number(before.UserId), userId, exec, factPlaceRefChanges('people', before, after));
}

/** A new event on the person: the claim's type, date and place, with what the record says as its description. */
async function addEvent(exec: Queryable, scope: { treeId: number; ownerId: number }, userId: number, change: PlannedChange) {
    const places = await factPlaceRefs(exec, scope.treeId, scope.ownerId, { Place: change.place });
    const columns = ['"UserId"', '"TreeId"', '"Type"', '"Date"', '"Description"', '"PersonId"', ...places.map(([c]) => c)];
    const values = [scope.ownerId, scope.treeId, change.what, change.date, change.says, change.personId, ...places.map(([, v]) => v)];
    const res = await exec.query(
        `INSERT INTO "Events" (${columns.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING *, ${factPlaceTextColumns('events', '"Events"')}`,
        values,
    );
    const event = res.rows[0] as Row;
    const auditId = await auditCreate('event', event, scope.ownerId, userId, exec);
    return { eventId: Number(event.Id), auditId };
}

/** A revert that names a record gone since: the change is already undone there. */
const gone = (err: unknown) => err instanceof Error && !(err instanceof ValidationError) && /no longer exists|not found/i.test(err.message);

type AuditRow = { Id: number; Action: string; EntityType: string; EntityId: number; Changes: unknown };
const changesOf = (e: AuditRow) => (typeof e.Changes === 'string' ? JSON.parse(e.Changes) : e.Changes) as {
    fields?: Record<string, { old: unknown; new: unknown }>; snapshot?: Row;
};

/**
 * Undo (#58): reverts what Answer and close changed for one claim (the citation,
 * then the fact) and clears the claim's applied mark. Refused when the fact has
 * been edited since (the person's birth or death, or the new event, or the event
 * has gained other sources), so Undo never overwrites later work. A change already
 * undone elsewhere (from the audit log, or its record deleted) just clears the mark.
 */
export async function undoApplied(
    exec: Queryable,
    caseId: number,
    claimId: number,
    scope: { treeId: number; ownerId: number },
    userId: number,
): Promise<void> {
    const res = await exec.query(
        `SELECT cl."AppliedAt", cl."AppliedAuditId", cl."AppliedCitationAuditId" FROM "CaseClaims" cl
           JOIN "CaseFindings" f ON f."Id" = cl."FindingId" AND f."CaseId" = $2
          WHERE cl."Id" = $1 FOR UPDATE OF cl`,
        [claimId, caseId],
    );
    const row = res.rows[0] as Row | undefined;
    if (!row) throw new NotFoundError('Claim not found');
    if (row.AppliedAt == null || row.AppliedAuditId == null) throw new ValidationError('This claim has no change to undo');
    const ids = [Number(row.AppliedAuditId), ...(row.AppliedCitationAuditId == null ? [] : [Number(row.AppliedCitationAuditId)])];

    const found = await exec.query(
        `SELECT "Id", "Action", "EntityType", "EntityId", "Changes" FROM "AuditLog" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`,
        [ids, scope.treeId],
    );
    const byId = new Map((found.rows as AuditRow[]).map((e) => [Number(e.Id), e]));
    const citationIds = [...byId.values()].filter((e) => e.EntityType === 'citation').map((e) => Number(e.EntityId));
    const toRevert: number[] = [];
    for (const auditId of ids) {
        const e = byId.get(auditId);
        if (!e) continue;
        if (e.EntityType === 'person' && e.Action === 'update') {
            const fields = Object.entries(changesOf(e).fields ?? {});
            const now = await exec.query(`SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2`, [e.EntityId, scope.treeId]);
            const person = now.rows[0] as Row | undefined;
            if (!person) continue;
            // Already put back from the audit log: nothing to revert here.
            if (fields.every(([field, diff]) => same(str(person[field]), str(diff.old)))) continue;
            if (!fields.every(([field, diff]) => same(str(person[field]), str(diff.new)))) {
                throw new ValidationError('This person has been edited since. Change it on their page instead.');
            }
        } else if (e.EntityType === 'event' && e.Action === 'create') {
            const snap = changesOf(e).snapshot ?? {};
            const now = await exec.query(`SELECT * FROM "Events" WHERE "Id" = $1 AND "TreeId" = $2`, [e.EntityId, scope.treeId]);
            const event = now.rows[0] as Row | undefined;
            if (!event) continue;
            const edited = ['Type', 'Date', 'Description', 'PersonId', 'PlaceId'].some((f) => !same(str(event[f]), str(snap[f])));
            const others = await exec.query(
                `SELECT 1 FROM "Citation" WHERE "FactTable" = $1 AND "FactId" = $2 AND "TreeId" = $3 AND NOT ("Id" = ANY($4::int[])) LIMIT 1`,
                [FACT_TABLES.EVENTS, e.EntityId, scope.treeId, citationIds],
            );
            if (edited || others.rows.length > 0) {
                throw new ValidationError('This event has been edited or cited since. Change it on the page of the person instead.');
            }
        } else if (e.EntityType === 'citation' && e.Action === 'create') {
            const still = await exec.query(`SELECT 1 FROM "Citation" WHERE "Id" = $1 AND "TreeId" = $2`, [e.EntityId, scope.treeId]);
            if (still.rows.length === 0) continue;
        }
        toRevert.push(auditId);
    }
    try {
        await revertAuditEntriesWith(exec, toRevert, scope.treeId, scope.ownerId, userId);
    } catch (err) {
        if (!gone(err)) throw err;
        throw new ValidationError('What this changed has been edited or deleted since, so it can not be undone here.');
    }
    await exec.query(
        `UPDATE "CaseClaims" SET "AppliedAt" = NULL, "AppliedAuditId" = NULL, "AppliedCitationAuditId" = NULL WHERE "Id" = $1`,
        [claimId],
    );
}
