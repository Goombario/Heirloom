import { query } from '@/lib/db/connection';
import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';
import type { PlaceKey } from '@/lib/places/place-key';
import { LINK_OWNER_TABLES } from '@/lib/db/fact-tables';
import { integratedFullName } from './people';
import { primaryPhotoJoin } from './media-tags';
import { suppressCoveredAncestors, type RankedPlace } from './place-rollup';
import { liveEventSql } from '@/lib/db/queries/live-owner';
import { FACT_PLACE_COLUMNS, factPlaceTextSql, resolvePlaceTexts } from './place-links';
import { insertSnapshotRow } from './snapshot-rows';

/**
 * A place as a browsable entity (Slice 5, Option A). The `Places` gazetteer holds
 * coordinates; `ParentId` links the jurisdiction hierarchy ("Boston, Suffolk, MA"
 * → "Suffolk, MA" → "MA") and `Form` is the GEDCOM PLAC.FORM. Records keep the
 * place string as recorded and point at their place by id (#1167, place-links.ts).
 */
export interface Place {
    Id: number;
    UserId: number;
    TreeId: number | null;
    Name: string;
    Latitude: number | null;
    Longitude: number | null;
    DisplayName: string | null;
    ParentId: number | null;
    Form: string | null;
    OsmType?: string | null;
    /** BIGINT: a number on both engines, or text past `Number.MAX_SAFE_INTEGER` (#868). */
    OsmId?: number | string | null;
    PinSuppressed?: boolean;
    CreatedAt: string;
    UpdatedAt: string;
}

/** All places for a tree, alphabetical. */
export async function getPlaces(treeId: number): Promise<Place[]> {
    const result = await query(
        `SELECT * FROM "Places" WHERE "TreeId" = $1 ORDER BY "Name" ASC, "Id" ASC`,
        [treeId],
    );
    return result.rows as Place[];
}

/** Another name of a place (#1167, ADR 0031): Lemberg until 1918, Lwów, Львів. */
export interface PlaceOtherName {
    PlaceId: number;
    Name: string;
    Language: string | null;
    FromDate: string | null;
    ToDate: string | null;
}

/** Every other name of every place in a tree, by place then name. */
export async function getPlaceOtherNames(treeId: number): Promise<PlaceOtherName[]> {
    const result = await query(
        `SELECT "PlaceId", "Name", "Language", "FromDate", "ToDate" FROM "PlaceName"
          WHERE "TreeId" = $1 ORDER BY "PlaceId", "Name"`,
        [treeId],
    );
    return result.rows as PlaceOtherName[];
}

/** One place scoped to its tree (null if not found / not in scope). */
export async function getPlaceById(id: number, treeId: number): Promise<Place | null> {
    const result = await query(
        `SELECT * FROM "Places" WHERE "Id" = $1 AND "TreeId" = $2`,
        [id, treeId],
    );
    return (result.rows[0] as Place | undefined) ?? null;
}

/**
 * Direct children of a place in the jurisdiction hierarchy, each with
 * `RecordCount`: the births, deaths, marriages and live events whose place is
 * that child or any place inside it.
 */
export async function getChildPlaces(parentId: number, treeId: number): Promise<(Place & { RecordCount: number })[]> {
    const result = await query(
        // `path` stops a cyclic ParentId (should never exist) from looping forever.
        `WITH RECURSIVE sub AS (
             SELECT c."Id" AS root, c."Id" AS id, ARRAY[c."Id"] AS path
               FROM "Places" c WHERE c."ParentId" = $1 AND c."TreeId" = $2
             UNION ALL
             SELECT s.root, p."Id", s.path || p."Id"
               FROM sub s JOIN "Places" p ON p."ParentId" = s.id AND p."TreeId" = $2
              WHERE NOT p."Id" = ANY(s.path)
         )
         SELECT pl.*,
                ${FACT_PLACE_COLUMNS.map((col) => `(SELECT COUNT(*) FROM ${col.table} f
                  WHERE f."TreeId" = $2 AND f.${col.id} IN (SELECT id FROM sub WHERE sub.root = pl."Id")${col.table === '"Events"' ? ` AND ${liveEventSql('f')}` : ''})::int`).join('\n              + ')}
                AS "RecordCount"
           FROM "Places" pl
          WHERE pl."ParentId" = $1 AND pl."TreeId" = $2
          ORDER BY pl."Name" ASC`,
        [parentId, treeId],
    );
    return (result.rows as (Place & { RecordCount: number | string })[]).map((r) => ({ ...r, RecordCount: Number(r.RecordCount) }));
}

/**
 * The jurisdiction ancestors of a place, ordered **root-first** for a breadcrumb
 * (e.g. for "Moscow": [Russia, Moscow Oblast]). Walks `ParentId` up via a
 * recursive CTE; excludes the place itself.
 */
export async function getPlaceAncestors(id: number, treeId: number): Promise<{ Id: number; Name: string }[]> {
    const result = await query(
        // `path` tracks visited ids so a cyclic ParentId (should never exist, but a bad
         // merge could once create one) terminates instead of looping forever.
         `WITH RECURSIVE anc AS (
             SELECT pl."Id", pl."Name", pl."ParentId", 0 AS depth, ARRAY[pl."Id"] AS path
               FROM "Places" pl WHERE pl."Id" = $1 AND pl."TreeId" = $2
             UNION ALL
             SELECT p."Id", p."Name", p."ParentId", anc.depth + 1, anc.path || p."Id"
               FROM "Places" p JOIN anc ON p."Id" = anc."ParentId"
              WHERE p."TreeId" = $2 AND p."Id" <> ALL(anc.path)
         )
         SELECT "Id", "Name" FROM anc WHERE depth > 0 ORDER BY depth DESC`,
        [id, treeId],
    );
    return result.rows as { Id: number; Name: string }[];
}

/** The nearest ancestor that can lend a place its map pin. */
export interface PlaceAncestorWithCoords {
    Id: number;
    Name: string;
    Latitude: number;
    Longitude: number;
}

export async function getNearestPlaceAncestorWithCoords(id: number, treeId: number): Promise<PlaceAncestorWithCoords | null> {
    const result = await query(
        `WITH RECURSIVE anc AS (
             SELECT pl."Id", pl."Name", pl."ParentId", pl."Latitude", pl."Longitude", pl."PinSuppressed", 0 AS depth, ARRAY[pl."Id"] AS path
               FROM "Places" pl WHERE pl."Id" = $1 AND pl."TreeId" = $2
             UNION ALL
             SELECT p."Id", p."Name", p."ParentId", p."Latitude", p."Longitude", p."PinSuppressed", anc.depth + 1, anc.path || p."Id"
               FROM "Places" p JOIN anc ON p."Id" = anc."ParentId"
              WHERE p."TreeId" = $2 AND p."Id" <> ALL(anc.path) AND NOT anc."PinSuppressed"
         )
         SELECT "Id", "Name", "Latitude", "Longitude"
           FROM anc
          WHERE depth > 0 AND NOT "PinSuppressed"
            AND "Latitude" IS NOT NULL AND "Longitude" IS NOT NULL
          ORDER BY depth ASC
          LIMIT 1`,
        [id, treeId],
    );
    const row = result.rows[0] as PlaceAncestorWithCoords | undefined;
    return row ?? null;
}

/**
 * Every geocoded place strictly BELOW `id` (any depth, capped like the other walks),
 * for the map of a place that has no pin of its own (#923). Same rule as Explore's
 * `collectPins`: a descendant's own coordinate counts whether or not it suppresses
 * inheritance, because PinSuppressed only stops a place borrowing a parent's pin.
 */
