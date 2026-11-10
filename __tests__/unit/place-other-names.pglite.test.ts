import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPerson } from '@/lib/db/queries/people';
import { revertAuditEntry } from '@/lib/db/queries/audit';
import { getPlaceDetailService, renamePlaceService, savePlaceNamesService } from '@/lib/services/places';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';
import type { PlaceOtherNameDraft } from '@/lib/data/types';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * A place's other names (#1185): the editor saves the whole list as one undoable
 * change, a name that records use is never silently dropped from them, and a
 * rename can keep the old name as another one.
 */

const USER_ID = 118511;

type Row = Record<string, unknown>;

describe('place other names (#1185)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

    const placeId = async (name: string): Promise<number | null> =>
        ((await query(`SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2 ORDER BY "Id"`, [treeId, name])).rows[0] as { Id: number } | undefined)?.Id ?? null;
    const person = async (id: number): Promise<Row> =>
        (await query(`SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."Id" = $1`, [id])).rows[0] as Row;
    const addPlace = async (name: string) =>
        ((await query(`INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES ($1, $2, $3) RETURNING "Id"`, [USER_ID, treeId, name])).rows[0] as { Id: number }).Id;
    const addOtherName = async (place: number, name: string, language: string | null = null) =>
        ((await query(
            `INSERT INTO "PlaceName" ("PlaceId", "UserId", "TreeId", "Name", "Language") VALUES ($1, $2, $3, $4, $5) RETURNING "Id"`,
            [place, USER_ID, treeId, name, language],
        )).rows[0] as { Id: number }).Id;
    const names = async (place: number) =>
        (await query(`SELECT "Id", "Name", "Language", "FromDate", "ToDate" FROM "PlaceName" WHERE "PlaceId" = $1 ORDER BY "Name"`, [place])).rows as Row[];
    const born = async (first: string, place: string) =>
        (await createPerson({
            UserId: USER_ID, TreeId: treeId, FirstName: first, LastName: 'Test', Sex: 'F', GedcomId: null,
            BirthDate: null, BirthPlace: place, DeathDate: null, DeathPlace: null, IsDeceased: null,
        }, USER_ID)).Id;
    const save = (place: number, list: PlaceOtherNameDraft[]) => savePlaceNamesService({ placeId: place, names: list, ...ctx() });
    const draft = (name: string, extra: Partial<PlaceOtherNameDraft> = {}): PlaceOtherNameDraft =>
        ({ name, language: null, fromDate: null, toDate: null, ...extra });
    const revert = (id: number) => revertAuditEntry(id, treeId, USER_ID, USER_ID);

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'other-names@test.local', 'other-names']);
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

    it('adds, changes and removes names in one undoable save, and the page counts their records', async () => {
        const lviv = await addPlace('Lviv');
        const lemberg = await addOtherName(lviv, 'Lemberg');
        const leopolis = await addOtherName(lviv, 'Leopolis', 'Latin');
        const anna = await born('Anna', 'Lemberg');
        await born('Ivan', 'Lviv');

        let detail = await getPlaceDetailService({ id: lviv, ...ctx() });
        expect(detail.otherNames).toEqual([
            { id: lemberg, name: 'Lemberg', language: null, fromDate: null, toDate: null, records: 1 },
            { id: leopolis, name: 'Leopolis', language: 'Latin', fromDate: null, toDate: null, records: 0 },
        ]);
        expect(detail.ownNameRecords).toBe(1);

        const saved = await save(lviv, [
            draft('Lemberg', { id: lemberg, language: 'German', toDate: '1918' }),
            draft('Lwów', { language: 'Polish', fromDate: '1918', toDate: '1939' }),
        ]);
        expect(saved).toMatchObject({ added: 1, changed: 1, removed: 1 });
        expect(saved.auditIds).toHaveLength(1);
        expect((await names(lviv)).map((n) => [n.Name, n.Language, n.FromDate, n.ToDate])).toEqual([
            ['Lemberg', 'German', null, '1918'],
            ['Lwów', 'Polish', '1918', '1939'],
        ]);
        expect((await person(anna)).BirthPlace).toBe('Lemberg');

        await revert(saved.auditIds[0]);
        detail = await getPlaceDetailService({ id: lviv, ...ctx() });
        expect(detail.otherNames?.map((n) => [n.id, n.name, n.language])).toEqual([[lemberg, 'Lemberg', null], [leopolis, 'Leopolis', 'Latin']]);
    });

    it('saving the list unchanged writes nothing', async () => {
        const lviv = await addPlace('Lviv');
        const lemberg = await addOtherName(lviv, 'Lemberg');
        const saved = await save(lviv, [draft('Lemberg', { id: lemberg })]);
        expect(saved).toMatchObject({ added: 0, changed: 0, removed: 0, auditIds: [] });
    });

    it('a removed name its records use becomes a separate place they keep, and undo brings them back', async () => {
        const lviv = await addPlace('Lviv');
        const lemberg = await addOtherName(lviv, 'Lemberg');
        const anna = await born('Anna', 'Lemberg');
        const jan = await born('Jan', 'Lemberg');

        const saved = await save(lviv, []);
        expect(saved.removed).toBe(1);
        const split = await placeId('Lemberg');
        expect(split).not.toBeNull();
        expect(await person(anna)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: split, BirthPlaceNameId: null });
        expect(await person(jan)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: split });
        // A record saved there since goes back with them.
        const olga = await born('Olga', 'Lemberg');
        expect((await person(olga)).BirthPlaceId).toBe(split);

        await revert(saved.auditIds[0]);
        expect(await placeId('Lemberg')).toBeNull();
        for (const id of [anna, jan, olga]) {
            expect(await person(id)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv, BirthPlaceNameId: lemberg });
        }
    });

    it('a renamed spelling leaves its records their own, while a case fix carries them', async () => {
        const lviv = await addPlace('Lviv');
        const lemberg = await addOtherName(lviv, 'Lemberg');
        const lwow = await addOtherName(lviv, 'lwów');
        const anna = await born('Anna', 'Lemberg');
        const stefan = await born('Stefan', 'lwów');

        const saved = await save(lviv, [draft('Lemburg', { id: lemberg }), draft('Lwów', { id: lwow })]);
        expect(saved.changed).toBe(2);
        expect(await person(anna)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: await placeId('Lemberg') });
        expect(await person(stefan)).toMatchObject({ BirthPlace: 'Lwów', BirthPlaceId: lviv, BirthPlaceNameId: lwow });

        await revert(saved.auditIds[0]);
        expect(await person(anna)).toMatchObject({ BirthPlace: 'Lemberg', BirthPlaceId: lviv, BirthPlaceNameId: lemberg });
        expect(await person(stefan)).toMatchObject({ BirthPlace: 'lwów' });
    });

    it('refuses a name that is the place’s own, a repeat, another place’s name or another place', async () => {
        const lviv = await addPlace('Lviv');
        const lemberg = await addOtherName(lviv, 'Lemberg');
        const krakow = await addPlace('Kraków');
        await addOtherName(krakow, 'Krakau');
        await born('Piotr', 'Lwow');
        await addPlace('Ukraine');

        await expect(save(lviv, [draft('lviv')])).rejects.toThrow('That is this place’s own name.');
        await expect(save(lviv, [draft('Lemberg', { id: lemberg }), draft('lemberg')])).rejects.toThrow('Lviv already has the name Lemberg.');
        await expect(save(lviv, [draft('krakau')])).rejects.toThrow('Krakau is already another name of Kraków. A name can belong to one place only.');
        await expect(save(lviv, [draft('Lwow')])).rejects.toThrow(/Lwow is its own place, with 1 record\. To make it a name of Lviv, merge Lwow into Lviv/);
        await expect(save(lviv, [draft('Ukraine')])).rejects.toThrow('Ukraine is another place in this tree with no records of its own, so it can’t become a name of Lviv.');
        await expect(save(lviv, [draft('Kyiv', { id: 999999 })])).rejects.toThrow(/no other name with id/);
        expect((await names(lviv)).map((n) => n.Name)).toEqual(['Lemberg']);
    });

    it('keeps a name removed and typed again, and won’t give a leaving spelling to another name', async () => {
        const lviv = await addPlace('Lviv');
        const lemberg = await addOtherName(lviv, 'Lemberg');
        const anna = await born('Anna', 'Lemberg');
        const saved = await save(lviv, [draft('Lemberg', { language: 'German' })]);
        expect(saved).toMatchObject({ added: 0, changed: 1, removed: 0 });
        expect(await person(anna)).toMatchObject({ BirthPlaceId: lviv, BirthPlaceNameId: lemberg });

        await expect(save(lviv, [draft('Lemburg', { id: lemberg }), draft('Lemberg')])).rejects.toThrow('Lviv already has the name Lemberg.');
    });

    it('won’t undo adding a name that records have used since', async () => {
        const lviv = await addPlace('Lviv');
        const saved = await save(lviv, [draft('Lemberg')]);
        await born('Anna', 'Lemberg');
        await expect(revert(saved.auditIds[0])).rejects.toThrow(/1 record now use Lemberg/);
        expect((await names(lviv)).map((n) => n.Name)).toEqual(['Lemberg']);
    });

    it('won’t undo a removal once the split-off place has a pin of its own', async () => {
        const lviv = await addPlace('Lviv');
        await addOtherName(lviv, 'Lemberg');
        await born('Anna', 'Lemberg');
        const saved = await save(lviv, []);
        await query(`UPDATE "Places" SET "Latitude" = 49.8, "Longitude" = 24 WHERE "Name" = 'Lemberg'`, []);
        await expect(revert(saved.auditIds[0])).rejects.toThrow(/edited as a place of its own/);
        expect(await names(lviv)).toEqual([]);
    });

    describe('rename keeping the old name', () => {
        it('keeps a renamed place’s old name on its records, and undo takes it back', async () => {
            const lviv = await addPlace('Lviv');
            const ivan = await born('Ivan', 'Lviv');
            const renamed = await renamePlaceService({ fromId: lviv, to: 'Lvov', keepOldName: true, ...ctx() });
            const [kept] = await names(lviv);
            expect(kept).toMatchObject({ Name: 'Lviv' });
            expect(await person(ivan)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv, BirthPlaceNameId: kept.Id });

            await revert(renamed.auditIds[0]);
            expect(await names(lviv)).toEqual([]);
            expect(await person(ivan)).toMatchObject({ BirthPlace: 'Lviv', BirthPlaceId: lviv, BirthPlaceNameId: null });
            expect(await placeId('Lviv')).toBe(lviv);
        });

        it('without it, the records say the new name', async () => {
            const lviv = await addPlace('Lviv');
            const ivan = await born('Ivan', 'Lviv');
            await renamePlaceService({ fromId: lviv, to: 'Lvov', ...ctx() });
            expect(await names(lviv)).toEqual([]);
            expect((await person(ivan)).BirthPlace).toBe('Lvov');
        });

        it('keeps a merged place’s name on the place it merged into', async () => {
            const lwow = await addPlace('Lwow');
            const piotr = await born('Piotr', 'Lwow');
            const lviv = await addPlace('Lviv');
            const merged = await renamePlaceService({ fromId: lwow, to: 'Lviv', keepOldName: true, ...ctx() });
            expect(merged.wasMerge).toBe(true);
            const [kept] = await names(lviv);
            expect(await person(piotr)).toMatchObject({ BirthPlace: 'Lwow', BirthPlaceId: lviv, BirthPlaceNameId: kept.Id });
            // A record saved under the kept name after the merge goes back with the place.
            const olga = await born('Olga', 'Lwow');
            expect((await person(olga)).BirthPlaceId).toBe(lviv);

            await revert(merged.auditIds[0]);
            expect(await names(lviv)).toEqual([]);
            for (const id of [piotr, olga]) {
                expect(await person(id)).toMatchObject({ BirthPlace: 'Lwow', BirthPlaceId: lwow, BirthPlaceNameId: null });
            }
        });

        it('can rename onto another place’s name and keep the two apart', async () => {
            const paris = await addPlace('Paris');
            await born('Ann', 'Paris');
            const parisTx = await addPlace('Paris, TX');
            const result = await renamePlaceService({ fromId: parisTx, to: 'Paris', separate: true, ...ctx() });
            expect(result.wasMerge).toBe(false);
            const rows = (await query(`SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Paris' ORDER BY "Id"`, [treeId])).rows as { Id: number }[];
            expect(rows.map((r) => r.Id)).toEqual([paris, parisTx]);
        });
    });
});
