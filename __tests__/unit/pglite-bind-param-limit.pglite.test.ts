import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, getClient, __setTestDb, PGLITE_MAX_BIND_PARAMS } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { importGedcomService } from '@/lib/services/gedcom';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * PGlite 0.4 reads a bind message's parameter count as a signed 16-bit number.
 * At 32,768 parameters a statement doesn't fail: it desyncs the connection,
 * and every later query returns no rows. The import's place upsert chunked at
 * 60,000 parameters, so any file with more than 8,191 places wedged the
 * static build's database (#810, found on a 34,020-person FTM export).
 */
const OWNER = 810_101;

describe('PGlite bind-parameter ceiling', () => {
    let db: PGlite;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [OWNER, 'p@test.local', 'p']);
        await resolveDefaultTree(OWNER);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('refuses a statement over the ceiling instead of corrupting the connection', async () => {
        const params = Array.from({ length: PGLITE_MAX_BIND_PARAMS + 1 }, (_, i) => i);
        const sql = `SELECT ${params.map((_, i) => `$${i + 1}::int`).join(' + ')} AS n`;
        await expect(query(sql, params)).rejects.toThrow(/32768 parameters/);
        const client = await getClient();
        try {
            await expect(client.query(sql, params)).rejects.toThrow(/32768 parameters/);
        } finally {
            client.release();
        }
        expect((await query('SELECT 1 AS x')).rows).toEqual([{ x: 1 }]);
    });

    it('imports a file with more places than one upsert can carry, and the database still answers', async () => {
        const places = 9_000;
        const lines = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
        for (let i = 1; i <= places; i++) lines.push(`0 @I${i}@ INDI`, `1 NAME P${i} /Town/`, '1 BIRT', `2 PLAC Town ${i}, Shire`);
        lines.push('0 TRLR');

        await importGedcomService({ file: new File([lines.join('\n')], 'tree.ged'), mode: 'overwrite', currentUserId: OWNER });

        expect((await query('SELECT 1 AS x')).rows).toEqual([{ x: 1 }]);
        const stored = await query(`SELECT count(*)::int AS n FROM "Places" WHERE "Name" LIKE 'Town %'`);
        expect(stored.rows).toEqual([{ n: places }]);
    }, 120_000);
});
