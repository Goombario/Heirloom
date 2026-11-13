import { query } from '@/lib/db/connection';
import { EVENT_TYPES, type NewAuditLogEntry, type AuditEntityType, type AuditSnapshotChanges, type AuditFieldChanges } from '../schema';
import { FACT_TABLES } from '../fact-tables';
import type { NoteAuditSnapshot } from './notes';
import type { CaseNoteStrikeSnapshot } from './cases';
import { getPlaceNamesById, placeEditChanged, type PlaceDeleteSnapshot, type PlaceEditChange, type PlaceEditState, type PlaceMoveSnapshot, type PlaceRenameSnapshot } from './places';
import type { PlaceNamesSnapshot } from './place-names';

/**
 * A write's result plus the audit entries it created, so the UI can offer Undo by
 * reverting exactly those entries (#1044). `auditIds` is empty when the write
 * changed nothing or its best-effort audit insert failed.
 */
export type Audited<T = object> = T & { auditIds: number[] };

/** Attach audit ids to a write's result, dropping the nulls a no-op or failed insert returns. */
export function withAuditIds<T extends object>(value: T, ids: ReadonlyArray<number | null | undefined>): Audited<T> {
    return { ...value, auditIds: ids.filter((id): id is number => typeof id === 'number') };
}

/** Transaction-aware audit executor shared by pg and PGlite callers. */
export type Queryable = {
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

/**
 * Build a human-readable label for an entity record.
 */
export function buildEntityLabel(
    entityType: AuditEntityType,
    record: Record<string, unknown>
): string {
    switch (entityType) {
        case 'person': {
            const first = (record.FirstName as string) || '';
            const last = (record.LastName as string) || '';
            const name = `${first} ${last}`.trim();
            return name || `Person #${record.Id}`;
        }
        case 'family': {
            const parts: string[] = [];
            const p1Id = record.Partner1Id ?? record.HusbandId;
            const p2Id = record.Partner2Id ?? record.WifeId;
            if (p1Id) parts.push(`Partner1 #${p1Id}`);
            if (p2Id) parts.push(`Partner2 #${p2Id}`);
            return parts.length > 0 ? `Family: ${parts.join(' & ')}` : `Family #${record.Id}`;
        }
        case 'event': {
            // GEDCOM codes are for the file format, not for people reading a log:
            // this used to emit "ADOP for Person #20371".
            const code = (record.Type as string) || 'EVEN';
            const type = EVENT_TYPES[code] ?? code;
            // The subject's name is resolved by `resolveEntityLabel` where a DB
            // handle is available; this is the fallback when it is not.
            if (record.PersonId) return `${type} for Person #${record.PersonId}`;
            if (record.FamilyId) return `${type} for Family #${record.FamilyId}`;
            return `${type} #${record.Id}`;
        }
        case 'media': {
            return (record.Title as string) || `Media #${record.Id}`;
        }
        case 'story': {
            return (record.Title as string) || `Story #${record.Id}`;
        }
        case 'case': {
            return (record.Title as string) || `Case #${record.Id}`;
        }
        case 'source': {
            return (record.Title as string) || `Source #${record.Id}`;
        }
        case 'citation': {
            // Never the storage coordinates ("Citation on PersonBirth#7", #701):
            // the fact's kind here, its subject from `resolveEntityLabel`.
            return `Citation — ${citationFactWord(record)}`;
        }
        case 'mediatag': {
            return `Tag on Media #${record.MediaId} for Person #${record.PersonId}`;
        }
        case 'familychild': {
            return `Child #${record.ChildId} in Family #${record.FamilyId}`;
        }
        case 'namevariant': {
            const type = (record.Type as string) || 'Name';
            const name = (record.Name as string) || '';
            return name ? `${type}: ${name}` : `${type} #${record.Id}`;
        }
        case 'import': {
            // Import summary entries set EntityLabel directly (see auditImport);
            // this branch only satisfies exhaustiveness.
            return (record.EntityLabel as string) || 'Import';
        }
        case 'place': {
            // Place rename/merge entries set EntityLabel directly (see auditPlaceRename);
            // this branch only satisfies exhaustiveness.
            return (record.EntityLabel as string) || 'Place';
        }
        case 'datacheck': {
            // The person's name comes from `resolveEntityLabel`; the rule is
            // translated in the log's Changes column (#830).
            return `Person #${record.PersonId}`;
        }
        case 'casenote': {
            // "Journal note — Who were Ada's parents?" (#1227, #1251).
            return `Journal note — ${(record.CaseTitle as string) || `Case #${record.CaseId}`}`;
        }
        case 'note': {
            // The record's name comes from `resolveEntityLabel` (#1045).
            const text = typeof record.Text === 'string' ? record.Text.replace(/\s+/g, ' ').trim() : '';
            return text ? `Note: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}` : `Note #${record.NoteId}`;
        }
    }
}

/** Plain-language kind of the fact a citation supports. */
const CITATION_FACT_WORDS: Record<string, string> = {
    [FACT_TABLES.PEOPLE]: 'person',
    [FACT_TABLES.FAMILIES]: 'partnership',
    [FACT_TABLES.EVENTS]: 'event',
    [FACT_TABLES.PERSON_BIRTH]: 'birth',
    [FACT_TABLES.PERSON_DEATH]: 'death',
    [FACT_TABLES.PERSON_NAME]: 'name',
    [FACT_TABLES.NAME_VARIANT]: 'name variant',
    [FACT_TABLES.CASES]: 'research case',
    [FACT_TABLES.CASE_COMMENTS]: 'journal entry',
    [FACT_TABLES.CASE_FINDINGS]: 'case finding',
};

function citationFactWord(record: Record<string, unknown>): string {
    return CITATION_FACT_WORDS[record.FactTable as string] ?? 'fact';
}

/*
 * Every lookup below is filtered by the audited record's tree (#847), so an id
 * from another tree yields no label rather than that tree's names. Callers
 * validate ids against the tree today; this is defense in depth.
 * `resolveEntityLabel` skips them for a record without a TreeId, so unscoped
 * legacy rows never match each other across owners.
 */
async function personName(run: Queryable, treeId: number, personId: unknown): Promise<string | undefined> {
    const r = await run.query(
        `SELECT TRIM(CONCAT(COALESCE("FirstName", ''), ' ', COALESCE("LastName", ''))) AS name
           FROM "People" WHERE "Id" = $1 AND "TreeId" = $2`,
        [personId, treeId],
    );
    return (r.rows[0] as { name?: string } | undefined)?.name?.trim() || undefined;
}

async function familyNames(run: Queryable, treeId: number, familyId: unknown): Promise<string | undefined> {
    const r = await run.query(
        `SELECT TRIM(CONCAT(COALESCE(p1."FirstName", ''), ' ', COALESCE(p1."LastName", ''))) AS p1,
                TRIM(CONCAT(COALESCE(p2."FirstName", ''), ' ', COALESCE(p2."LastName", ''))) AS p2
           FROM "Families" f
           LEFT JOIN "People" p1 ON p1."Id" = COALESCE(f."Partner1Id", f."HusbandId")
           LEFT JOIN "People" p2 ON p2."Id" = COALESCE(f."Partner2Id", f."WifeId")
          WHERE f."Id" = $1 AND f."TreeId" = $2`,
        [familyId, treeId],
    );
    const row = r.rows[0] as { p1?: string; p2?: string } | undefined;
    const names = [row?.p1, row?.p2].map((n) => n?.trim()).filter(Boolean);
    return names.length > 0 ? names.join(' & ') : undefined;
}

/**
 * A citation's subject and fact: "Aster Arbor · birth", "John Marsh & Mary
 * Marsh · partnership", "Aster Arbor · adoption". Undefined when the subject
 * has no name or no longer exists.
 */
async function citationSourceTitle(run: Queryable, treeId: number, sourceId: unknown): Promise<string | undefined> {
    if (sourceId == null) return undefined;
    const r = await run.query(`SELECT "Title" FROM "Sources" WHERE "Id" = $1 AND "TreeId" = $2`, [sourceId, treeId]);
    return (r.rows[0] as { Title?: string | null } | undefined)?.Title?.trim() || undefined;
}

async function citationSubject(run: Queryable, treeId: number, record: Record<string, unknown>): Promise<string | undefined> {
    const factId = record.FactId;
    let word = citationFactWord(record);
    let subject: string | undefined;
    switch (record.FactTable) {
        case FACT_TABLES.PEOPLE:
        case FACT_TABLES.PERSON_BIRTH:
        case FACT_TABLES.PERSON_DEATH:
        case FACT_TABLES.PERSON_NAME:
            subject = await personName(run, treeId, factId);
            break;
        case FACT_TABLES.FAMILIES:
            subject = await familyNames(run, treeId, factId);
            break;
        case FACT_TABLES.NAME_VARIANT: {
            const r = await run.query(`SELECT "PersonId" FROM "NameVariant" WHERE "Id" = $1 AND "TreeId" = $2`, [factId, treeId]);
            const personId = (r.rows[0] as { PersonId?: number } | undefined)?.PersonId;
            if (personId) subject = await personName(run, treeId, personId);
            break;
        }
        case FACT_TABLES.EVENTS: {
            const r = await run.query(`SELECT "Type", "PersonId", "FamilyId" FROM "Events" WHERE "Id" = $1 AND "TreeId" = $2`, [factId, treeId]);
            const ev = r.rows[0] as { Type?: string; PersonId?: number | null; FamilyId?: number | null } | undefined;
            if (!ev) break;
            if (ev.Type) word = (EVENT_TYPES[ev.Type] ?? ev.Type).toLowerCase();
            if (ev.PersonId) subject = await personName(run, treeId, ev.PersonId);
            else if (ev.FamilyId) subject = await familyNames(run, treeId, ev.FamilyId);
            break;
        }
        case FACT_TABLES.CASES: {
            const r = await run.query(`SELECT "Title" FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2`, [factId, treeId]);
            subject = (r.rows[0] as { Title?: string } | undefined)?.Title?.trim() || undefined;
            break;
        }
        case FACT_TABLES.CASE_COMMENTS: {
            const r = await run.query(
                `SELECT c."Title" FROM "CaseComments" cc JOIN "Cases" c ON c."Id" = cc."CaseId" WHERE cc."Id" = $1 AND c."TreeId" = $2`,
                [factId, treeId],
            );
            subject = (r.rows[0] as { Title?: string } | undefined)?.Title?.trim() || undefined;
            break;
        }
        case FACT_TABLES.CASE_FINDINGS: {
            const r = await run.query(
                `SELECT c."Title" FROM "CaseFindings" cf JOIN "Cases" c ON c."Id" = cf."CaseId" WHERE cf."Id" = $1 AND c."TreeId" = $2`,
                [factId, treeId],
            );
            subject = (r.rows[0] as { Title?: string } | undefined)?.Title?.trim() || undefined;
            break;
        }
    }
    return subject ? `${subject} · ${word}` : undefined;
}

/**
 * `buildEntityLabel` plus the one thing it cannot do without a DB handle: name
 * the record's subject. An event becomes "Adoption — Cecilia Rose Anderson"
 * rather than "ADOP for Person #20371".
 *
 * Labels are NOT backfilled: a saved label is what the app knew when the change
 * happened. The audit log page no longer shows them, though: since #930 its
 * Record column is built when the log is read (`getAuditRecords`), so it is
 * translated and old entries read like new ones. The saved label still feeds
 * the log's record search and sort, the home activity feed, and the page's
 * fallback for an entry with no record.
 *
 * A lookup failure falls back to the sync label rather than blocking the write —
 * an audit label is never worth failing a user's edit over.
 */
export async function resolveEntityLabel(
    entityType: AuditEntityType,
    record: Record<string, unknown>,
    exec?: Queryable,
): Promise<string> {
    const fallback = buildEntityLabel(entityType, record);
    if (!['event', 'citation', 'familychild', 'family', 'mediatag', 'datacheck', 'note'].includes(entityType)) return fallback;
    // Mirrors insertAuditEntry: inside a transaction use the caller's client, else
    // the pool. Without this the common non-transactional path (every query
    // function) passes no exec and would never resolve a name.
    const run: Queryable = exec ?? { query: (sql, params) => query(sql, params) };
    const treeId = treeIdOf(record);
    if (treeId == null) return fallback;

    try {
        if (entityType === 'family') {
            // "Tom Bracken & Mary Bracken", not "Family: Partner1 #812 & Partner2 #907" (#551).
            const names = [
                await personName(run, treeId, record.Partner1Id ?? record.HusbandId),
                await personName(run, treeId, record.Partner2Id ?? record.WifeId),
            ].filter(Boolean);
            return names.length > 0 ? names.join(' & ') : fallback;
        }
        if (entityType === 'mediatag') {
            const name = await personName(run, treeId, record.PersonId);
            return name ? `Photo tag — ${name}` : fallback;
        }
        if (entityType === 'datacheck') {
            return (await personName(run, treeId, record.PersonId)) || fallback;
        }
        if (entityType === 'note') {
            // "Note — Hazel Bracken" or "Note — Tom Bracken & Mary Bracken" (#1045).
            const owner = record.OwnerTable === 'People'
                ? await personName(run, treeId, record.RecordId)
                : record.OwnerTable === 'Families'
                    ? await familyNames(run, treeId, record.RecordId)
                    : undefined;
            return owner ? `Note — ${owner}` : fallback;
        }
        if (entityType === 'familychild') {
            // "Child — Hazel Bracken · Tom Bracken & Mary Bracken" (#788).
            const child = await personName(run, treeId, record.ChildId);
            if (!child) return fallback;
            const parents = await familyNames(run, treeId, record.FamilyId);
            return parents ? `Child — ${child} · ${parents}` : `Child — ${child}`;
        }
        if (entityType === 'citation') {
            const subject = await citationSubject(run, treeId, record);
            if (!subject) return fallback;
            // Name the source too: "Citation — Hazel Bracken · birth ← 1901 Census" (#768, DV-3).
            const source = await citationSourceTitle(run, treeId, record.SourceId);
            return source ? `Citation — ${subject} ← ${source}` : `Citation — ${subject}`;
        }
        const code = (record.Type as string) || 'EVEN';
        const type = EVENT_TYPES[code] ?? code;
        if (record.PersonId) {
            const name = await personName(run, treeId, record.PersonId);
            return name ? `${type} — ${name}` : fallback;
        }
        if (record.FamilyId) {
            const names = await familyNames(run, treeId, record.FamilyId);
            return names ? `${type} — ${names}` : fallback;
        }
    } catch {
        return fallback;
    }
    return fallback;
}

/**
 * Compute field-level diff between old and new record.
 * Only includes fields from the allowed set that actually changed.
 */
export function computeFieldDiff(
    oldRecord: Record<string, unknown>,
    newRecord: Record<string, unknown>,
    allowedFields: ReadonlySet<string>
): Record<string, { old: unknown; new: unknown }> {
    const diff: Record<string, { old: unknown; new: unknown }> = {};
    for (const field of allowedFields) {
        const oldVal = oldRecord[field] ?? null;
        const newVal = newRecord[field] ?? null;
        if (oldVal !== newVal) {
            diff[field] = { old: oldVal, new: newVal };
        }
    }
    return diff;
}

/**
 * Insert an audit log entry. Audit writes are best-effort: if the insert fails
 * we log and swallow so a non-critical audit problem (e.g. AuditLog CHECK
 * constraint mismatch, JSON.stringify failure) does not propagate as a 500 to
 * the user after their actual write succeeded. When `exec` is a transaction
 * client, the caller controls rollback semantics — we re-throw there so the
 * transaction is rolled back atomically.
 */
/** Returns the new entry's Id, or null when a non-transactional write failed. */
async function insertAuditEntry(entry: NewAuditLogEntry, exec?: Queryable): Promise<number | null> {
    const run = exec
        ? (sql: string, params: unknown[]) => exec.query(sql, params)
        : query;
    try {
        const result = await run(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING "Id"`,
            [entry.TreeOwnerId, entry.UserId, entry.TreeId ?? null, entry.Action, entry.EntityType, entry.EntityId, entry.EntityLabel, JSON.stringify(entry.Changes)]
        );
        return (result.rows[0] as { Id?: number } | undefined)?.Id ?? null;
    } catch (err) {
        // In a transaction the caller needs the error to ROLLBACK atomically.
        if (exec) throw err;
        console.error(
            `[audit] Failed to write ${entry.Action} entry for ${entry.EntityType}#${entry.EntityId}:`,
            err
        );
        return null;
    }
}

/**
 * Multi-tree: audit entries carry the record's tree scope. Derived from the
 * row itself (SELECT * / RETURNING * include "TreeId" once the entity's INSERT
 * stamps it) so no audit call site needs a new argument. Falls back to null;
 * the init-schema backfill re-stamps NULL AuditLog rows on every boot.
 */
function treeIdOf(record: Record<string, unknown>): number | null {
    return typeof record.TreeId === 'number' ? record.TreeId : null;
}

/**
 * Record an update action in the audit log.
 */
export async function auditUpdate(
    entityType: AuditEntityType,
    oldRecord: Record<string, unknown>,
    newRecord: Record<string, unknown>,
    allowedFields: ReadonlySet<string>,
    treeOwnerId: number,
    userId: number,
    exec?: Queryable,
    places?: AuditFieldChanges['places'],
): Promise<number | null> {
    const fields = computeFieldDiff(oldRecord, newRecord, allowedFields);
    // A fact moved to another place of the same name changes no text, but is a change.
    for (const field of Object.keys(places ?? {})) {
        fields[field] ??= { old: oldRecord[field] ?? null, new: newRecord[field] ?? null };
    }
    if (Object.keys(fields).length === 0) return null; // no actual changes
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeIdOf(newRecord) ?? treeIdOf(oldRecord),
        Action: 'update',
        EntityType: entityType,
        EntityId: newRecord.Id as number,
        EntityLabel: await resolveEntityLabel(entityType, newRecord, exec),
        Changes: places && Object.keys(places).length > 0 ? { fields, places } : { fields },
    }, exec);
}

