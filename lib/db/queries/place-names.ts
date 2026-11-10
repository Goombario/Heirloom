import { query } from '@/lib/db/connection';
import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';
import { FACT_PLACE_COLUMNS } from './place-links';

/*
 * Editing a place's other names (#1185): Lemberg until 1918, Lwów 1918–1939. A fact
 * written under one of them points at the place and at that name, and shows the name
 * (ADR 0037). So a name that records use is never just deleted, which would make
 * them show the place's own name: its records keep their spelling and become a
 * separate place of that name, as they would have been without it.
 */

type Exec = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> };
type FactKind = (typeof FACT_PLACE_COLUMNS)[number]['kind'];

/** One other name of a place, with how many records were written under it. */
export interface PlaceOtherNameUse {
    id: number;
    name: string;
    language: string | null;
    fromDate: string | null;
    toDate: string | null;
    records: number;
}

/** The facts that point at `placeId` under one of its names, counted per name. */
const NAME_USE_SQL = FACT_PLACE_COLUMNS.map((c) =>
    `SELECT ${c.nameId} AS "nameId" FROM ${c.table} WHERE "TreeId" = $1 AND ${c.id} = $2`,
).join(' UNION ALL ');

/**
 * A place's other names, in the order the page lists them, and how many of its
 * records use its own name.
 */
export async function getPlaceNameUse(
    placeId: number,
    treeId: number,
    exec: Exec = { query },
): Promise<{ otherNames: PlaceOtherNameUse[]; ownNameRecords: number }> {
    const [names, use] = await Promise.all([
        exec.query(
            `SELECT "Id", "Name", "Language", "FromDate", "ToDate" FROM "PlaceName"
              WHERE "TreeId" = $1 AND "PlaceId" = $2 ORDER BY "Name", "Id"`,
            [treeId, placeId],
        ),
        exec.query(`SELECT "nameId", COUNT(*)::int AS n FROM (${NAME_USE_SQL}) u GROUP BY "nameId"`, [treeId, placeId]),
    ]);
    const counts = new Map((use.rows as { nameId: number | null; n: number | string }[]).map((r) => [r.nameId, Number(r.n)]));
    return {
        otherNames: (names.rows as { Id: number; Name: string; Language: string | null; FromDate: string | null; ToDate: string | null }[])
            .map((r) => ({ id: r.Id, name: r.Name, language: r.Language, fromDate: r.FromDate, toDate: r.ToDate, records: counts.get(r.Id) ?? 0 })),
        ownNameRecords: counts.get(null) ?? 0,
    };
}

/** A name as the editor sends it: `id` for one the place has, none for a new one. */
export interface PlaceOtherNameInput {
    id?: number | null;
    name: string;
    language: string | null;
    fromDate: string | null;
    toDate: string | null;
}

type NameFields = Pick<PlaceOtherNameInput, 'name' | 'language' | 'fromDate' | 'toDate'>;

/** The facts a removed or renamed name had, moved to a new place of that name. */
interface SplitOff {
    placeId: number;
    facts: { kind: FactKind; recordId: number }[];
}

/**
 * Everything needed to undo one save of a place's other names, stored in the
 * audit entry's `Changes.snapshot`. `names: true` tells it from a rename or a move.
 */
export interface PlaceNamesSnapshot {
    names: true;
    placeId: number;
    /** The place's name, for the audit line. */
    place: string;
    added: { id: number; name: string }[];
    changed: { id: number; before: NameFields; after: NameFields; split?: SplitOff }[];
    removed: { id: number; userId: number | null; before: NameFields; split?: SplitOff }[];
}

const fold = (s: string) => s.trim().toLocaleLowerCase();

const fieldsOf = (r: { Name: string; Language: string | null; FromDate: string | null; ToDate: string | null }): NameFields =>
    ({ name: r.Name, language: r.Language, fromDate: r.FromDate, toDate: r.ToDate });

const sameFields = (a: NameFields, b: NameFields) =>
    a.name === b.name && a.language === b.language && a.fromDate === b.fromDate && a.toDate === b.toDate;

/**
 * Why `name` can't become another name of the place (`placeId`, called `own`), or
 * null when it can. Matched without case, like the editor's own checks. `others`
 * are the names it will have besides this one.
 */