export async function getGeocodedPlaceDescendants(id: number, treeId: number): Promise<PlaceAncestorWithCoords[]> {
    const result = await query(
        `WITH RECURSIVE d AS (
             SELECT c."Id", c."Name", c."Latitude", c."Longitude", 1 AS depth, ARRAY[$1::int, c."Id"] AS path
               FROM "Places" c WHERE c."ParentId" = $1 AND c."TreeId" = $2 AND c."Id" <> $1
             UNION ALL
             SELECT c."Id", c."Name", c."Latitude", c."Longitude", d.depth + 1, d.path || c."Id"
               FROM "Places" c JOIN d ON c."ParentId" = d."Id"
              WHERE c."TreeId" = $2 AND c."Id" <> ALL(d.path) AND d.depth < 20
         )
         SELECT DISTINCT "Id", "Name", "Latitude", "Longitude"
           FROM d
          WHERE "Latitude" IS NOT NULL AND "Longitude" IS NOT NULL
          ORDER BY "Name" ASC, "Id" ASC`,
        [id, treeId],
    );
    return result.rows as PlaceAncestorWithCoords[];
}

/** A record that references a place by name (for the "used by" view). */
export interface PlaceUsage {
    kind: 'birth' | 'death' | 'marriage' | 'event';
    recordId: number;
    label: string | null;
}

/** The text a fact shows, built from its references (ADR 0037). */
const shownPlace = (field: string, alias: string) => factPlaceTextSql(FACT_PLACE_COLUMNS.find((c) => c.name === `"${field}"`)!, alias);

/**
 * Records that show `name` as their place (people born/died there, families married
 * there, events located there). Name-keyed on purpose: this is what a record says,
 * which is the place's own name or one of its other names. People/Families/Events
 * are top-level TreeId-scoped entities, so this scans by tree, not by owner.
 */
export async function getRecordsForPlace(name: string, treeId: number, exec: Exec = { query }): Promise<PlaceUsage[]> {
    const result = await exec.query(
        `SELECT 'birth' AS kind, p."Id" AS "recordId", CONCAT(p."FirstName", ' ', p."LastName") AS label
           FROM "People" p WHERE p."TreeId" = $2 AND ${shownPlace('BirthPlace', 'p')} = $1
         UNION ALL
         SELECT 'death', p."Id", CONCAT(p."FirstName", ' ', p."LastName")
           FROM "People" p WHERE p."TreeId" = $2 AND ${shownPlace('DeathPlace', 'p')} = $1
         UNION ALL
         SELECT 'marriage', f."Id", NULL
           FROM "Families" f WHERE f."TreeId" = $2 AND ${shownPlace('MarriagePlace', 'f')} = $1
         UNION ALL
         SELECT 'event', e."Id", e."Type"
           FROM "Events" e WHERE e."TreeId" = $2 AND ${shownPlace('Place', 'e')} = $1`,
        [name, treeId],
    );
    return result.rows as PlaceUsage[];
}

/** One person's link to a place, by the single fact that ties them to it. */
export interface PlaceFactLink {
    personId: number;
    name: string;
    sex: string | null;
    primaryMediaId: number | null;
    /** Focal crop of the primary photo (percent coords), so avatars show the
     *  face rather than a centred slab of the whole photo. Null when the photo
     *  carries no crop — `ProfileImage` then falls back to object-cover. */
    focalX: number | null;
    focalY: number | null;
    focalRadius: number | null;
    /** Which fact ties this person to the place. */
    kind: 'birth' | 'death' | 'marriage' | 'event';
    /** Event type code for kind==='event' (RESI, OCCU, ...); null otherwise. */
    eventType: string | null;
    date: string | null;
    /** The place string this fact actually carries. Equal to the requested name for a
     *  leaf; a descendant place when a jurisdiction rolled the fact up. */
    placeName: string;
    /** The record holding the fact: the person, the family or the event (#1186). */
    recordId: number;
    /** The place the fact points at: the page's own place, or one below it. */
    placeId: number;
}

/**
 * Every fact in a tree that points at one of `placeIds`, as one row per fact.
 *
 * Deliberately NOT one row per person: the place page states *why* each person
 * is linked ("Born here 1887", "Married here 1910"), and one person can be tied
 * to a place by several facts, so a person born and married in the same town
 * appears twice with different reasons. `getRecordsForPlace` above answers the
 * older, narrower question (which records mention this place) and is still used
 * by the usage view.
 *
 * Marriage rows are emitted once per partner, since the fact ties both of them
 * to the place. Names use the same expression as the rest of the app so a person
 * with a primary name variant reads identically here and on their profile.
 * Matched by place id (#1167), so a fact recorded under another of the place's
 * names is linked too. Each row reports the place string it carries as recorded
 * (`placeName`), so a rolled-up jurisdiction can name the sub-place a fact
 * actually happened in.
 *
 * Takes the roll-up set: a jurisdiction's page aggregates every descendant place,
 * and its links must roll up the same way or the reasons would disagree with the
 * counts beside them.
 */
export async function getPlaceFactLinks(
    placeIds: number[],
    treeId: number,
    exec: Exec = { query },
): Promise<PlaceFactLink[]> {
    const nameExpr = integratedFullName('p');
    // The shared JOIN, not a bare MediaTag lookup and not the scalar id-only
    // form: setPrimaryPhoto writes Media."IsPrimary" for an untagged owned
    // portrait (the ordinary upload path), so a tag-only query renders initials
    // for people whose face the place page shows two panels over — and the
    // scalar `primaryMediaIdFor` drops the focal columns, which left every
    // avatar on this surface centre-cropping the whole photo instead of the
    // face. `primaryPhotoJoin` answers both: same primary pick, focal included.
    const photoJoin = primaryPhotoJoin('p', 'p."TreeId"', 'm');
    const cols = `p."Id" AS "personId", ${nameExpr} AS name, p."Sex" AS sex, m."Id" AS "primaryMediaId", m."FocalX" AS "focalX", m."FocalY" AS "focalY", m."FocalRadius" AS "focalRadius"`;

    const result = await exec.query(
        `SELECT ${cols}, 'birth' AS kind, NULL AS "eventType", p."BirthDate" AS date, ${shownPlace('BirthPlace', 'p')} AS "placeName", p."Id" AS "recordId", p."BirthPlaceId" AS "placeId"
           FROM "People" p
           ${photoJoin}
          WHERE p."TreeId" = $2 AND p."BirthPlaceId" = ANY($1)
         UNION ALL
         SELECT ${cols}, 'death', NULL, p."DeathDate", ${shownPlace('DeathPlace', 'p')}, p."Id", p."DeathPlaceId"
           FROM "People" p
           ${photoJoin}
          WHERE p."TreeId" = $2 AND p."DeathPlaceId" = ANY($1)
         UNION ALL
         SELECT ${cols}, 'marriage', NULL, f."MarriageDate", ${shownPlace('MarriagePlace', 'f')}, f."Id", f."MarriagePlaceId"
           FROM "Families" f
           JOIN "People" p ON p."Id" IN (COALESCE(f."Partner1Id", f."HusbandId"), COALESCE(f."Partner2Id", f."WifeId"))
           ${photoJoin}
          WHERE f."TreeId" = $2 AND f."MarriagePlaceId" = ANY($1) AND p."TreeId" = $2
         UNION ALL
         SELECT ${cols}, 'event', e."Type", e."Date", ${shownPlace('Place', 'e')}, e."Id", e."PlaceId"
           FROM "Events" e
           JOIN "People" p ON p."Id" = e."PersonId"
           ${photoJoin}
          WHERE e."TreeId" = $2 AND e."PlaceId" = ANY($1) AND p."TreeId" = $2
         ORDER BY name, "personId", date NULLS LAST, kind, "eventType"`,
        [placeIds, treeId],
    );
    return result.rows as PlaceFactLink[];
}

/** One row of the dashboard "Places hot list". Counts are COUNTs — pg returns
 *  bigint as a string, so callers format them rather than doing maths. */
export interface PlaceRecordCount {
    place_id: number;
    place_name: string;
    /** Rolled total: this place plus every gazetteer descendant. */
    person_count: string;
    /** Records naming this exact place string. Lower than `person_count` when
     *  descendants contributed — the dashboard row says so. */
    own_count: string;
}