/** Capture the canonical People primary independently of legacy mirror changes. */
export async function auditCanonicalPrimaryChange(params: {
    personId: number;
    oldMediaId: number | null;
    newMediaId: number | null;
    treeOwnerId: number;
    userId: number;
    treeId: number;
    exec: Queryable;
}): Promise<number | null> {
    if (params.oldMediaId === params.newMediaId) return null;
    const entityId = params.newMediaId ?? params.oldMediaId;
    if (entityId == null) return null;
    // "Profile picture — Hazel Bracken", not "Primary media for Person #9510".
    let name: string | undefined;
    try {
        name = await personName(params.exec, params.treeId, params.personId);
    } catch {
        // The label is cosmetic; a failed lookup keeps the id fallback.
    }
    return insertAuditEntry({
        TreeOwnerId: params.treeOwnerId,
        UserId: params.userId,
        TreeId: params.treeId,
        Action: 'update',
        EntityType: 'media',
        EntityId: entityId,
        EntityLabel: `Profile picture — ${name ?? `Person #${params.personId}`}`,
        Changes: ({
            summary: { kind: 'canonical_primary' },
            personId: params.personId,
            fields: {
                CanonicalPrimaryMediaId: { old: params.oldMediaId, new: params.newMediaId },
            },
        } as unknown) as NewAuditLogEntry['Changes'],
    }, params.exec);
}

