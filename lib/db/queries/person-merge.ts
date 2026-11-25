import { effectiveFirstName } from './people';
import { factPlaceColumnFor, factPlaceTextSql } from './place-links';
import { PERSON_KEYED_FACT_TABLES, FACT_TABLES } from '@/lib/db/fact-tables';

/**
 * Merging two people (#28, ADR 0052): one record is kept, everything on the other
 * moves onto it, and the other is removed. Every row the merge touches is written
 * to an undo log in order, so revert can play it backwards and put back exactly
 * what was there.
 */

type Executor = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> };
type Row = Record<string, unknown>;

/** The tables a merge writes, each with the columns that name one row. */
const MERGE_TABLES = {
    People: ['Id'],
    Events: ['Id'],
    Citation: ['Id'],
    NameVariant: ['Id'],
    MediaTag: ['Id'],
    MediaFaceCandidate: ['Id'],
    CaseClaims: ['Id'],
    DataCheckConfirmations: ['Id'],
    Families: ['Id'],
    FamilyPerson: ['FamiliesAsChildId', 'ChildrenId'],
    MediaLink: ['MediaId', 'OwnerTable', 'OwnerId', 'OwnerFact'],
    NoteLink: ['NoteId', 'OwnerTable', 'OwnerId', 'OwnerFact'],
    CasePerson: ['CaseId', 'PersonId'],
    CaseLeadPerson: ['LeadId', 'PersonId'],
} as const satisfies Record<string, readonly string[]>;

type MergeTable = keyof typeof MERGE_TABLES;

/** Generated columns: the database computes them, so nothing ever writes them. */
const GENERATED: Readonly<Record<string, ReadonlySet<string>>> = {
    People: new Set(['SearchName']),
    NameVariant: new Set(['SearchName']),
};

/** One step of the undo log. */
type MergeOp =
    | { op: 'update'; table: MergeTable; key: Row; before: Row }
    | { op: 'delete'; table: MergeTable; row: Row }
    | { op: 'insert'; table: MergeTable; key: Row };