/**
 * The places most referenced by records in a tree, for the dashboard hot list.
 *
 * The count has to mean what the place DETAIL page means by "N records", because
 * the hot-list row links straight to it. That page counts distinct record
 * references AND rolls up the place's gazetteer descendants — so this does both.
 * Before the roll-up, "Dover" read 12 here and 18 on the page it opened.
 *
 * Rolling up alone would rank England above every town it contains, so a place is
 * dropped when one of its own descendants is kept (`suppressCoveredAncestors`).
 * The SQL therefore returns ALL ranked places, not `LIMIT $2` of them — the limit
 * is applied after suppression. The row count is the size of the gazetteer
 * (hundreds), not of the fact tables.
 */
export async function getTopPlacesByRecordCount(treeId: number, limit: number, exec: Exec = { query }): Promise<PlaceRecordCount[]> {
    const result = await exec.query(
        `WITH RECURSIVE refs AS (
             SELECT "BirthPlaceId" AS place_id, 'p:' || "Id" AS ref FROM "People" WHERE "TreeId" = $1 AND "BirthPlaceId" IS NOT NULL
             UNION ALL
             SELECT "DeathPlaceId", 'p:' || "Id" FROM "People" WHERE "TreeId" = $1 AND "DeathPlaceId" IS NOT NULL
             UNION ALL
             SELECT "MarriagePlaceId", 'f:' || "Id" FROM "Families" WHERE "TreeId" = $1 AND "MarriagePlaceId" IS NOT NULL
             UNION ALL
             SELECT e."PlaceId", 'e:' || e."Id" FROM "Events" e WHERE e."TreeId" = $1 AND e."PlaceId" IS NOT NULL AND ${liveEventSql('e')}
         ),
         own AS (
             SELECT place_id, COUNT(DISTINCT ref) AS own_count FROM refs GROUP BY place_id
         ),
         tree AS (
             -- Every gazetteer place paired with itself and each place below it.
             -- depth-capped for ParentId-cycle safety, exactly like getPlaceDetail.
             SELECT p."Id" AS root_id, p."Id" AS node_id, p."Name" AS node_name, 0 AS depth
               FROM "Places" p WHERE p."TreeId" = $1
             UNION ALL
             SELECT t.root_id, c."Id", c."Name", t.depth + 1
               FROM "Places" c JOIN tree t ON c."ParentId" = t.node_id
              WHERE c."TreeId" = $1 AND t.depth < 20
         ),
         rolled AS (
             SELECT t.root_id AS place_id, COUNT(DISTINCT r.ref) AS rolled_count
               FROM tree t JOIN refs r ON r.place_id = t.node_id
              GROUP BY t.root_id
         ),
         kids AS (
             SELECT root_id AS place_id, ARRAY_AGG(DISTINCT node_name) AS descendants
               FROM tree WHERE depth > 0 GROUP BY root_id
         )
         -- Facts point at their place by id (#1167), so a fact recorded under one of
         -- a place's other names counts for that place.
         SELECT pl."Id" AS place_id, pl."Name" AS place_name,
                rl.rolled_count AS person_count,
                COALESCE(o.own_count, 0) AS own_count,
                COALESCE(k.descendants, ARRAY[]::text[]) AS descendants
           FROM rolled rl
           JOIN "Places" pl ON pl."Id" = rl.place_id
           LEFT JOIN own o ON o.place_id = rl.place_id
           LEFT JOIN kids k ON k.place_id = rl.place_id
          -- Ties break on the folded name so both engines keep the same places (#882).
          ORDER BY rl.rolled_count DESC, "SearchFold"(pl."Name"), pl."Name"`,
        [treeId],
    );
    const ranked = (result.rows as (RankedPlace & { place_id: number })[]).map((r) => ({
        ...r,
        person_count: String(r.person_count),
        own_count: String(r.own_count),
    }));
    return suppressCoveredAncestors(ranked, limit).map(({ place_id, place_name, person_count, own_count }) => ({
        place_id, place_name, person_count, own_count,
    }));
}

// ── Rename & merge (CRUD §1.2) ──────────────────────────────────────────────────
// Facts point at their place by reference (#1186), so a rename changes one
// gazetteer row and a merge moves references; the facts' text copies are then
// refreshed from the references. Everything runs on a caller-supplied
// transaction client (`exec`).

/** Minimal transaction-client shape (works for the pg PoolClient and PGlite). */
type Exec = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> };

/** Gazetteer fields eligible for the "fill B's nulls only" merge fold. */
const FOLD_FIELDS = ['Latitude', 'Longitude', 'DisplayName', 'OsmType', 'OsmId', 'ParentId', 'Form'] as const;

function factPlaceColumn(kind: PlaceUsage['kind']) {
    return FACT_PLACE_COLUMNS.find((c) => c.kind === kind)!;
}

/**
 * Everything needed to undo a rename/merge exactly — stored verbatim in the audit
 * entry's `Changes.snapshot`. `affected` is the precise set of records the
 * operation changed, so reverting a merge only pulls back the records that
 * pointed at `from`, never those that already pointed at `to`.
 */
export interface PlaceRenameSnapshot {
    from: string;
    to: string;
    wasMerge: boolean;
    /** With `byReference`, the facts whose place reference moved (merge) or whose
     *  shown name changed (rename). Without it, the facts whose text was rewritten. */
    affected: { kind: PlaceUsage['kind']; recordId: number }[];
    /** True from v62 (#1186): the operation renamed a place row or moved fact
     *  references. Older snapshots, and a rename of text that is not a place's own
     *  name, rewrote fact text and are undone by rewriting it back. */
    byReference?: boolean;
    /** With `byReference`, the renamed row or, for a merge, the surviving one. */
    toId?: number;
    /** Merge only — the deleted `from` gazetteer row, to recreate it on revert. */
    fromRow?: Record<string, unknown> | null;
    /** Merge only — field → value folded into the surviving `to` row (each was null
     *  before). Revert re-nulls a field only if `to` still holds this exact value. */
    toFilled?: Record<string, unknown>;
    /** Merge only — child places re-pointed from the old `from` row to `to`. */
    repointedChildIds?: number[];
    /** Merge only — true when `to` was itself a child of `from`, so deleting `from`
     *  nulled `to`'s ParentId (ON DELETE SET NULL). Revert restores the link. */
    toWasChildOfFrom?: boolean;
    /** Merge only — `from`'s other names, moved to `to` so the merge keeps them (#1167).
     *  Revert moves them back. */
    movedNameIds?: number[];
    /** From v64 (ADR 0037): the other name a text rename renamed, or whose facts it
     *  moved to the `to` place, so revert puts that name or those facts back. */
    otherName?: { id: number; placeId: number };
    /** #1185: the old name, kept as another name of the renamed or surviving place.
     *  The facts that showed it point at that name; revert removes it. */
    keptNameId?: number;
}

/** How a rename treats the old name and a place that already has the new one (#1185). */
export interface RenamePlaceOptions {
    /** Keep the old name as another name, so its records stay as written. */
    keepOldName?: boolean;
    /** The new name is another place's too: rename without merging the two (ADR 0036). */
    separate?: boolean;
}

export interface RenamePlaceResult {
    snapshot: PlaceRenameSnapshot;
    /** Gazetteer Id of the surviving place (the `to` row), for the audit EntityId. */
    survivingId: number;
    /** True when a real place (facts and/or a gazetteer row) was actually renamed. */
    changed: boolean;
}

/**
 * Rename `from` (a place's id, or a name) → `to` inside an open transaction. If a `to` gazetteer row already
 * exists this is a MERGE (fold `from` into it, filling only `to`'s null fields, and
 * move `from`'s facts and other names to it), unless `separate` asks for two places
 * of one name; otherwise it is a plain rename of the `from` row. `keepOldName` keeps
 * `from` as another name, so the records that said it still do. Returns a snapshot
 * that `revertPlaceRename` can replay to undo the operation exactly.
 */
