import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { auditCreate, auditCreateMany } from '@/lib/db/queries/audit-capture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The batched create audit (#1270) must write what `auditCreate` writes one
 * record at a time: the same rows, labels and snapshots, in the same order.
 */
describe('auditCreateMany (PGlite)', () => {
    let mdb: PGlite;
    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Arbor'), (2, 1, 'Other')`, []);
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    type Row = Record<string, unknown>;
    const person = async (first: string | null, last: string | null, treeId = 1) =>
        (await query(`INSERT INTO "People" ("UserId", "FirstName", "LastName", "TreeId") VALUES (1, $1, $2, $3) RETURNING *`, [first, last, treeId])).rows[0] as Row;
    const family = async (p1: unknown, p2: unknown) =>
        (await query(`INSERT INTO "Families" ("UserId", "Partner1Id", "Partner2Id", "TreeId") VALUES (1, $1, $2, 1) RETURNING *`, [p1, p2])).rows[0] as Row;
    const entries = async () =>
        (await query(`SELECT "TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes"
                        FROM "AuditLog" ORDER BY "Id"`, [])).rows as Row[];

    it('writes the same entries as auditCreate, in order', async () => {
        const aster = await person('Aster', 'Arbor');
        const birch = await person('Birch', null);
        const nameless = await person(null, null);
        const stranger = await person('Cedar', 'Elsewhere', 2);
        const records = [
            { entityType: 'person' as const, record: aster },
            { entityType: 'person' as const, record: birch },
            { entityType: 'person' as const, record: nameless },
            { entityType: 'family' as const, record: await family(aster.Id, birch.Id) },
            { entityType: 'family' as const, record: await family(null, birch.Id) },
            // No partners, a nameless partner, and one from another tree: the fallback labels.
            { entityType: 'family' as const, record: await family(null, null) },
            { entityType: 'family' as const, record: await family(nameless.Id, null) },
            { entityType: 'family' as const, record: await family(stranger.Id, null) },
        ];

        for (const { entityType, record } of records) await auditCreate(entityType, record, 1, 1);
        const oneByOne = await entries();
        await query('DELETE FROM "AuditLog"', []);

        await auditCreateMany(records, 1, 1);
        const batched = await entries();

        expect(batched).toEqual(oneByOne);
        expect(batched.map((e) => e.EntityLabel).slice(0, 5)).toEqual([
            'Aster Arbor', 'Birch', `Person #${nameless.Id}`, 'Aster Arbor & Birch', 'Birch',
        ]);
    });

    it('splits a large import across inserts and keeps every record', async () => {
        const records: { entityType: 'person'; record: Row }[] = [];
        for (let i = 0; i < 450; i++) {
            records.push({ entityType: 'person', record: { Id: i + 1, TreeId: 1, FirstName: `P${i}`, LastName: 'Arbor' } });
        }
        await auditCreateMany(records, 1, 1);
        const written = await entries();
        expect(written).toHaveLength(450);
        expect(written.map((e) => e.EntityId)).toEqual(records.map((r) => r.record.Id));
    });

    it('does nothing for an empty list', async () => {
        await auditCreateMany([], 1, 1);
        expect(await entries()).toHaveLength(0);
    });
});
