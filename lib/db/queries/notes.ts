import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { type LinkOwnerTable } from '@/lib/db/fact-tables';
import type { EventWithMedia } from '@/lib/db/schema';

/**
 * A first-class note. `OwnerId` is the tree owner (a UserId) — the same
 * ownership column the rest of the app uses for access scoping. A note attaches
 * to one or more records through `NoteLink`, mirroring how `Citation` attaches a
 * source. `GedcomXref` preserves an imported `0 @N@ NOTE` record's pointer so a
 * round-trip can keep notes shared; `BackfilledFromPersonId` marks rows the
 * one-time People."Notes" migration created (idempotency).
 */
export interface Note {
    Id: number;
    OwnerId: number;
    TreeId?: number | null;
    Text: string;
    GedcomXref: string | null;
    BackfilledFromPersonId: number | null;
    CreatedAt: string;
    /** When the note's text last changed; its CreatedAt until then (#1045). */
    UpdatedAt?: string | null;
    /**
     * Whether this note is the PRIMARY (preferred) one for the owner it was read
     * through — the one a detail page's hero slot shows. It is a property of the
     * `NoteLink`, not of the note itself: the same shared note can be primary for a
     * person and not for the family it is also attached to (ADR 0010/0012). Only
     * present on owner-scoped reads; absent from whole-tree reads, which have no
     * single owner to resolve it against.
     */
    IsPrimary?: number;
    /**
     * Which promoted vital fact (Birth/Death/Marriage) this note is about, or null
     * for a record-level note. Like `IsPrimary`, this is a property of the
     * `NoteLink`, not the note itself — a shared note can be birth-scoped for one
     * owner and unscoped for another. Set at creation only, from context — the
     * GEDCOM importer, or a create path that already knows the vital (the
     * synthetic Birth/Death editor's note box). Never re-scoped afterwards; there
     * is no control to change it (ADR 0016, decision 3). Only present on
     * owner-scoped reads.
     */
    OwnerFact?: NoteOwnerFact | null;
    /**
     * 1 when this link was made by writing the note in the app, 0 for imported and
     * backfilled notes (#902). Only those can stand in as a person's biography when
     * none is preferred. Only present on owner-scoped reads.
     */
    AddedInApp?: number;
}

export interface NewNote {
    OwnerId: number;
    TreeId?: number | null;
    Text: string;
    GedcomXref?: string | null;
}

/** The vocabulary of promoted vital facts a note can be scoped to (`NoteLink."OwnerFact"`). */
export type NoteOwnerFact = 'Birth' | 'Death' | 'Marriage';
export const NOTE_OWNER_FACTS: readonly NoteOwnerFact[] = ['Birth', 'Death', 'Marriage'];

/**
 * One note as attached to one owner record, as the audit log records it (#1045):
 * the note row plus every link from it to that record. A note can be linked to the
 * same record more than once, under different promoted facts (#512), and an
 * unlink removes all of them, so `Links` is a list. `NoteOwnerId` is the note's
 * tree owner (Note."OwnerId"); `RecordId` is the record it is attached to.
 */
export interface NoteAuditSnapshot {
    NoteId: number;
    TreeId: number;
    NoteOwnerId: number;
    Text: string;
    GedcomXref: string | null;
    CreatedAt: string | null;
    UpdatedAt: string | null;
    OwnerTable: LinkOwnerTable;
    RecordId: number;
    Links: { OwnerFact: NoteOwnerFact | null; IsPrimary: number; AddedInApp: number }[];
}

