// The last step of #1186 (v64, ADR 0037): facts stop keeping their place as text.
//
// Before v64 each fact kept its place text beside its references, and the link pass
// below matched text that disagreed with them. initializeSchema runs it once more on
// a database that still has the text, so facts an older build wrote are linked, then
// checks that every fact's references spell its text exactly before the text
// columns are dropped. A fact they don't spell stops the upgrade with the text kept.

import { FACT_PLACE_COLUMNS, factPlaceTextSql } from './queries/place-links';

interface Exec {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

type FactPlaceColumn = (typeof FACT_PLACE_COLUMNS)[number];

/**
 * SQL for the id of the place `f.<name>` names in its tree, or NULL: the place of
 * that name most records point at, else the place it is another name of.
 */
function resolvePlaceIdSql(name: string): string {
    return `CASE WHEN f.${name} IS NULL OR f.${name} = '' THEN NULL ELSE "PlaceIdByName"(f."TreeId", f.${name}) END`;
}

/** SQL for the other name `f.<name>` is, or NULL when it is a place's own name. */
function resolvePlaceNameIdSql(name: string): string {
    return `CASE WHEN f.${name} IS NULL OR f.${name} = ''
                   OR EXISTS (SELECT 1 FROM "Places" pl WHERE pl."TreeId" = f."TreeId" AND pl."Name" = f.${name})
              THEN NULL
              ELSE (SELECT pn."Id" FROM "PlaceName" pn WHERE pn."TreeId" = f."TreeId" AND pn."Name" = f.${name}) END`;
}

/** SQL true for a fact whose references don't spell its text. */
function staleSql(col: FactPlaceColumn): string {
    return `(CASE WHEN f.${col.name} IS NULL OR f.${col.name} = ''
                  THEN f.${col.id} IS NOT NULL OR f.${col.nameId} IS NOT NULL
                  ELSE ${factPlaceTextSql(col)} IS DISTINCT FROM f.${col.name} END)`;
}

/** The place text columns this database still has (all four before v64). */
async function textColumns(exec: Exec): Promise<FactPlaceColumn[]> {
    const res = await exec.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND (table_name, column_name) IN (('People', 'BirthPlace'), ('People', 'DeathPlace'), ('Families', 'MarriagePlace'), ('Events', 'Place'))`,
    );
    const present = new Set((res.rows as { table_name: string; column_name: string }[]).map((r) => `"${r.table_name}"."${r.column_name}"`));
    return FACT_PLACE_COLUMNS.filter((c) => present.has(`${c.table}.${c.name}`));
}

/** Whether this database still keeps place text on any of its facts (before v64). */
export async function hasFactPlaceText(exec: Exec): Promise<boolean> {
    return (await textColumns(exec)).length > 0;
}

/**
 * Point every fact whose text its references don't spell at the place the text
 * names: a bare place for a text that names none, then the most-used place of that
 * name, else the place it is another name of, else NULL for an empty place.
 */
async function linkFactPlaceText(exec: Exec, columns: readonly FactPlaceColumn[]): Promise<void> {
    for (const col of columns) {
        const stale = staleSql(col);
        await exec.query(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name")
             SELECT DISTINCT ON (f."TreeId", f.${col.name}) f."UserId", f."TreeId", f.${col.name}
               FROM ${col.table} f
              WHERE ${stale}
                AND f."UserId" IS NOT NULL AND f."TreeId" IS NOT NULL
                AND f.${col.name} IS NOT NULL AND f.${col.name} <> ''
                AND NOT EXISTS (SELECT 1 FROM "Places" pl WHERE pl."TreeId" = f."TreeId" AND pl."Name" = f.${col.name})
                AND NOT EXISTS (SELECT 1 FROM "PlaceName" pn WHERE pn."TreeId" = f."TreeId" AND pn."Name" = f.${col.name})
              ORDER BY f."TreeId", f.${col.name}, f."Id"`,
        );
        await exec.query(
            `UPDATE ${col.table} AS f
                SET ${col.id} = ${resolvePlaceIdSql(col.name)}, ${col.nameId} = ${resolvePlaceNameIdSql(col.name)}
              WHERE ${stale}`,
        );
    }
}

/**
 * Link every fact once more, check that each one's references spell its text, then
 * drop the text columns and their indexes. Throws, dropping nothing, when any fact
 * would lose its text: a fact with no tree, say, has no place to point at. Each
 * column is checked and dropped on its own, so an upgrade stopped part-way (outside
 * a transaction) finishes on the next boot.
 */
export async function dropFactPlaceText(exec: Exec): Promise<void> {
    const columns = await textColumns(exec);
    await linkFactPlaceText(exec, columns);
    const unspelt: string[] = [];
    for (const col of columns) {
        const res = await exec.query(
            `SELECT COUNT(*)::int AS n, (ARRAY_AGG(f."Id" ORDER BY f."Id"))[1:5] AS ids FROM ${col.table} f
              WHERE f.${col.name} IS NOT NULL AND f.${col.name} <> ''
                AND ${factPlaceTextSql(col)} IS DISTINCT FROM f.${col.name}`,
        );
        const { n, ids } = res.rows[0] as { n: number; ids: number[] | null };
        if (n > 0) unspelt.push(`${n} ${col.table}.${col.name}, ids ${(ids ?? []).join(', ')}${n > 5 ? ', …' : ''}`);
    }
    if (unspelt.length > 0) {
        throw new Error(
            `Place text kept: these facts don't point at a place spelt as they are (${unspelt.join('; ')}). `
            + 'Give each a "TreeId" and "UserId", or clear its place, then start the app again.',
        );
    }
    for (const index of ['idx_people_user_birthplace', 'idx_people_user_deathplace', 'idx_events_user_place', 'idx_families_user_marrplace']) {
        await exec.query(`DROP INDEX IF EXISTS ${index}`);
    }
    // "People"."BirthPlace" last: while any text column is left, the next boot comes back here.
    for (const col of [...columns].reverse()) {
        await exec.query(`ALTER TABLE ${col.table} DROP COLUMN IF EXISTS ${col.name}`);
    }
}