/** Capture a family photo choice (#119, ADR 0047), as a profile picture change is captured. */
export async function auditFamilyPhotoChange(params: {
    familyId: number;
    oldMediaId: number | null;
    newMediaId: number | null;
    treeOwnerId: number;
    userId: number;
    treeId: number;
    exec: Queryable;
}): Promise<number | null> {
    if (params.oldMediaId === params.newMediaId) return null;
    const entityId = params.newMediaId ?? params.oldMediaId;
    if (entityId == null) return null;
    let names: string | undefined;
    try {
        names = await familyNames(params.exec, params.treeId, params.familyId);
    } catch {
        // The label is cosmetic; a failed lookup keeps the id fallback.
    }
    return insertAuditEntry({
        TreeOwnerId: params.treeOwnerId,
        UserId: params.userId,
        TreeId: params.treeId,
        Action: 'update',
        EntityType: 'media',
        EntityId: entityId,
        EntityLabel: `Family photo — ${names ?? `Family #${params.familyId}`}`,
        Changes: ({
            summary: { kind: FAMILY_PHOTO_SUMMARY },
            familyId: params.familyId,
            fields: {
                FamilyPhotoMediaId: { old: params.oldMediaId, new: params.newMediaId },
            },
        } as unknown) as NewAuditLogEntry['Changes'],
    }, params.exec);
}