/** A note's audit snapshot for one owner record, or null when it is not attached there in this tree. */
export async function getNoteAuditSnapshot(
    noteId: number,
    ownerTable: LinkOwnerTable,
    ownerId: number,
    treeId: number,
): Promise<NoteAuditSnapshot | null> {
    const result = await query(
        `SELECT n."Id", n."OwnerId", n."TreeId", n."Text", n."GedcomXref", n."CreatedAt", n."UpdatedAt",
                l."OwnerFact", l."IsPrimary", l."AddedInApp"
         FROM "Note" n
         JOIN "NoteLink" l ON l."NoteId" = n."Id"
         WHERE n."Id" = $1 AND l."OwnerTable" = $2 AND l."OwnerId" = $3 AND n."TreeId" = $4
         ORDER BY l."IsPrimary" DESC, l."OwnerFact" NULLS FIRST`,
        [noteId, ownerTable, ownerId, treeId],
    );
    const rows = result.rows as (Note & { OwnerFact: NoteOwnerFact | null; IsPrimary: number; AddedInApp: number })[];
    if (rows.length === 0) return null;
    const n = rows[0];
    const stamp = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
    return {
        NoteId: n.Id,
        TreeId: treeId,
        NoteOwnerId: n.OwnerId,
        Text: n.Text,
        GedcomXref: n.GedcomXref ?? null,
        CreatedAt: stamp(n.CreatedAt),
        UpdatedAt: stamp(n.UpdatedAt),
        OwnerTable: ownerTable,
        RecordId: ownerId,
        Links: rows.map((r) => ({ OwnerFact: r.OwnerFact ?? null, IsPrimary: Number(r.IsPrimary) || 0, AddedInApp: Number(r.AddedInApp) || 0 })),
    };
}

export interface NoteLinkRow {
    NoteId: number;
    OwnerTable: LinkOwnerTable;
    OwnerId: number;
    OwnerFact: NoteOwnerFact | null;
}

/** Every note attached to one owner record, the primary one first then oldest first. */
export async function getNotesForOwner(
    ownerTable: LinkOwnerTable,
    ownerId: number,
    treeId: number,
): Promise<Note[]> {
    const result = await query(
        `SELECT n.*, l."IsPrimary", l."OwnerFact", l."AddedInApp"
         FROM "Note" n
         JOIN "NoteLink" l ON l."NoteId" = n."Id"
         WHERE l."OwnerTable" = $1 AND l."OwnerId" = $2 AND n."TreeId" = $3
         ORDER BY l."IsPrimary" DESC, n."Id" ASC`,
        [ownerTable, ownerId, treeId],
    );
    return result.rows as Note[];
}

/**
 * Make one note the owner's primary, or clear the owner's primary entirely
 * (`noteId = null`). Returns the ids of the notes it demoted and promoted, for the
 * audit log (#1045), or null when the note is not attached to that owner in this
 * tree, having changed nothing.
 *
 * Membership is verified BEFORE anything is written, and the demote+promote pair
 * runs in one transaction — mirroring `setPrimaryForPerson` in `media.ts`. Both
 * matter: demoting first and validating later would silently drop the owner's
 * existing preferred note on a request that then 404s, and two concurrent promotes
 * for the same owner would interleave into an `idx_notelink_one_primary` violation.
 * The demote itself is required rather than tidy — that index rejects a second
 * primary. Every statement is tree-scoped through the `Note` join; `NoteLink` is a
 * junction table with no `TreeId` of its own.
 */
