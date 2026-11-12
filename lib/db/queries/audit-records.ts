import { query } from '@/lib/db/connection';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { EVENT_TYPES, type AuditLogEntry } from '../schema';
import type { AuditRecord, AuditRecordItem, AuditRecordKind } from '@/lib/data/types';

/**
 * The record each audit entry belongs to, for the log's Record column (#930):
 * the person, family, source, case or place, never the event, tag or citation
 * inside it. That item rides along as `item`, in ids and codes the page words.
 *
 * Built when the log is read, from the entry's type, ids and `Changes`, so old
 * entries read like new ones whatever their saved `EntityLabel` says. An
 * update saves only the changed fields, so an update to an event, tag, name or
 * citation looks the item up to find its record. Every lookup is filtered by
 * the tree. A record that is gone keeps the name its entry saved (its
 * snapshot, or the names in its saved label) and is not linked.
 */

type Row = Record<string, unknown>;

interface Draft {
    kind: AuditRecordKind | null;
    id: number | null;
    /** The name this entry itself saved, used when the record is gone. */
    saved: string | null;
    item: AuditRecordItem | null;
    /** The person a child link or tag names, resolved with the record names. */
    childId?: number | null;
    /** The child's name as the entry saved it, for when the child is gone. */
    savedChild?: string | null;
    savedSource?: string | null;
    photoId?: number | null;
    sourceId?: number | null;
    /** An item whose record is found by looking the item up. */
    pending?: { table: 'Events' | 'MediaTag' | 'NameVariant' | 'Citation' | 'CaseComments' | 'CaseFindings'; id: number };
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const fullName = (row: Row | undefined): string | null =>
    row ? text(`${text(row.FirstName) ?? ''} ${text(row.LastName) ?? ''}`) : null;

/** A label the capture code saved for the record itself, unless it is an id placeholder. */
function savedLabel(entry: AuditLogEntry): string | null {
    const label = text(entry.EntityLabel);
    return label && !/#\d+/.test(label) ? label : null;
}

/** Where a cited fact lives: a record directly, or an item to look up first. */
function citedFact(draft: Draft, factTable: unknown, factId: number | null): void {
    const item = draft.item as Extract<AuditRecordItem, { kind: 'citation' }>;
    if (factId == null) return;
    switch (factTable) {
        case FACT_TABLES.PEOPLE: item.fact = 'person'; break;
        case FACT_TABLES.PERSON_BIRTH: item.fact = 'birth'; break;
        case FACT_TABLES.PERSON_DEATH: item.fact = 'death'; break;
        case FACT_TABLES.PERSON_NAME: item.fact = 'name'; break;
        case FACT_TABLES.FAMILIES: item.fact = 'partnership'; break;
        case FACT_TABLES.FAMILY_MARRIAGE: item.fact = 'marriage'; break;
        case FACT_TABLES.CASES: item.fact = 'case'; break;
        case FACT_TABLES.EVENTS: item.fact = 'event'; draft.pending = { table: 'Events', id: factId }; return;
        case FACT_TABLES.NAME_VARIANT: item.fact = 'nameVariant'; draft.pending = { table: 'NameVariant', id: factId }; return;
        case FACT_TABLES.CASE_COMMENTS: item.fact = 'journal'; draft.pending = { table: 'CaseComments', id: factId }; return;
        // A finding's record (#58) is cited for its case.
        case FACT_TABLES.CASE_FINDINGS: item.fact = 'case'; draft.pending = { table: 'CaseFindings', id: factId }; return;
        default: return;
    }
    draft.kind = item.fact === 'partnership' || item.fact === 'marriage' ? 'family' : item.fact === 'case' ? 'case' : 'person';
    draft.id = factId;
}

/** Point a draft at the person or family an item belongs to. */
function ownedBy(draft: Draft, personId: unknown, familyId?: unknown): boolean {
    const person = num(personId);
    const family = num(familyId);
    if (person != null) Object.assign(draft, { kind: 'person', id: person });
    else if (family != null) Object.assign(draft, { kind: 'family', id: family });
    return person != null || family != null;
}

/**
 * Names a saved label holds. The capture code writes them while the records
 * exist ("Child — Hazel Bracken · Tom Bracken & Mary Bracken"), so they are
 * what's left to name a record deleted since. An id placeholder
 * ("Child #12 in Family #3") names nothing.
 */
function namesInSavedLabel(entityType: string, label: string | null): { record?: string; child?: string; source?: string; eventCode?: string } {
    const clean = (v: string | undefined) => (v && v.trim() && !/#\d+/.test(v) ? v.trim() : undefined);
    if (!label) return {};
    const dash = label.indexOf(' — ');
    const after = dash > 0 ? label.slice(dash + 3) : null;
    switch (entityType) {
        case 'familychild': {
            if (!after) return {};
            const dot = after.indexOf(' · ');
            return dot > 0 ? { child: clean(after.slice(0, dot)), record: clean(after.slice(dot + 3)) } : { child: clean(after) };
        }
        case 'citation': {
            if (!after) return {};
            const arrow = after.lastIndexOf(' ← ');
            const subject = arrow > 0 ? after.slice(0, arrow) : after;
            const dot = subject.lastIndexOf(' · ');
            return { record: clean(dot > 0 ? subject.slice(0, dot) : undefined), source: clean(arrow > 0 ? after.slice(arrow + 3) : undefined) };
        }
        case 'event': {
            // The saved label leads with the type's English name: "Occupation — Edith Bracken".
            const type = dash > 0 ? label.slice(0, dash) : undefined;
            const eventCode = Object.keys(EVENT_TYPES).find((code) => EVENT_TYPES[code] === type);
            return { record: clean(after ?? undefined), eventCode };
        }
        case 'mediatag':
        case 'note':
        case 'casenote':
        case 'media':
            return { record: clean(after ?? undefined) };
        case 'datacheck':
            return { record: clean(label) };
        case 'family':
            // Older entries wrote "Family: Tom Bracken & Mary Bracken".
            return { record: clean(label.replace(/^Family: /, '')) };
        default:
            return {};
    }
}

/** What an entry's own `Changes` say about its record, with the names its saved label kept. */
function draftFor(entry: AuditLogEntry): Draft {
    const draft = capturedDraft(entry);
    const names = namesInSavedLabel(entry.EntityType, entry.EntityLabel);
    draft.saved ??= names.record ?? null;
    draft.savedChild = names.child ?? null;
    draft.savedSource = names.source ?? null;
    if (draft.item?.kind === 'event') draft.item.code ??= names.eventCode ?? null;
    return draft;
}

function capturedDraft(entry: AuditLogEntry): Draft {
    const changes = (entry.Changes ?? {}) as { snapshot?: Row; fields?: Record<string, { old: unknown; new: unknown }>; summary?: { kind?: unknown }; personId?: unknown; places?: Row[] };
    const snap = changes.snapshot ?? {};
    const field = (name: string) => changes.fields?.[name]?.new;
    const id = num(entry.EntityId);
    const draft: Draft = { kind: null, id: null, saved: null, item: null };
    switch (entry.EntityType) {
        case 'person':
            return { ...draft, kind: 'person', id, saved: fullName(snap) ?? savedLabel(entry) };
        case 'family':
            return { ...draft, kind: 'family', id, saved: savedLabel(entry) };
        case 'case':
        case 'source':
            return { ...draft, kind: entry.EntityType, id, saved: text(snap.Title) ?? savedLabel(entry) };
        case 'datacheck':
            return { ...draft, kind: 'person', id, item: { kind: 'dataCheck', rule: text(snap.Rule), threshold: typeof snap.Threshold === 'number' ? snap.Threshold : null } };
        case 'familychild':
            return { ...draft, kind: 'family', id: num(snap.FamilyId) ?? id, item: { kind: 'child', id: num(snap.ChildId), name: null, live: false }, childId: num(snap.ChildId) };
        case 'casenote':
            return { ...draft, kind: 'case', id: num(snap.CaseId), saved: text(snap.CaseTitle), item: { kind: 'journalEntry' } };
        case 'note':
            draft.item = { kind: 'note' };
            if (snap.OwnerTable === 'People') ownedBy(draft, snap.RecordId);
            else if (snap.OwnerTable === 'Families') ownedBy(draft, null, snap.RecordId);
            return draft;
        case 'story':
            draft.item = { kind: 'story', title: text(snap.Title) ?? text(field('Title')) };
            ownedBy(draft, snap.PersonId);
            return draft;
        case 'event':
            draft.item = { kind: 'event', code: text(snap.Type) ?? text(field('Type')) };
            if (!ownedBy(draft, snap.PersonId, snap.FamilyId) && id != null) draft.pending = { table: 'Events', id };
            return draft;
        case 'mediatag':
            draft.item = { kind: 'photoTag', photo: null };
            draft.photoId = num(snap.MediaId);
            if (!ownedBy(draft, snap.PersonId ?? field('PersonId')) && id != null) draft.pending = { table: 'MediaTag', id };
            return draft;
        case 'namevariant':
            draft.item = { kind: 'nameVariant', type: text(snap.Type) ?? text(field('Type')), name: text(snap.Name) ?? text(field('Name')) };
            if (!ownedBy(draft, snap.PersonId) && id != null) draft.pending = { table: 'NameVariant', id };
            return draft;
        case 'citation':
            draft.item = { kind: 'citation', fact: null, eventCode: null, source: null };
            draft.sourceId = num(snap.SourceId);
            if (snap.FactTable != null) citedFact(draft, snap.FactTable, num(snap.FactId));
            else if (id != null) draft.pending = { table: 'Citation', id };
            return draft;
        case 'media':
            if (changes.summary?.kind === 'canonical_primary') {
                draft.item = { kind: 'profilePicture', photo: null };
                draft.photoId = id;
                ownedBy(draft, changes.personId);
                return draft;
            }
            return { ...draft, kind: 'media', id, saved: text(snap.Title) ?? savedLabel(entry) };
        case 'place': {
            // A rename names the place it became; a geocode or hierarchy edit saves each place it touched, leaf last.
            const leaf = Array.isArray(changes.places) ? changes.places[changes.places.length - 1] : undefined;
            return { ...draft, kind: 'place', id, saved: text(snap.to) ?? text(snap.Name) ?? text(leaf?.name) };
        }
        case 'import':
            return { ...draft, kind: 'tree' };
        default:
            return draft;
    }
}

async function rowsById(sql: string, ids: Set<number>, treeId: number): Promise<Map<number, Row>> {
    if (ids.size === 0) return new Map();
    const result = await query(sql, [[...ids], treeId]);
    return new Map((result.rows as Row[]).map((row) => [row.Id as number, row]));
}

/** Records for one page of entries, keyed by entry id. */
export async function getAuditRecords(treeId: number, entries: AuditLogEntry[]): Promise<Record<string, AuditRecord>> {
    const drafts = new Map(entries.map((entry) => [entry.Id, draftFor(entry)]));
    const pendingIds = (table: NonNullable<Draft['pending']>['table']) =>
        new Set([...drafts.values()].filter((d) => d.pending?.table === table).map((d) => d.pending!.id));

    // An updated citation saved only its changed fields: find the fact it cites.
    const citations = await rowsById(
        `SELECT "Id", "FactTable", "FactId", "SourceId" FROM "Citation" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`,
        pendingIds('Citation'), treeId,
    );
    for (const draft of drafts.values()) {
        if (draft.pending?.table !== 'Citation') continue;
        const row = citations.get(draft.pending.id);
        draft.pending = undefined;
        if (!row) continue;
        draft.sourceId = num(row.SourceId);
        citedFact(draft, row.FactTable, num(row.FactId));
    }

    const [events, tags, variants, comments, findings] = await Promise.all([
        rowsById(`SELECT "Id", "Type", "PersonId", "FamilyId" FROM "Events" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, pendingIds('Events'), treeId),
        rowsById(
            `SELECT mt."Id", mt."PersonId", mt."MediaId" FROM "MediaTag" mt JOIN "Media" m ON m."Id" = mt."MediaId"
              WHERE mt."Id" = ANY($1::int[]) AND m."TreeId" = $2`,
            pendingIds('MediaTag'), treeId,
        ),
        rowsById(`SELECT "Id", "PersonId", "Type", "Name" FROM "NameVariant" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, pendingIds('NameVariant'), treeId),
        rowsById(
            `SELECT cc."Id", cc."CaseId" FROM "CaseComments" cc JOIN "Cases" c ON c."Id" = cc."CaseId"
              WHERE cc."Id" = ANY($1::int[]) AND c."TreeId" = $2`,
            pendingIds('CaseComments'), treeId,
        ),
        rowsById(
            `SELECT cf."Id", cf."CaseId" FROM "CaseFindings" cf JOIN "Cases" c ON c."Id" = cf."CaseId"
              WHERE cf."Id" = ANY($1::int[]) AND c."TreeId" = $2`,
            pendingIds('CaseFindings'), treeId,
        ),
    ]);
    for (const draft of drafts.values()) {
        const pending = draft.pending;
        if (!pending) continue;
        draft.pending = undefined;
        const item = draft.item;
        if (pending.table === 'Events') {
            const row = events.get(pending.id);
            if (!row) continue;
            ownedBy(draft, row.PersonId, row.FamilyId);
            if (item?.kind === 'event') item.code ??= text(row.Type);
            if (item?.kind === 'citation') item.eventCode = text(row.Type);
        } else if (pending.table === 'MediaTag') {
            const row = tags.get(pending.id);
            if (!row) continue;
            ownedBy(draft, row.PersonId);
            draft.photoId ??= num(row.MediaId);
        } else if (pending.table === 'NameVariant') {
            const row = variants.get(pending.id);
            if (!row) continue;
            ownedBy(draft, row.PersonId);
            if (item?.kind === 'nameVariant') {
                item.type ??= text(row.Type);
                item.name ??= text(row.Name);
            }
        } else {
            const row = (pending.table === 'CaseFindings' ? findings : comments).get(pending.id);
            if (row) Object.assign(draft, { kind: 'case', id: num(row.CaseId) });
        }
    }

    const ids = (kind: AuditRecordKind) => new Set([...drafts.values()].filter((d) => d.kind === kind && d.id != null).map((d) => d.id!));
    const people = ids('person');
    for (const draft of drafts.values()) if (draft.childId != null) people.add(draft.childId);
    const media = ids('media');
    for (const draft of drafts.values()) if (draft.photoId != null) media.add(draft.photoId);
    const sources = ids('source');
    for (const draft of drafts.values()) if (draft.sourceId != null) sources.add(draft.sourceId);
    const name = (alias: string) => `NULLIF(TRIM(CONCAT(COALESCE(${alias}."FirstName", ''), ' ', COALESCE(${alias}."LastName", ''))), '')`;
    const [personRows, familyRows, sourceRows, caseRows, placeRows, mediaRows, treeRows] = await Promise.all([
        rowsById(`SELECT p."Id", ${name('p')} AS "Name" FROM "People" p WHERE p."Id" = ANY($1::int[]) AND p."TreeId" = $2`, people, treeId),
        rowsById(
            `SELECT f."Id", ${name('p1')} AS "P1", ${name('p2')} AS "P2" FROM "Families" f
               LEFT JOIN "People" p1 ON p1."Id" = COALESCE(f."Partner1Id", f."HusbandId")
               LEFT JOIN "People" p2 ON p2."Id" = COALESCE(f."Partner2Id", f."WifeId")
              WHERE f."Id" = ANY($1::int[]) AND f."TreeId" = $2`,
            ids('family'), treeId,
        ),
        rowsById(`SELECT "Id", "Title" AS "Name" FROM "Sources" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, sources, treeId),
        rowsById(`SELECT "Id", "Title" AS "Name" FROM "Cases" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, ids('case'), treeId),
        rowsById(`SELECT "Id", "Name" FROM "Places" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, ids('place'), treeId),
        rowsById(`SELECT "Id", "Title" AS "Name" FROM "Media" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, media, treeId),
        rowsById(`SELECT "Id", "Name" FROM "Trees" WHERE "Id" = ANY($1::int[]) AND "Id" = $2`, [...drafts.values()].some((d) => d.kind === 'tree') ? new Set([treeId]) : new Set<number>(), treeId),
    ]);
    const families = new Map([...familyRows].map(([id, row]) => [id, { Name: [text(row.P1), text(row.P2)].filter(Boolean).join(' & ') || null }]));
    const tables: Record<AuditRecordKind, Map<number, Row>> = {
        person: personRows, family: families, source: sourceRows, case: caseRows, place: placeRows, media: mediaRows, tree: treeRows,
    };

    const records: Record<string, AuditRecord> = {};
    for (const [entryId, draft] of drafts) {
        const row = draft.kind == null ? undefined : tables[draft.kind].get(draft.kind === 'tree' ? treeId : draft.id ?? -1);
        const item = draft.item;
        if (item?.kind === 'child') {
            const child = draft.childId == null ? undefined : personRows.get(draft.childId);
            Object.assign(item, { name: text(child?.Name) ?? draft.savedChild ?? null, live: child != null });
        }
        if ((item?.kind === 'photoTag' || item?.kind === 'profilePicture') && draft.photoId != null) item.photo = text(mediaRows.get(draft.photoId)?.Name);
        if (item?.kind === 'citation') item.source = (draft.sourceId == null ? null : text(sourceRows.get(draft.sourceId)?.Name)) ?? draft.savedSource ?? null;
        records[entryId] = {
            kind: draft.kind,
            id: draft.kind === 'tree' ? null : draft.id,
            name: text(row?.Name) ?? draft.saved,
            live: row != null,
            item,
        };
    }
    return records;
}