export async function renamePlace(
    exec: Exec,
    treeId: number,
    fromKey: PlaceKey,
    to: string,
    options: RenamePlaceOptions = {},
): Promise<RenamePlaceResult> {
    // A name names one place (#1167): `to` may not already be another name of one.
    const taken = await exec.query(
        `SELECT pl."Name" FROM "PlaceName" pn JOIN "Places" pl ON pl."Id" = pn."PlaceId"
          WHERE pn."TreeId" = $1 AND pn."Name" = $2`,
        [treeId, to],
    );
    const owner = taken.rows[0] as { Name: string } | undefined;
    if (owner) throw new ValidationError(`"${to}" is already another name of ${owner.Name}`);

    // A name is the most-used place of that name (two places may share one, #1186);
    // a name that is only another name of a place is renamed as text below.
    const fromRes = await exec.query(
        typeof fromKey === 'number'
            ? `SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`
            : `SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Id" = "PlaceIdByName"($1, $2) AND "Name" = $2`,
        [treeId, fromKey],
    );
    const fromRow = (fromRes.rows[0] as Record<string, unknown> | undefined) ?? null;
    if (!fromRow && typeof fromKey === 'number') throw new NotFoundError('Place not found');
    const from = fromRow ? fromRow.Name as string : fromKey as string;
    if (from === to) throw new ValidationError('The new name is the same as the current one');
    // Merging into a name that several places share picks the most-used of them.
    const toRes = await exec.query(
        `SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Id" = "PlaceIdByName"($1, $2) AND "Name" = $2`,
        [treeId, to],
    );
    const toRow = options.separate ? null : (toRes.rows[0] as Record<string, unknown> | undefined) ?? null;

    if (!fromRow) return renamePlaceText(exec, treeId, from, to, toRow);

    const fromId = fromRow.Id as number;
    if (options.keepOldName) {
        // A name names one place: another place of the old name keeps it to itself.
        const shared = await exec.query(
            `SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2 AND "Id" <> $3`,
            [treeId, from, fromId],
        );
        if (shared.rows.length > 0) throw new ValidationError(`Another place is also called ${from}, so it can’t stay as another name`);
    }
    if (!toRow) {
        // RENAME: the `from` gazetteer row takes the new name, and every fact that
        // shows its own name follows. Facts written under its other names keep them.
        const affected: PlaceRenameSnapshot['affected'] = [];
        for (const col of FACT_PLACE_COLUMNS) {
            const res = await exec.query(
                `SELECT "Id" FROM ${col.table} WHERE "TreeId" = $1 AND ${col.id} = $2 AND ${col.nameId} IS NULL`,
                [treeId, fromId],
            );
            for (const r of res.rows as { Id: number }[]) affected.push({ kind: col.kind, recordId: r.Id });
        }
        await exec.query(
            `UPDATE "Places" SET "Name" = $1, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $2`,
            [to, fromId],
        );
        const keptNameId = options.keepOldName
            ? await keepOldName(exec, treeId, fromRow, fromId, from, affected)
            : undefined;
        return {
            snapshot: { from, to, wasMerge: false, affected, byReference: true, toId: fromId, ...(keptNameId != null ? { keptNameId } : {}) },
            survivingId: fromId,
            changed: true,
        };
    }

    // MERGE: fill only `to`'s null fields from `from`, move `from`'s children, other
    // names and facts to `to`, then remove the `from` row.
    const toId = toRow.Id as number;
    const toFilled: Record<string, unknown> = {};
    for (const f of FOLD_FIELDS) {
        // Never fold `from`'s ParentId when it points at `to` — that would make
        // `to` its own parent, an infinite loop in getPlaceAncestors's CTE.
        if (f === 'ParentId' && fromRow[f] === toId) continue;
        if (toRow[f] == null && fromRow[f] != null) {
            await exec.query(`UPDATE "Places" SET "${f}" = $1 WHERE "Id" = $2`, [fromRow[f], toId]);
            toFilled[f] = fromRow[f];
        }
    }
    // If `to` was a child of `from`, the DELETE below nulls to.ParentId
    // (ON DELETE SET NULL); record it so revert restores the link exactly.
    const toWasChildOfFrom = toRow.ParentId === fromId;
    // Re-point children of the old `from` row so the hierarchy is not orphaned.
    const kids = await exec.query(
        `SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "ParentId" = $2`,
        [treeId, fromId],
    );
    const repointedChildIds = (kids.rows as { Id: number }[]).map((r) => r.Id).filter((id) => id !== toId);
    if (repointedChildIds.length > 0) {
        await exec.query(
            `UPDATE "Places" SET "ParentId" = $1 WHERE "Id" = ANY($2)`,
            [toId, repointedChildIds],
        );
    }
    // `from`'s other names become `to`'s; the DELETE would cascade them away.
    const moved = await exec.query(
        `UPDATE "PlaceName" SET "PlaceId" = $1 WHERE "TreeId" = $2 AND "PlaceId" = $3 RETURNING "Id"`,
        [toId, treeId, fromId],
    );
    const movedNameIds = (moved.rows as { Id: number }[]).map((r) => r.Id);
    // `from`'s facts point at `to`, keeping the other name each was written under.
    const affected: PlaceRenameSnapshot['affected'] = [];
    // The facts that showed `from`'s own name, which a kept old name goes on showing.
    const ownName: PlaceRenameSnapshot['affected'] = [];
    for (const col of FACT_PLACE_COLUMNS) {
        const res = await exec.query(
            `UPDATE ${col.table} SET ${col.id} = $1 WHERE "TreeId" = $2 AND ${col.id} = $3 RETURNING "Id", ${col.nameId} AS "nameId"`,
            [toId, treeId, fromId],
        );
        for (const r of res.rows as { Id: number; nameId: number | null }[]) {
            affected.push({ kind: col.kind, recordId: r.Id });
            if (r.nameId == null) ownName.push({ kind: col.kind, recordId: r.Id });
        }
    }
    await exec.query(`DELETE FROM "Places" WHERE "Id" = $1`, [fromId]);
    const keptNameId = options.keepOldName
        ? await keepOldName(exec, treeId, fromRow, toId, from, ownName)
        : undefined;
    return {
        snapshot: {
            from, to, wasMerge: true, affected, byReference: true, toId,
            fromRow, toFilled, repointedChildIds, toWasChildOfFrom, movedNameIds,
            ...(keptNameId != null ? { keptNameId } : {}),
        },
        survivingId: toId,
        changed: true,
    };
}

/**
 * Add `from`, a renamed or merged place's old name, as another name of `placeId`,
 * and point `facts` (the ones that showed it) at it. Returns the new name's id.
 */
