/**
 * Person-owned rows that a person delete destroys or strands, carried in the
 * delete's audit entry so a revert can bring them back (#788, ED-10).
 *
 * `NameVariant`, `MediaTag` and `CasePerson` reference "People" with
 * ON DELETE CASCADE, so the delete removes them. `NoteLink` and `MediaLink` are
 * polymorphic (no FK) and survive today, but they are captured as well so a
 * restore doesn't depend on no sweep having run in between. Citations, events,
 * `FamilyPerson` child links and partner slots are also FK-less and survive the
 * delete, so they come back with the person's original Id and aren't captured.
 */

type Executor = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> };
type Row = Record<string, unknown>;

interface PersonDependents {
    NameVariant: Row[];
    MediaTag: Row[];
    CasePerson: Row[];
    NoteLink: Row[];
    MediaLink: Row[];
}

/** Read every dependent row of one person. Run before the delete, in its transaction. */
export async function capturePersonDependents(exec: Executor, personId: number): Promise<PersonDependents> {
    // Sequential: one transaction client runs one statement at a time.
    const nameVariants = await exec.query(`SELECT * FROM "NameVariant" WHERE "PersonId" = $1 ORDER BY "Id"`, [personId]);
    const mediaTags = await exec.query(`SELECT * FROM "MediaTag" WHERE "PersonId" = $1 ORDER BY "Id"`, [personId]);
    const casePeople = await exec.query(`SELECT * FROM "CasePerson" WHERE "PersonId" = $1 ORDER BY "CaseId"`, [personId]);
    const noteLinks = await exec.query(`SELECT * FROM "NoteLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 ORDER BY "NoteId"`, [personId]);
    const mediaLinks = await exec.query(`SELECT * FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 ORDER BY "MediaId"`, [personId]);
    return {
        NameVariant: nameVariants.rows as Row[],
        MediaTag: mediaTags.rows as Row[],
        CasePerson: casePeople.rows as Row[],
        NoteLink: noteLinks.rows as Row[],
        MediaLink: mediaLinks.rows as Row[],
    };
}

/** True when the audit payload carries dependents in the expected shape. */
export function isPersonDependents(value: unknown): value is PersonDependents {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return ['NameVariant', 'MediaTag', 'CasePerson', 'NoteLink', 'MediaLink'].every(k => v[k] === undefined || Array.isArray(v[k]));
}

/** Ids from `rows[field]` that name a row of `table` in this tree and owner. */
async function idsInTree(
    exec: Executor,
    table: 'Media' | 'Note' | 'Cases',
    ownerColumn: 'UserId' | 'OwnerId',
    rows: Row[],
    field: string,
    treeId: number,
    treeOwnerId: number,
): Promise<Set<number>> {
    const ids = [...new Set(rows.map(r => Number(r[field])).filter(Number.isInteger))];
    if (ids.length === 0) return new Set();
    const result = await exec.query(
        `SELECT "Id" FROM "${table}" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2 AND "${ownerColumn}" = $3`,
        [ids, treeId, treeOwnerId],
    );
    return new Set((result.rows as { Id: number }[]).map(r => r.Id));
}

/** Returns false when a conflicting row already exists and nothing was inserted. */
async function insertRow(exec: Executor, table: string, values: Row): Promise<boolean> {
    const columns = Object.keys(values).filter(c => values[c] !== undefined);
    const result = await exec.query(
        `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')})
         VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT DO NOTHING`,
        columns.map(c => values[c]),
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Name variants and face tags keep their Ids, because citations and later audit
 * entries point at them. If one can't go back under its Id, fail the whole
 * revert rather than report success with the row missing.
 */
async function insertKeepingId(exec: Executor, table: 'NameVariant' | 'MediaTag', values: Row): Promise<void> {
    if (!(await insertRow(exec, table, values))) {
        throw new Error(`${table} #${values.Id} could not be restored: a conflicting row exists`);
    }
}

/**
 * Re-insert a restored person's dependents. The caller has already re-inserted
 * the person in `treeId`. Every row is re-pointed at that person and this tree,
 * whatever the snapshot says, and a row whose media, note or case is gone or
 * belongs elsewhere is skipped, so a forged snapshot can't reach another tree.
 * Link rows that still exist are left alone; a name variant or face tag that
 * can't be restored under its own Id fails the revert.
 */
export async function restorePersonDependents(
    exec: Executor,
    personId: number,
    treeId: number,
    treeOwnerId: number,
    dependents: PersonDependents,
): Promise<void> {
    const nameVariants = dependents.NameVariant ?? [];
    const mediaTags = dependents.MediaTag ?? [];
    const casePeople = dependents.CasePerson ?? [];
    const noteLinks = dependents.NoteLink ?? [];
    const mediaLinks = dependents.MediaLink ?? [];

    for (const nv of nameVariants) {
        await insertKeepingId(exec, 'NameVariant', {
            Id: nv.Id, OwnerId: treeOwnerId, TreeId: treeId, PersonId: personId,
            Type: nv.Type, Name: nv.Name, FromDate: nv.FromDate, ToDate: nv.ToDate,
            IsPrimary: nv.IsPrimary, CreatedAt: nv.CreatedAt,
        });
    }

    const media = await idsInTree(exec, 'Media', 'UserId', [...mediaTags, ...mediaLinks], 'MediaId', treeId, treeOwnerId);
    for (const tag of mediaTags) {
        if (!media.has(Number(tag.MediaId))) continue;
        await insertKeepingId(exec, 'MediaTag', {
            Id: tag.Id, MediaId: tag.MediaId, PersonId: personId,
            RegionX: tag.RegionX, RegionY: tag.RegionY, RegionW: tag.RegionW, RegionH: tag.RegionH,
            CreatedAt: tag.CreatedAt,
        });
    }
    for (const link of mediaLinks) {
        if (!media.has(Number(link.MediaId))) continue;
        await insertRow(exec, 'MediaLink', {
            MediaId: link.MediaId, OwnerTable: 'People', OwnerId: personId,
            // An entry written before #905 has no fact: its link was record-level.
            OwnerFact: link.OwnerFact ?? null,
            IsPrimary: link.IsPrimary, CreatedAt: link.CreatedAt,
        });
    }

    const cases = await idsInTree(exec, 'Cases', 'UserId', casePeople, 'CaseId', treeId, treeOwnerId);
    for (const cp of casePeople) {
        if (!cases.has(Number(cp.CaseId))) continue;
        await insertRow(exec, 'CasePerson', { CaseId: cp.CaseId, PersonId: personId });
    }

    const notes = await idsInTree(exec, 'Note', 'OwnerId', noteLinks, 'NoteId', treeId, treeOwnerId);
    for (const link of noteLinks) {
        if (!notes.has(Number(link.NoteId))) continue;
        await insertRow(exec, 'NoteLink', {
            NoteId: link.NoteId, OwnerTable: 'People', OwnerId: personId, OwnerFact: link.OwnerFact,
            IsPrimary: link.IsPrimary, CreatedAt: link.CreatedAt,
            // Kept so a restored rail note stays out of the biography (#902).
            AddedInApp: link.AddedInApp ?? 0,
        });
    }
}