export async function setPrimaryNoteForOwner(
    noteId: number | null,
    ownerTable: LinkOwnerTable,
    ownerId: number,
    treeId: number,
): Promise<{ demoted: number[]; promoted: number[] } | null> {
    if (noteId !== null) {
        // Outside the transaction on purpose: PGlite is single-connection, so a
        // global query() inside a getClient() transaction deadlocks.
        const link = await query(
            `SELECT 1 FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"
             WHERE l."NoteId" = $1 AND l."OwnerTable" = $2 AND l."OwnerId" = $3 AND n."TreeId" = $4`,
            [noteId, ownerTable, ownerId, treeId],
        );
        if ((link.rowCount ?? 0) === 0) return null;
    }

    const client = await getClient();
    const changed = { demoted: [] as number[], promoted: [] as number[] };
    try {
        await client.query('BEGIN');
        const demoted = await client.query(
            `UPDATE "NoteLink" l SET "IsPrimary" = 0
             FROM "Note" n
             WHERE n."Id" = l."NoteId" AND n."TreeId" = $3
               AND l."OwnerTable" = $1 AND l."OwnerId" = $2 AND l."IsPrimary" = 1
             RETURNING l."NoteId"`,
            [ownerTable, ownerId, treeId],
        );
        changed.demoted = [...new Set((demoted.rows as { NoteId: number }[]).map((r) => r.NoteId))];
        if (noteId !== null) {
            await client.query(
                `UPDATE "NoteLink" l SET "IsPrimary" = 1
                 FROM "Note" n
                 WHERE n."Id" = l."NoteId" AND n."TreeId" = $4
                   AND l."NoteId" = $1 AND l."OwnerTable" = $2 AND l."OwnerId" = $3`,
                [noteId, ownerTable, ownerId, treeId],
            );
            changed.promoted = [noteId];
        }
        await client.query('COMMIT');
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
    // Re-promoting the note that was already primary changes nothing.
    if (noteId !== null && changed.demoted.includes(noteId)) {
        changed.demoted = changed.demoted.filter((id) => id !== noteId);
        changed.promoted = [];
    }
    return changed;
}

/**
 * Attach each event's NOTE COUNT (NoteLink OwnerTable='Events') in ONE query —
 * the mirror of `attachMediaToEvents`. The life-events timeline needs to know
 * which rows have notes so it can offer a read affordance on those rows without
 * an N+1 fetch (or a rail on every row); the note text itself is loaded only when
 * a row is actually opened. Events with no notes get `noteCount: 0`. Empty input
 * short-circuits (no query). Tree-scoped through the `Note` join — `NoteLink` is a
 * junction table with no "TreeId" of its own.
 */
export async function attachNoteCountsToEvents(
    events: EventWithMedia[],
    treeId: number,
): Promise<EventWithMedia[]> {
    if (events.length === 0) return [];
    const result = await query(
        `SELECT l."OwnerId" AS "EventId", COUNT(*)::int AS "NoteCount"
         FROM "NoteLink" l
         JOIN "Note" n ON n."Id" = l."NoteId"
         WHERE l."OwnerTable" = 'Events' AND l."OwnerId" = ANY($1) AND n."TreeId" = $2
         GROUP BY l."OwnerId"`,
        [events.map((e) => e.Id), treeId],
    );
    const byEvent = new Map<number, number>();
    for (const row of result.rows as { EventId: number; NoteCount: number }[]) {
        byEvent.set(row.EventId, Number(row.NoteCount));
    }
    return events.map((e) => ({ ...e, noteCount: byEvent.get(e.Id) ?? 0 }));
}

/** All note links for a tree (used by GEDCOM export to group notes by owner). */
export async function getAllNoteLinks(treeId: number): Promise<NoteLinkRow[]> {
    const result = await query(
        `SELECT l."NoteId", l."OwnerTable", l."OwnerId", l."OwnerFact"
         FROM "NoteLink" l
         JOIN "Note" n ON n."Id" = l."NoteId"
         WHERE n."TreeId" = $1
         ORDER BY l."NoteId" ASC`,
        [treeId],
    );
    return result.rows as NoteLinkRow[];
}

/** All notes for a tree (used by GEDCOM export). */
export async function getAllNotes(treeId: number): Promise<Note[]> {
    const result = await query(
        `SELECT * FROM "Note" WHERE "TreeId" = $1 ORDER BY "Id" ASC`,
        [treeId],
    );
    return result.rows as Note[];
}

/** Create a note row (unattached). Callers usually follow with `linkNote`. */
async function createNote(data: NewNote): Promise<Note> {
    const result = await query(
        `INSERT INTO "Note" ("OwnerId", "TreeId", "Text", "GedcomXref")
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [data.OwnerId, data.TreeId ?? null, data.Text, data.GedcomXref ?? null],
    );
    return result.rows[0] as Note;
}

/** Attach an existing note to an owner record (idempotent — re-linking is a no-op).
 *  Junction table — no "TreeId" column (the tree scope lives on the Note row itself). */
async function linkNote(
    noteId: number,
    ownerTable: LinkOwnerTable,
    ownerId: number,
    ownerFact: NoteOwnerFact | null = null,
    addedInApp = false,
): Promise<void> {
    await query(
        `INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "OwnerFact", "AddedInApp")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [noteId, ownerTable, ownerId, ownerFact, addedInApp ? 1 : 0],
    );
}

/**
 * Create a note and attach it to one owner in a single call. `treeId` and
 * `gedcomXref` are optional (appended, not inserted between existing params) so
 * pre-existing direct callers that predate the multi-tree refactor keep
 * type-checking — a note created without `treeId` simply has a null "TreeId"
 * (invisible to TreeId-scoped reads until backfilled). `ownerFact` follows the
 * same discipline: appended last so every existing call site keeps
 * type-checking unchanged.
 */