async function nameProblem(exec: Exec, treeId: number, placeId: number, own: string, name: string, others: string[]): Promise<string | null> {
    if (fold(name) === fold(own)) return 'That is this place’s own name.';
    const dup = others.find((o) => fold(o) === fold(name));
    if (dup) return `${own} already has the name ${dup}.`;
    const taken = (await exec.query(
        `SELECT pn."Name", pl."Name" AS "Place" FROM "PlaceName" pn JOIN "Places" pl ON pl."Id" = pn."PlaceId"
          WHERE pn."TreeId" = $1 AND pn."PlaceId" <> $2 AND lower(pn."Name") = lower($3) LIMIT 1`,
        [treeId, placeId, name],
    )).rows[0] as { Name: string; Place: string } | undefined;
    if (taken) return `${taken.Name} is already another name of ${taken.Place}. A name can belong to one place only.`;
    const place = (await exec.query(
        `SELECT "Name", "PlaceUseCount"("Id")::int AS n FROM "Places"
          WHERE "TreeId" = $1 AND "Id" <> $2 AND lower("Name") = lower($3)
          ORDER BY "PlaceUseCount"("Id") DESC, "Id" LIMIT 1`,
        [treeId, placeId, name],
    )).rows[0] as { Name: string; n: number } | undefined;
    if (place && place.n > 0) {
        return `${place.Name} is its own place, with ${place.n} record${place.n === 1 ? '' : 's'}. To make it a name of ${own}, merge ${place.Name} into ${own}.`;
    }
    if (place) return `${place.Name} is another place in this tree with no records of its own, so it can’t become a name of ${own}.`;
    return null;
}

/**
 * Move the facts written under other name `nameId` to a new place called `name`,
 * which shows them as they were written. Null when no fact uses the name.
 */
async function splitOff(exec: Exec, treeId: number, userId: number | null, nameId: number, name: string): Promise<SplitOff | undefined> {
    const facts: SplitOff['facts'] = [];
    for (const col of FACT_PLACE_COLUMNS) {
        const res = await exec.query(
            `SELECT "Id" FROM ${col.table} WHERE "TreeId" = $1 AND ${col.nameId} = $2 ORDER BY "Id" FOR UPDATE`,
            [treeId, nameId],
        );
        for (const r of res.rows as { Id: number }[]) facts.push({ kind: col.kind, recordId: r.Id });
    }
    if (facts.length === 0) return undefined;
    const created = await exec.query(
        `INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES ($1, $2, $3) RETURNING "Id"`,
        [userId, treeId, name],
    );
    const placeId = (created.rows[0] as { Id: number }).Id;
    for (const col of FACT_PLACE_COLUMNS) {
        await exec.query(
            `UPDATE ${col.table} SET ${col.id} = $1, ${col.nameId} = NULL WHERE "TreeId" = $2 AND ${col.nameId} = $3`,
            [placeId, treeId, nameId],
        );
    }
    return { placeId, facts };
}

/**
 * Save the whole list of `placeId`'s other names inside an open transaction: names
 * with an id are kept (and changed where they differ), names without one are added,
 * and names the list leaves out are removed. A removed name, or one renamed to
 * another spelling, that records use gives them a separate place of that name.
 * Returns the snapshot `revertPlaceNames` undoes, or null when nothing changed.
 */
