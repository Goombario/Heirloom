import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { revertAuditEntries, revertAuditEntry } from '@/lib/db/queries/audit';
import {
    upsertPlaceGeocodeService, updatePlaceCoordinatesService, upsertPlaceHierarchyService,
} from '@/lib/services/places';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** Place geocode, coordinate and hierarchy edits are audited and revertable (#924). */

const USER_ID = 924924;

type Row = Record<string, unknown>;

describe('place edit audit (#924)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

    const place = async (name: string): Promise<Row | null> =>
        ((await query(`SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, name])).rows[0] as Row | undefined) ?? null;
    const placeEntries = async (): Promise<Row[]> =>
        (await query(`SELECT * FROM "AuditLog" WHERE "TreeId" = $1 AND "EntityType" = 'place' ORDER BY "Id"`, [treeId])).rows as Row[];
    const revert = (entry: Row) => revertAuditEntry(entry.Id as number, treeId, USER_ID, USER_ID);

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query(
            'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
            [USER_ID, 'place-audit@test.local', 'place-audit'],
        );
        treeId = await resolveDefaultTree(USER_ID);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('a first geocode writes one create entry, and revert removes the new row', async () => {
        await upsertPlaceGeocodeService({
            ...ctx(), name: 'Evenmere', latitude: 51.5, longitude: -0.1,
            displayName: 'Evenmere, Kent', osmType: 'relation', osmId: 42,
        });
        const entries = await placeEntries();
        expect(entries).toHaveLength(1);
        const [entry] = entries;
        expect(entry).toMatchObject({ Action: 'create', EntityLabel: 'Evenmere: geocoded', EntityId: (await place('Evenmere'))!.Id });
        expect((entry.Changes as Row).snapshot).toMatchObject({ Name: 'Evenmere', Coordinates: [51.5, -0.1], DisplayName: 'Evenmere, Kent' });

        await revert(entry);
        expect(await place('Evenmere')).toBeNull();
        const marker = (await placeEntries()).at(-1)!;
        expect(marker.EntityLabel).toBe('Reverted: Evenmere: geocoded');
        expect((marker.Changes as { snapshot: Row }).snapshot.revertOf).toBe(entry.Id);
    });

    it('a coordinate adjustment writes one update entry with readable fields, and revert restores the prior row', async () => {
        await upsertPlaceGeocodeService({
            ...ctx(), name: 'Dover', latitude: 51.12, longitude: 1.31,
            displayName: 'Dover, Kent', osmType: 'node', osmId: 7,
        });
        const before = await place('Dover');
        const count = (await placeEntries()).length;

        const { auditIds } = await updatePlaceCoordinatesService({ ...ctx(), name: 'Dover', latitude: 51.13, longitude: 1.32 });
        const entries = await placeEntries();
        expect(entries).toHaveLength(count + 1);
        const entry = entries.at(-1)!;
        // The write hands back its entry, so the place page can offer Undo (#56).
        expect(auditIds).toEqual([entry.Id]);
        expect(entry).toMatchObject({ Action: 'update', EntityLabel: 'Dover: coordinates set' });
        expect((entry.Changes as { fields: Row }).fields).toEqual({
            Coordinates: { old: [51.12, 1.31], new: [51.13, 1.32] },
        });

        await revert(entry);
        const after = await place('Dover');
        for (const f of ['Latitude', 'Longitude', 'DisplayName', 'OsmType', 'PinSuppressed', 'ParentId']) {
            expect(after![f]).toEqual(before![f]);
        }
        expect(String(after!.OsmId)).toBe(String(before!.OsmId));
    });

    it('hiding a pin is labelled and reverts to the shown pin', async () => {
        await upsertPlaceGeocodeService({ ...ctx(), name: 'Folkestone', latitude: 51.08, longitude: 1.17 });
        await upsertPlaceGeocodeService({ ...ctx(), name: 'Folkestone', latitude: null, longitude: null, pinSuppressed: true });
        const entry = (await placeEntries()).at(-1)!;
        expect(entry.EntityLabel).toBe('Folkestone: pin hidden');
        expect((entry.Changes as { fields: Row }).fields).toMatchObject({
            PinSuppressed: { old: false, new: true },
            Coordinates: { old: [51.08, 1.17], new: null },
        });

        await revert(entry);
        expect(await place('Folkestone')).toMatchObject({ Latitude: 51.08, Longitude: 1.17, PinSuppressed: false });
    });

    it('a write that changes nothing is not logged', async () => {
        await updatePlaceCoordinatesService({ ...ctx(), name: 'Hythe', latitude: 51.07, longitude: 1.08 });
        const count = (await placeEntries()).length;
        const again = await updatePlaceCoordinatesService({ ...ctx(), name: 'Hythe', latitude: 51.07, longitude: 1.08 });
        expect(await placeEntries()).toHaveLength(count);
        expect(again.auditIds).toEqual([]);
    });

    it('a hierarchy build writes one grouped entry, and revert removes created parents and unlinks the leaf', async () => {
        await updatePlaceCoordinatesService({ ...ctx(), name: 'Deal', latitude: 51.22, longitude: 1.4 });
        const leafBefore = await place('Deal');
        const count = (await placeEntries()).length;

        await upsertPlaceHierarchyService({
            ...ctx(),
            levels: [
                { name: 'United Kingdom' },
                { name: 'England' },
                { name: 'Kent' },
                { name: 'Deal', latitude: 51.223, longitude: 1.402, displayName: 'Deal, Kent', osmType: 'relation', osmId: 99 },
            ],
        });
        const entries = await placeEntries();
        expect(entries).toHaveLength(count + 1);
        const entry = entries.at(-1)!;
        expect(entry).toMatchObject({ Action: 'update', EntityLabel: 'Built jurisdiction chain for Deal: 4 places', EntityId: leafBefore!.Id });
        expect((entry.Changes as { fields: Row }).fields).toMatchObject({ PartOf: { old: null, new: 'Kent' } });
        expect((await place('Deal'))!.ParentId).toBe((await place('Kent'))!.Id);

        await revert(entry);
        for (const name of ['United Kingdom', 'England', 'Kent']) expect(await place(name)).toBeNull();
        expect(await place('Deal')).toMatchObject({ Latitude: 51.22, Longitude: 1.4, ParentId: null, DisplayName: null });
    });

    it('revert keeps a created parent that something else now points at, clearing what the edit set', async () => {
        await upsertPlaceHierarchyService({
            ...ctx(),
            levels: [{ name: 'Wales', latitude: 52.3, longitude: -3.7 }, { name: 'Cardiff', latitude: 51.48, longitude: -3.18 }],
        });
        const entry = (await placeEntries()).at(-1)!;
        const wales = await place('Wales');
        // A later, separate edit hangs another place under Wales.
        await query(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId") VALUES ($1, $2, 'Swansea', $3)`,
            [USER_ID, treeId, wales!.Id],
        );

        await revert(entry);
        expect(await place('Cardiff')).toBeNull();
        expect(await place('Wales')).toMatchObject({ Id: wales!.Id, Latitude: null, Longitude: null });
        expect((await place('Swansea'))!.ParentId).toBe(wales!.Id);
    });

    it('revert leaves a newer edit alone, and undoes in order when the newer one is reverted first', async () => {
        await updatePlaceCoordinatesService({ ...ctx(), name: 'Sandwich', latitude: 51.27, longitude: 1.34 });
        await updatePlaceCoordinatesService({ ...ctx(), name: 'Sandwich', latitude: 51.28, longitude: 1.35 });
        const older = (await placeEntries()).at(-1)!;
        await upsertPlaceGeocodeService({ ...ctx(), name: 'Sandwich', latitude: 51.29, longitude: 1.36, displayName: 'Sandwich, Kent' });
        const newer = (await placeEntries()).at(-1)!;

        await revert(older);
        expect(await place('Sandwich')).toMatchObject({ Latitude: 51.29, DisplayName: 'Sandwich, Kent' });

        await revertAuditEntries([older.Id as number, newer.Id as number], treeId, USER_ID, USER_ID);
        expect(await place('Sandwich')).toMatchObject({ Latitude: 51.27, Longitude: 1.34, DisplayName: null });
    });

    it('revert keeps a created row a later edit geocoded', async () => {
        await upsertPlaceHierarchyService({ ...ctx(), levels: [{ name: 'Essex' }, { name: 'Colchester' }] });
        const entry = (await placeEntries()).at(-1)!;
        await updatePlaceCoordinatesService({ ...ctx(), name: 'Essex', latitude: 51.77, longitude: 0.61 });

        await revert(entry);
        expect(await place('Colchester')).toBeNull();
        expect(await place('Essex')).toMatchObject({ Latitude: 51.77, Longitude: 0.61 });
    });

    it('revert does not restore a parent that has since moved under the place', async () => {
        await upsertPlaceHierarchyService({ ...ctx(), levels: [{ name: 'Old Surrey' }, { name: 'Guildford' }] });
        await upsertPlaceHierarchyService({ ...ctx(), reparent: true, levels: [{ name: 'Surrey' }, { name: 'Guildford' }] });
        const entry = (await placeEntries()).at(-1)!;
        const guildford = await place('Guildford');
        // Later, a direct edit files Old Surrey under Guildford.
        await query(`UPDATE "Places" SET "ParentId" = $1 WHERE "TreeId" = $2 AND "Name" = 'Old Surrey'`, [guildford!.Id, treeId]);

        await revert(entry);
        expect((await place('Guildford'))!.ParentId).toBeNull();
        expect((await place('Old Surrey'))!.ParentId).toBe(guildford!.Id);
    });

    it('a failed audit write rolls the place edit back', async () => {
        await query(`ALTER TABLE "AuditLog" ADD CONSTRAINT test_924 CHECK ("EntityLabel" <> 'Rye: geocoded')`, []);
        try {
            await expect(upsertPlaceGeocodeService({ ...ctx(), name: 'Rye', latitude: 50.95, longitude: 0.73 }))
                .rejects.toThrow();
        } finally {
            await query(`ALTER TABLE "AuditLog" DROP CONSTRAINT test_924`, []);
        }
        expect(await place('Rye')).toBeNull();
    });
});
