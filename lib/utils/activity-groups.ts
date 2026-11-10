import type { AuditLogEntryWithUser } from '@/lib/db/schema';

/** A dashboard activity row: one audit entry, or the newest entry of a bulk run. */
export type ActivityRow = AuditLogEntryWithUser & {
    /** How many distinct records the row stands for; 1 for a single record, even
     *  one edited several times in the run. */
    GroupCount: number;
    /** The run reached the end of the fetched window, so the count is a lower bound. */
    GroupCountAtLeast: boolean;
};

/** Every field the run's entries changed, newest first, each once, so a row for
 *  one record edited several times names all its changes, not only the last (#931). */
function mergedChanges(run: AuditLogEntryWithUser[]): AuditLogEntryWithUser['Changes'] {
    const newest = run[0].Changes;
    if (!('fields' in newest)) return newest;
    const fields: Record<string, { old: unknown; new: unknown }> = {};
    for (const e of run) {
        const own = 'fields' in e.Changes ? e.Changes.fields : undefined;
        for (const [field, change] of Object.entries(own ?? {})) {
            if (!(field in fields)) fields[field] = change;
        }
    }
    return { ...newest, fields };
}

/** Adjacent entries further apart than this start a new row. */
const RUN_GAP_MS = 2 * 60 * 1000;

function sameRun(a: AuditLogEntryWithUser, b: AuditLogEntryWithUser): boolean {
    if (a.EntityType === 'import' || b.EntityType === 'import') return false;
    if (a.UserId !== b.UserId || a.EntityType !== b.EntityType || a.Action !== b.Action) return false;
    return Math.abs(Date.parse(a.CreatedAt) - Date.parse(b.CreatedAt)) <= RUN_GAP_MS;
}

/**
 * Collapse a bulk action into one row (#768, DV-3): 88 near-identical "Citation —
 * … added" entries from one batch read as "Added 88 citations". A run is consecutive
 * entries (newest first) by the same user, of the same entity type and action, each
 * within two minutes of the next. Imports keep their own summary row.
 *
 * The count is of records, not entries (#807): one case saved three times in a row
 * is one "Updated" row for that case, not "Updated 3 cases".
 *
 * `hasMore` says the log continues past `entries`: a run that reaches the last
 * fetched entry may continue, so its count is marked as a lower bound.
 */
export function groupActivityRuns(entries: AuditLogEntryWithUser[], limit: number, hasMore: boolean): ActivityRow[] {
    const rows: ActivityRow[] = [];
    let i = 0;
    while (i < entries.length && rows.length < limit) {
        let j = i + 1;
        while (j < entries.length && sameRun(entries[j - 1], entries[j])) j++;
        const run = entries.slice(i, j);
        const records = new Set(run.map((e) => e.EntityId)).size;
        rows.push({
            ...entries[i],
            Changes: records === 1 && run.length > 1 ? mergedChanges(run) : entries[i].Changes,
            GroupCount: records,
            GroupCountAtLeast: hasMore && j === entries.length && records > 1,
        });
        i = j;
    }
    return rows;
}

/** Records that are themselves in the tree read "added to tree" / "removed from tree". */
const TREE_RECORD_TYPES = new Set(['person', 'family', 'source', 'case', 'story', 'media']);
const ADD_REMOVE_WORDING: Record<string, string> = { datacheck: 'datacheck', mediatag: 'tag', familychild: 'link' };

/**
 * The `home.*` key for a single create/delete row's action. Anything that isn't a
 * tree record is a part of one (a tag, a link, a citation) or not a record at all
 * (a data check confirmation), and says what happened to it instead of "added to
 * tree" (#931). A missing type is the resume card's person.
 */
export function addRemoveActionKey(action: 'create' | 'delete', entityType: string | undefined): string {
    const base = action === 'create' ? 'action_added' : 'action_removed';
    if (!entityType || TREE_RECORD_TYPES.has(entityType)) return base;
    return `${base}_${ADD_REMOVE_WORDING[entityType] ?? 'part'}`;
}