export async function createNoteForOwner(
    ownerTable: LinkOwnerTable,
    ownerId: number,
    text: string,
    treeOwnerId: number,
    treeId?: number | null,
    gedcomXref?: string | null,
    ownerFact?: NoteOwnerFact | null,
    /** Written in the app rather than imported (#902): never a biography fallback. */
    addedInApp = false,
): Promise<Note> {
    const note = await createNote({ OwnerId: treeOwnerId, TreeId: treeId ?? null, Text: text, GedcomXref: gedcomXref ?? null });
    await linkNote(note.Id, ownerTable, ownerId, ownerFact ?? null, addedInApp);
    // OwnerFact and AddedInApp live on the NoteLink row (not selected by
    // createNote's RETURNING *), but the caller just supplied them, so attach them
    // to the returned Note the same way getNotesForOwner would report them.
    return { ...note, OwnerFact: ownerFact ?? null, AddedInApp: addedInApp ? 1 : 0 };
}

/**
 * Update a note's text, scoped to the tree and verified to be attached to
 * the given owner record (so a caller can only edit notes reachable from a record
 * they can access). Editing a shared note updates it everywhere it is linked.
 * Returns the updated note, or null if no matching note/link exists.
 */
export async function updateNote(
    noteId: number,
    ownerTable: LinkOwnerTable,
    ownerId: number,
    text: string,
    treeId: number,
): Promise<Note | null> {
    const result = await query(
        `UPDATE "Note" n
         SET "Text" = $5, "UpdatedAt" = CURRENT_TIMESTAMP
         WHERE n."Id" = $1 AND n."TreeId" = $4
           AND EXISTS (
             SELECT 1 FROM "NoteLink" l
             WHERE l."NoteId" = n."Id" AND l."OwnerTable" = $2 AND l."OwnerId" = $3
           )
         RETURNING n.*`,
        [noteId, ownerTable, ownerId, treeId, text],
    );
    return (result.rows[0] as Note) ?? null;
}

/**
 * Detach a note from one owner. When that was the note's last link, the now-
 * orphaned note row is deleted too (app-layer cascade — `NoteLink.OwnerId` is
 * polymorphic and has no DB FK). Returns true if a link was removed.
 */
export async function unlinkNote(
    noteId: number,
    ownerTable: LinkOwnerTable,
    ownerId: number,
    treeId: number,
): Promise<boolean> {
    const result = await query(
        `DELETE FROM "NoteLink" l
         USING "Note" n
         WHERE l."NoteId" = n."Id" AND n."TreeId" = $4
           AND l."NoteId" = $1 AND l."OwnerTable" = $2 AND l."OwnerId" = $3`,
        [noteId, ownerTable, ownerId, treeId],
    );
    const removed = (result.rowCount ?? 0) > 0;
    if (removed) {
        await query(
            `DELETE FROM "Note" n
             WHERE n."Id" = $1 AND n."TreeId" = $2
               AND NOT EXISTS (SELECT 1 FROM "NoteLink" l WHERE l."NoteId" = n."Id")`,
            [noteId, treeId],
        );
    }
    return removed;
}

/**
 * Remove every note attached ONLY to the given owner record, and drop those
 * owner's links. Use when an owner record is deleted so its notes don't orphan
 * (shared notes still linked elsewhere are kept). Returns the deleted note count.
 */
export async function deleteNotesForOwner(
    ownerTable: LinkOwnerTable,
    ownerId: number,
    treeId: number,
): Promise<number> {
    // Drop this owner's links first.
    await query(
        `DELETE FROM "NoteLink" l
         USING "Note" n
         WHERE l."NoteId" = n."Id" AND n."TreeId" = $3
           AND l."OwnerTable" = $1 AND l."OwnerId" = $2`,
        [ownerTable, ownerId, treeId],
    );
    // Sweep any of this tree's notes left with no remaining link.
    const result = await query(
        `DELETE FROM "Note" n
         WHERE n."TreeId" = $1
           AND NOT EXISTS (SELECT 1 FROM "NoteLink" l WHERE l."NoteId" = n."Id")`,
        [treeId],
    );
    return result.rowCount ?? 0;
}
