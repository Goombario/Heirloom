import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { truncateAllTables } from '../setup/pglite-truncate';

/**
 * Multi-tree Phase 1: the trees query layer — CRUD, the lazy default-tree
 * resolver, and the transactional whole-tree wipe (which must delete ONLY the
 * target tree's rows and hand back media file paths for disk cleanup).
 */

const holder = vi.hoisted(() => ({ db: null as PGlite | null }));

vi.mock('@/lib/db/connection', () => ({
    query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
    getClient: async () => ({
        query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
        release: () => {},
    }),
    closePool: async () => {},
}));

import {
    listTreesForUser,
    getTree,
    createTree,
    renameTree,
    countTreesForUser,
    resolveDefaultTree,
    deleteTreeData,
} from '@/lib/db/queries/trees';

let db: PGlite;

beforeAll(async () => {
    db = await newEmptyClusterDb();
    holder.db = db;
    await initializeSchema(db as unknown as DbExecutor);
});

afterEach(async () => {
    await truncateAllTables(db);
});

async function makeUser(id: number): Promise<number> {
    await db.query(
        `INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (${id},'u${id}@test.local','g-${id}')`
    );
    return id;
}

describe('trees queries', () => {
    it('resolveDefaultTree lazily creates exactly one tree and is stable', async () => {
        const uid = await makeUser(1);
        const t1 = await resolveDefaultTree(uid);
        const t2 = await resolveDefaultTree(uid);
        expect(t2).toBe(t1);
        expect(await countTreesForUser(uid)).toBe(1);
        expect((await getTree(t1))?.Name).toBe('My Tree');
    });

    it('default tree is the lowest Id when several exist', async () => {
        const uid = await makeUser(1);
        const first = await resolveDefaultTree(uid);
        await createTree({ OwnerId: uid, Name: 'Research' });
        expect(await resolveDefaultTree(uid)).toBe(first);
        expect((await listTreesForUser(uid))[0].Id).toBe(first);
        expect(await countTreesForUser(uid)).toBe(2);
    });

    it('create / rename / get round-trip; list is per-user', async () => {
        const uid = await makeUser(1);
        const other = await makeUser(2);
        const tree = await createTree({ OwnerId: uid, Name: 'Maternal line' });
        await createTree({ OwnerId: other, Name: 'Not mine' });
        const renamed = await renameTree(tree.Id, 'Maternal');
        expect(renamed.Name).toBe('Maternal');
        expect((await getTree(tree.Id))?.Name).toBe('Maternal');
        expect((await listTreesForUser(uid)).map((t) => t.Name)).toEqual(['Maternal']);
    });

    it('getTree returns null for a nonexistent id; renameTree throws', async () => {
        expect(await getTree(999999)).toBeNull();
        await expect(renameTree(999999, 'Ghost')).rejects.toThrow('Tree not found');
    });

    it('deleteTreeData wipes only that tree and returns media file paths', async () => {
        const uid = await makeUser(1);
        const keep = await resolveDefaultTree(uid);
        const kill = (await createTree({ OwnerId: uid, Name: 'Doomed' })).Id;

        // Rows in the doomed tree across owner-column flavors + a survivor.
        await db.query(`INSERT INTO "People" ("UserId","TreeId","FirstName") VALUES (${uid},${keep},'Keep')`);
        await db.query(`INSERT INTO "People" ("UserId","TreeId","FirstName") VALUES (${uid},${kill},'Kill')`);
        await db.query(`INSERT INTO "Families" ("UserId","TreeId") VALUES (${uid},${kill})`);
        const fam = await db.query<{ Id: number }>(`SELECT "Id" FROM "Families" WHERE "TreeId" = ${kill}`);
        const person = await db.query<{ Id: number }>(`SELECT "Id" FROM "People" WHERE "TreeId" = ${kill}`);
        await db.query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId","ChildrenId") VALUES (${fam.rows[0].Id},${person.rows[0].Id})`
        );
        await db.query(`INSERT INTO "Media" ("UserId","TreeId","FilePath") VALUES (${uid},${kill},'/uploads/x.jpg')`);
        await db.query(`INSERT INTO "Sources" ("TreeId","Title") VALUES (${kill},'Doomed source')`);
        await db.query(
            `INSERT INTO "AuditLog" ("TreeOwnerId","UserId","TreeId","Action","EntityType","EntityId","Changes")
             VALUES (${uid},${uid},${kill},'create','person',${person.rows[0].Id},'{}')`
        );

        const paths = await deleteTreeData(kill, uid);
        expect(paths).toEqual(['/uploads/x.jpg']);
        expect(await getTree(kill)).toBeNull();

        // Only the doomed tree's rows are gone.
        const people = await db.query<{ FirstName: string }>(`SELECT "FirstName" FROM "People" WHERE "UserId" = ${uid}`);
        expect(people.rows.map((p) => p.FirstName)).toEqual(['Keep']);
        for (const table of ['Families', 'FamilyPerson', 'Media', 'Sources', 'AuditLog'] as const) {
            const r = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "${table}"`);
            expect(parseInt(r.rows[0].c, 10), `${table} should be empty`).toBe(0);
        }
        expect(await countTreesForUser(uid)).toBe(1); // the kept tree survives
    });
});
