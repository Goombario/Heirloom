import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { createPersonService, updatePersonService } from '@/lib/services/people';
import { updateFamilyService } from '@/lib/services/families';
import { updateEventService } from '@/lib/services/events';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { upsertPlaceGeocodeService } from '@/lib/services/places';
import { normalizeNameText } from '@/lib/validation';
import { factPlaceColumnFor, factPlaceTextSql, type FactPlaceField } from '@/lib/db/queries/place-links';

const placeText = (field: FactPlaceField, alias: string) => factPlaceTextSql(factPlaceColumnFor(field), alias);

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** Write-time validation gaps from the data audit (#884). */

const USER_ID = 884884;
const LONG = 'A'.repeat(600);
const ged = (text: string) => new File([text], 'tree.ged', { type: 'text/plain' });

describe('normalizeNameText (#884)', () => {
    it('composes to NFC and drops invisible characters', () => {
        expect(normalizeNameText('José')).toBe('José');
        expect(normalizeNameText('Jo​sé')).toBe('José');
        expect(normalizeNameText('Jo‍sé﻿')).toBe('José');
        expect(normalizeNameText('‮Ann')).toBe('Ann');
    });

    it('turns control characters into spaces and trims', () => {
        expect(normalizeNameText('  Ann\nLee\t ')).toBe('Ann Lee');
    });

    it('keeps joiners that shape Persian text or emoji', () => {
        expect(normalizeNameText('می‌خواهم')).toBe('می‌خواهم');
        expect(normalizeNameText('👨‍👩‍👧')).toBe('👨‍👩‍👧');
    });
});

describe('write validation (#884)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query(
            'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
            [USER_ID, 'write-validation@test.local', 'write-validation'],
        );
        treeId = await resolveDefaultTree(USER_ID);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('refuses a whitespace-only name on create', async () => {
        await expect(createPersonService({ ...ctx(), body: { FirstName: ' ​ ', LastName: '\t' } }))
            .rejects.toThrow(/FirstName or LastName is required/);
    });

    it('refuses an update that would leave a person with no name, but allows clearing one of the two', async () => {
        const p = await createPersonService({ ...ctx(), body: { FirstName: 'Ann', LastName: 'Lee' } });
        await expect(updatePersonService({ ...ctx(), id: p.Id, body: { FirstName: '', LastName: null } }))
            .rejects.toThrow(/FirstName or LastName is required/);
        await expect(updatePersonService({ ...ctx(), id: p.Id, body: { LastName: '  ' } }))
            .resolves.toMatchObject({ FirstName: 'Ann', LastName: null });
        await expect(updatePersonService({ ...ctx(), id: p.Id, body: { FirstName: ' ' } }))
            .rejects.toThrow(/FirstName or LastName is required/);
    });

    it('stores names and places in NFC with no zero-width characters, from the API and from import', async () => {
        const p = await createPersonService({
            ...ctx(), body: { FirstName: 'José', LastName: 'Gar​cía', BirthPlace: ' Montréal‍ ' },
        });
        expect(p).toMatchObject({ FirstName: 'José', LastName: 'García', BirthPlace: 'Montréal' });

        await importGedcomService({
            file: ged(['0 HEAD', '0 @I1@ INDI', '1 NAME José /Gar​cía/', '1 BIRT', '2 PLAC Montréal', '0 TRLR'].join('\n')),
            mode: 'merge', currentUserId: USER_ID,
        });
        const rows = await query(
            `SELECT p."FirstName", p."LastName", ${placeText('BirthPlace', 'p')} AS "BirthPlace" FROM "People" p WHERE p."TreeId" = $1 AND p."LastName" = 'García'`,
            [treeId],
        );
        expect(rows.rows).toContainEqual({ FirstName: 'José', LastName: 'García', BirthPlace: 'Montréal' });
        expect(rows.rows.every((r) => /^[\p{L} ]+$/u.test(`${r.FirstName}${r.LastName}${r.BirthPlace}`))).toBe(true);
    });

    it('lets an edit resend an imported value longer than the API cap, but not change it to another', async () => {
        await importGedcomService({
            file: ged([
                '0 HEAD',
                '0 @I1@ INDI', `1 NAME ${LONG} /Long/`, '1 BIRT', `2 PLAC ${LONG}`, '1 OCCU Smith', `2 PLAC ${LONG}`,
                '0 @I2@ INDI', '1 NAME Bea /Long/',
                '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', `2 PLAC ${LONG}`,
                '0 TRLR',
            ].join('\n')),
            mode: 'merge', currentUserId: USER_ID,
        });
        const person = (await query(`SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = $2`, [treeId, LONG])).rows[0];
        const family = (await query(`SELECT f."Id" FROM "Families" f WHERE f."TreeId" = $1 AND ${placeText('MarriagePlace', 'f')} = $2`, [treeId, LONG])).rows[0];
        const event = (await query(`SELECT e."Id" FROM "Events" e WHERE e."TreeId" = $1 AND e."Type" = 'OCCU' AND ${placeText('Place', 'e')} = $2`, [treeId, LONG])).rows[0];
        expect(person && family && event).toBeTruthy();

        // The UI's person form sends every field back, changed or not.
        await expect(updatePersonService({
            ...ctx(), id: person.Id, body: { FirstName: LONG, LastName: 'Long', BirthPlace: LONG, Sex: 'm' },
        })).resolves.toMatchObject({ FirstName: LONG, BirthPlace: LONG, Sex: 'M' });
        await expect(updatePersonService({ ...ctx(), id: person.Id, body: { FirstName: `${LONG}B` } }))
            .rejects.toThrow(/FirstName must be 200 characters or fewer/);

        await expect(updateFamilyService({ ...ctx(), id: family.Id, body: { MarriagePlace: LONG } }))
            .resolves.toMatchObject({ MarriagePlace: LONG });
        await expect(updateFamilyService({ ...ctx(), id: family.Id, body: { MarriagePlace: `${LONG}B` } }))
            .rejects.toThrow(/MarriagePlace must be 500 characters or fewer/);

        await expect(updateEventService({ ...ctx(), eventId: event.Id, body: { Place: LONG } }))
            .resolves.toMatchObject({ Place: LONG });
    });

    it('accepts only M, F, U and X for Sex', async () => {
        await expect(createPersonService({ ...ctx(), body: { FirstName: 'Sam', Sex: 'x' } }))
            .resolves.toMatchObject({ Sex: 'X' });
        await expect(createPersonService({ ...ctx(), body: { FirstName: 'Sam', Sex: 'Male' } }))
            .rejects.toThrow(/Sex must be one of M, F, U, X/);
        const p = await createPersonService({ ...ctx(), body: { FirstName: 'Sam', Sex: 'U' } });
        await expect(updatePersonService({ ...ctx(), id: p.Id, body: { Sex: 'unknown' } }))
            .rejects.toThrow(/Sex must be one of/);
    });

    it('refuses a non-numeric or out-of-range coordinate before it reaches SQL (#867)', async () => {
        for (const latitude of ['abc', Number.NaN, 91] as unknown as number[]) {
            await expect(upsertPlaceGeocodeService({ ...ctx(), name: 'Dover', latitude, longitude: 1 }))
                .rejects.toThrow(/latitude out of range/);
        }
        await expect(upsertPlaceGeocodeService({ ...ctx(), name: 'Dover', latitude: 51.1, longitude: '1' as unknown as number }))
            .rejects.toThrow(/longitude out of range/);
    });

    it('ignores a client-sent GedcomId on create and update', async () => {
        const p = await createPersonService({ ...ctx(), body: { FirstName: 'Gid', GedcomId: '@I1@' } });
        expect(p.GedcomId).toBeNull();
        const updated = await updatePersonService({ ...ctx(), id: p.Id, body: { FirstName: 'Gid', GedcomId: '@I1@' } });
        expect(updated.GedcomId).toBeNull();
    });
});