async function keepOldName(
    exec: Exec,
    treeId: number,
    fromRow: Record<string, unknown>,
    placeId: number,
    from: string,
    facts: PlaceRenameSnapshot['affected'],
): Promise<number> {
    const res = await exec.query(
        `INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
        [placeId, fromRow.UserId ?? null, treeId, from],
    );
    const nameId = (res.rows[0] as { Id: number }).Id;
    for (const col of FACT_PLACE_COLUMNS) {
        const ids = facts.filter((f) => f.kind === col.kind).map((f) => f.recordId);
        if (ids.length === 0) continue;
        await exec.query(
            `UPDATE ${col.table} SET ${col.nameId} = $1 WHERE "TreeId" = $2 AND ${col.id} = $3 AND ${col.nameId} IS NULL AND "Id" = ANY($4)`,
            [nameId, treeId, placeId, ids],
        );
    }
    return nameId;
}

/**
 * Rename text that is not a place's own name: another name of a place. To a new
 * name, the other name itself is renamed and its facts follow it. To the name of
 * a place, its facts move to that place's own name and the other name stays.
 */
async function renamePlaceText(
    exec: Exec,
    treeId: number,
    from: string,
    to: string,
    toRow: Record<string, unknown> | null,
): Promise<RenamePlaceResult> {
    const named = await exec.query(
        `SELECT "Id", "PlaceId" FROM "PlaceName" WHERE "TreeId" = $1 AND "Name" = $2`,
        [treeId, from],
    );
    const other = named.rows[0] as { Id: number; PlaceId: number } | undefined;
    const usage = await getRecordsForPlace(from, treeId, exec);
    const affected = usage.map((u) => ({ kind: u.kind, recordId: u.recordId }));
    if (other) {
        if (toRow) {
            for (const col of FACT_PLACE_COLUMNS) {
                await exec.query(
                    `UPDATE ${col.table} SET ${col.id} = $1, ${col.nameId} = NULL
                      WHERE "TreeId" = $2 AND ${col.nameId} = $3 AND ${col.id} = $4`,
                    [toRow.Id, treeId, other.Id, other.PlaceId],
                );
            }
        } else {
            await exec.query(`UPDATE "PlaceName" SET "Name" = $1 WHERE "Id" = $2`, [to, other.Id]);
        }
    }
    const otherName = other ? { id: other.Id, placeId: other.PlaceId } : undefined;
    const snapshot: PlaceRenameSnapshot = toRow
        ? { from, to, wasMerge: true, affected, fromRow: null, toFilled: {}, repointedChildIds: [], toWasChildOfFrom: false, movedNameIds: [], otherName }
        : { from, to, wasMerge: false, affected, otherName };
    return { snapshot, survivingId: (toRow?.Id as number | undefined) ?? 0, changed: affected.length > 0 || !!other };
}

/**
 * Undo a rename/merge from its snapshot, inside an open transaction. Recreates the
 * deleted gazetteer row (merge), re-nulls the fields the merge filled, re-points
 * moved children and names, and moves back only the recorded `affected` facts.
 */
export async function revertPlaceRename(
    exec: Exec,
    treeId: number,
    snap: PlaceRenameSnapshot,
): Promise<void> {
    // 1) Restore the gazetteer. A merge NEVER renames the surviving `to` row (it
    //    legitimately pre-existed); only a plain rename does. Guard on wasMerge, not
    //    on fromRow — a merge whose `from` had no gazetteer row (null fromRow) still
    //    must not fall through to the rename path and clobber the real `to` row.
    // The surviving `to` row: by id from v62 on, else the most-used place of the name.
    const toKey = snap.toId ?? snap.to;
    const toRowSql = snap.toId != null ? '$3' : `"PlaceIdByName"($2, $3)`;
    let fromNowId: number | null = null;
    // 0) A kept old name (#1185) goes before the place takes that name back. Its
    //    facts show the place's own name again, and a merge moves them back below,
    //    including one saved under the name since.
    const keptFacts: PlaceRenameSnapshot['affected'] = [];
    if (snap.keptNameId != null) {
        for (const col of FACT_PLACE_COLUMNS) {
            const res = await exec.query(
                `UPDATE ${col.table} SET ${col.nameId} = NULL WHERE "TreeId" = $1 AND ${col.nameId} = $2 RETURNING "Id"`,
                [treeId, snap.keptNameId],
            );
            for (const r of res.rows as { Id: number }[]) keptFacts.push({ kind: col.kind, recordId: r.Id });
        }
        await exec.query(`DELETE FROM "PlaceName" WHERE "TreeId" = $1 AND "Id" = $2`, [treeId, snap.keptNameId]);
    }
    if (snap.wasMerge) {
        if (snap.fromRow) {
            // Recreate the deleted `from` row before re-pointing its children to it.
            // TreeId (in addition to the legacy UserId) is included so the recreated
            // row is visible again to the same tree it belonged to before the merge.
            const cols = ['Id', 'UserId', 'TreeId', 'Name', ...FOLD_FIELDS].filter((c) => snap.fromRow![c] != null);
            const values = cols.map((c) => snap.fromRow![c]);
            const placeholders = values.map((_, i) => `$${i + 1}`);
            const quoted = cols.map((c) => `"${c}"`);
            // Snapshots from v62 on bring the place back under its own id (#1186): two
            // places may share a name now, so one that took the name since is another
            // place. Older snapshots resolve whatever row now holds the name, as before.
            const reclaimed = !snap.byReference && (await exec.query(
                `SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, snap.from],
            )).rows.length > 0;
            if (!reclaimed) {
                await exec.query(
                    `INSERT INTO "Places" (${quoted.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${placeholders.join(', ')})
                     ON CONFLICT ("Id") DO NOTHING`,
                    values,
                );
            }
            // Re-point moved children (and, if `to` used to be a child of `from`, restore
            // that link) to the row that now stands for `from`, never a stale id, so
            // revert can't violate the FK.
            const fromNow = await exec.query(
                snap.byReference
                    ? `SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`
                    : `SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Id" = "PlaceIdByName"($1, $2) AND "Name" = $2`,
                [treeId, snap.byReference ? snap.fromRow.Id : snap.from],
            );
            fromNowId = (fromNow.rows[0] as { Id: number } | undefined)?.Id ?? null;
            if (fromNowId != null) {
                if (snap.repointedChildIds && snap.repointedChildIds.length > 0) {
                    await exec.query(
                        `UPDATE "Places" SET "ParentId" = $1 WHERE "TreeId" = $2 AND "Id" = ANY($3)`,
                        [fromNowId, treeId, snap.repointedChildIds],
                    );
                }
                if (snap.toWasChildOfFrom) {
                    await exec.query(
                        `UPDATE "Places" SET "ParentId" = $1 WHERE "TreeId" = $2 AND "Id" = ${toRowSql} AND "ParentId" IS NULL`,
                        [fromNowId, treeId, toKey],
                    );
                }
                if (snap.movedNameIds && snap.movedNameIds.length > 0) {
                    await exec.query(
                        `UPDATE "PlaceName" SET "PlaceId" = $1 WHERE "TreeId" = $2 AND "Id" = ANY($3)`,
                        [fromNowId, treeId, snap.movedNameIds],
                    );
                    // Every fact written under a moved name follows it, including one
                    // saved after the merge: its text is built from that name (ADR 0037).
                    for (const col of FACT_PLACE_COLUMNS) {
                        await exec.query(
                            `UPDATE ${col.table} SET ${col.id} = $1
                              WHERE "TreeId" = $2 AND ${col.nameId} = ANY($3)
                                AND ${col.id} = ${snap.toId != null ? '$4' : '"PlaceIdByName"($2, $4)'}`,
                            [fromNowId, treeId, snap.movedNameIds, toKey],
                        );
                    }
                }
            }
        }
        // Re-null each field the merge filled — but only if the surviving `to` row
        // STILL holds the exact folded value, so a later legit edit to `to` is
        // preserved and a double-revert is a no-op.
        for (const [f, val] of Object.entries(snap.toFilled ?? {})) {
            await exec.query(
                `UPDATE "Places" SET "${f}" = NULL
                  WHERE "TreeId" = $1 AND "Id" = ${snap.toId != null ? '$2' : `"PlaceIdByName"($1, $2)`} AND "${f}" IS NOT DISTINCT FROM $3`,
                [treeId, toKey, val],
            );
        }
    } else if (snap.otherName) {
        // A renamed other name takes its old name back, unless a place has taken it since.
        await exec.query(
            `UPDATE "PlaceName" SET "Name" = $1 WHERE "TreeId" = $2 AND "Id" = $3 AND "Name" = $4
                AND NOT EXISTS (SELECT 1 FROM "Places" x WHERE x."TreeId" = $2 AND x."Name" = $1)`,
            [snap.from, treeId, snap.otherName.id, snap.to],
        );
    } else {
        // Plain rename: give the surviving `to` gazetteer row its old name back.
        await exec.query(
            `UPDATE "Places" SET "Name" = $1, "UpdatedAt" = CURRENT_TIMESTAMP
              WHERE "TreeId" = $2 AND "Id" = ${toRowSql} AND "Name" = ${snap.toId != null ? '$4' : '$3'}`,
            snap.toId != null ? [snap.from, treeId, toKey, snap.to] : [snap.from, treeId, toKey],
        );
    }

    if (snap.byReference && snap.toId != null) {
        // 2) A merge moves exactly the recorded facts back, and only while they still
        //    point at `to`; a rename's facts follow the row. Then refresh the copies.
        if (snap.wasMerge && fromNowId != null) {
            const recorded = new Set(snap.affected.map((a) => `${a.kind}:${a.recordId}`));
            for (const a of [...snap.affected, ...keptFacts.filter((k) => !recorded.has(`${k.kind}:${k.recordId}`))]) {
                const col = factPlaceColumn(a.kind);
                await exec.query(
                    `UPDATE ${col.table} SET ${col.id} = $1 WHERE "Id" = $2 AND "TreeId" = $3 AND ${col.id} = $4`,
                    [fromNowId, a.recordId, treeId, snap.toId],
                );
            }
        }
    } else if (snap.otherName && snap.wasMerge) {
        // 2) Facts moved off an other name go back to it, while they still show `to`
        //    and the name is still that place's.
        for (const a of snap.affected) {
            const col = factPlaceColumn(a.kind);
            await exec.query(
                `UPDATE ${col.table} AS f SET ${col.id} = pn."PlaceId", ${col.nameId} = pn."Id"
                   FROM "PlaceName" pn
                  WHERE pn."Id" = $1 AND pn."PlaceId" = $2 AND pn."TreeId" = $4
                    AND f."Id" = $3 AND f."TreeId" = $4 AND ${factPlaceTextSql(col, 'f')} = $5`,
                [snap.otherName.id, snap.otherName.placeId, a.recordId, treeId, snap.to],
            );
        }
    } else if (!snap.otherName) {
        // 2) An older text rewrite (before v64): point exactly the recorded records
        //    that still show `to` back at the place `from` names (never other `to` rows).
        const owner = await exec.query(`SELECT "OwnerId" FROM "Trees" WHERE "Id" = $1`, [treeId]);
        const ownerId = (owner.rows[0] as { OwnerId: number } | undefined)?.OwnerId ?? 0;
        const ref = (await resolvePlaceTexts(exec, treeId, ownerId, [snap.from])).get(snap.from);
        for (const a of snap.affected) {
            const col = factPlaceColumn(a.kind);
            await exec.query(
                `UPDATE ${col.table} AS f SET ${col.id} = $1, ${col.nameId} = $2
                  WHERE f."Id" = $3 AND f."TreeId" = $4 AND ${factPlaceTextSql(col, 'f')} = $5`,
                [ref?.id ?? null, ref?.nameId ?? null, a.recordId, treeId, snap.to],
            );
        }
    }
}