/** Record canonical People ownership independently of lossy Media.PersonId mirrors. */
export async function auditCanonicalMediaOwnershipChange(params: {
    mediaId: number;
    oldPersonIds: number[];
    newPersonIds: number[];
    treeOwnerId: number;
    userId: number;
    treeId: number;
    exec: Queryable;
}): Promise<void> {
    const oldPersonIds = [...params.oldPersonIds].sort((a, b) => a - b);
    const newPersonIds = [...params.newPersonIds].sort((a, b) => a - b);
    if (
        oldPersonIds.length === newPersonIds.length
        && oldPersonIds.every((personId, index) => personId === newPersonIds[index])
    ) return;
    await insertAuditEntry({
        TreeOwnerId: params.treeOwnerId,
        UserId: params.userId,
        TreeId: params.treeId,
        Action: 'update',
        EntityType: 'media',
        EntityId: params.mediaId,
        EntityLabel: `Canonical People ownership for Media #${params.mediaId}`,
        Changes: ({
            summary: { kind: 'canonical_ownership' },
            fields: {
                CanonicalPeopleOwnerIds: { old: oldPersonIds, new: newPersonIds },
            },
        } as unknown) as NewAuditLogEntry['Changes'],
    }, params.exec);
}

/**
 * Record a create action in the audit log.
 */
