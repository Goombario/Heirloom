import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { truncateAllTables } from '../setup/pglite-truncate';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

/**
 * ADR 0012 / ADR 0010 — the primary ("preferred") note concept, so the hero slot
 * on /people/view has something to show once a person can have several notes.
 *
 * The flag lives on `NoteLink`, NOT on `Note`. That follows the precedent the
 * decision session named: `MediaTag."IsPrimary"` sits on the JOIN row and is
 * scoped per person by a partial unique index, exactly like
 * `NameVariant."IsPrimary"`. A `Note."IsPrimary"` would mean "primary for every
 * owner at once", which breaks the shared note ADR 0010 exists to enable — the
 * same note attached to a person and their family could not be that person's
 * preferred note without also claiming to be the family's.
 */
describe('NoteLink.IsPrimary', () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
        await initializeSchema(executor);
    });

    beforeEach(async () => {
        await truncateAllTables(db);
        await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
        await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'T')`);
    });

    async function addNote(text: string): Promise<number> {
        const r = await db.query<{ Id: number }>(
            `INSERT INTO "Note" ("OwnerId", "TreeId", "Text") VALUES (1, 1, $1) RETURNING "Id"`,
            [text],
        );
        return r.rows[0].Id;
    }

    async function link(noteId: number, ownerTable: string, ownerId: number, isPrimary = 0): Promise<void> {
        await db.query(
            `INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, $4)`,
            [noteId, ownerTable, ownerId, isPrimary],
        );
    }

    it('defaults to 0 so existing links are unaffected', async () => {
        const noteId = await addNote('A note');
        await db.query(
            `INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId") VALUES ($1, 'People', 7)`,
            [noteId],
        );
        const r = await db.query<{ IsPrimary: number }>(`SELECT "IsPrimary" FROM "NoteLink"`);
        expect(r.rows[0].IsPrimary).toBe(0);
    });

    it('allows one primary note per owner', async () => {
        await link(await addNote('first'), 'People', 7, 1);
        const r = await db.query<{ c: string }>(
            `SELECT COUNT(*)::text AS c FROM "NoteLink" WHERE "IsPrimary" = 1`,
        );
        expect(r.rows[0].c).toBe('1');
    });

    it('rejects a second primary note for the same owner', async () => {
        await link(await addNote('first'), 'People', 7, 1);
        const second = await addNote('second');
        await expect(link(second, 'People', 7, 1)).rejects.toThrow();
    });

    it('allows a primary note for a DIFFERENT person', async () => {
        await link(await addNote('hers'), 'People', 7, 1);
        await expect(link(await addNote('his'), 'People', 8, 1)).resolves.toBeUndefined();
    });

    it('allows a primary note for the same id in a different owner table', async () => {
        // (People 7) and (Families 7) are different records — the index is scoped
        // by the OwnerTable+OwnerId pair, not the bare id.
        await link(await addNote('person note'), 'People', 7, 1);
        await expect(link(await addNote('family note'), 'Families', 7, 1)).resolves.toBeUndefined();
    });

    it('allows many non-primary notes for one owner', async () => {
        await link(await addNote('a'), 'People', 7, 0);
        await link(await addNote('b'), 'People', 7, 0);
        await link(await addNote('c'), 'People', 7, 1);
        const r = await db.query<{ c: string }>(
            `SELECT COUNT(*)::text AS c FROM "NoteLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = 7`,
        );
        expect(r.rows[0].c).toBe('3');
    });

    it('lets a note shared with a family be primary for the person only', async () => {
        // The reason the flag is on the link, not the note.
        const shared = await addNote('about both');
        await link(shared, 'People', 7, 1);
        await link(shared, 'Families', 3, 0);
        const r = await db.query<{ OwnerTable: string; IsPrimary: number }>(
            `SELECT "OwnerTable", "IsPrimary" FROM "NoteLink" WHERE "NoteId" = $1 ORDER BY "OwnerTable"`,
            [shared],
        );
        expect(r.rows).toEqual([
            { OwnerTable: 'Families', IsPrimary: 0 },
            { OwnerTable: 'People', IsPrimary: 1 },
        ]);
    });
});