/** One fact a move took off a place, with the other name of it the fact showed. */
interface PlaceMovedFact {
    kind: PlaceUsage['kind'];
    recordId: number;
    nameId: number | null;
}

/**
 * Everything needed to undo "Move records to another place" (#1186), stored in
 * the audit entry's `Changes.snapshot`. `from` and `to` are the names the places
 * had, for the audit line; the places themselves are `fromId` and `toId`.
 */
export interface PlaceMoveSnapshot {
    move: true;
    from: string;
    to: string;
    fromId: number;
    toId: number;
    affected: PlaceMovedFact[];
}

/**
 * Point facts of place `fromId` at place `toId` inside an open transaction
 * (#1186): every fact of `fromId`, or only `records`. Both places stay. A fact
 * moves to `toId`'s own name unless `toId` has another name spelt as the fact
 * is, so its text follows the place it now points at.
 */
export async function movePlaceRecords(
    exec: Exec,
    treeId: number,
    fromId: number,
    toId: number,
    records?: readonly { kind: PlaceUsage['kind']; recordId: number }[],
): Promise<PlaceMoveSnapshot> {
    if (fromId === toId) throw new ValidationError('Choose another place to move the records to');
    const rows = await exec.query(
        `SELECT "Id", "Name" FROM "Places" WHERE "TreeId" = $1 AND "Id" = ANY($2) ORDER BY "Id" FOR UPDATE`,
        [treeId, [fromId, toId]],
    );
    const names = new Map((rows.rows as { Id: number; Name: string }[]).map((r) => [r.Id, r.Name]));
    if (!names.has(fromId) || !names.has(toId)) throw new NotFoundError('Place not found');

    const affected: PlaceMovedFact[] = [];
    for (const col of FACT_PLACE_COLUMNS) {
        const ids = records?.filter((r) => r.kind === col.kind).map((r) => r.recordId);
        if (ids && ids.length === 0) continue;
        const found = await exec.query(
            `SELECT "Id", ${col.nameId} AS "nameId" FROM ${col.table}
              WHERE "TreeId" = $1 AND ${col.id} = $2${ids ? ' AND "Id" = ANY($3)' : ''}
              ORDER BY "Id" FOR UPDATE`,
            ids ? [treeId, fromId, ids] : [treeId, fromId],
        );
        const facts = found.rows as { Id: number; nameId: number | null }[];
        if (facts.length === 0) continue;
        await exec.query(
            `UPDATE ${col.table} AS f SET ${col.id} = $1,
                    ${col.nameId} = (SELECT pn."Id" FROM "PlaceName" pn
                                      WHERE pn."TreeId" = $2 AND pn."PlaceId" = $1 AND pn."Name" = ${factPlaceTextSql(col, 'f')})
              WHERE f."TreeId" = $2 AND f."Id" = ANY($3)`,
            [toId, treeId, facts.map((r) => r.Id)],
        );
        for (const r of facts) affected.push({ kind: col.kind, recordId: r.Id, nameId: r.nameId });
    }
    if (affected.length === 0) throw new ValidationError('None of those records is at this place');
    return { move: true, from: names.get(fromId)!, to: names.get(toId)!, fromId, toId, affected };
}

/**
 * Undo a move from its snapshot, inside an open transaction: each moved fact that
 * still points at `toId` goes back to `fromId` and the other name it showed, while
 * that name remains. A fact moved again since is left where it is. Refused once
 * the place they came from is gone (merged away), as there is nowhere to go back to.
 */
export async function revertPlaceMove(exec: Exec, treeId: number, snap: PlaceMoveSnapshot): Promise<void> {
    const from = await exec.query(`SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`, [treeId, snap.fromId]);
    if (from.rows.length === 0) throw new NotFoundError(`${snap.from} no longer exists, so the records can't go back to it`);
    for (const a of snap.affected) {
        const col = factPlaceColumn(a.kind);
        await exec.query(
            `UPDATE ${col.table} SET ${col.id} = $1,
                    ${col.nameId} = (SELECT pn."Id" FROM "PlaceName" pn
                                      WHERE pn."TreeId" = $3 AND pn."PlaceId" = $1 AND pn."Id" = $5)
              WHERE "Id" = $2 AND "TreeId" = $3 AND ${col.id} = $4`,
            [snap.fromId, a.recordId, treeId, snap.toId, a.nameId],
        );
    }
}

/**
 * The gazetteer columns a geocode, coordinate or hierarchy edit can change (#924).
 * An audit entry stores each touched row's values before and after, so a revert
 * restores exactly these columns and nothing a later rename or note touched.
 */
const PLACE_EDIT_FIELDS = ['Latitude', 'Longitude', 'DisplayName', 'OsmType', 'OsmId', 'PinSuppressed', 'ParentId'] as const;

export type PlaceEditState = Record<(typeof PLACE_EDIT_FIELDS)[number], unknown>;

/** One gazetteer row an edit touched. `before` is null when the edit created it. */
export interface PlaceEditChange {
    id: number;
    name: string;
    before: PlaceEditState | null;
    after: PlaceEditState;
}

function editState(row: Record<string, unknown>): PlaceEditState {
    const state = {} as PlaceEditState;
    for (const f of PLACE_EDIT_FIELDS) state[f] = row[f] ?? null;
    // PinSuppressed is NOT NULL; normalise so a before/after compare is exact.
    state.PinSuppressed = row.PinSuppressed === true;
    return state;
}

/** True when the edit created the row or changed one of its edit columns. */
export function placeEditChanged(change: PlaceEditChange): boolean {
    if (!change.before) return true;
    // OsmId is BIGINT: a number on one engine, text on another; compare as text.
    return PLACE_EDIT_FIELDS.some((f) => String(change.before![f] ?? '') !== String(change.after[f] ?? ''));
}