export async function auditCreate(
    entityType: AuditEntityType,
    record: Record<string, unknown>,
    treeOwnerId: number,
    userId: number,
    exec?: Queryable
): Promise<number | null> {
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeIdOf(record),
        Action: 'create',
        EntityType: entityType,
        EntityId: record.Id as number,
        EntityLabel: await resolveEntityLabel(entityType, record, exec),
        Changes: { snapshot: { ...record } },
    }, exec);
}

/** Rows per INSERT in `auditCreateMany`: 8 parameters each, well under Postgres' 65,535. */
const AUDIT_BATCH_ROWS = 200;

/**
 * Record many person and family creates at once (#1270): the same entries
 * `auditCreate` writes one by one, in the order given, in one INSERT per 200
 * records and one read for the families' partner names. A bulk import calls
 * this after its commit; per-record calls cost a round trip a row, and three a
 * family. Post-commit only: it throws on failure and takes no transaction.
 */
export async function auditCreateMany(
    records: ReadonlyArray<{ entityType: 'person' | 'family'; record: Record<string, unknown> }>,
    treeOwnerId: number,
    userId: number,
): Promise<void> {
    if (records.length === 0) return;

    // Partner names for the family labels, as `personName` reads them: per tree,
    // so an id is only ever named inside the record's own tree.
    const partnersOf = (record: Record<string, unknown>) =>
        [record.Partner1Id ?? record.HusbandId, record.Partner2Id ?? record.WifeId];
    const partnerIdsByTree = new Map<number, Set<number>>();
    for (const { entityType, record } of records) {
        const treeId = treeIdOf(record);
        if (entityType !== 'family' || treeId == null) continue;
        let ids = partnerIdsByTree.get(treeId);
        if (!ids) partnerIdsByTree.set(treeId, ids = new Set());
        for (const id of partnersOf(record)) if (typeof id === 'number') ids.add(id);
    }
    const names = new Map<string, string>();
    for (const [treeId, ids] of partnerIdsByTree) {
        if (ids.size === 0) continue;
        const r = await query(
            `SELECT "Id", TRIM(CONCAT(COALESCE("FirstName", ''), ' ', COALESCE("LastName", ''))) AS name
               FROM "People" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`,
            [[...ids], treeId],
        );
        for (const row of r.rows as { Id: number; name: string | null }[]) {
            const name = row.name?.trim();
            if (name) names.set(`${treeId}:${row.Id}`, name);
        }
    }
    const labelOf = (entityType: 'person' | 'family', record: Record<string, unknown>): string => {
        const fallback = buildEntityLabel(entityType, record);
        const treeId = treeIdOf(record);
        if (entityType !== 'family' || treeId == null) return fallback;
        const partners = partnersOf(record).map((id) => names.get(`${treeId}:${id}`)).filter(Boolean);
        return partners.length > 0 ? partners.join(' & ') : fallback;
    };

    for (let start = 0; start < records.length; start += AUDIT_BATCH_ROWS) {
        const batch = records.slice(start, start + AUDIT_BATCH_ROWS);
        const params: unknown[] = [];
        const tuples = batch.map(({ entityType, record }, i) => {
            params.push(
                treeOwnerId, userId, treeIdOf(record), 'create', entityType, record.Id,
                labelOf(entityType, record), JSON.stringify({ snapshot: { ...record } }),
            );
            const n = i * 8;
            return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8})`;
        });
        await query(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ${tuples.join(', ')}`,
            params,
        );
    }
}

