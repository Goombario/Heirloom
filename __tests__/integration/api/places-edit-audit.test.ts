import { describe, it, expect, afterEach } from 'vitest';
import { POST as GEOCODE } from '@/app/api/places/geocode/route';
import { POST as COORDINATES } from '@/app/api/places/coordinates/route';
import { POST as HIERARCHY } from '@/app/api/places/geocode-hierarchy/route';
import { POST as REVERT } from '@/app/api/audit/revert/route';
import { createRequest, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const describeIf = hasTestDatabase() ? describe : describe.skip;

type Row = Record<string, unknown>;

/** The hosted path audits place geocode, coordinate and hierarchy edits (#924). */
describeIf('place edit audit through the API (#924)', () => {
    afterEach(async () => {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        await query(`DELETE FROM "Places" WHERE "TreeId" = $1`, [treeId]);
        await cleanupTestData();
    });

    const post = (route: (req: never) => Promise<Response>, path: string, body: unknown) =>
        route(createRequest(`http://localhost:3000${path}`, { method: 'POST', body }) as never);
    const placeEntries = async (): Promise<Row[]> => {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        return (await query(`SELECT * FROM "AuditLog" WHERE "TreeId" = $1 AND "EntityType" = 'place' ORDER BY "Id"`, [treeId])).rows as Row[];
    };
    const place = async (name: string): Promise<Row | null> => {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        return ((await query(`SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, name])).rows[0] as Row | undefined) ?? null;
    };

    it('geocode, coordinate adjustment and hierarchy each write one entry, and each reverts', async () => {
        expect((await post(GEOCODE, '/api/places/geocode', {
            name: 'Evenmere', latitude: 51.5, longitude: -0.1, displayName: 'Evenmere, Kent', osmType: 'relation', osmId: 42,
        })).status).toBe(200);
        expect((await post(COORDINATES, '/api/places/coordinates', { name: 'Evenmere', latitude: 51.51, longitude: -0.11 })).status).toBe(200);
        expect((await post(HIERARCHY, '/api/places/geocode-hierarchy', {
            levels: [{ name: 'Kent' }, { name: 'Evenmere', latitude: 51.52, longitude: -0.12 }],
        })).status).toBe(200);

        const entries = await placeEntries();
        expect(entries.map((e) => e.EntityLabel)).toEqual([
            'Evenmere: geocoded',
            'Evenmere: coordinates set',
            'Built jurisdiction chain for Evenmere: 2 places',
        ]);

        // One bulk revert; the server applies them newest first.
        const res = await post(REVERT, '/api/audit/revert', { ids: entries.map((e) => e.Id) });
        expect(res.status).toBe(200);
        expect(await place('Kent')).toBeNull();
        expect(await place('Evenmere')).toBeNull();
    });
});
