import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { readBundle } from '../setup/gedcom-bundle';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { initializeSchema } from '@/lib/db/init-schema';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPerson } from '@/lib/db/queries/people';
import { createEvent } from '@/lib/db/queries/events';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { getPlaceCoordsService, getPlaceDetailService, listPlacesService, movePlaceRecordsService, renamePlaceService } from '@/lib/services/places';
import { createPersonService, updatePersonService } from '@/lib/services/people';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';
import { createEventService } from '@/lib/services/events';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Two places may share a name (#1186, ADR 0036): "Paris" in France and "Paris" in
 * Ontario. Records point at one by id; a typed name links to the place of that
 * name most records use; and a bundle keeps each record on its own place.
 */

const USER_ID = 118636;

type Row = Record<string, unknown>;

describe('places that share a name (#1186)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

    const addPlace = async (name: string, extra: { parentId?: number; lat?: number; lng?: number } = {}) =>
        ((await query(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId", "Latitude", "Longitude") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "Id"`,
            [USER_ID, treeId, name, extra.parentId ?? null, extra.lat ?? null, extra.lng ?? null],
        )).rows[0] as { Id: number }).Id;
    const newPerson = async (first: string, birthPlace: string | null) =>
        (await createPerson({
            UserId: USER_ID, TreeId: treeId, FirstName: first, LastName: 'Test', Sex: 'F', GedcomId: null,
            BirthDate: '1900', BirthPlace: birthPlace, DeathDate: null, DeathPlace: null, IsDeceased: null,
        }, USER_ID));
    const bornAt = async (personId: number, placeId: number) =>
        query(`UPDATE "People" SET "BirthPlaceId" = $2 WHERE "Id" = $1`, [personId, placeId]);
    const person = async (id: number): Promise<Row> =>
        (await query(`SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."Id" = $1`, [id])).rows[0] as Row;
    const personNamed = async (first: string): Promise<Row> =>
        (await query(`SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."TreeId" = $1 AND p."FirstName" = $2`, [treeId, first])).rows[0] as Row;
    const placeOf = async (id: unknown): Promise<Row> =>
        (await query(`SELECT * FROM "Places" WHERE "Id" = $1`, [id])).rows[0] as Row;
    const parisRows = async () =>
        (await query(`SELECT * FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Paris' ORDER BY "Id"`, [treeId])).rows as Row[];

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'shared-names@test.local', 'shared-names']);
        treeId = await resolveDefaultTree(USER_ID);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    beforeEach(async () => {
        for (const table of ['Events', 'Families', 'People', 'PlaceName', 'Places', 'AuditLog']) {
            await query(`DELETE FROM "${table}" WHERE "TreeId" = $1`, [treeId]);
        }
    });

    it('links a typed name to the place of that name most records use', async () => {
        const france = await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        const ontario = await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        // A tie goes to the older place.
        expect((await person((await newPerson('A', 'Paris')).Id)).BirthPlaceId).toBe(france);

        for (const first of ['B', 'C']) await bornAt((await newPerson(first, 'Paris')).Id, ontario);
        expect((await person((await newPerson('D', 'Paris')).Id)).BirthPlaceId).toBe(ontario);
    });

    it('points a fact at the place a form picked, and ignores a pick that does not fit', async () => {
        const france = await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        const ontario = await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        const lyon = await addPlace('Lyon');
        const created = await createPersonService({
            ...ctx(), body: { FirstName: 'Picked', BirthPlace: 'Paris', BirthPlaceId: ontario },
        });
        expect((await person(created.Id)).BirthPlaceId).toBe(ontario);

        // A pick whose name is not the text keeps the text's place.
        await updatePersonService({ ...ctx(), id: created.Id, body: { BirthPlace: 'Paris', BirthPlaceId: lyon } });
        expect((await person(created.Id)).BirthPlaceId).toBe(ontario);
        // Retyping the same text without a pick keeps the picked place.
        await updatePersonService({ ...ctx(), id: created.Id, body: { BirthPlace: 'Paris' } });
        expect((await person(created.Id)).BirthPlaceId).toBe(ontario);
        await updatePersonService({ ...ctx(), id: created.Id, body: { BirthPlaceId: france } });
        expect((await person(created.Id)).BirthPlaceId).toBe(france);

        const event = await createEventService({
            ...ctx(), body: { Type: 'RESI', Place: 'Paris', PlaceId: ontario, PersonId: created.Id },
        });
        expect(((await query(`SELECT "PlaceId" FROM "Events" WHERE "Id" = $1`, [event.Id])).rows[0] as Row).PlaceId).toBe(ontario);
        await expect(updatePersonService({ ...ctx(), id: created.Id, body: { BirthPlaceId: 'x' } })).rejects.toThrow(/place id/);
    });

    it('keeps two places of one name apart on every boot', async () => {
        await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        await initializeSchema({ query });
        await initializeSchema({ query });
        expect(await parisRows()).toHaveLength(2);
    });

    it('reports coordinates and list rows per place, not per name', async () => {
        const france = await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        const ontario = await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        await bornAt((await newPerson('A', 'Paris')).Id, france);
        await bornAt((await newPerson('B', 'Paris')).Id, ontario);

        const coords = await getPlaceCoordsService({ ...ctx(), ids: [france, ontario] });
        expect(coords[`#${france}`]).toEqual({ lat: 48.85, lng: 2.35 });
        expect(coords[`#${ontario}`]).toEqual({ lat: 43.2, lng: -80.38 });

        const { places } = await listPlacesService({ ...ctx() });
        const paris = places.filter((p) => p.name === 'Paris');
        expect(paris.map((p) => [p.id, p.count, p.peopleCount]).sort()).toEqual([[france, 1, 1], [ontario, 1, 1]].sort());
    });

    it('renames one of two same-name places by id, and undoes it', async () => {
        const france = await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        const ontario = await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        const a = (await newPerson('A', 'Paris')).Id;
        const b = (await newPerson('B', 'Paris')).Id;
        await bornAt(a, france);
        await bornAt(b, ontario);

        const renamed = await renamePlaceService({ ...ctx(), fromId: ontario, to: 'Paris, Ontario' });
        expect((await person(a)).BirthPlace).toBe('Paris');
        expect((await person(b))).toMatchObject({ BirthPlace: 'Paris, Ontario', BirthPlaceId: ontario });

        await revertAuditEntry(renamed.auditIds[0], treeId, USER_ID, USER_ID);
        expect(await parisRows()).toHaveLength(2);
        expect((await person(a))).toMatchObject({ BirthPlace: 'Paris', BirthPlaceId: france });
        expect((await person(b))).toMatchObject({ BirthPlace: 'Paris', BirthPlaceId: ontario });
    });

    it('moves chosen records to the other place of a name, keeps them there, and undoes it', async () => {
        const france = await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        const ontario = await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(async (first) => (await newPerson(first, 'Paris')).Id));
        for (const id of [a, b, c]) expect((await person(id)).BirthPlaceId).toBe(france);
        const event = await createEvent({ UserId: USER_ID, TreeId: treeId, PersonId: c, FamilyId: null, Type: 'RESI', Date: '1920', Place: 'Paris', Description: null });

        // The detail page says which record and place each fact is.
        const detail = await getPlaceDetailService({ ...ctx(), id: france });
        expect(detail.factLinks).toEqual(expect.arrayContaining([
            expect.objectContaining({ personId: b, kind: 'birth', recordId: b, placeId: france }),
            expect.objectContaining({ personId: c, kind: 'event', recordId: event.Id, placeId: france }),
        ]));

        const moved = await movePlaceRecordsService({
            ...ctx(), fromId: france, toId: ontario,
            records: [{ kind: 'birth', recordId: b }, { kind: 'event', recordId: event.Id }],
        });
        expect(moved.moved).toBe(2);
        expect(await person(a)).toMatchObject({ BirthPlace: 'Paris', BirthPlaceId: france });
        expect(await person(b)).toMatchObject({ BirthPlace: 'Paris', BirthPlaceId: ontario });
        const eventRow = async () => (await query(`SELECT * FROM "Events" WHERE "Id" = $1`, [event.Id])).rows[0] as Row;
        expect((await eventRow()).PlaceId).toBe(ontario);

        expect((await person(b)).BirthPlaceId).toBe(ontario);

        const [entry] = (await query(`SELECT * FROM "AuditLog" WHERE "Id" = $1`, [moved.auditIds[0]])).rows as Row[];
        expect(entry).toMatchObject({ EntityType: 'place', EntityId: ontario, Action: 'update' });
        await revertAuditEntry(moved.auditIds[0], treeId, USER_ID, USER_ID);
        expect((await person(b)).BirthPlaceId).toBe(france);
        expect((await eventRow()).PlaceId).toBe(france);
        expect(await parisRows()).toHaveLength(2);
    });

    it('folds a duplicate into its twin: every record moves, the shown name follows the place', async () => {
        const lviv = await addPlace('Lviv');
        const lvov = await addPlace('Lvov');
        await query(`INSERT INTO "PlaceName" ("UserId", "TreeId", "PlaceId", "Name") VALUES ($1, $2, $3, 'Lemberg')`, [USER_ID, treeId, lvov]);
        await query(`INSERT INTO "PlaceName" ("UserId", "TreeId", "PlaceId", "Name") VALUES ($1, $2, $3, 'Lemberg 2')`, [USER_ID, treeId, lviv]);
        const own = (await newPerson('Own', 'Lvov')).Id;
        const other = (await newPerson('Other', 'Lemberg')).Id;
        expect((await person(other)).BirthPlaceId).toBe(lvov);
        expect((await person(other)).BirthPlaceNameId).not.toBeNull();

        const moved = await movePlaceRecordsService({ ...ctx(), fromId: lvov, toId: lviv });
        expect(moved.moved).toBe(2);
        expect(await person(own)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv, BirthPlaceNameId: null });
        expect(await person(other)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv, BirthPlaceNameId: null });
        expect(await placeOf(lvov)).toMatchObject({ Name: 'Lvov' });

        // Undo brings back the other name each record showed.
        await revertAuditEntry(moved.auditIds[0], treeId, USER_ID, USER_ID);
        expect(await person(own)).toMatchObject({ BirthPlace: 'Lvov', BirthPlaceId: lvov });
        expect(await person(other)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lvov });
    });

    it("refuses a move to the same place, to a place it can't find, or of no records", async () => {
        const france = await addPlace('Paris');
        const ontario = await addPlace('Paris');
        await newPerson('A', 'Paris');
        await expect(movePlaceRecordsService({ ...ctx(), fromId: france, toId: france })).rejects.toThrow(/another place/);
        await expect(movePlaceRecordsService({ ...ctx(), fromId: france, toId: 999999 })).rejects.toThrow(/not found/i);
        await expect(movePlaceRecordsService({ ...ctx(), fromId: ontario, toId: france })).rejects.toThrow(/None of those records/);
        await expect(movePlaceRecordsService({ ...ctx(), fromId: france, toId: ontario, records: [{ kind: 'burial', recordId: 1 }] })).rejects.toThrow(/kind/);
        expect(await query(`SELECT 1 FROM "AuditLog" WHERE "TreeId" = $1 AND "EntityType" = 'place'`, [treeId])).toMatchObject({ rows: [] });

        // Undo has nowhere to go once the place the records came from is gone.
        const moved = await movePlaceRecordsService({ ...ctx(), fromId: france, toId: ontario });
        await query(`DELETE FROM "Places" WHERE "Id" = $1`, [france]);
        await expect(revertAuditEntry(moved.auditIds[0], treeId, USER_ID, USER_ID)).rejects.toThrow(/no longer exists/);
    });

    it('keeps each record on its own place through a bundle round trip', async () => {
        const fr = await addPlace('France', { lat: 46.6, lng: 2.2 });
        const on = await addPlace('Ontario', { lat: 50, lng: -85 });
        const france = await addPlace('Paris', { parentId: fr, lat: 48.85, lng: 2.35 });
        const ontario = await addPlace('Paris', { parentId: on, lat: 43.2, lng: -80.38 });
        const a = (await newPerson('Amelie', 'Paris')).Id;
        const b = (await newPerson('Bryce', 'Paris')).Id;
        const c = (await newPerson('Cora', 'Paris')).Id;
        await bornAt(a, france);
        await bornAt(b, ontario);
        await bornAt(c, ontario);
        const resi = await createEvent({ UserId: USER_ID, TreeId: treeId, Type: 'RESI', Date: '1920', Place: 'Paris', Description: null, PersonId: a, FamilyId: null });
        await query(`UPDATE "Events" SET "PlaceId" = $2 WHERE "Id" = $1`, [resi.Id, france]);

        const { exportGedcomService } = await import('@/lib/services/gedcom-export');
        const { importGedcomService } = await import('@/lib/services/gedcom');
        const exported = await exportGedcomService({ ...ctx(), includeMedia: true });
        if (exported.kind !== 'zip') throw new Error('expected a zip bundle');
        const bundle = await readBundle(exported.buffer);
        const facts = (bundle.places as { facts?: unknown[] }).facts ?? [];
        expect(facts).toHaveLength(4);

        const result = await importGedcomService({
            file: new File([bundle.ged], 'family_tree.ged', { type: 'text/plain' }),
            mode: 'overwrite',
            casesJson: JSON.stringify(bundle.cases),
            mediaJson: JSON.stringify(bundle.media),
            sourcesJson: JSON.stringify(bundle.sources),
            placesJson: JSON.stringify(bundle.places),
            currentUserId: USER_ID,
            requestedTreeId: treeId,
        });
        expect(result.warnings.map((w) => w.code)).not.toContain('places_shared_name');

        const rows = await parisRows();
        expect(rows).toHaveLength(2);
        const coordsOf = async (first: string) => {
            const place = await placeOf((await personNamed(first)).BirthPlaceId);
            const parent = await placeOf(place.ParentId);
            return [place.Latitude, parent.Name];
        };
        expect(await coordsOf('Amelie')).toEqual([48.85, 'France']);
        expect(await coordsOf('Bryce')).toEqual([43.2, 'Ontario']);
        expect(await coordsOf('Cora')).toEqual([43.2, 'Ontario']);
        const event = (await query(
            `SELECT e."PlaceId" FROM "Events" e JOIN "People" p ON p."Id" = e."PersonId" WHERE p."FirstName" = 'Amelie'`,
        )).rows[0] as { PlaceId: number };
        expect((await placeOf(event.PlaceId)).Latitude).toBe(48.85);

        // The user moves Bryce to the French Paris and corrects that pin a little.
        const parisFrance = (await personNamed('Amelie')).BirthPlaceId;
        await query(`UPDATE "People" SET "BirthPlaceId" = $2 WHERE "Id" = $1`, [(await personNamed('Bryce')).Id, parisFrance]);
        await query(`UPDATE "Places" SET "Latitude" = 48.8566 WHERE "Id" = $1`, [parisFrance]);

        // Merging the same bundle again matches each entry to its place, and leaves
        // the records it matched where the user put them.
        await importGedcomService({
            file: new File([bundle.ged], 'family_tree.ged', { type: 'text/plain' }),
            mode: 'merge',
            placesJson: JSON.stringify(bundle.places),
            currentUserId: USER_ID,
            requestedTreeId: treeId,
        });
        expect(await parisRows()).toHaveLength(2);
        expect(await coordsOf('Amelie')).toEqual([48.8566, 'France']);
        expect(await coordsOf('Bryce')).toEqual([48.8566, 'France']);
        expect(await coordsOf('Cora')).toEqual([43.2, 'Ontario']);
    });

    it('lists the records a plain .ged links to the most-used of two same-name places', async () => {
        const france = await addPlace('Paris', { lat: 48.85, lng: 2.35 });
        await addPlace('Paris', { lat: 43.2, lng: -80.38 });
        await bornAt((await newPerson('Amelie', 'Paris')).Id, france);

        const { importGedcomService } = await import('@/lib/services/gedcom');
        const ged = [
            '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
            '0 @I900@ INDI', '1 NAME Zed /Stranger/', '1 BIRT', '2 DATE 1901', '2 PLAC Paris',
            '0 TRLR', '',
        ].join('\n');
        const result = await importGedcomService({
            file: new File([ged], 'other.ged', { type: 'text/plain' }),
            mode: 'merge',
            currentUserId: USER_ID,
            requestedTreeId: treeId,
        });

        expect((await personNamed('Zed')).BirthPlaceId).toBe(france);
        expect(result.warnings).toContainEqual({
            code: 'places_shared_name',
            values: { count: 1, places: 'Paris', people: 'Zed Stranger', more: 0 },
        });
        expect(await parisRows()).toHaveLength(2);
    });
});