/**
 * The gazetteer row a write lands on, locked for the rest of the transaction.
 *
 * An id names the row exactly (#1186) and must exist in the tree. A name lands on
 * the place it names: the most-used place of that name, else the place it is
 * another name of, even when the caller holds a fact's string that is another of
 * its names (#1167; without this, geocoding a fact recorded as "Lemberg" would mint
 * a second place), or no row yet, which the write creates.
 */
async function lockPlaceTarget(exec: Exec, treeId: number, target: PlaceKey): Promise<{ name: string; row: Record<string, unknown> | null }> {
    if (typeof target === 'number') {
        const res = await exec.query(`SELECT * FROM "Places" WHERE "Id" = $1 AND "TreeId" = $2 FOR UPDATE`, [target, treeId]);
        const row = res.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new NotFoundError('Place not found');
        return { name: row.Name as string, row };
    }
    // FOR UPDATE locks nothing while the row doesn't exist yet, so two first-time
    // writes of one name could both record it as created. The transaction-scoped
    // advisory lock serialises them on the (tree, name) key instead.
    await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`place:${treeId}:${target}`]);
    // The most-used place of that name, else the place it is another name of (#1186).
    const res = await exec.query(
        `SELECT * FROM "Places" WHERE "Id" = "PlaceIdByName"($1, $2) AND "TreeId" = $1 FOR UPDATE`,
        [treeId, target],
    );
    const row = (res.rows[0] as Record<string, unknown> | undefined) ?? null;
    return { name: row ? row.Name as string : target, row };
}

/**
 * Write one gazetteer row: update the target when it exists, else insert it.
 * `set` is the UPDATE's SET list and `insert` the INSERT's extra columns, both over
 * `params`, and each must use every one of them (an unused parameter has no type).
 */
