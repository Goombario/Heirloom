// How a GEDCOM import writes the gazetteer, now that two places may share a name
// (#1186, ADR 0036).
//
// There is no unique ("TreeId","Name") index to upsert against any more, so a name
// is written to the place it means, the most-used place of that name (see
// "PlaceIdByName" in initializeSchema), and only a name no place has gets a new
// row. places.json is the one source that can tell two same-name places apart: it
// keys each entry and says which place each record of a shared name points at.

import type { SidecarFactPlace, SidecarPlaceEntry } from '@/lib/gedcom/places-sidecar';
import { factPlaceColumnFor, factPlaceTextSql } from './place-links';

interface Exec {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The PGlite parameter ceiling an import chunks under (see batchInsert). */
const CHUNK_PARAMS = 30000;

const PLACE_COLUMN_TYPES: Record<string, string> = {
    Id: 'integer', UserId: 'integer', TreeId: 'integer', Name: 'text', Form: 'text',
    Latitude: 'double precision', Longitude: 'double precision', DisplayName: 'text',
    OsmType: 'text', OsmId: 'bigint', OsmKind: 'text', PinSuppressed: 'boolean',
};

/** A VALUES list whose parameters carry their column types, as a FROM list needs. */
function typedValues(columns: string[], chunk: unknown[][], params: unknown[]): string {
    return chunk
        .map((row) => `(${row.map((value, i) => `$${params.push(value)}::${PLACE_COLUMN_TYPES[columns[i]]}`).join(', ')})`)
        .join(', ');
}

/**
 * Write each row to the place its name means in its tree, and create a place for
 * a name no place has. `columns` must include TreeId and Name, and rows must not
 * repeat a name. `updateSet` reads the incoming row as `v` ("Form" = COALESCE(
 * "Places"."Form", v."Form")).
 */
export async function upsertPlacesByName(
    exec: Exec,
    columns: string[],
    rows: unknown[][],
    updateSet: string,
): Promise<void> {
    if (rows.length === 0) return;
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const perChunk = Math.max(1, Math.floor(CHUNK_PARAMS / columns.length));
    for (let start = 0; start < rows.length; start += perChunk) {
        const params: unknown[] = [];
        const values = typedValues(columns, rows.slice(start, start + perChunk), params);
        await exec.query(
            `UPDATE "Places" SET ${updateSet}
               FROM (VALUES ${values}) AS v(${cols})
              WHERE "Places"."TreeId" = v."TreeId" AND "Places"."Name" = v."Name"
                AND "Places"."Id" = "PlaceIdByName"(v."TreeId", v."Name")`,
            params,
        );
        await exec.query(
            `INSERT INTO "Places" (${cols})
             SELECT ${columns.map((c) => `v."${c}"`).join(', ')} FROM (VALUES ${values}) AS v(${cols})
              WHERE NOT EXISTS (SELECT 1 FROM "Places" pl WHERE pl."TreeId" = v."TreeId" AND pl."Name" = v."Name")`,
            params,
        );
    }
}

interface ExistingPlace {
    Id: number;
    Name: string;
    OsmId: string | null;
    Latitude: number | null;
    Longitude: number | null;
}

/** How far apart, in degrees (about 50 km), two same-name places are told apart on import. */
const SAME_PLACE_DEGREES = 0.5;

const ENTRY_COLUMNS = ['UserId', 'TreeId', 'Name', 'Form', 'Latitude', 'Longitude', 'DisplayName', 'OsmType', 'OsmId', 'OsmKind', 'PinSuppressed'];

/**
 * Restore places.json's places into a tree, returning the place each entry became,
 * by entry index (an entry whose name the tree holds as another name is skipped).
 *
 * An entry matches an existing place of its name that no earlier entry took: the
 * one with its OSM id, else its coordinates, else the most-used one that is not
 * well away from it. On overwrite the
 * tree has no places, so every entry is a new place and two entries of one name
 * stay two places. On merge a matched place keeps every value it has and only
 * fills its gaps: the target tree is the user's curation, the bundle the stranger.
 */
export async function restorePlaceEntries(
    exec: Exec,
    treeId: number,
    ownerId: number,
    entries: SidecarPlaceEntry[],
    heldNames: ReadonlySet<string>,
): Promise<Map<number, number>> {
    const existing = (await exec.query(
        `SELECT "Id", "Name", "OsmId"::text AS "OsmId", "Latitude", "Longitude" FROM "Places"
          WHERE "TreeId" = $1 ORDER BY "PlaceUseCount"("Id") DESC, "Id"`,
        [treeId],
    )).rows as ExistingPlace[];
    const byName = new Map<string, ExistingPlace[]>();
    for (const row of existing) {
        const list = byName.get(row.Name) ?? [];
        list.push(row);
        byName.set(row.Name, list);
    }

    const placeByEntry = new Map<number, number>();
    const updates: unknown[][] = [];
    // Inserts go in rounds that never repeat a name, so RETURNING maps back by name.
    const rounds: Array<Map<string, number>> = [];
    entries.forEach((entry, index) => {
        if (heldNames.has(entry.name)) return;
        const candidates = byName.get(entry.name) ?? [];
        const hasCoords = entry.latitude != null && entry.longitude != null;
        const sameCoords = (c: ExistingPlace) => c.Latitude === entry.latitude && c.Longitude === entry.longitude;
        // A place well away from the entry's coordinates is somewhere else; a corrected
        // pin or a new geocode (another OSM id) nearby is the same place. Without
        // coordinates on both sides, a different OSM id is the only sign.
        const elsewhere = (c: ExistingPlace) => (hasCoords && c.Latitude != null && c.Longitude != null)
            ? Math.abs(c.Latitude - entry.latitude!) > SAME_PLACE_DEGREES || Math.abs(c.Longitude - entry.longitude!) > SAME_PLACE_DEGREES
            : entry.osmId != null && c.OsmId != null && c.OsmId !== entry.osmId;
        const match = candidates.find((c) => entry.osmId != null && c.OsmId === entry.osmId)
            ?? candidates.find((c) => hasCoords && sameCoords(c))
            ?? candidates.find((c) => !elsewhere(c));
        if (match) {
            candidates.splice(candidates.indexOf(match), 1);
            placeByEntry.set(index, match.Id);
            updates.push([match.Id, entry.form, entry.latitude, entry.longitude, entry.displayName, entry.osmType, entry.osmId, entry.osmKind ?? null]);
            return;
        }
        let round = rounds.find((r) => !r.has(entry.name));
        if (!round) { round = new Map(); rounds.push(round); }
        round.set(entry.name, index);
    });

    const updateColumns = ['Id', 'Form', 'Latitude', 'Longitude', 'DisplayName', 'OsmType', 'OsmId', 'OsmKind'];
    const perUpdate = Math.max(1, Math.floor(CHUNK_PARAMS / updateColumns.length));
    for (let start = 0; start < updates.length; start += perUpdate) {
        const params: unknown[] = [];
        const values = typedValues(updateColumns, updates.slice(start, start + perUpdate), params);
        // PinSuppressed is never overwritten: a boolean has no NULL to tell "unset"
        // from "deliberately false", so COALESCE could not protect it.
        await exec.query(
            `UPDATE "Places" SET
                "Form" = COALESCE("Places"."Form", v."Form"),
                "Latitude" = COALESCE("Places"."Latitude", v."Latitude"),
                "Longitude" = COALESCE("Places"."Longitude", v."Longitude"),
                "DisplayName" = COALESCE("Places"."DisplayName", v."DisplayName"),
                "OsmType" = COALESCE("Places"."OsmType", v."OsmType"),
                "OsmKind" = COALESCE("Places"."OsmKind", v."OsmKind"),
                "OsmId" = COALESCE("Places"."OsmId", v."OsmId")
               FROM (VALUES ${values}) AS v(${updateColumns.map((c) => `"${c}"`).join(', ')})
              WHERE "Places"."Id" = v."Id" AND "Places"."TreeId" = $${params.push(treeId)}`,
            params,
        );
    }

    const perInsert = Math.max(1, Math.floor(CHUNK_PARAMS / ENTRY_COLUMNS.length));
    for (const round of rounds) {
        const indexes = [...round.values()];
        for (let start = 0; start < indexes.length; start += perInsert) {
            const params: unknown[] = [];
            const tuples = indexes.slice(start, start + perInsert).map((i) => {
                const e = entries[i];
                const row = [ownerId, treeId, e.name, e.form, e.latitude, e.longitude, e.displayName, e.osmType, e.osmId, e.osmKind ?? null, e.pinSuppressed];
                return `(${row.map((value) => `$${params.push(value)}`).join(', ')})`;
            });
            const inserted = (await exec.query(
                `INSERT INTO "Places" (${ENTRY_COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}
                 RETURNING "Id", "Name"`,
                params,
            )).rows as Array<{ Id: number; Name: string }>;
            for (const row of inserted) placeByEntry.set(round.get(row.Name)!, row.Id);
        }
    }
    return placeByEntry;
}

/** The record ids this import wrote, by the xref the file gives each record. */
export interface ImportedRecordIds {
    people: ReadonlyMap<string, number>;
    families: ReadonlyMap<string, number>;
    /** Existing records a merge matched, as `person:<id>` / `family:<id>`: they keep their places. */
    matched: Set<string>;
}

const FACT_TARGETS = {
    birth: factPlaceColumnFor('BirthPlace'),
    death: factPlaceColumnFor('DeathPlace'),
    marriage: factPlaceColumnFor('MarriagePlace'),
};
const EVENT_PLACE = factPlaceColumnFor('Place');

/**
 * Point each record places.json names at the place it says, once the facts are
 * linked by name. A fact is only moved to a place spelt as it is now, so the text
 * it shows stays the text the file gave it. Returns
 * the facts it set, as `table:id`, so the import report can leave them out.
 */
export async function applyFactPlaceMap(
    exec: Exec,
    treeId: number,
    facts: SidecarFactPlace[],
    placeByKey: ReadonlyMap<string, number>,
    records: ImportedRecordIds,
): Promise<Set<string>> {
    const applied = new Set<string>();
    for (const f of facts) {
        const placeId = placeByKey.get(f.key);
        if (placeId == null) continue;
        const isFamily = f.xref.startsWith('@F');
        const recordId = (isFamily ? records.families : records.people).get(f.xref);
        if (recordId == null || records.matched.has(`${isFamily ? 'family' : 'person'}:${recordId}`)) continue;
        let rows: unknown[];
        if (f.fact === 'event') {
            rows = (await exec.query(
                `UPDATE "Events" SET "PlaceId" = $1, "PlaceNameId" = NULL
                  WHERE "Id" = (
                        SELECT e."Id" FROM "Events" e
                         WHERE e."TreeId" = $2 AND e.${isFamily ? '"FamilyId"' : '"PersonId"'} = $3
                           AND e."Type" = $4 AND e."Date" IS NOT DISTINCT FROM $5 AND ${factPlaceTextSql(EVENT_PLACE, 'e')} = $6
                         ORDER BY e."Id" OFFSET ${f.n} LIMIT 1)
                    AND EXISTS (SELECT 1 FROM "Places" pl WHERE pl."Id" = $1 AND pl."TreeId" = $2 AND pl."Name" = $6)
                  RETURNING "Id"`,
                [placeId, treeId, recordId, f.type, f.date, f.place],
            )).rows;
            for (const row of rows as Array<{ Id: number }>) applied.add(`Events:${row.Id}`);
            continue;
        }
        const target = FACT_TARGETS[f.fact];
        if ((target.table === '"Families"') !== isFamily) continue;
        rows = (await exec.query(
            `UPDATE ${target.table} AS f SET ${target.id} = $1, ${target.nameId} = NULL
              WHERE f."Id" = $3 AND f."TreeId" = $2 AND ${factPlaceTextSql(target)} = $4
                AND EXISTS (SELECT 1 FROM "Places" pl WHERE pl."Id" = $1 AND pl."TreeId" = $2 AND pl."Name" = $4)
              RETURNING "Id"`,
            [placeId, treeId, recordId, f.place],
        )).rows;
        for (const row of rows as Array<{ Id: number }>) applied.add(`${f.fact}:${row.Id}`);
    }
    return applied;
}

/** A fact of this import linked to one of several places that share its name. */
export interface SharedNameFact {
    key: string;
    place: string;
    person: string;
}

/**
 * The facts of the records this import wrote whose place name more than one place
 * in the tree has. They were linked to the most-used of them, which may be the
 * wrong one; the import report lists them. Keys match `applyFactPlaceMap`'s.
 */
export async function sharedNameFacts(
    exec: Exec,
    treeId: number,
    personIds: number[],
    familyIds: number[],
): Promise<SharedNameFact[]> {
    if (personIds.length === 0 && familyIds.length === 0) return [];
    // Only facts on the most-used place: one on another was placed there on purpose.
    const shared = `(SELECT COUNT(*) FROM "Places" s WHERE s."TreeId" = $1 AND s."Name" = pl."Name") > 1
                    AND pl."Id" = "PlaceIdByName"($1, pl."Name")`;
    const personName = (alias: string) => `TRIM(COALESCE(${alias}."FirstName", '') || ' ' || COALESCE(${alias}."LastName", ''))`;
    const familyName = `(SELECT STRING_AGG(${personName('fp')}, ' & ' ORDER BY fp."Id") FROM "People" fp
                          WHERE fp."Id" IN (fam."HusbandId", fam."WifeId"))`;
    const rows = (await exec.query(
        `SELECT 'birth:' || p."Id" AS "key", pl."Name" AS "place", ${personName('p')} AS "person"
           FROM "People" p JOIN "Places" pl ON pl."Id" = p."BirthPlaceId"
          WHERE p."TreeId" = $1 AND p."Id" = ANY($2) AND ${shared}
         UNION ALL
         SELECT 'death:' || p."Id", pl."Name", ${personName('p')}
           FROM "People" p JOIN "Places" pl ON pl."Id" = p."DeathPlaceId"
          WHERE p."TreeId" = $1 AND p."Id" = ANY($2) AND ${shared}
         UNION ALL
         SELECT 'marriage:' || fam."Id", pl."Name", ${familyName}
           FROM "Families" fam JOIN "Places" pl ON pl."Id" = fam."MarriagePlaceId"
          WHERE fam."TreeId" = $1 AND fam."Id" = ANY($3) AND ${shared}
         UNION ALL
         SELECT 'Events:' || e."Id", pl."Name",
                COALESCE((SELECT ${personName('ep')} FROM "People" ep WHERE ep."Id" = e."PersonId"),
                         (SELECT ${familyName} FROM "Families" fam WHERE fam."Id" = e."FamilyId"))
           FROM "Events" e JOIN "Places" pl ON pl."Id" = e."PlaceId"
          WHERE e."TreeId" = $1 AND (e."PersonId" = ANY($2) OR e."FamilyId" = ANY($3)) AND ${shared}`,
        [treeId, personIds, familyIds],
    )).rows as SharedNameFact[];
    return rows;
}