/**
 * Record a GEDCOM/spreadsheet import as a SINGLE summary entry (FUNC-5), so the
 * import shows in the Audit Log + activity feed instead of looking like "nothing
 * happened". Informational only: `'import'` is intentionally absent from
 * `ENTITY_CONFIG` (audit.ts), so revert rejects it — imports are not individually
 * revertable (restore a backup to roll back an overwrite). `EntityId` is a `0`
 * sentinel (no single record). Structured counts live in `Changes.snapshot` so
 * the UI can render a fully-localized line; `EntityLabel` is a plain fallback.
 */
export async function auditImport(
    mode: 'overwrite' | 'merge',
    counts: { people: number; families: number; sources?: number },
    treeOwnerId: number,
    userId: number,
    exec?: Queryable,
    treeId?: number | null
): Promise<void> {
    await insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeId ?? null,
        Action: 'create',
        EntityType: 'import',
        EntityId: 0,
        EntityLabel: `${counts.people} people, ${counts.families} families (${mode})`,
        Changes: { snapshot: { mode, ...counts } },
    }, exec);
}

/**
 * Record a place rename/merge as a single revertable summary entry (CRUD §1.2).
 * The full `PlaceRenameSnapshot` (including the exact affected record ids) rides in
 * `Changes.snapshot` so `revertSingleEntry` can undo the operation precisely — even
 * a merge, which folds two places into one. `EntityId` is the surviving gazetteer
 * row (0 when the place had no gazetteer row). Action is `'update'` (a mutation);
 * `EntityLabel` is a plain human fallback, structured data lives in the snapshot.
 */
export async function auditPlaceRename(
    treeOwnerId: number,
    userId: number,
    snapshot: PlaceRenameSnapshot,
    survivingId: number,
    exec?: Queryable,
    treeId?: number | null,
): Promise<number | null> {
    const count = snapshot.affected.length;
    const label = snapshot.wasMerge
        ? `Merged ${snapshot.from} into ${snapshot.to} (${count} record${count === 1 ? '' : 's'})`
        : `Renamed ${snapshot.from} → ${snapshot.to} (${count} record${count === 1 ? '' : 's'})`;
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeId ?? null,
        Action: 'update',
        EntityType: 'place',
        EntityId: survivingId,
        EntityLabel: label,
        Changes: { snapshot: snapshot as unknown as Record<string, unknown> },
    }, exec);
}

/**
 * Record a save of a place's other names (#1185) as one revertable entry. The
 * snapshot holds each name before and after, so undo restores exactly those.
 */
export async function auditPlaceNames(
    treeOwnerId: number,
    userId: number,
    snapshot: PlaceNamesSnapshot,
    exec: Queryable,
    treeId: number,
): Promise<number | null> {
    const parts = [
        snapshot.added.length ? `added ${snapshot.added.map((a) => a.name).join(', ')}` : '',
        snapshot.changed.length ? `changed ${snapshot.changed.map((c) => c.after.name).join(', ')}` : '',
        snapshot.removed.length ? `removed ${snapshot.removed.map((r) => r.before.name).join(', ')}` : '',
    ].filter(Boolean);
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeId,
        Action: 'update',
        EntityType: 'place',
        EntityId: snapshot.placeId,
        EntityLabel: `Other names of ${snapshot.place}: ${parts.join('; ')}`,
        Changes: { snapshot: snapshot as unknown as Record<string, unknown> },
    }, exec);
}

/**
 * Record "Move records to another place" (#1186) as one revertable entry. The
 * snapshot names each moved fact, so undo moves back exactly those. `EntityId` is
 * the place the records moved to.
 */
export async function auditPlaceMove(
    treeOwnerId: number,
    userId: number,
    snapshot: PlaceMoveSnapshot,
    exec: Queryable,
    treeId: number,
): Promise<number | null> {
    const count = snapshot.affected.length;
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeId,
        Action: 'update',
        EntityType: 'place',
        EntityId: snapshot.toId,
        EntityLabel: `Moved ${count} record${count === 1 ? '' : 's'} from ${snapshot.from} to ${snapshot.to}`,
        Changes: { snapshot: snapshot as unknown as Record<string, unknown> },
    }, exec);
}