export async function savePlaceOtherNames(
    exec: Exec,
    treeId: number,
    userId: number,
    placeId: number,
    list: readonly PlaceOtherNameInput[],
): Promise<PlaceNamesSnapshot | null> {
    let names = list;
    const placeRes = await exec.query(
        `SELECT "Id", "Name" FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2 FOR UPDATE`,
        [treeId, placeId],
    );
    const place = placeRes.rows[0] as { Id: number; Name: string } | undefined;
    if (!place) throw new NotFoundError('Place not found');
    const currentRes = await exec.query(
        `SELECT "Id", "UserId", "Name", "Language", "FromDate", "ToDate" FROM "PlaceName"
          WHERE "TreeId" = $1 AND "PlaceId" = $2 ORDER BY "Id" FOR UPDATE`,
        [treeId, placeId],
    );
    type Row = { Id: number; UserId: number | null; Name: string; Language: string | null; FromDate: string | null; ToDate: string | null };
    const current = new Map((currentRes.rows as Row[]).map((r) => [r.Id, r]));

    const seen = new Set<number>();
    for (const n of names) {
        if (n.id == null) continue;
        if (!current.has(n.id)) throw new ValidationError(`${place.Name} has no other name with id ${n.id}`);
        if (seen.has(n.id)) throw new ValidationError(`Name ${n.id} is listed twice`);
        seen.add(n.id);
    }
    // A name removed and typed again in the same save is the same name, kept.
    names = names.map((n) => {
        if (n.id != null) return n;
        const again = [...current.values()].find((r) => !seen.has(r.Id) && r.Name === n.name);
        if (!again) return n;
        seen.add(again.Id);
        return { ...n, id: again.Id };
    });
    // The spellings this save takes off records' names: a removed or respelt name
    // whose records become a place of that name, so no name here may take it.
    const leaving = [...current.values()].filter((r) => {
        const n = names.find((x) => x.id === r.Id);
        return !n || fold(n.name) !== fold(r.Name);
    }).map((r) => r.Name);
    // A new spelling is checked; one the place already has (as written) is not, so an
    // older clash never blocks an unrelated edit.
    for (const [i, n] of names.entries()) {
        const before = n.id != null ? current.get(n.id)! : null;
        if (before && before.Name === n.name) continue;
        const others = [...names.filter((_, j) => j !== i).map((o) => o.name), ...leaving];
        const problem = await nameProblem(exec, treeId, placeId, place.Name, n.name, others);
        if (problem) throw new ValidationError(problem);
    }

    const snap: PlaceNamesSnapshot = { names: true, placeId, place: place.Name, added: [], changed: [], removed: [] };
    for (const row of current.values()) {
        if (seen.has(row.Id)) continue;
        const split = await splitOff(exec, treeId, row.UserId ?? userId, row.Id, row.Name);
        await exec.query(`DELETE FROM "PlaceName" WHERE "Id" = $1`, [row.Id]);
        snap.removed.push({ id: row.Id, userId: row.UserId, before: fieldsOf(row), ...(split ? { split } : {}) });
    }
    for (const n of names) {
        if (n.id == null) continue;
        const row = current.get(n.id)!;
        const before = fieldsOf(row);
        const after: NameFields = { name: n.name, language: n.language, fromDate: n.fromDate, toDate: n.toDate };
        if (sameFields(before, after)) continue;
        // Another spelling, not a corrected case: the records keep the one they had.
        const split = fold(before.name) !== fold(after.name)
            ? await splitOff(exec, treeId, row.UserId ?? userId, row.Id, row.Name)
            : undefined;
        await exec.query(
            `UPDATE "PlaceName" SET "Name" = $1, "Language" = $2, "FromDate" = $3, "ToDate" = $4 WHERE "Id" = $5`,
            [after.name, after.language, after.fromDate, after.toDate, row.Id],
        );
        snap.changed.push({ id: row.Id, before, after, ...(split ? { split } : {}) });
    }
    for (const n of names) {
        if (n.id != null) continue;
        const res = await exec.query(
            `INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name", "Language", "FromDate", "ToDate")
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING "Id"`,
            [placeId, userId, treeId, n.name, n.language, n.fromDate, n.toDate],
        );
        snap.added.push({ id: (res.rows[0] as { Id: number }).Id, name: n.name });
    }
    return snap.added.length + snap.changed.length + snap.removed.length > 0 ? snap : null;
}

/**
 * Bring back the facts a save moved to a new place of a name's own: they point at
 * the place and the name again, and the new place goes. Refused when that place has
 * become more than those records' place since (a pin, a parent, names, places
 * within it, notes), as removing it would lose that.
 */
async function rejoin(exec: Exec, treeId: number, placeId: number, nameId: number, name: string, split: SplitOff): Promise<void> {
    const res = await exec.query(
        `SELECT pl."Name", pl."Latitude", pl."DisplayName", pl."ParentId",
                EXISTS (SELECT 1 FROM "PlaceName" pn WHERE pn."PlaceId" = pl."Id") AS "hasNames",
                EXISTS (SELECT 1 FROM "Places" c WHERE c."ParentId" = pl."Id") AS "hasChildren",
                EXISTS (SELECT 1 FROM "NoteLink" nl WHERE nl."OwnerTable" = 'Places' AND nl."OwnerId" = pl."Id") AS "hasNotes"
           FROM "Places" pl WHERE pl."TreeId" = $1 AND pl."Id" = $2`,
        [treeId, split.placeId],
    );
    const row = res.rows[0] as { Name: string; Latitude: number | null; DisplayName: string | null; ParentId: number | null; hasNames: boolean; hasChildren: boolean; hasNotes: boolean } | undefined;
    if (row && (row.Name !== name || row.Latitude != null || row.DisplayName != null || row.ParentId != null || row.hasNames || row.hasChildren || row.hasNotes)) {
        throw new ValidationError(`${name} has been edited as a place of its own since, so its records can’t go back. Merge it into the place instead.`);
    }
    if (!row) return;
    // Every fact at that place says the name, so all of them go back, including one
    // saved there since.
    for (const col of FACT_PLACE_COLUMNS) {
        await exec.query(
            `UPDATE ${col.table} SET ${col.id} = $1, ${col.nameId} = $2 WHERE "TreeId" = $3 AND ${col.id} = $4`,
            [placeId, nameId, treeId, split.placeId],
        );
    }
    await exec.query(`DELETE FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`, [treeId, split.placeId]);
}

