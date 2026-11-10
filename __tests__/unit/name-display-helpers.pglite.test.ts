import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { truncateAllTables } from '../setup/pglite-truncate';
import { primaryNickname, effectiveFirstName } from '@/lib/db/queries/people';

/**
 * `primaryNickname` / `effectiveFirstName` — the SQL fragments every person query
 * embeds to build display names.
 *
 * These went uncovered, and it cost: `primaryNickname` required `IsPrimary = 1`,
 * which nothing in the import path or the UI ever sets, so all 36 nickname variants
 * in the live database rendered as NULL and nicknames appeared to be missing from
 * the app entirely.
 */

let db: PGlite;

beforeAll(async () => {
    db = await newEmptyClusterDb();
    await initializeSchema(db as unknown as DbExecutor);
});

afterEach(async () => {
    await truncateAllTables(db);
});

async function addPerson(id: number, firstName: string) {
    await db.query(
        `INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES ($1, 1, 1, $2)`,
        [id, firstName],
    );
}

async function addVariant(
    id: number, personId: number, type: string, name: string, isPrimary = 0,
) {
    await db.query(
        `INSERT INTO "NameVariant" ("Id", "OwnerId", "TreeId", "PersonId", "Type", "Name", "IsPrimary")
         VALUES ($1, 1, 1, $2, $3, $4, $5)`,
        [id, personId, type, name, isPrimary],
    );
}

async function nicknameOf(personId: number): Promise<string | null> {
    const res = await db.query<{ nick: string | null }>(
        `SELECT ${primaryNickname('p')} AS nick FROM "People" p WHERE p."Id" = $1`,
        [personId],
    );
    return res.rows[0].nick;
}

describe('primaryNickname', () => {
    it('falls back to the earliest Nickname variant when none is primary', async () => {
        await addPerson(1, 'Cecilia');
        await addVariant(10, 1, 'Nickname', 'Cece');
        await addVariant(11, 1, 'Nickname', 'Ceci');

        expect(await nicknameOf(1)).toBe('Cece');
    });

    it('prefers an explicitly primary nickname over the earliest', async () => {
        await addPerson(1, 'Cecilia');
        await addVariant(10, 1, 'Nickname', 'Cece');
        await addVariant(11, 1, 'Nickname', 'Ceci', 1);

        expect(await nicknameOf(1)).toBe('Ceci');
    });

    it('ignores variants that are not nicknames', async () => {
        await addPerson(1, 'Cecilia');
        await addVariant(10, 1, 'Alias', 'Cissy');
        await addVariant(11, 1, 'Maiden', 'Rose');

        expect(await nicknameOf(1)).toBeNull();
    });

    it('returns null when the person has no variants', async () => {
        await addPerson(1, 'Cecilia');

        expect(await nicknameOf(1)).toBeNull();
    });

    it('does not leak another person\'s nickname', async () => {
        await addPerson(1, 'Cecilia');
        await addPerson(2, 'Arthur');
        await addVariant(10, 2, 'Nickname', 'Art');

        expect(await nicknameOf(1)).toBeNull();
    });
});

describe('effectiveFirstName', () => {
    // Deliberately NOT given primaryNickname's fallback. It keys off IsPrimary for
    // ANY variant type and means "use this variant as the first name" — a different
    // question. Keeping them independent stops a displayed nickname from silently
    // replacing the first name in every name join.
    it('ignores a non-primary nickname', async () => {
        await addPerson(1, 'Cecilia');
        await addVariant(10, 1, 'Nickname', 'Cece');

        const res = await db.query<{ fn: string | null }>(
            `SELECT ${effectiveFirstName('p')} AS fn FROM "People" p WHERE p."Id" = 1`,
        );
        expect(res.rows[0].fn).toBe('Cecilia');
    });

    it('uses a primary variant of any type as the first name', async () => {
        await addPerson(1, 'Cecilia');
        await addVariant(10, 1, 'Given', 'Cecelia', 1);

        const res = await db.query<{ fn: string | null }>(
            `SELECT ${effectiveFirstName('p')} AS fn FROM "People" p WHERE p."Id" = 1`,
        );
        expect(res.rows[0].fn).toBe('Cecelia');
    });
});