/**
 * Record deleting an unused place (#1229) as one revertable entry. The snapshot
 * holds the place row and its other names, so undo brings it back under its id.
 */
export async function auditPlaceDelete(
    treeOwnerId: number,
    userId: number,
    snapshot: PlaceDeleteSnapshot,
    exec: Queryable,
    treeId: number,
): Promise<number | null> {
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeId,
        Action: 'delete',
        EntityType: 'place',
        EntityId: Number(snapshot.place.Id),
        EntityLabel: snapshot.name,
        Changes: { snapshot: snapshot as unknown as Record<string, unknown> },
    }, exec);
}

/**
 * Record a journal note being struck out or its strike undone (#1251). `EntityId`
 * is the note; the snapshot keeps the marker before and after, so a revert puts
 * the old one back. Older 'casenote' entries (#1227 edits and deletes) only display.
 */
export async function auditCaseNoteStrike(
    snapshot: CaseNoteStrikeSnapshot,
    treeOwnerId: number,
    userId: number,
    exec: Queryable,
): Promise<number | null> {
    const record = { ...snapshot } as unknown as Record<string, unknown>;
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: snapshot.TreeId,
        Action: 'update',
        EntityType: 'casenote',
        EntityId: snapshot.CommentId,
        EntityLabel: buildEntityLabel('casenote', record),
        Changes: { snapshot: record },
    }, exec);
}

/** What a geocode, coordinate or hierarchy edit did to a place, for its label (#924). */
export type PlaceEditKind = 'coordinates' | 'geocode' | 'pin_hidden' | 'pin_cleared' | 'hierarchy';

/** `Changes.summary.kind` of a revertable place edit entry. */
export const PLACE_EDIT_SUMMARY = 'place_edit';

/** `Changes.summary.kind` of a family photo choice (#119). */
export const FAMILY_PHOTO_SUMMARY = 'family_photo';

/** The readable values of one place state; the raw columns ride in `places`. */
function placeDisplay(state: PlaceEditState | null, parentNames: Map<number, string>): Record<string, unknown> {
    if (!state) return { Coordinates: null, DisplayName: null, PinSuppressed: false, PartOf: null };
    return {
        Coordinates: state.Latitude != null && state.Longitude != null ? [state.Latitude, state.Longitude] : null,
        DisplayName: state.DisplayName ?? null,
        PinSuppressed: state.PinSuppressed === true,
        PartOf: state.ParentId != null ? parentNames.get(state.ParentId as number) ?? null : null,
    };
}

/**
 * Record a place geocode, coordinate or hierarchy edit as one revertable entry,
 * in the same transaction as the write (#924). `changes` lists every gazetteer
 * row the call touched (root → leaf for a hierarchy); unchanged rows are dropped
 * and nothing is written when the call changed nothing. The raw before/after
 * columns ride in `Changes.places` for revert; `fields` (or `snapshot`, for a new
 * place) holds the readable details of the leaf. Created when the leaf is new.
 */
export async function auditPlaceEdit(params: {
    kind: PlaceEditKind;
    changes: PlaceEditChange[];
    treeOwnerId: number;
    userId: number;
    treeId: number;
    exec: Queryable;
}): Promise<number | null> {
    const changed = params.changes.filter(placeEditChanged);
    const leaf = params.changes[params.changes.length - 1];
    if (!leaf || changed.length === 0) return null;
    const parentIds = [leaf.before?.ParentId, leaf.after.ParentId].filter((id): id is number => typeof id === 'number');
    const parentNames = await getPlaceNamesById(params.exec, params.treeId, parentIds);
    const after = placeDisplay(leaf.after, parentNames);
    const created = leaf.before == null;
    const fields: Record<string, { old: unknown; new: unknown }> = {};
    if (!created) {
        const before = placeDisplay(leaf.before, parentNames);
        for (const [field, value] of Object.entries(after)) {
            if (JSON.stringify(before[field]) !== JSON.stringify(value)) fields[field] = { old: before[field], new: value };
        }
    }
    const label = params.kind === 'hierarchy'
        ? `Built jurisdiction chain for ${leaf.name}: ${changed.length} place${changed.length === 1 ? '' : 's'}`
        : `${leaf.name}: ${{ coordinates: 'coordinates set', geocode: 'geocoded', pin_hidden: 'pin hidden', pin_cleared: 'coordinates cleared' }[params.kind]}`;
    const summary = { kind: PLACE_EDIT_SUMMARY, edit: params.kind };
    const changes = created
        ? { snapshot: { Name: leaf.name, ...after }, summary, places: changed }
        : { fields, summary, places: changed };
    return insertAuditEntry({
        TreeOwnerId: params.treeOwnerId,
        UserId: params.userId,
        TreeId: params.treeId,
        Action: created ? 'create' : 'update',
        EntityType: 'place',
        EntityId: leaf.id,
        EntityLabel: label,
        Changes: changes as unknown as NewAuditLogEntry['Changes'],
    }, params.exec);
}

