import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { getTreeCountsService } from '@/lib/services/tree-counts';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user ids — integration tests run in parallel and
// share the database, so every read and cleanup is scoped to these.
const COUNTS_USER = 987731;
const OTHER_USER = 987732;

async function seedUser(id: number, email: string) {
    await query(
        'INSERT INTO "Users" ("Id","Email","GoogleId") VALUES ($1,$2,$3) ON CONFLICT ("Id") DO NOTHING',
        [id, email, `google-${id}`],
    );
}

async function clear(userId: number) {
    await query('DELETE FROM "Citation" WHERE "OwnerId" = $1', [userId]);
    await query('DELETE FROM "Note" WHERE "OwnerId" = $1', [userId]);
    await query('DELETE FROM "Repository" WHERE "OwnerId" = $1', [userId]);
    await query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [userId]);
    await query('DELETE FROM "Events" WHERE "UserId" = $1', [userId]);
    await query('DELETE FROM "Media" WHERE "UserId" = $1', [userId]);
    await query('DELETE FROM "Cases" WHERE "UserId" = $1', [userId]);
    await query('DELETE FROM "Places" WHERE "UserId" = $1', [userId]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [userId]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [userId]);
}

// Multi-tree: counts are TreeId-scoped; seeds stamp each user's default tree.
let COUNTS_TREE = 0;
let OTHER_TREE = 0;

d('getTreeCountsService (PostgreSQL)', () => {
    beforeAll(async () => {
        await seedUser(COUNTS_USER, `tree-counts-${COUNTS_USER}@test.local`);
        await seedUser(OTHER_USER, `tree-counts-${OTHER_USER}@test.local`);
        COUNTS_TREE = await resolveDefaultTree(COUNTS_USER);
        OTHER_TREE = await resolveDefaultTree(OTHER_USER);
    });

    afterEach(async () => {
        await clear(COUNTS_USER);
        await clear(OTHER_USER);
    });

    it('returns all-zero for an empty tree — the state that skips the overwrite confirm', async () => {
        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: COUNTS_USER });
        expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });

    it('counts a tree holding only standalone repositories', async () => {
        // Creatable from the Library's "Add repository" button with no people at
        // all. An overwrite import deletes these, so they must make the tree
        // non-empty or they are wiped without a confirmation.
        await query('INSERT INTO "Repository" ("OwnerId","TreeId","Name") VALUES ($1,$2,$3)', [COUNTS_USER, COUNTS_TREE, 'County Archive']);

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: COUNTS_USER });
        expect(counts.repositories).toBe(1);
        expect(counts.people).toBe(0);
        expect(Object.values(counts).every((n) => n === 0)).toBe(false);
    });

    it('counts a tree holding only a geocoded places gazetteer', async () => {
        await query(
            'INSERT INTO "Places" ("UserId","TreeId","Name","Latitude","Longitude") VALUES ($1,$5,$2,$3,$4)',
            [COUNTS_USER, 'Dover', 51.1048, 1.2416, COUNTS_TREE],
        );

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: COUNTS_USER });
        expect(counts.places).toBe(1);
        expect(Object.values(counts).every((n) => n === 0)).toBe(false);
    });

    it('counts people, families and events for a populated tree', async () => {
        const person = await query(
            'INSERT INTO "People" ("UserId","TreeId","FirstName") VALUES ($1,$3,$2) RETURNING "Id"',
            [COUNTS_USER, 'Ada', COUNTS_TREE],
        );
        await query('INSERT INTO "Families" ("UserId","TreeId") VALUES ($1,$2)', [COUNTS_USER, COUNTS_TREE]);
        await query(
            'INSERT INTO "Events" ("UserId","TreeId","PersonId","Type") VALUES ($1,$4,$2,$3)',
            [COUNTS_USER, person.rows[0].Id, 'BIRT', COUNTS_TREE],
        );

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: COUNTS_USER });
        expect(counts).toMatchObject({ people: 1, families: 1, events: 1 });
    });

    it("scopes every count to the tree owner — another user's rows never leak in", async () => {
        await query('INSERT INTO "People" ("UserId","TreeId","FirstName") VALUES ($1,$3,$2)', [OTHER_USER, 'Nobody', OTHER_TREE]);
        await query('INSERT INTO "Repository" ("OwnerId","TreeId","Name") VALUES ($1,$3,$2)', [OTHER_USER, 'Their Archive', OTHER_TREE]);

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: COUNTS_USER });
        expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });
});
