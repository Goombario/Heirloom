import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPerson, updatePerson, searchPeople } from '@/lib/db/queries/people';
import { createFamily } from '@/lib/db/queries/families';
import { createEvent, updateEvent } from '@/lib/db/queries/events';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { getTopPlacesByRecordCount } from '@/lib/db/queries/places';
import {
    getPlaceCoordsService, getPlaceDependentCountService, getPlaceDetailService, getPlacePinChainsService, listPlacesService,
    renamePlaceService, updatePlaceCoordinatesService, upsertPlaceGeocodeService, upsertPlaceHierarchyService,
} from '@/lib/services/places';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Facts point at their place by id (#1167, ADR 0031). A fact keeps its place as
 * recorded and links to the gazetteer place that string names, its own name or
 * another of its names, and every write keeps the link right.
 */

const USER_ID = 116711;

type Row = Record<string, unknown>;

describe('place ids (#1167)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

    const placeId = async (name: string): Promise<number | null> =>
        ((await query(`SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, name])).rows[0] as { Id: number } | undefined)?.Id ?? null;
    const person = async (id: number): Promise<Row> =>
        (await query(`SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."Id" = $1`, [id])).rows[0] as Row;
    const addPlace = async (name: string, extra: { parentId?: number; lat?: number } = {}) =>
        ((await query(
            `INSERT INTO "Places" ("UserId", "TreeId", "Name", "ParentId", "Latitude", "Longitude") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "Id"`,
            [USER_ID, treeId, name, extra.parentId ?? null, extra.lat ?? null, extra.lat == null ? null : 24],
        )).rows[0] as { Id: number }).Id;
    const addOtherName = (place: number, name: string) => query(
        `INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name", "Language", "ToDate") VALUES ($1, $2, $3, $4, 'de', '1918')`,
        [place, USER_ID, treeId, name],
    );
    const newPerson = async (first: string, birthPlace: string | null, deathPlace: string | null = null) =>
        (await createPerson({
            UserId: USER_ID, TreeId: treeId, FirstName: first, LastName: 'Test', Sex: 'F', GedcomId: null,
            BirthDate: null, BirthPlace: birthPlace, DeathDate: null, DeathPlace: deathPlace, IsDeceased: null,
        }, USER_ID));

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'place-ids@test.local', 'place-ids']);
        treeId = await resolveDefaultTree(USER_ID);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    beforeEach(async () => {
        for (const table of ['Events', 'Families', 'People', 'Places', 'AuditLog']) {
            await query(`DELETE FROM "${table}" WHERE "TreeId" = $1`, [treeId]);
        }
    });

    it('links a fact on create and on every place edit, and clears it with the place', async () => {
        const created = await newPerson('Ada', 'Dover, Kent');
        const dover = await placeId('Dover, Kent');
        expect(dover).not.toBeNull();
        expect(created.BirthPlaceId).toBe(dover);

        await updatePerson(created.Id, { BirthPlace: 'Canterbury' }, treeId, USER_ID);
        expect((await person(created.Id)).BirthPlaceId).toBe(await placeId('Canterbury'));

        await updatePerson(created.Id, { BirthPlace: null }, treeId, USER_ID);
        expect((await person(created.Id)).BirthPlaceId).toBeNull();

        const family = await createFamily({ UserId: USER_ID, TreeId: treeId, Partner1Id: created.Id, Partner2Id: null, MarriageDate: null, MarriagePlace: 'Dover, Kent' }, USER_ID);
        expect(family.MarriagePlaceId).toBe(dover);

        const event = await createEvent({ UserId: USER_ID, TreeId: treeId, Type: 'RESI', Date: null, Place: 'Margate', Description: null, PersonId: created.Id, FamilyId: null }, USER_ID);
        expect(event.PlaceId).toBe(await placeId('Margate'));
        const moved = await updateEvent(event.Id, { Place: 'Dover, Kent' }, treeId, USER_ID);
        expect(moved.PlaceId).toBe(dover);
    });

    it('relinks a fact when undo restores its old place', async () => {
        const created = await newPerson('Bea', 'Ramsgate');
        const edit = await updatePerson(created.Id, { BirthPlace: 'Deal' }, treeId, USER_ID);
        await revertAuditEntry(edit.auditIds[0], treeId, USER_ID, USER_ID);
        const after = await person(created.Id);
        expect(after.BirthPlace).toBe('Ramsgate');
        expect(after.BirthPlaceId).toBe(await placeId('Ramsgate'));
    });

    it('counts, lists and opens a place by the facts that point at it under any of its names', async () => {
        const ukraine = await addPlace('Ukraine');
        const lviv = await addPlace('Lviv', { parentId: ukraine, lat: 49.8 });
        await addOtherName(lviv, 'Lemberg');
        const born = await newPerson('Cora', 'Lemberg');
        await newPerson('Dot', 'Lviv');

        const detail = await getPlaceDetailService({ ...ctx(), name: 'Ukraine' });
        expect(detail.people.map((p) => p.FirstName).sort()).toEqual(['Cora', 'Dot']);
        // The fact still says where it was recorded.
        expect(detail.factLinks.find((l) => l.personId === born.Id)?.placeName).toBe('Lemberg');

        // A fact's string that is another name opens that place's page.
        const byOtherName = await getPlaceDetailService({ ...ctx(), name: 'Lemberg' });
        expect(byOtherName.name).toBe('Lviv');
        expect(byOtherName.id).toBe(lviv);

        const { places, gazetteer } = await listPlacesService(ctx());
        expect(places.find((p) => p.name === 'Lviv')).toMatchObject({ count: 2, otherNames: ['Lemberg'] });
        expect(places.some((p) => p.name === 'Lemberg')).toBe(false);
        expect(gazetteer.find((g) => g.id === lviv)?.otherNames).toEqual(['Lemberg']);

        const [top] = await getTopPlacesByRecordCount(treeId, 5);
        expect(top).toMatchObject({ place_name: 'Lviv', person_count: '2' });

        // Maps and pin chains resolve the recorded string to the place's pin.
        expect(await getPlaceCoordsService({ ...ctx(), names: ['Lemberg'] })).toEqual({ Lemberg: { lat: 49.8, lng: 24 } });
        const chains = await getPlacePinChainsService({ ...ctx(), names: ['Lemberg'] });
        expect(chains.Lemberg.map((r) => r.name)).toEqual(['Ukraine', 'Lviv']);
    });

    it('finds a person born under another name of the place searched for', async () => {
        const lviv = await addPlace('Lviv');
        await addOtherName(lviv, 'Lemberg');
        await newPerson('Edith', 'Lemberg');

        const found = await searchPeople('Lviv', treeId, 10, { places: true });
        expect(found.map((p) => p.FirstName)).toEqual(['Edith']);
        expect(await searchPeople('Lviv', treeId, 10)).toEqual([]);
    });

    it('geocodes the place itself when given another of its names', async () => {
        const lviv = await addPlace('Lviv');
        await addOtherName(lviv, 'Lemberg');
        await upsertPlaceGeocodeService({ ...ctx(), name: 'Lemberg', latitude: 49.84, longitude: 24.03, displayName: 'Lviv, Ukraine' });
        expect(await placeId('Lemberg')).toBeNull();
        const row = (await query(`SELECT "Latitude", "DisplayName" FROM "Places" WHERE "Id" = $1`, [lviv])).rows[0] as Row;
        expect(row).toEqual({ Latitude: 49.84, DisplayName: 'Lviv, Ukraine' });
    });

    it('a merge keeps the merged place\'s other names and relinks its facts; undo puts both back', async () => {
        const lwow = await addPlace('Lwów');
        await addOtherName(lwow, 'Lemberg');
        const lviv = await addPlace('Lviv');
        const recorded = await newPerson('Flo', 'Lemberg');
        const spelled = await newPerson('Gil', 'Lwów');

        const merged = await renamePlaceService({ ...ctx(), from: 'Lwów', to: 'Lviv' });
        expect(merged.wasMerge).toBe(true);
        expect(await person(recorded.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv });
        expect(await person(spelled.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv });
        const moved = (await query(`SELECT "PlaceId" FROM "PlaceName" WHERE "TreeId" = $1 AND "Name" = 'Lemberg'`, [treeId])).rows[0] as Row;
        expect(moved.PlaceId).toBe(lviv);

        await revertAuditEntry(merged.auditIds[0], treeId, USER_ID, USER_ID);
        expect(await placeId('Lwów')).toBe(lwow);
        expect(await person(recorded.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lwow });
        expect(await person(spelled.Id)).toMatchObject({ BirthPlace: 'Lwów', BirthPlaceId: lwow });
        const back = (await query(`SELECT "PlaceId" FROM "PlaceName" WHERE "TreeId" = $1 AND "Name" = 'Lemberg'`, [treeId])).rows[0] as Row;
        expect(back.PlaceId).toBe(lwow);
    });

    it('undoing a merge takes back every fact written under the names it moved, even one saved since', async () => {
        const lwow = await addPlace('Lwów');
        await addOtherName(lwow, 'Lemberg');
        const lviv = await addPlace('Lviv');
        const merged = await renamePlaceService({ ...ctx(), from: 'Lwów', to: 'Lviv' });
        const later = await newPerson('Una', 'Lemberg');
        expect(await person(later.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv });

        await revertAuditEntry(merged.auditIds[0], treeId, USER_ID, USER_ID);
        expect(await person(later.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lwow });
    });

    it('refuses a rename to another place\'s other name', async () => {
        const lviv = await addPlace('Lviv');
        await addOtherName(lviv, 'Lemberg');
        await newPerson('Hal', 'Leopolis');
        await expect(renamePlaceService({ ...ctx(), from: 'Leopolis', to: 'Lemberg' }))
            .rejects.toThrow('"Lemberg" is already another name of Lviv');
    });

    // ── #1186: the references are the truth, the text a copy ──────────────────
    const nameId = async (name: string): Promise<number> =>
        ((await query(`SELECT "Id" FROM "PlaceName" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, name])).rows[0] as { Id: number }).Id;

    it('a rename changes the place row and the facts that show its own name, not those under its other names; undo puts it back', async () => {
        const lviv = await addPlace('Lviv');
        await addOtherName(lviv, 'Lemberg');
        const own = await newPerson('Kit', 'Lviv');
        const other = await newPerson('Lou', 'Lemberg');
        const event = await createEvent({ UserId: USER_ID, TreeId: treeId, Type: 'RESI', Date: null, Place: 'Lviv', Description: null, PersonId: own.Id, FamilyId: null }, USER_ID);

        const renamed = await renamePlaceService({ ...ctx(), from: 'Lviv', to: 'Lwiw' });
        expect(renamed).toMatchObject({ wasMerge: false, renamed: 2 });
        expect(await placeId('Lwiw')).toBe(lviv);
        expect(await person(own.Id)).toMatchObject({ BirthPlace: 'Lwiw', BirthPlaceId: lviv, BirthPlaceNameId: null });
        expect(await person(other.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv, BirthPlaceNameId: await nameId('Lemberg') });
        const moved = (await query(`SELECT ${factPlaceTextColumns('events', 'e')}, e."PlaceId" FROM "Events" e WHERE e."Id" = $1`, [event.Id])).rows[0] as Row;
        expect(moved).toEqual({ Place: 'Lwiw', PlaceId: lviv });

        // A record added after the rename points at the same place, so undo renames it too.
        const later = await newPerson('Max', 'Lwiw');
        await revertAuditEntry(renamed.auditIds[0], treeId, USER_ID, USER_ID);
        expect(await placeId('Lviv')).toBe(lviv);
        expect(await placeId('Lwiw')).toBeNull();
        expect(await person(own.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv });
        expect(await person(later.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv });
        expect(await person(other.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv });
    });

    it('a merge moves facts with the name each was written under; undo moves back only those', async () => {
        const lwow = await addPlace('Lwów');
        await addOtherName(lwow, 'Lemberg');
        const lviv = await addPlace('Lviv');
        const recorded = await newPerson('Ned', 'Lemberg');
        const spelled = await newPerson('Oda', 'Lwów');
        const already = await newPerson('Pat', 'Lviv');

        const merged = await renamePlaceService({ ...ctx(), from: 'Lwów', to: 'Lviv' });
        expect(merged).toMatchObject({ wasMerge: true, renamed: 2 });
        expect(await person(recorded.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv, BirthPlaceNameId: await nameId('Lemberg') });
        expect(await person(spelled.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv, BirthPlaceNameId: null });

        const later = await newPerson('Quin', 'Lviv');
        await revertAuditEntry(merged.auditIds[0], treeId, USER_ID, USER_ID);
        expect(await person(recorded.Id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lwow, BirthPlaceNameId: await nameId('Lemberg') });
        expect(await person(spelled.Id)).toMatchObject({ BirthPlace: 'Lwów', BirthPlaceId: lwow });
        expect(await person(already.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv });
        expect(await person(later.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv });
    });

    it('undoes a rename logged before v62, which rewrote the text', async () => {
        const renamedRow = await addPlace('Lwiw');
        const rewritten = await newPerson('Rae', 'Lwiw');
        const entry = (await query(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $1, $2, 'update', 'place', $3, 'Renamed Lviv → Lwiw (1 record)', $4) RETURNING "Id"`,
            [USER_ID, treeId, renamedRow, JSON.stringify({ snapshot: { from: 'Lviv', to: 'Lwiw', wasMerge: false, affected: [{ kind: 'birth', recordId: rewritten.Id }] } })],
        )).rows[0] as { Id: number };
        await revertAuditEntry(entry.Id, treeId, USER_ID, USER_ID);
        expect(await placeId('Lviv')).toBe(renamedRow);
        expect(await person(rewritten.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: renamedRow, BirthPlaceNameId: null });
    });

    it('removing another name leaves its facts on the place, under its own name (ADR 0037)', async () => {
        const lviv = await addPlace('Lviv');
        await addOtherName(lviv, 'Lemberg');
        const recorded = await newPerson('Sid', 'Lemberg');
        await query(`DELETE FROM "PlaceName" WHERE "Id" = $1`, [await nameId('Lemberg')]);
        expect(await person(recorded.Id)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv, BirthPlaceNameId: null });
    });

    it('addresses a place by id for its page, lookups and edits (#1186)', async () => {
        const kent = await addPlace('Kent');
        const dover = await addPlace('Dover', { parentId: kent });
        await newPerson('Tess', 'Dover');

        expect(await getPlaceDetailService({ ...ctx(), id: dover })).toMatchObject({ id: dover, name: 'Dover' });
        expect(await getPlaceDependentCountService({ ...ctx(), placeId: kent })).toBe(1);

        await updatePlaceCoordinatesService({ ...ctx(), placeId: dover, latitude: 51.1, longitude: 1.3 });
        await upsertPlaceGeocodeService({ ...ctx(), placeId: kent, latitude: 51.2, longitude: 0.7, displayName: 'Kent, England' });
        const rows = (await query(`SELECT "Id", "Latitude", "DisplayName" FROM "Places" WHERE "TreeId" = $1 ORDER BY "Id"`, [treeId])).rows;
        expect(rows).toEqual([
            { Id: kent, Latitude: 51.2, DisplayName: 'Kent, England' },
            { Id: dover, Latitude: 51.1, DisplayName: null },
        ]);

        // Ids and names in one batch, each reported under its own key.
        expect(await getPlaceCoordsService({ ...ctx(), names: ['Kent'], ids: [dover] }))
            .toEqual({ Kent: { lat: 51.2, lng: 0.7 }, [`#${dover}`]: { lat: 51.1, lng: 1.3 } });
        const chains = await getPlacePinChainsService({ ...ctx(), ids: [dover] });
        expect(chains[`#${dover}`].map((r) => r.name)).toEqual(['Kent', 'Dover']);

        // The leaf of a re-match lands on the place by id, whatever the chain calls it.
        await upsertPlaceHierarchyService({
            ...ctx(), reparent: true, leafId: dover,
            levels: [{ name: 'England' }, { name: 'Kent' }, { name: 'Dover, Kent', latitude: 51.12, longitude: 1.31 }],
        });
        const leaf = (await query(`SELECT "Name", "Latitude", "ParentId" FROM "Places" WHERE "Id" = $1`, [dover])).rows[0] as Row;
        expect(leaf).toEqual({ Name: 'Dover', Latitude: 51.12, ParentId: kent });
        expect(await placeId('Dover, Kent')).toBeNull();

        const renamed = await renamePlaceService({ ...ctx(), fromId: dover, to: 'Dover, Kent' });
        expect(renamed).toMatchObject({ wasMerge: false, renamed: 1 });
        expect(await placeId('Dover, Kent')).toBe(dover);

        await expect(updatePlaceCoordinatesService({ ...ctx(), placeId: 999999, latitude: 1, longitude: 1 })).rejects.toThrow('Place not found');
        await expect(renamePlaceService({ ...ctx(), fromId: 999999, to: 'Nowhere' })).rejects.toThrow('Place not found');
    });

    it('a deleted place unlinks its facts without deleting them', async () => {
        const created = await newPerson('Ivy', 'Hythe');
        await query(`DELETE FROM "Places" WHERE "Id" = $1`, [await placeId('Hythe')]);
        expect(await person(created.Id)).toMatchObject({ FirstName: 'Ivy', BirthPlace: null, BirthPlaceId: null });
    });
});