/**
 * Record a delete action in the audit log.
 */
export async function auditDelete(
    entityType: AuditEntityType,
    record: Record<string, unknown>,
    treeOwnerId: number,
    userId: number,
    exec?: Queryable,
    dependents?: AuditSnapshotChanges['dependents'],
): Promise<number | null> {
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: treeIdOf(record),
        Action: 'delete',
        EntityType: entityType,
        EntityId: record.Id as number,
        EntityLabel: await resolveEntityLabel(entityType, record, exec),
        Changes: dependents ? { snapshot: { ...record }, dependents } : { snapshot: { ...record } },
    }, exec);
}

/**
 * Record confirming (`create`) or reopening (`delete`) an unlikely data check
 * (#830). `EntityId` is the person the problem is listed under, so the log
 * links to their page; the confirmation row rides in the snapshot. Not
 * revertable from the log: a problem is reopened from the Data checks page.
 */
export async function auditDataCheckConfirmation(
    action: 'create' | 'delete',
    row: Record<string, unknown> & { PersonId: number; TreeId: number },
    treeOwnerId: number,
    userId: number,
    exec?: Queryable,
): Promise<number | null> {
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: row.TreeId,
        Action: action,
        EntityType: 'datacheck',
        EntityId: row.PersonId,
        EntityLabel: await resolveEntityLabel('datacheck', row, exec),
        Changes: { snapshot: { ...row } },
    }, exec);
}

/** A family's child link, the `FamilyPerson` row, as the audit log records it (#788). */
interface FamilyChildLink {
    FamilyId: number;
    ChildId: number;
    /** The child's relationship to each partner slot (#982). */
    Partner1Relationship: string | null;
    Partner2Relationship: string | null;
    TreeId: number;
}

/**
 * Record adding (`create`) or removing (`delete`) a child link, or changing its
 * relationship to a partner (`update`, with the old values; only the partners
 * whose value changed are fields). `EntityId` is the family, so the log links to
 * the family page; the child rides in the snapshot. Returns the entry's Id so an
 * Undo can revert exactly this change.
 */
export async function auditFamilyChild(
    action: 'create' | 'delete' | 'update',
    link: FamilyChildLink,
    treeOwnerId: number,
    userId: number,
    exec?: Queryable,
    old?: Pick<FamilyChildLink, 'Partner1Relationship' | 'Partner2Relationship'>,
): Promise<number | null> {
    const snapshot = { ...link } as Record<string, unknown>;
    const fields: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of ['Partner1Relationship', 'Partner2Relationship'] as const) {
        if ((old?.[key] ?? null) !== link[key]) fields[key] = { old: old?.[key] ?? null, new: link[key] };
    }
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: link.TreeId,
        Action: action,
        EntityType: 'familychild',
        EntityId: link.FamilyId,
        EntityLabel: await resolveEntityLabel('familychild', snapshot, exec),
        Changes: action === 'update'
            ? { fields, snapshot }
            : { snapshot },
    }, exec);
}

/**
 * Record moving a child link from one family to another (#796) as one `update`
 * on the destination family. `fields.FamilyId` holds the move, so the log reads
 * "Family · A → B" and a revert moves the link back.
 */
export async function auditFamilyChildMove(
    link: FamilyChildLink,
    fromFamilyId: number,
    treeOwnerId: number,
    userId: number,
    exec?: Queryable,
): Promise<number | null> {
    const snapshot = { ...link } as Record<string, unknown>;
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: link.TreeId,
        Action: 'update',
        EntityType: 'familychild',
        EntityId: link.FamilyId,
        EntityLabel: await resolveEntityLabel('familychild', snapshot, exec),
        Changes: { fields: { FamilyId: { old: fromFamilyId, new: link.FamilyId } }, snapshot },
    }, exec);
}

/**
 * Record a note write (#1045). `EntityId` is the note; the snapshot carries the
 * note row and its links to one record, so a revert can remove an added note,
 * restore a deleted one, or put back its text or preferred flag. `fields` holds
 * an update's `Text` or `IsPrimary` change. Returns the entry's Id for Undo.
 */
export async function auditNote(
    action: 'create' | 'delete' | 'update',
    snapshot: NoteAuditSnapshot,
    treeOwnerId: number,
    userId: number,
    fields?: Record<string, { old: unknown; new: unknown }>,
    exec?: Queryable,
): Promise<number | null> {
    const record = { ...snapshot } as unknown as Record<string, unknown>;
    return insertAuditEntry({
        TreeOwnerId: treeOwnerId,
        UserId: userId,
        TreeId: snapshot.TreeId,
        Action: action,
        EntityType: 'note',
        EntityId: snapshot.NoteId,
        EntityLabel: await resolveEntityLabel('note', record, exec),
        Changes: fields ? { fields, snapshot: record } : { snapshot: record },
    }, exec);
}