async function writePlaceRow(
    exec: Exec,
    w: { ownerId: number; treeId: number; target: PlaceKey },
    set: string,
    insert: { columns: string[]; values: string[] },
    params: unknown[],
): Promise<PlaceEditChange> {
    const { name, row: before } = await lockPlaceTarget(exec, w.treeId, w.target);
    const n = params.length;
    const res = before
        ? await exec.query(
            `UPDATE "Places" SET ${set}, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $${n + 1} AND "TreeId" = $${n + 2} RETURNING *`,
            [...params, before.Id, w.treeId],
        )
        : await exec.query(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name", ${insert.columns.map((c) => `"${c}"`).join(', ')})
             VALUES ($${n + 1}, $${n + 2}, $${n + 3}, ${insert.values.join(', ')}) RETURNING *`,
            [...params, w.ownerId, w.treeId, name],
        );
    const row = res.rows[0] as Record<string, unknown>;
    return { id: row.Id as number, name, before: before ? editState(before) : null, after: editState(row) };
}

export interface PlaceGeocodeWrite {
    ownerId: number;
    treeId: number;
    /** The place's id, or a name it is called. */
    target: PlaceKey;
    latitude: number | null;
    longitude: number | null;
    displayName: string | null;
    osmType: string | null;
    osmId: number | null;
    pinSuppressed: boolean;
}

/**
 * Cache a place's geocode, or suppress its pin, inside an open transaction.
 * Per-tree gazetteer (v20): the row is looked up in the write's tree, so a geocode
 * in one tree can only ever touch that tree's row.
 */
export async function upsertPlaceGeocode(exec: Exec, w: PlaceGeocodeWrite): Promise<PlaceEditChange> {
    return writePlaceRow(exec, w,
        `"Latitude" = $1, "Longitude" = $2, "DisplayName" = COALESCE($3, "DisplayName"),
         "OsmType" = $4, "OsmId" = $5, "PinSuppressed" = $6`,
        { columns: ['Latitude', 'Longitude', 'DisplayName', 'OsmType', 'OsmId', 'PinSuppressed'], values: ['$1', '$2', '$3', '$4', '$5', '$6'] },
        [w.latitude, w.longitude, w.displayName, w.osmType, w.osmId, w.pinSuppressed]);
}

/**
 * A manual coordinate adjustment, inside an open transaction. It deliberately
 * leaves DisplayName/OsmType/OsmId alone: a manual edit must never erase or replace
 * the geocoder match those columns describe. Creating the row keeps the detail page
 * usable for a place that has not been geocoded before.
 */
export async function upsertPlaceCoordinates(
    exec: Exec,
    w: { ownerId: number; treeId: number; target: PlaceKey; latitude: number; longitude: number },
): Promise<PlaceEditChange> {
    return writePlaceRow(exec, w,
        `"Latitude" = $1, "Longitude" = $2, "PinSuppressed" = FALSE`,
        { columns: ['Latitude', 'Longitude', 'PinSuppressed'], values: ['$1', '$2', 'FALSE'] },
        [w.latitude, w.longitude]);
}

export interface PlaceHierarchyLevel {
    name: string;
    latitude: number | null;
    longitude: number | null;
    displayName: string | null;
    osmType: string | null;
    osmId: number | null;
}

/**
 * Persist a resolved jurisdiction chain (root → leaf) as linked rows, inside an
 * open transaction. See upsertPlaceHierarchyService for the column rules. Returns
 * one change per level, in the same order. `leafId` pins the last level to that
 * place (#1186); the other levels land on the place their name names.
 */
export async function upsertPlaceHierarchy(
    exec: Exec,
    w: { ownerId: number; treeId: number; levels: PlaceHierarchyLevel[]; reparent: boolean; leafId?: number | null },
): Promise<PlaceEditChange[]> {
    const changes: PlaceEditChange[] = [];
    let parentId: number | null = null;
    const seen = new Set<number>();
    for (const [i, level] of w.levels.entries()) {
        const target: PlaceKey = i === w.levels.length - 1 && w.leafId != null ? w.leafId : level.name;
        const { row } = await lockPlaceTarget(exec, w.treeId, target);
        // Two levels that are names of one place would make it its own parent.
        if (row && seen.has(row.Id as number)) continue;
        if (row && w.reparent && parentId !== null && await wouldCycle(exec, w.treeId, row.Id as number, parentId)) {
            throw new ValidationError('hierarchy would create a parent cycle');
        }
        const change = await writePlaceRow(exec, { ownerId: w.ownerId, treeId: w.treeId, target },
            `"Latitude" = COALESCE($1, "Latitude"),
             "Longitude" = COALESCE($2, "Longitude"),
             "ParentId" = ${w.reparent ? '$3::integer' : 'COALESCE("ParentId", $3::integer)'},
             "DisplayName" = COALESCE($4, "DisplayName"),
             "OsmType" = CASE WHEN $1::double precision IS NOT NULL THEN $5 ELSE "OsmType" END,
             "OsmId" = CASE WHEN $1::double precision IS NOT NULL THEN $6::bigint ELSE "OsmId" END,
             "PinSuppressed" = CASE WHEN $1::double precision IS NOT NULL THEN FALSE ELSE "PinSuppressed" END`,
            { columns: ['Latitude', 'Longitude', 'ParentId', 'DisplayName', 'OsmType', 'OsmId'], values: ['$1', '$2', '$3', '$4', '$5', '$6'] },
            [level.latitude, level.longitude, parentId, level.displayName, level.osmType, level.osmId]);
        seen.add(change.id);
        changes.push(change);
        parentId = change.id;
    }
    return changes;
}

/** Names of the given place ids in a tree, for readable audit details. */
export async function getPlaceNamesById(exec: Exec, treeId: number, ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const res = await exec.query(`SELECT "Id", "Name" FROM "Places" WHERE "TreeId" = $1 AND "Id" = ANY($2)`, [treeId, ids]);
    return new Map((res.rows as { Id: number; Name: string }[]).map((r) => [r.Id, r.Name]));
}

/** True when `state` is still exactly what the edit left behind. */
function stillAsEditLeft(row: Record<string, unknown>, after: PlaceEditState): boolean {
    return !placeEditChanged({ id: 0, name: '', before: editState(row), after });
}

/** True when linking `id` under `parentId` would make it its own ancestor. */
async function wouldCycle(exec: Exec, treeId: number, id: number, parentId: number): Promise<boolean> {
    const res = await exec.query(
        `WITH RECURSIVE ancestors AS (
           SELECT "Id", "ParentId", 0 AS depth FROM "Places" WHERE "Id" = $1 AND "TreeId" = $2
           UNION ALL
           SELECT p."Id", p."ParentId", a.depth + 1 FROM "Places" p JOIN ancestors a ON p."Id" = a."ParentId"
           WHERE p."TreeId" = $2 AND a.depth < 50
         )
         SELECT 1 FROM ancestors WHERE "Id" = $3 LIMIT 1`,
        [parentId, treeId, id],
    );
    return res.rows.length > 0;
}

/**
 * Undo a geocode, coordinate or hierarchy edit from its audit entry, inside an
 * open transaction (#924). Rows are restored leaf-first, so a parent the edit
 * created is no longer referenced by its own chain when its turn comes.
 *
 * Like a merge revert, it only undoes what is still there: a row whose edit
 * columns changed since (a later geocode, or a merge folded into it) keeps them,
 * and a row renamed or merged away is skipped. Reverting the later entry first,
 * as a bulk revert does, brings the row back to the state this one expects.
 * A row the edit created is deleted when nothing else points at it (a child place
 * or a note); otherwise its edit columns are cleared, the state it had before it
 * existed.
 */
export async function revertPlaceEdits(exec: Exec, treeId: number, changes: PlaceEditChange[]): Promise<void> {
    for (const change of [...changes].reverse()) {
        const current = await exec.query(`SELECT * FROM "Places" WHERE "Id" = $1 AND "TreeId" = $2 FOR UPDATE`, [change.id, treeId]);
        const row = current.rows[0] as Record<string, unknown> | undefined;
        if (!row || !stillAsEditLeft(row, change.after)) continue;
        if (change.before) {
            const restored = { ...change.before };
            // A parent deleted since then (ON DELETE SET NULL) can't be linked back,
            // nor one that has since moved under this place.
            if (restored.ParentId != null) {
                const parentId = Number(restored.ParentId);
                const parent = await exec.query(`SELECT 1 FROM "Places" WHERE "Id" = $1 AND "TreeId" = $2`, [parentId, treeId]);
                if (parent.rows.length === 0 || await wouldCycle(exec, treeId, change.id, parentId)) restored.ParentId = null;
            }
            await exec.query(
                `UPDATE "Places" SET ${PLACE_EDIT_FIELDS.map((f, i) => `"${f}" = $${i + 1}`).join(', ')}, "UpdatedAt" = CURRENT_TIMESTAMP
                 WHERE "Id" = $${PLACE_EDIT_FIELDS.length + 1} AND "TreeId" = $${PLACE_EDIT_FIELDS.length + 2}`,
                [...PLACE_EDIT_FIELDS.map((f) => restored[f] ?? null), change.id, treeId],
            );
            continue;
        }
        // A fact or another name pointing at the row keeps it too (#1167): deleting
        // it would unlink the fact (ON DELETE SET NULL) or drop the name (CASCADE).
        const refs = await exec.query(
            `SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "ParentId" = $2
             UNION ALL
             SELECT 1 FROM "NoteLink" WHERE "OwnerTable" = $3 AND "OwnerId" = $2
             UNION ALL
             SELECT 1 FROM "PlaceName" WHERE "PlaceId" = $2
             UNION ALL
             ${FACT_PLACE_COLUMNS.map((c) => `SELECT 1 FROM ${c.table} WHERE ${c.id} = $2`).join('\n             UNION ALL\n             ')}
             LIMIT 1`,
            [treeId, change.id, LINK_OWNER_TABLES.PLACES],
        );
        if (refs.rows.length === 0) {
            await exec.query(`DELETE FROM "Places" WHERE "Id" = $1 AND "TreeId" = $2`, [change.id, treeId]);
        } else {
            await exec.query(
                `UPDATE "Places" SET "Latitude" = NULL, "Longitude" = NULL, "DisplayName" = NULL, "OsmType" = NULL,
                   "OsmId" = NULL, "PinSuppressed" = FALSE, "ParentId" = NULL, "UpdatedAt" = CURRENT_TIMESTAMP
                 WHERE "Id" = $1 AND "TreeId" = $2`,
                [change.id, treeId],
            );
        }
    }
}

/** What still uses a place: its own facts, places within it, notes and photos (#1229). */
export interface PlaceUses {
    records: number;
    places: number;
    notes: number;
    media: number;
}

/** A deleted place, kept whole so the audit log can bring it back (#1229). */
export interface PlaceDeleteSnapshot {
    deleted: true;
    name: string;
    place: Record<string, unknown>;
    /** Its other names, which went with it. */
    names: Record<string, unknown>[];
}

export async function placeUses(exec: Exec, treeId: number, placeId: number): Promise<PlaceUses> {
    const facts = FACT_PLACE_COLUMNS.map((c) => `(SELECT COUNT(*) FROM ${c.table} WHERE "TreeId" = $1 AND ${c.id} = $2)`).join(' + ');
    const res = await exec.query(
        `SELECT (${facts})::int AS records,
                (SELECT COUNT(*) FROM "Places" WHERE "TreeId" = $1 AND "ParentId" = $2)::int AS places,
                (SELECT COUNT(*) FROM "NoteLink" WHERE "OwnerTable" = $3 AND "OwnerId" = $2)::int AS notes,
                (SELECT COUNT(*) FROM "MediaLink" WHERE "OwnerTable" = $3 AND "OwnerId" = $2)::int AS media`,
        [treeId, placeId, LINK_OWNER_TABLES.PLACES],
    );
    return res.rows[0] as PlaceUses;
}

/**
 * Delete a place nothing uses, inside an open transaction (#1229). A place with
 * records, places within it, notes or photos is refused: its records move to
 * another place first (Move records), so a delete never unlinks anything.
 */
export async function deleteUnusedPlace(exec: Exec, treeId: number, placeId: number): Promise<PlaceDeleteSnapshot> {
    const row = await exec.query(`SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2 FOR UPDATE`, [treeId, placeId]);
    const place = row.rows[0] as Record<string, unknown> | undefined;
    if (!place) throw new NotFoundError('Place not found');
    const uses = await placeUses(exec, treeId, placeId);
    if (uses.records + uses.places + uses.notes + uses.media > 0) {
        throw new ValidationError(`${place.Name as string} is still in use, so it can't be deleted. Move its records to another place first.`);
    }
    const names = await exec.query(`SELECT * FROM "PlaceName" WHERE "TreeId" = $1 AND "PlaceId" = $2 ORDER BY "Id"`, [treeId, placeId]);
    await exec.query(`DELETE FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`, [treeId, placeId]);
    return { deleted: true, name: place.Name as string, place, names: names.rows as Record<string, unknown>[] };
}

/**
 * Bring a deleted place back from its snapshot, inside an open transaction, under
 * its old id so links in older audit entries still find it. Refused when one of its
 * other names has since become another place's, as a name names one place.
 */
export async function revertPlaceDelete(exec: Exec, treeId: number, snap: PlaceDeleteSnapshot): Promise<void> {
    const id = Number(snap.place.Id);
    const existing = await exec.query(`SELECT 1 FROM "Places" WHERE "Id" = $1`, [id]);
    if (existing.rows.length > 0) return; // already back
    for (const n of snap.names) {
        const taken = await exec.query(
            `SELECT 1 FROM "PlaceName" WHERE "TreeId" = $1 AND "Name" = $2
             UNION ALL SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`,
            [treeId, n.Name],
        );
        if (taken.rows.length > 0) throw new ValidationError(`${n.Name as string} is now another place's name, so ${snap.name} can't come back with it`);
    }
    // A parent deleted since leaves the place at the top level.
    const place = { ...snap.place };
    if (place.ParentId != null) {
        const parent = await exec.query(`SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`, [treeId, place.ParentId]);
        if (parent.rows.length === 0) place.ParentId = null;
    }
    await insertSnapshotRow(exec, 'Places', place, { TreeId: treeId });
    for (const n of snap.names) await insertSnapshotRow(exec, 'PlaceName', n, { TreeId: treeId, PlaceId: id });
}
