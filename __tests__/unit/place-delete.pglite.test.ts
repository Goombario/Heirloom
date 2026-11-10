import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPerson } from '@/lib/db/queries/people';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { deletePlaceService, getPlaceDetailService } from '@/lib/services/places';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Deleting a place (#1229) is for a place nothing uses: no records, no places
 * within it, no notes or photos. It is one audit entry, and reverting it brings
 * the place back under its id with its other names.
 */

const OWNER_ID = 122901;
const CONTRIBUTOR_ID = 122902;

type Row = Record<string, unknown>;

describe('deleting an unused place (#1229)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = (currentUserId = OWNER_ID) => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId });

    const addPlace = async (name: string, parentId: number | null = null) =>
        ((await query(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId", "Latitude", "Longitude") VALUES ($1, $2, $3, $4, 50.45, 30.52) RETURNING "Id"`,
            [OWNER_ID, treeId, name, parentId],
        )).rows[0] as { Id: number }).Id;
    const placeRow = async (id: number): Promise<Row | undefined> =>
        (await query(`SELECT * FROM "Places" WHERE "Id" = $1`, [id])).rows[0] as Row | undefined;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3), ($4, $5, $6)',
            [OWNER_ID, 'place-delete@test.local', 'place-delete', CONTRIBUTOR_ID, 'place-delete-2@test.local', 'place-delete-2']);
        treeId = await resolveDefaultTree(OWNER_ID);
        await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, 'contribute', $3)`,
            [OWNER_ID, CONTRIBUTOR_ID, treeId]);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    beforeEach(async () => {
        for (const table of ['People', 'PlaceName', 'Places', 'AuditLog']) {
            await query(`DELETE FROM "${table}" WHERE "TreeId" = $1`, [treeId]);
        }
    });

    it('deletes it with its other names, and a revert brings both back under the same id', async () => {
        const region = await addPlace('Galicia');
        const lviv = await addPlace('Lviv', region);
        await query(`INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name", "Language") VALUES ($1, $2, $3, 'Lemberg', 'de')`, [lviv, OWNER_ID, treeId]);

        expect((await getPlaceDetailService({ id: lviv, ...ctx() })).uses).toEqual({ records: 0, places: 0, notes: 0, media: 0 });
        const { auditIds } = await deletePlaceService({ placeId: lviv, ...ctx() });
        expect(await placeRow(lviv)).toBeUndefined();
        expect((await query(`SELECT 1 FROM "PlaceName" WHERE "TreeId" = $1`, [treeId])).rows).toHaveLength(0);

        const entry = (await query(`SELECT * FROM "AuditLog" WHERE "Id" = $1`, [auditIds[0]])).rows[0] as Row;
        expect(entry).toMatchObject({ Action: 'delete', EntityType: 'place', EntityId: lviv, EntityLabel: 'Lviv', UserId: OWNER_ID });

        await revertAuditEntry(auditIds[0], treeId, OWNER_ID, OWNER_ID);
        expect(await placeRow(lviv)).toMatchObject({ Name: 'Lviv', ParentId: region, Latitude: 50.45 });
        const names = (await query(`SELECT "Name", "Language" FROM "PlaceName" WHERE "PlaceId" = $1`, [lviv])).rows;
        expect(names).toEqual([{ Name: 'Lemberg', Language: 'de' }]);
        // A second revert is a no-op.
        await revertAuditEntry(auditIds[0], treeId, OWNER_ID, OWNER_ID);
        expect((await query(`SELECT 1 FROM "Places" WHERE "Id" = $1`, [lviv])).rows).toHaveLength(1);
    });

    it('refuses a place in use, and says what uses it', async () => {
        const region = await addPlace('Galicia');
        const lviv = await addPlace('Lviv', region);
        const person = await createPerson({
            UserId: OWNER_ID, TreeId: treeId, FirstName: 'Ola', LastName: 'Test', Sex: 'F', GedcomId: null,
            BirthDate: '1900', BirthPlace: 'Lviv', DeathDate: null, DeathPlace: null, IsDeceased: null,
        }, OWNER_ID);
        expect((await query(`SELECT "BirthPlaceId" FROM "People" WHERE "Id" = $1`, [person.Id])).rows[0]).toEqual({ BirthPlaceId: lviv });

        expect((await getPlaceDetailService({ id: lviv, ...ctx() })).uses).toMatchObject({ records: 1, places: 0 });
        expect((await getPlaceDetailService({ id: region, ...ctx() })).uses).toMatchObject({ records: 0, places: 1 });
        await expect(deletePlaceService({ placeId: lviv, ...ctx() })).rejects.toThrow(/still in use/);
        await expect(deletePlaceService({ placeId: region, ...ctx() })).rejects.toThrow(/still in use/);
        expect(await placeRow(lviv)).toBeDefined();
        expect(await placeRow(region)).toBeDefined();
    });

    it('refuses a contributor, as other deletes do', async () => {
        const lviv = await addPlace('Lviv');
        await expect(deletePlaceService({ placeId: lviv, ...ctx(CONTRIBUTOR_ID) })).rejects.toThrow(/permission/);
        expect(await placeRow(lviv)).toBeDefined();
    });

    it('comes back at the top level when its parent is gone, and not over a name taken since', async () => {
        const region = await addPlace('Galicia');
        const lviv = await addPlace('Lviv', region);
        await query(`INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name") VALUES ($1, $2, $3, 'Lemberg')`, [lviv, OWNER_ID, treeId]);
        const { auditIds } = await deletePlaceService({ placeId: lviv, ...ctx() });

        const other = await addPlace('Lemberg');
        await expect(revertAuditEntry(auditIds[0], treeId, OWNER_ID, OWNER_ID)).rejects.toThrow(/another place/);
        expect(await placeRow(lviv)).toBeUndefined();

        await query(`DELETE FROM "Places" WHERE "Id" = ANY($1)`, [[other, region]]);
        await revertAuditEntry(auditIds[0], treeId, OWNER_ID, OWNER_ID);
        expect(await placeRow(lviv)).toMatchObject({ Name: 'Lviv', ParentId: null });
    });
});
