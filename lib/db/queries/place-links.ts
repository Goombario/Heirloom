// Facts point at their place by reference (#1167, #1186, ADR 0031, ADR 0037).
//
// Each fact points at the gazetteer place it names through a nullable PlaceId
// column, and at which of that place's names it was written under through a
// nullable PlaceNameId (null: the place's own name). A place can carry other names
// in "PlaceName" ("Lemberg" until 1918).
//
// The references are the only record of a fact's place: the text columns are gone
// (v64). This module owns both directions:
//
// - Reading: `factPlaceTextColumns` builds the text a fact shows from its
//   references, under the old column names, so the screens, search and the GEDCOM
//   writer read "BirthPlace" and the rest as before.
// - Writing: the forms and imports still send text. `factPlaceRefs` and
//   `resolvePlaceTexts` match it once, at save time: the place's own name (the
//   most-used place of that name), then its other names, then a new bare place.
//   A place the user picked by id wins when its name is the text.
//
// No connection import: initializeSchema's migration imports this module, and the
// connection module imports initializeSchema.

interface Exec {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * A fact's place: the name readers get its text under, the place it points at,
 * and which of the place's names it uses. `kind` is the fact's `PlaceUsage` kind.
 */
interface FactPlaceColumn {
    table: '"People"' | '"Families"' | '"Events"';
    kind: 'birth' | 'death' | 'marriage' | 'event';
    /** The field readers get the built text under ("BirthPlace"). */
    name: string;
    id: string;
    nameId: string;
    records: 'people' | 'families' | 'events';
}

export const FACT_PLACE_COLUMNS: readonly FactPlaceColumn[] = [
    { table: '"People"', kind: 'birth', name: '"BirthPlace"', id: '"BirthPlaceId"', nameId: '"BirthPlaceNameId"', records: 'people' },
    { table: '"People"', kind: 'death', name: '"DeathPlace"', id: '"DeathPlaceId"', nameId: '"DeathPlaceNameId"', records: 'people' },
    { table: '"Families"', kind: 'marriage', name: '"MarriagePlace"', id: '"MarriagePlaceId"', nameId: '"MarriagePlaceNameId"', records: 'families' },
    { table: '"Events"', kind: 'event', name: '"Place"', id: '"PlaceId"', nameId: '"PlaceNameId"', records: 'events' },
];

/** The place text fields of each record table, as the forms and readers name them. */
export type FactPlaceField = 'BirthPlace' | 'DeathPlace' | 'MarriagePlace' | 'Place';

/** A fact's place columns by the field its text is read as. */
export function factPlaceColumnFor(field: FactPlaceField): FactPlaceColumn {
    return FACT_PLACE_COLUMNS.find((c) => c.name === `"${field}"`)!;
}

/**
 * SQL for the text a fact's references spell: the other name it points at, else
 * its place's own name, else NULL. A name that has moved to another place, or a
 * reference into another tree, does not count.
 */
export function factPlaceTextSql(col: FactPlaceColumn, alias = 'f'): string {
    return `COALESCE(
        (SELECT pn."Name" FROM "PlaceName" pn
          WHERE pn."Id" = ${alias}.${col.nameId} AND pn."PlaceId" = ${alias}.${col.id} AND pn."TreeId" = ${alias}."TreeId"),
        (SELECT pl."Name" FROM "Places" pl WHERE pl."Id" = ${alias}.${col.id} AND pl."TreeId" = ${alias}."TreeId")
    )`;
}

/**
 * The select-list entries that give a row its place text under the old column
 * names, for `SELECT p.*, ${factPlaceTextColumns('people', 'p')}`. `alias` must be
 * the table's alias (or its quoted name) in the query.
 */
export function factPlaceTextColumns(records: FactPlaceColumn['records'], alias: string): string {
    return FACT_PLACE_COLUMNS
        .filter((c) => c.records === records)
        .map((c) => `${factPlaceTextSql(c, alias)} AS ${c.name}`)
        .join(', ');
}

/** Where a fact's place points: the place, and which of its other names (null: its own). */
export interface FactPlaceRef {
    id: number | null;
    nameId: number | null;
}

const NO_PLACE: FactPlaceRef = { id: null, nameId: null };

/**
 * The place each text names in a tree, creating a bare place for a text that names
 * none: the most-used place of that name, else the place it is another name of. An
 * empty text names no place. One round trip for any number of texts, so an import
 * resolves every place it carries at once.
 */
export async function resolvePlaceTexts(
    exec: Exec,
    treeId: number,
    userId: number,
    texts: Iterable<string | null | undefined>,
): Promise<Map<string, FactPlaceRef>> {
    const wanted = [...new Set([...texts].filter((t): t is string => typeof t === 'string' && t !== ''))];
    const refs = new Map<string, FactPlaceRef>();
    if (wanted.length === 0) return refs;
    await exec.query(
        `INSERT INTO "Places" ("UserId", "TreeId", "Name")
         SELECT $1, $2, t FROM unnest($3::text[]) AS t
          WHERE NOT EXISTS (SELECT 1 FROM "Places" pl WHERE pl."TreeId" = $2 AND pl."Name" = t)
            AND NOT EXISTS (SELECT 1 FROM "PlaceName" pn WHERE pn."TreeId" = $2 AND pn."Name" = t)`,
        [userId, treeId, wanted],
    );
    const res = await exec.query(
        `SELECT t AS text, "PlaceIdByName"($1, t) AS id,
                CASE WHEN EXISTS (SELECT 1 FROM "Places" pl WHERE pl."TreeId" = $1 AND pl."Name" = t) THEN NULL
                     ELSE (SELECT pn."Id" FROM "PlaceName" pn WHERE pn."TreeId" = $1 AND pn."Name" = t) END AS "nameId"
           FROM unnest($2::text[]) AS t`,
        [treeId, wanted],
    );
    for (const r of res.rows as { text: string; id: number | null; nameId: number | null }[]) {
        refs.set(r.text, { id: r.id, nameId: r.nameId });
    }
    return refs;
}

/** A place the user picked for one of a record's facts, by id (#1186). */
export interface FactPlacePick {
    kind: FactPlaceColumn['kind'];
    placeId: number;
}

/**
 * The reference a pick gives a fact written as `text`: the picked place when its own
 * name is the text, or one of its other names is. Otherwise null, and the text is
 * matched as usual. A place in another tree is never picked.
 */
async function pickedRef(exec: Exec, treeId: number, placeId: number, text: string): Promise<FactPlaceRef | null> {
    const res = await exec.query(
        `SELECT pl."Name" = $3 AS own,
                (SELECT pn."Id" FROM "PlaceName" pn WHERE pn."TreeId" = $2 AND pn."PlaceId" = pl."Id" AND pn."Name" = $3) AS "nameId"
           FROM "Places" pl WHERE pl."Id" = $1 AND pl."TreeId" = $2`,
        [placeId, treeId, text],
    );
    const row = res.rows[0] as { own: boolean; nameId: number | null } | undefined;
    if (!row) return null;
    if (row.own) return { id: placeId, nameId: null };
    return row.nameId != null ? { id: placeId, nameId: row.nameId } : null;
}

/**
 * The reference columns a save writes for the place fields it sends, as
 * [quoted column, value] pairs: for each field in `texts` (a field left undefined
 * is not touched), the pick for its fact when the pick names the text, else the
 * text matched (or created) as a place, else nothing for an empty text.
 */
export async function factPlaceRefs(
    exec: Exec,
    treeId: number,
    userId: number,
    texts: Partial<Record<FactPlaceField, string | null | undefined>>,
    picks: readonly FactPlacePick[] = [],
): Promise<[string, number | null][]> {
    const fields = (Object.keys(texts) as FactPlaceField[]).filter((f) => texts[f] !== undefined);
    const picked = new Map<FactPlaceField, FactPlaceRef>();
    for (const field of fields) {
        const text = texts[field];
        const pick = picks.find((p) => p.kind === factPlaceColumnFor(field).kind);
        if (!pick || !text) continue;
        const ref = await pickedRef(exec, treeId, pick.placeId, text);
        if (ref) picked.set(field, ref);
    }
    const matched = await resolvePlaceTexts(exec, treeId, userId, fields.filter((f) => !picked.has(f)).map((f) => texts[f]));
    const out: [string, number | null][] = [];
    for (const field of fields) {
        const col = factPlaceColumnFor(field);
        const text = texts[field];
        const ref = picked.get(field) ?? (text ? matched.get(text) : undefined) ?? NO_PLACE;
        out.push([col.id, ref.id], [col.nameId, ref.nameId]);
    }
    return out;
}

/**
 * The reference a fact had when its audit entry was written, when it still spells
 * the text the entry recorded: undo restores the place itself, not whichever place
 * its name now means. Null when the place or name has gone or changed since.
 */
export async function savedFactPlaceRef(
    exec: Exec,
    treeId: number,
    text: string,
    ref: FactPlaceRef,
): Promise<FactPlaceRef | null> {
    if (ref.id == null) return null;
    const res = await exec.query(
        `SELECT COALESCE(
            (SELECT pn."Name" FROM "PlaceName" pn WHERE pn."Id" = $3 AND pn."PlaceId" = $1 AND pn."TreeId" = $2),
            CASE WHEN $3::integer IS NULL THEN (SELECT pl."Name" FROM "Places" pl WHERE pl."Id" = $1 AND pl."TreeId" = $2) END
         ) AS text`,
        [ref.id, treeId, ref.nameId],
    );
    return (res.rows[0] as { text: string | null } | undefined)?.text === text ? ref : null;
}

/** A row's place references and text, as the readers above return them. */
type FactPlaceRow = Record<string, unknown>;

const bare = (column: string) => column.slice(1, -1);

/**
 * The place fields of a record whose place changed between two reads of it, with
 * the references before and after, for its audit entry. A fact that moved to
 * another place of the same name ("Paris" to the other Paris) counts as a change.
 */
export function factPlaceRefChanges(
    records: FactPlaceColumn['records'],
    before: FactPlaceRow,
    after: FactPlaceRow,
): Record<string, { old: FactPlaceRef; new: FactPlaceRef }> {
    const changes: Record<string, { old: FactPlaceRef; new: FactPlaceRef }> = {};
    for (const col of FACT_PLACE_COLUMNS.filter((c) => c.records === records)) {
        const ref = (row: FactPlaceRow): FactPlaceRef => ({
            id: (row[bare(col.id)] as number | null | undefined) ?? null,
            nameId: (row[bare(col.nameId)] as number | null | undefined) ?? null,
        });
        const old = ref(before);
        const next = ref(after);
        if (old.id !== next.id || old.nameId !== next.nameId) changes[bare(col.name)] = { old, new: next };
    }
    return changes;
}

/** A fact an import wrote, with the place text it carries. */
export interface FactPlaceText {
    field: FactPlaceField;
    recordId: number;
    text: string | null | undefined;
}

/**
 * Point the facts an import wrote at the places their texts name, all at once,
 * inside the import's transaction: once places.json and the file's own place
 * records have made their rows, so a name restored as another name links to it.
 */
export async function linkFactPlaceTexts(
    exec: Exec,
    treeId: number,
    userId: number,
    facts: readonly FactPlaceText[],
): Promise<void> {
    const placed = facts.filter((f) => f.text);
    const refs = await resolvePlaceTexts(exec, treeId, userId, placed.map((f) => f.text));
    for (const col of FACT_PLACE_COLUMNS) {
        const rows = placed.filter((f) => factPlaceColumnFor(f.field) === col);
        if (rows.length === 0) continue;
        const ref = (f: FactPlaceText) => refs.get(f.text!) ?? NO_PLACE;
        await exec.query(
            `UPDATE ${col.table} AS f SET ${col.id} = v.place, ${col.nameId} = v.name
               FROM unnest($1::int[], $2::int[], $3::int[]) AS v(id, place, name)
              WHERE f."Id" = v.id AND f."TreeId" = $4`,
            [rows.map((f) => f.recordId), rows.map((f) => ref(f).id), rows.map((f) => ref(f).nameId), treeId],
        );
    }
}
