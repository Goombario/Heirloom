import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { hasFactPlaceText } from '@/lib/db/place-text-migration';
import { factPlaceText } from '../setup/fact-places';

/**
 * v64 (#1186, ADR 0037): a database from before v64 keeps each fact's place as text
 * beside its references. Upgrading links every fact once more, checks that each
 * one's references spell its text, and only then drops the text columns. A fact
 * they can't spell stops the upgrade with the text kept.
 */

const USER = 1;
const TREE = 1;

type Row = Record<string, unknown>;

/** A fresh database put back to how v63 left it: the text columns beside the references. */
async function beforeV64(): Promise<{ db: PGlite; executor: DbExecutor }> {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (${USER}, 'a@b.c', 'g1')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (${TREE}, ${USER}, 'Tree')`);
    await db.query(`ALTER TABLE "People" ADD COLUMN "BirthPlace" TEXT, ADD COLUMN "DeathPlace" TEXT`);
    await db.query(`ALTER TABLE "Families" ADD COLUMN "MarriagePlace" TEXT`);
    await db.query(`ALTER TABLE "Events" ADD COLUMN "Place" TEXT`);
    await db.query(`CREATE INDEX idx_people_user_birthplace ON "People"("UserId", "BirthPlace")`);
    return { db, executor };
}

const columns = async (db: PGlite, table: string): Promise<string[]> =>
    (await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
        [table],
    )).rows.map((r) => r.column_name);

describe('v64: facts keep no place text', () => {
    let db: PGlite;
    let executor: DbExecutor;

    beforeEach(async () => {
        ({ db, executor } = await beforeV64());
    });
    afterEach(async () => {
        await db.close();
    });

    it('links every fact, keeps the text each one showed, then drops the columns', async () => {
        const lviv = (await db.query<{ Id: number }>(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES (${USER}, ${TREE}, 'Lviv') RETURNING "Id"`,
        )).rows[0].Id;
        const lemberg = (await db.query<{ Id: number }>(
            `INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name") VALUES (${lviv}, ${USER}, ${TREE}, 'Lemberg') RETURNING "Id"`,
        )).rows[0].Id;
        // Written by an older build: text only, no references.
        await db.query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName", "BirthPlace", "DeathPlace") VALUES (1, ${USER}, ${TREE}, 'Raw', 'Lemberg', 'Kyiv')`);
        // References that disagree with the text: the text wins.
        await db.query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName", "BirthPlace", "BirthPlaceId") VALUES (2, ${USER}, ${TREE}, 'Stale', 'Dover', ${lviv})`);
        // Already linked, and an empty place.
        await db.query(`INSERT INTO "Families" ("Id", "UserId", "TreeId", "MarriagePlace", "MarriagePlaceId") VALUES (1, ${USER}, ${TREE}, 'Lviv', ${lviv})`);
        await db.query(`INSERT INTO "Events" ("Id", "UserId", "TreeId", "Type", "Place", "PersonId") VALUES (1, ${USER}, ${TREE}, 'RESI', '', 1)`);

        await initializeSchema(executor);

        expect(await hasFactPlaceText(executor)).toBe(false);
        expect(await columns(db, 'People')).not.toContain('BirthPlace');
        expect(await columns(db, 'Events')).not.toContain('Place');
        const kyiv = (await db.query<{ Id: number }>(`SELECT "Id" FROM "Places" WHERE "Name" = 'Kyiv'`)).rows[0].Id;
        const dover = (await db.query<{ Id: number }>(`SELECT "Id" FROM "Places" WHERE "Name" = 'Dover'`)).rows[0].Id;
        const raw = (await db.query<Row>(`SELECT * FROM "People" WHERE "Id" = 1`)).rows[0];
        expect(raw).toMatchObject({ BirthPlaceId: lviv, BirthPlaceNameId: lemberg, DeathPlaceId: kyiv, DeathPlaceNameId: null });
        expect(await factPlaceText(executor, 'People', 1, 'BirthPlace')).toBe('Lemberg');
        expect(await factPlaceText(executor, 'People', 1, 'DeathPlace')).toBe('Kyiv');
        expect(await factPlaceText(executor, 'People', 2, 'BirthPlace')).toBe('Dover');
        expect((await db.query<Row>(`SELECT "BirthPlaceId" FROM "People" WHERE "Id" = 2`)).rows[0].BirthPlaceId).toBe(dover);
        expect(await factPlaceText(executor, 'Families', 1, 'MarriagePlace')).toBe('Lviv');
        expect((await db.query<Row>(`SELECT "PlaceId" FROM "Events" WHERE "Id" = 1`)).rows[0].PlaceId).toBeNull();
        expect((await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_people_user_birthplace'`)).rows).toHaveLength(0);

        // Later boots find nothing to do.
        await initializeSchema(executor);
        expect(await factPlaceText(executor, 'People', 1, 'BirthPlace')).toBe('Lemberg');
    });

    it('stops the upgrade, dropping nothing, when a fact has no place to point at', async () => {
        // No tree, so no place can be made for it.
        await db.query(`INSERT INTO "People" ("Id", "FirstName", "BirthPlace") VALUES (9, 'Orphan', 'Nowhere')`);

        await expect(initializeSchema(executor)).rejects.toThrow(/Place text kept.*1 "People"\."BirthPlace", ids 9\)/);
        expect(await columns(db, 'People')).toContain('BirthPlace');
        expect((await db.query<Row>(`SELECT "BirthPlace" FROM "People" WHERE "Id" = 9`)).rows[0].BirthPlace).toBe('Nowhere');

        // Once the fact is sorted out, the upgrade goes through.
        await db.query(`UPDATE "People" SET "UserId" = ${USER}, "TreeId" = ${TREE} WHERE "Id" = 9`);
        await initializeSchema(executor);
        expect(await hasFactPlaceText(executor)).toBe(false);
        expect(await factPlaceText(executor, 'People', 9, 'BirthPlace')).toBe('Nowhere');
    });

    it('finishes an upgrade that stopped part-way', async () => {
        // As a run outside a transaction could leave it: only the event text is left.
        await db.query(`ALTER TABLE "People" DROP COLUMN "BirthPlace", DROP COLUMN "DeathPlace"`);
        await db.query(`ALTER TABLE "Families" DROP COLUMN "MarriagePlace"`);
        await db.query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES (3, ${USER}, ${TREE}, 'Ivy')`);
        await db.query(`INSERT INTO "Events" ("Id", "UserId", "TreeId", "Type", "Place", "PersonId") VALUES (2, ${USER}, ${TREE}, 'RESI', 'Hythe', 3)`);

        expect(await hasFactPlaceText(executor)).toBe(true);
        await initializeSchema(executor);
        expect(await hasFactPlaceText(executor)).toBe(false);
        expect(await factPlaceText(executor, 'Events', 2, 'Place')).toBe('Hythe');
    });
});