/** A name no other place has taken since, as another name or its own. */
async function nameFree(exec: Exec, treeId: number, name: string, exceptNameId: number | null, exceptPlaceId: number | null): Promise<boolean> {
    const res = await exec.query(
        `SELECT 1 FROM "PlaceName" WHERE "TreeId" = $1 AND "Name" = $2 AND "Id" IS DISTINCT FROM $3
         UNION ALL
         SELECT 1 FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2 AND "Id" IS DISTINCT FROM $4`,
        [treeId, name, exceptNameId, exceptPlaceId],
    );
    return res.rows.length === 0;
}

/**
 * Undo a save of a place's other names from its snapshot, inside an open
 * transaction: added names go, changed ones get their old values back while they
 * still hold the saved ones, and removed ones return with their records. Refused,
 * with nothing changed, when a step would lose something done since.
 */
export async function revertPlaceNames(exec: Exec, treeId: number, snap: PlaceNamesSnapshot): Promise<void> {
    const place = await exec.query(`SELECT "Name" FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2`, [treeId, snap.placeId]);
    if (place.rows.length === 0) throw new NotFoundError(`${snap.place} no longer exists, so its names can’t be put back`);

    for (const a of snap.added) {
        const res = await exec.query(`SELECT "nameId" FROM (${FACT_PLACE_COLUMNS.map((c) =>
            `SELECT ${c.nameId} AS "nameId" FROM ${c.table} WHERE "TreeId" = $1 AND ${c.nameId} = $2`).join(' UNION ALL ')}) u`,
        [treeId, a.id]);
        if (res.rows.length > 0) {
            throw new ValidationError(`${res.rows.length} record${res.rows.length === 1 ? '' : 's'} now use ${a.name}, so adding it can’t be undone. Remove the name instead.`);
        }
        await exec.query(`DELETE FROM "PlaceName" WHERE "TreeId" = $1 AND "Id" = $2 AND "PlaceId" = $3`, [treeId, a.id, snap.placeId]);
    }

    for (const c of [...snap.changed].reverse()) {
        const now = await exec.query(
            `SELECT "Name", "Language", "FromDate", "ToDate" FROM "PlaceName" WHERE "TreeId" = $1 AND "Id" = $2 AND "PlaceId" = $3`,
            [treeId, c.id, snap.placeId],
        );
        const row = now.rows[0] as { Name: string; Language: string | null; FromDate: string | null; ToDate: string | null } | undefined;
        // Changed again since, or gone: that later edit stands.
        if (!row || !sameFields(fieldsOf(row), c.after)) continue;
        if (c.before.name !== c.after.name && !(await nameFree(exec, treeId, c.before.name, c.id, c.split?.placeId ?? null))) {
            throw new ValidationError(`${c.before.name} has become another place’s name since, so ${c.after.name} can’t take it back.`);
        }
        if (c.split) await rejoin(exec, treeId, snap.placeId, c.id, c.before.name, c.split);
        await exec.query(
            `UPDATE "PlaceName" SET "Name" = $1, "Language" = $2, "FromDate" = $3, "ToDate" = $4 WHERE "Id" = $5`,
            [c.before.name, c.before.language, c.before.fromDate, c.before.toDate, c.id],
        );
    }

    for (const r of snap.removed) {
        if (!(await nameFree(exec, treeId, r.before.name, r.id, r.split?.placeId ?? null))) {
            throw new ValidationError(`${r.before.name} has become another place’s name since, so it can’t come back to ${snap.place}.`);
        }
        await exec.query(
            `INSERT INTO "PlaceName" ("Id", "PlaceId", "UserId", "TreeId", "Name", "Language", "FromDate", "ToDate")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT ("Id") DO NOTHING`,
            [r.id, snap.placeId, r.userId, treeId, r.before.name, r.before.language, r.before.fromDate, r.before.toDate],
        );
        if (r.split) await rejoin(exec, treeId, snap.placeId, r.id, r.before.name, r.split);
    }
}