/** The fields the reader chooses between. A date and its place are one choice. */
export const MERGE_FIELDS = ['name', 'sex', 'living', 'birth', 'death'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeTake = Partial<Record<MergeField, 'kept' | 'other'>>;

const FIELD_COLUMNS: Record<MergeField, readonly string[]> = {
    name: ['FirstName', 'LastName', 'NamePrefix', 'SurnamePrefix', 'NameSuffix', 'NameRawGedcom'],
    sex: ['Sex'],
    living: ['IsDeceased'],
    birth: ['BirthDate', 'BirthPlaceId', 'BirthPlaceNameId', 'BirthRawGedcom', 'BirthRecorded'],
    death: ['DeathDate', 'DeathPlaceId', 'DeathPlaceNameId', 'DeathRawGedcom', 'DeathCause'],
};

/** The columns that decide whether a field differs between the two people. */
const COMPARED: Record<MergeField, readonly string[]> = {
    name: ['FirstName', 'LastName'],
    sex: ['Sex'],
    living: ['IsDeceased'],
    birth: ['BirthDate', 'BirthPlaceId'],
    death: ['DeathDate', 'DeathPlaceId'],
};

const blank = (v: unknown) => (v == null || v === '' ? null : v);
const same = (a: Row, b: Row, field: MergeField) => COMPARED[field].every((c) => blank(a[c]) === blank(b[c]));

/** The fields whose values differ between two people rows. */
export function differingFields(a: Row, b: Row): MergeField[] {
    return MERGE_FIELDS.filter((f) => !same(a, b, f));
}

const COLUMN_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const q = (name: string) => {
    if (!COLUMN_NAME.test(name)) throw new Error(`Unexpected column name ${name}`);
    return `"${name}"`;
};

function keyOf(table: MergeTable, row: Row): Row {
    return Object.fromEntries(MERGE_TABLES[table].map((c) => [c, row[c] ?? null]));
}

/** `"A" IS NOT DISTINCT FROM $n AND …` for a key, from parameter `start`. */
function keyWhere(key: Row, start: number): { sql: string; params: unknown[] } {
    const cols = Object.keys(key);
    return {
        sql: cols.map((c, i) => `${q(c)} IS NOT DISTINCT FROM $${start + i}`).join(' AND '),
        params: cols.map((c) => key[c]),
    };
}

/** A value as a query parameter: a JSON value goes back as its text. */
function param(v: unknown): unknown {
    if (v != null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
    return v;
}

function writable(table: MergeTable, row: Row): string[] {
    const generated = GENERATED[table];
    return Object.keys(row).filter((c) => !generated?.has(c));
}

/** Records each change in order, and applies it. */
class UndoLog {
    readonly ops: MergeOp[] = [];
    constructor(private readonly exec: Executor) {}

    /**
     * The row as JSON, read again by its key: timestamps keep their microseconds
     * (a JS Date would drop them), so revert writes back exactly what was there.
     */
    private async exact(table: MergeTable, row: Row): Promise<Row> {
        const where = keyWhere(keyOf(table, row), 1);
        const found = await this.exec.query(`SELECT to_jsonb(t) AS "r" FROM ${q(table)} t WHERE ${where.sql}`, where.params);
        if (found.rows.length !== 1) throw new Error(`Merge could not read ${table}`);
        return (found.rows[0] as { r: Row }).r;
    }

    /** Change some columns of one row, keeping the whole row as it was. */
    async update(table: MergeTable, row: Row, set: Row): Promise<void> {
        const before = await this.exact(table, row);
        const changed = Object.keys(set).filter((c) => blank(before[c]) !== blank(set[c]));
        if (changed.length === 0) return;
        const where = keyWhere(keyOf(table, before), changed.length + 1);
        const result = await this.exec.query(
            `UPDATE ${q(table)} SET ${changed.map((c, i) => `${q(c)} = $${i + 1}`).join(', ')} WHERE ${where.sql}`,
            [...changed.map((c) => param(set[c])), ...where.params],
        );
        if ((result.rowCount ?? 0) !== 1) throw new Error(`Merge could not update ${table}`);
        this.ops.push({ op: 'update', table, key: keyOf(table, { ...before, ...set }), before });
    }

    async remove(table: MergeTable, found: Row): Promise<void> {
        const row = await this.exact(table, found);
        const where = keyWhere(keyOf(table, row), 1);
        const result = await this.exec.query(`DELETE FROM ${q(table)} WHERE ${where.sql}`, where.params);
        if ((result.rowCount ?? 0) !== 1) throw new Error(`Merge could not remove from ${table}`);
        this.ops.push({ op: 'delete', table, row });
    }

    async insert(table: MergeTable, values: Row): Promise<Row> {
        const cols = Object.keys(values);
        const result = await this.exec.query(
            `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
            cols.map((c) => param(values[c])),
        );
        const row = result.rows[0] as Row;
        this.ops.push({ op: 'insert', table, key: keyOf(table, row) });
        return row;
    }
}

async function rows(exec: Executor, sql: string, params: unknown[]): Promise<Row[]> {
    return (await exec.query(sql, params)).rows as Row[];
}

/** Both people, locked for the merge, in this tree. */
async function lockPeople(exec: Executor, treeId: number, ids: number[]): Promise<Map<number, Row>> {
    const found = await rows(exec, `SELECT * FROM "People" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2 ORDER BY "Id" FOR UPDATE`, [ids, treeId]);
    return new Map(found.map((r) => [r.Id as number, r]));
}

export interface MergeBlock {
    reason: 'partners' | 'parent';
    familyId: number;
}

/** A family that would make one of the two their own partner or parent, if any. */
export async function findMergeBlock(exec: Executor, treeId: number, a: number, b: number): Promise<MergeBlock | null> {
    const partners = await rows(exec,
        `SELECT "Id" FROM "Families"
          WHERE "TreeId" = $1
            AND ARRAY[$2::int, $3::int] <@ ARRAY[COALESCE("Partner1Id", "HusbandId"), COALESCE("Partner2Id", "WifeId")]
          ORDER BY "Id" LIMIT 1`, [treeId, a, b]);
    if (partners.length) return { reason: 'partners', familyId: partners[0].Id as number };
    const parent = await rows(exec,
        `SELECT f."Id" FROM "Families" f
           JOIN "FamilyPerson" fp ON fp."FamiliesAsChildId" = f."Id"
          WHERE f."TreeId" = $1
            AND ((fp."ChildrenId" = $2 AND $3 IN (COALESCE(f."Partner1Id", f."HusbandId"), COALESCE(f."Partner2Id", f."WifeId")))
              OR (fp."ChildrenId" = $3 AND $2 IN (COALESCE(f."Partner1Id", f."HusbandId"), COALESCE(f."Partner2Id", f."WifeId"))))
          ORDER BY f."Id" LIMIT 1`, [treeId, a, b]);
    if (parent.length) return { reason: 'parent', familyId: parent[0].Id as number };
    return null;
}

/** What sits on one person, as the merge dialog's "Also moves" line counts it. */
interface MergeCounts {
    events: number;
    citations: number;
    notes: number;
    photos: number;
    cases: number;
    familyLinks: number;
    names: number;
}

async function countPersonRecords(exec: Executor, treeId: number, personId: number): Promise<MergeCounts> {
    const r = (await rows(exec,
        `SELECT
           (SELECT COUNT(*)::int FROM "Events" WHERE "PersonId" = $1 AND "TreeId" = $2) AS events,
           (SELECT COUNT(*)::int FROM "Citation" WHERE "FactTable" = ANY($3::text[]) AND "FactId" = $1 AND "TreeId" = $2) AS citations,
           (SELECT COUNT(*)::int FROM "NoteLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1) AS notes,
           (SELECT COUNT(*)::int FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1) AS photos,
           (SELECT COUNT(*)::int FROM "CasePerson" WHERE "PersonId" = $1) AS cases,
           (SELECT COUNT(*)::int FROM "Families" WHERE "TreeId" = $2 AND $1 IN (COALESCE("Partner1Id", "HusbandId"), COALESCE("Partner2Id", "WifeId")))
             + (SELECT COUNT(*)::int FROM "FamilyPerson" WHERE "ChildrenId" = $1) AS "familyLinks",
           (SELECT COUNT(*)::int FROM "NameVariant" WHERE "PersonId" = $1) AS names`,
        [personId, treeId, [...PERSON_KEYED_FACT_TABLES]]))[0];
    // Citations on the person's events move with the events; count them too.
    const eventCitations = (await rows(exec,
        `SELECT COUNT(*)::int AS n FROM "Citation" c JOIN "Events" e ON e."Id" = c."FactId"
          WHERE c."FactTable" = $1 AND e."PersonId" = $2 AND e."TreeId" = $3`, [FACT_TABLES.EVENTS, personId, treeId]))[0].n as number;
    return {
        events: r.events as number,
        citations: (r.citations as number) + eventCitations,
        notes: r.notes as number,
        photos: r.photos as number,
        cases: r.cases as number,
        familyLinks: r.familyLinks as number,
        names: r.names as number,
    };
}

/** One side of the merge dialog. */
export interface MergeSide {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    DisplayFirstName: string | null;
    Sex: string | null;
    IsDeceased: number | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    BirthPlaceId: number | null;
    DeathDate: string | null;
    DeathPlace: string | null;
    DeathPlaceId: number | null;
    CreatedAt: string | null;
    /** Came in with a GEDCOM import rather than being added by hand. */
    Imported: boolean;
    BirthSources: number;
    DeathSources: number;
    Counts: MergeCounts;
}

export async function readMergeSide(exec: Executor, treeId: number, personId: number): Promise<MergeSide | null> {
    const found = await rows(exec,
        `SELECT p."Id", p."FirstName", p."LastName", ${effectiveFirstName('p')} AS "DisplayFirstName", p."Sex", p."IsDeceased",
                p."BirthDate", ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'p')} AS "BirthPlace", p."BirthPlaceId",
                p."DeathDate", ${factPlaceTextSql(factPlaceColumnFor('DeathPlace'), 'p')} AS "DeathPlace", p."DeathPlaceId",
                p."CreatedAt", (p."GedcomId" IS NOT NULL) AS "Imported",
                (SELECT COUNT(*)::int FROM "Citation" c WHERE c."FactTable" = $3 AND c."FactId" = p."Id" AND c."TreeId" = p."TreeId") AS "BirthSources",
                (SELECT COUNT(*)::int FROM "Citation" c WHERE c."FactTable" = $4 AND c."FactId" = p."Id" AND c."TreeId" = p."TreeId") AS "DeathSources"
           FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2`,
        [personId, treeId, FACT_TABLES.PERSON_BIRTH, FACT_TABLES.PERSON_DEATH]);
    if (!found.length) return null;
    const r = found[0];
    const created = r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : (r.CreatedAt as string | null);
    return { ...(r as unknown as MergeSide), CreatedAt: created, Counts: await countPersonRecords(exec, treeId, personId) };
}

const fullName = (r: Row) => [r.FirstName, r.LastName].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim();

/** What the audit log shows for a merge, and the undo log revert plays back. */
export interface PersonMergeSnapshot {
    keptId: number;
    mergedId: number;
    keptName: string;
    mergedName: string;
    /** The values not kept, per field, for the log. */
    notKept: Partial<Record<MergeField, Row>>;
    /** The name added to the kept person as an Alias, if any. */
    alternateName: string | null;
    moved: Record<'events' | 'citations' | 'names' | 'notes' | 'photos' | 'faceTags' | 'cases' | 'families' | 'childLinks', number>;
    /** Links the kept person already had: the other copy was dropped. */
    combined: Record<'childLinks' | 'photos' | 'notes' | 'faceTags' | 'cases', number>;
    ops: MergeOp[];
}

/**
 * Merge `otherId` into `keptId`, in the caller's transaction. Returns the undo
 * log and what the log shows. Throws when either person is missing from the tree
 * or the pair is blocked (the caller has already checked, this guards a race).
 */
export async function mergePeople(
    exec: Executor,
    treeId: number,
    treeOwnerId: number,
    keptId: number,
    otherId: number,
    take: MergeTake,
): Promise<PersonMergeSnapshot> {
    const people = await lockPeople(exec, treeId, [keptId, otherId]);
    const kept = people.get(keptId);
    const other = people.get(otherId);
    if (!kept || !other) throw new Error('Person not found');
    if (await findMergeBlock(exec, treeId, keptId, otherId)) throw new Error('These two people cannot be merged');

    const log = new UndoLog(exec);
    const moved = { events: 0, citations: 0, names: 0, notes: 0, photos: 0, faceTags: 0, cases: 0, families: 0, childLinks: 0 };
    const combined = { childLinks: 0, photos: 0, notes: 0, faceTags: 0, cases: 0 };
    const differing = differingFields(kept, other);
    const taken = new Set(differing.filter((f) => take[f] === 'other'));

    // The kept record's fields.
    const set: Row = {};
    for (const f of taken) for (const c of FIELD_COLUMNS[f]) set[c] = other[c] ?? null;
    const notKept: Partial<Record<MergeField, Row>> = {};
    for (const f of differing) {
        const from = taken.has(f) ? kept : other;
        notKept[f] = Object.fromEntries(COMPARED[f].map((c) => [c, from[c] ?? null]));
    }
    // The log shows the place not kept by name, as it read before the merge.
    for (const f of ['birth', 'death'] as const) {
        const value = notKept[f];
        if (!value) continue;
        const col = f === 'birth' ? 'BirthPlace' : 'DeathPlace';
        const from = taken.has(f) ? keptId : otherId;
        value[col] = (await rows(exec,
            `SELECT ${factPlaceTextSql(factPlaceColumnFor(col), 'p')} AS "Place" FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2`,
            [from, treeId]))[0]?.Place ?? null;
    }

    // The name that isn't kept stays as an Alias on the kept person.
    const nameTaken = taken.has('name');
    const leftName = fullName(nameTaken ? kept : other);
    const keptName = fullName(nameTaken ? other : kept);
    let alternate: Row | null = null;
    if (leftName && leftName.toLocaleLowerCase() !== keptName.toLocaleLowerCase()) {
        alternate = await log.insert('NameVariant', {
            OwnerId: treeOwnerId, TreeId: treeId, PersonId: keptId, Type: 'Alias', Name: leftName, IsPrimary: 0,
        });
    }

    // Citations on the name follow the name: the kept name's sources on the person's
    // name, the other's on the new Alias (or the person's name when no Alias was made).
    const nameCitations = await rows(exec,
        `SELECT * FROM "Citation" WHERE "FactTable" = $1 AND "FactId" = ANY($2::int[]) AND "TreeId" = $3 ORDER BY "Id"`,
        [FACT_TABLES.PERSON_NAME, [keptId, otherId], treeId]);
    const nameOwner = nameTaken ? otherId : keptId;
    for (const c of nameCitations) {
        const onKeptName = c.FactId === nameOwner;
        const target = onKeptName || !alternate
            ? { FactTable: FACT_TABLES.PERSON_NAME, FactId: keptId }
            : { FactTable: FACT_TABLES.NAME_VARIANT, FactId: alternate.Id };
        await log.update('Citation', c, target);
        if (c.FactId === otherId) moved.citations++;
    }

    // Every other citation on the person: the whole record, birth and death are combined.
    const personCitations = await rows(exec,
        `SELECT * FROM "Citation" WHERE "FactTable" = ANY($1::text[]) AND "FactId" = $2 AND "TreeId" = $3 ORDER BY "Id"`,
        [[FACT_TABLES.PEOPLE, FACT_TABLES.PERSON_BIRTH, FACT_TABLES.PERSON_DEATH], otherId, treeId]);
    for (const c of personCitations) {
        await log.update('Citation', c, { FactId: keptId });
        moved.citations++;
    }

    // Events, with their own citations untouched (they point at the event).
    for (const e of await rows(exec, `SELECT * FROM "Events" WHERE "PersonId" = $1 AND "TreeId" = $2 ORDER BY "Id"`, [otherId, treeId])) {
        await log.update('Events', e, { PersonId: keptId });
        moved.events++;
    }
    moved.citations += ((await rows(exec,
        `SELECT COUNT(*)::int AS n FROM "Citation" c JOIN "Events" e ON e."Id" = c."FactId"
          WHERE c."FactTable" = $1 AND e."PersonId" = $2 AND e."TreeId" = $3
            AND e."Id" = ANY($4::int[])`,
        [FACT_TABLES.EVENTS, keptId, treeId, log.ops.filter((o) => o.op === 'update' && o.table === 'Events').map((o) => (o as { key: Row }).key.Id)]))[0].n as number);

    // Name variants. Only one can be the preferred name.
    const keptHasPrimary = (await rows(exec, `SELECT 1 FROM "NameVariant" WHERE "PersonId" = $1 AND "IsPrimary" = 1`, [keptId])).length > 0;
    for (const v of await rows(exec, `SELECT * FROM "NameVariant" WHERE "PersonId" = $1 ORDER BY "Id"`, [otherId])) {
        await log.update('NameVariant', v, { PersonId: keptId, ...(keptHasPrimary && v.IsPrimary === 1 ? { IsPrimary: 0 } : {}) });
        moved.names++;
    }

    // Face tags: one per photo and person.
    for (const tag of await rows(exec, `SELECT * FROM "MediaTag" WHERE "PersonId" = $1 ORDER BY "Id"`, [otherId])) {
        const dup = await rows(exec, `SELECT 1 FROM "MediaTag" WHERE "PersonId" = $1 AND "MediaId" = $2`, [keptId, tag.MediaId]);
        if (dup.length) { await log.remove('MediaTag', tag); combined.faceTags++; } else { await log.update('MediaTag', tag, { PersonId: keptId }); moved.faceTags++; }
    }
    for (const c of await rows(exec, `SELECT * FROM "MediaFaceCandidate" WHERE "SuggestedPersonId" = $1 AND "TreeId" = $2 ORDER BY "Id"`, [otherId, treeId])) {
        await log.update('MediaFaceCandidate', c, { SuggestedPersonId: keptId });
    }

    // Photo and note links: polymorphic, one per (item, owner, fact); one primary per owner.
    for (const table of ['MediaLink', 'NoteLink'] as const) {
        const item = table === 'MediaLink' ? 'MediaId' : 'NoteId';
        const keptPrimary = (await rows(exec, `SELECT 1 FROM ${q(table)} WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`, [keptId])).length > 0;
        for (const link of await rows(exec, `SELECT * FROM ${q(table)} WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 ORDER BY ${q(item)}`, [otherId])) {
            const dup = await rows(exec,
                `SELECT 1 FROM ${q(table)} WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND ${q(item)} = $2 AND "OwnerFact" IS NOT DISTINCT FROM $3`,
                [keptId, link[item], link.OwnerFact ?? null]);
            const counter = table === 'MediaLink' ? 'photos' : 'notes';
            if (dup.length) { await log.remove(table, link); combined[counter]++; continue; }
            await log.update(table, link, { OwnerId: keptId, ...(keptPrimary && link.IsPrimary === 1 ? { IsPrimary: 0 } : {}) });
            moved[counter]++;
        }
    }

    // Case and lead links: one per case or lead and person.
    for (const [table, parent] of [['CasePerson', 'CaseId'], ['CaseLeadPerson', 'LeadId']] as const) {
        for (const link of await rows(exec, `SELECT * FROM ${q(table)} WHERE "PersonId" = $1 ORDER BY ${q(parent)}`, [otherId])) {
            const dup = await rows(exec, `SELECT 1 FROM ${q(table)} WHERE "PersonId" = $1 AND ${q(parent)} = $2`, [keptId, link[parent]]);
            if (dup.length) { await log.remove(table, link); if (table === 'CasePerson') combined.cases++; continue; }
            await log.update(table, link, { PersonId: keptId });
            if (table === 'CasePerson') moved.cases++;
        }
    }
    for (const claim of await rows(exec, `SELECT * FROM "CaseClaims" WHERE "PersonId" = $1 ORDER BY "Id"`, [otherId])) {
        await log.update('CaseClaims', claim, { PersonId: keptId });
    }

    // A data check confirmed on the other person carries over unless the kept one has its own.
    for (const conf of await rows(exec, `SELECT * FROM "DataCheckConfirmations" WHERE "PersonId" = $1 AND "TreeId" = $2 ORDER BY "Id"`, [otherId, treeId])) {
        const dup = await rows(exec, `SELECT 1 FROM "DataCheckConfirmations" WHERE "PersonId" = $1 AND "TreeId" = $2 AND "Rule" = $3`, [keptId, treeId, conf.Rule]);
        if (dup.length) await log.remove('DataCheckConfirmations', conf);
        else await log.update('DataCheckConfirmations', conf, { PersonId: keptId });
    }

    // Partner slots, both the current and the legacy columns.
    for (const fam of await rows(exec,
        `SELECT * FROM "Families" WHERE "TreeId" = $1 AND $2 IN ("Partner1Id", "Partner2Id", "HusbandId", "WifeId") ORDER BY "Id"`, [treeId, otherId])) {
        const next: Row = {};
        for (const c of ['Partner1Id', 'Partner2Id', 'HusbandId', 'WifeId']) if (fam[c] === otherId) next[c] = keptId;
        await log.update('Families', fam, next);
        moved.families++;
    }

    // Child links: the same family twice becomes one.
    for (const link of await rows(exec, `SELECT * FROM "FamilyPerson" WHERE "ChildrenId" = $1 ORDER BY "FamiliesAsChildId"`, [otherId])) {
        const dup = await rows(exec, `SELECT 1 FROM "FamilyPerson" WHERE "ChildrenId" = $1 AND "FamiliesAsChildId" = $2`, [keptId, link.FamiliesAsChildId]);
        if (dup.length) { await log.remove('FamilyPerson', link); combined.childLinks++; } else { await log.update('FamilyPerson', link, { ChildrenId: keptId }); moved.childLinks++; }
    }

    // The kept record takes the chosen values, then the other record goes.
    // Always logged, even with no value taken, so revert puts the whole row back.
    await log.update('People', kept, { ...set, UpdatedAt: new Date().toISOString() });
    // Nothing references the other person now; the cascade must find nothing to remove.
    await log.remove('People', other);

    return {
        keptId,
        mergedId: otherId,
        keptName: keptName || fullName(kept),
        mergedName: fullName(other),
        notKept,
        alternateName: alternate ? leftName : null,
        moved,
        combined,
        ops: log.ops,
    };
}

function isMergeTable(t: unknown): t is MergeTable {
    return typeof t === 'string' && Object.prototype.hasOwnProperty.call(MERGE_TABLES, t);
}

/** True when an audit entry's `merge` object has the shape revert needs. */
export function isPersonMergeSnapshot(v: unknown): v is PersonMergeSnapshot {
    const s = v as Partial<PersonMergeSnapshot> | null;
    return !!s && typeof s === 'object' && Number.isInteger(s.keptId) && Number.isInteger(s.mergedId) && Array.isArray(s.ops)
        && s.ops.every((o) => !!o && isMergeTable((o as MergeOp).table) && ['update', 'delete', 'insert'].includes((o as MergeOp).op));
}

/** Rows of these tables carry a TreeId, which revert checks against the entry's tree. */
const TREE_TABLES: ReadonlySet<MergeTable> = new Set(['People', 'Events', 'Citation', 'NameVariant', 'MediaFaceCandidate', 'DataCheckConfirmations', 'Families']);

function checkRow(table: MergeTable, row: Row, treeId: number): void {
    if (!row || typeof row !== 'object') throw new Error('Malformed merge snapshot');
    for (const c of Object.keys(row)) q(c);
    if (TREE_TABLES.has(table) && row.TreeId != null && row.TreeId !== treeId) throw new Error('Merge snapshot names another tree');
}

/**
 * Play a merge's undo log backwards, in the caller's transaction. The merged
 * person must still be gone (a second revert is refused) and the kept one present.
 */
export async function revertPersonMerge(exec: Executor, treeId: number, snap: PersonMergeSnapshot): Promise<void> {
    const present = await rows(exec, `SELECT "Id" FROM "People" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, [[snap.keptId, snap.mergedId], treeId]);
    if (present.some((r) => r.Id === snap.mergedId)) throw new Error('This merge was already reverted');
    if (!present.some((r) => r.Id === snap.keptId)) throw new Error('The kept person no longer exists');

    for (const op of [...snap.ops].reverse()) {
        if (op.op === 'insert') {
            checkRow(op.table, op.key, treeId);
            const where = keyWhere(keyOf(op.table, op.key), 1);
            await exec.query(`DELETE FROM ${q(op.table)} WHERE ${where.sql}`, where.params);
        } else if (op.op === 'delete') {
            checkRow(op.table, op.row, treeId);
            const cols = writable(op.table, op.row);
            await exec.query(
                `INSERT INTO ${q(op.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
                cols.map((c) => param(op.row[c])),
            );
        } else {
            checkRow(op.table, op.before, treeId);
            const cols = writable(op.table, op.before);
            const where = keyWhere(keyOf(op.table, op.key), cols.length + 1);
            const result = await exec.query(
                `UPDATE ${q(op.table)} SET ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(', ')} WHERE ${where.sql}`,
                [...cols.map((c) => param(op.before[c])), ...where.params],
            );
            if ((result.rowCount ?? 0) !== 1) throw new Error(`A ${op.table} row the merge moved is gone; the merge can't be reverted`);
        }
    }
}

/** The person-keyed fact tables, for matching later audit entries. */
const PERSON_FACTS = [...PERSON_KEYED_FACT_TABLES];

/**
 * Audit entries after a merge that touched the kept person: the person itself, or
 * a record that points at it now or pointed at it when the entry was written.
 * Newest first, as revert plays them. Entries that can't be reverted (imports,
 * data-check confirmations, place trail markers) are left out.
 */
export async function laterMergeChanges(exec: Executor, treeId: number, mergeEntryId: number, keptId: number): Promise<Row[]> {
    const id = Math.trunc(keptId);
    const facts = PERSON_FACTS.map((t) => `@.FactTable == "${t}"`).join(' || ');
    const path = `$.** ? (@.PersonId == ${id} || @.ChildrenId == ${id} || @.Partner1Id == ${id} || @.Partner2Id == ${id}`
        + ` || @.HusbandId == ${id} || @.WifeId == ${id} || @.keptId == ${id}`
        + ` || (@.OwnerTable == "People" && @.OwnerId == ${id}) || ((${facts}) && @.FactId == ${id}))`;
    return rows(exec,
        `SELECT a.* FROM "AuditLog" a
          WHERE a."TreeId" = $1 AND a."Id" > $2
            AND a."EntityType" NOT IN ('import', 'datacheck', 'place')
            -- A revert's trail marker isn't revertible, and the entry it reverted is already undone.
            AND NOT COALESCE((a."Changes" -> 'snapshot') ? 'revertOf', false)
            AND NOT EXISTS (SELECT 1 FROM "AuditLog" t WHERE t."TreeId" = $1 AND t."Changes" -> 'snapshot' ->> 'revertOf' = a."Id"::text)
            AND (
              (a."EntityType" = 'person' AND a."EntityId" = $3)
              OR a."Changes" @? $4::jsonpath
              OR (a."EntityType" = 'event' AND a."EntityId" IN (SELECT "Id" FROM "Events" WHERE "PersonId" = $3 AND "TreeId" = $1))
              OR (a."EntityType" = 'namevariant' AND a."EntityId" IN (SELECT "Id" FROM "NameVariant" WHERE "PersonId" = $3))
              OR (a."EntityType" = 'mediatag' AND a."EntityId" IN (SELECT "Id" FROM "MediaTag" WHERE "PersonId" = $3))
              OR (a."EntityType" = 'citation' AND a."EntityId" IN (SELECT "Id" FROM "Citation" WHERE "FactTable" = ANY($5::text[]) AND "FactId" = $3 AND "TreeId" = $1))
              OR (a."EntityType" = 'family' AND a."EntityId" IN (SELECT "Id" FROM "Families" WHERE "TreeId" = $1 AND $3 IN ("Partner1Id", "Partner2Id", "HusbandId", "WifeId")))
              OR (a."EntityType" = 'note' AND a."EntityId" IN (SELECT "NoteId" FROM "NoteLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $3))
            )
          ORDER BY a."CreatedAt" DESC, a."Id" DESC`,
        [treeId, mergeEntryId, id, path, PERSON_FACTS]);
}

/** The audit summary kind of a merge entry, and of the trail its revert leaves. */
export const PERSON_MERGE_SUMMARY = 'person_merge';
export const PERSON_MERGE_REVERT_SUMMARY = 'person_merge_revert';

/** Write the merge's one audit entry: a `person` update on the kept record. */
export async function auditPersonMerge(exec: Executor, treeId: number, treeOwnerId: number, userId: number, snap: PersonMergeSnapshot): Promise<number> {
    const result = await exec.query(
        `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
         VALUES ($1, $2, $3, 'update', 'person', $4, $5, $6) RETURNING "Id"`,
        [treeOwnerId, userId, treeId, snap.keptId, snap.keptName || null, JSON.stringify({ summary: { kind: PERSON_MERGE_SUMMARY }, merge: snap })],
    );
    return (result.rows[0] as { Id: number }).Id;
}
