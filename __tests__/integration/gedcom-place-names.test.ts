import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { factPlaceColumnFor, factPlaceTextSql } from '@/lib/db/queries/place-links';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
const NAMES_USER = 116700;

const GED = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Anna /Recorded/',
    '1 BIRT',
    '2 DATE 1890',
    '2 PLAC Lemberg',
    '0 @I2@ INDI',
    '1 NAME Ivan /Modern/',
    '1 BIRT',
    '2 DATE 1990',
    '2 PLAC Lviv',
    '0 TRLR',
].join('\n');

const PLACES_JSON = JSON.stringify({
    version: 1,
    places: [{ name: 'Lviv', latitude: 49.84, longitude: 24.03, names: [{ name: 'Lemberg', language: 'de', toDate: '1918' }] }],
});

/**
 * A place's other names ride in places.json, never the .ged (#1167, ADR 0031): the
 * .ged keeps each fact's place as recorded, and the import points a fact recorded
 * under another name at its place instead of minting a second one.
 */
d('place other names through import and export (#1167)', () => {
    let treeId: number;

    beforeEach(async () => {
        await query(
            `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING`,
            [NAMES_USER, `names-${NAMES_USER}@example.com`, `names-${NAMES_USER}`],
        );
        treeId = await resolveDefaultTree(NAMES_USER);
        await importGedcomService({
            file: new File([GED], 'family_tree.ged', { type: 'text/plain' }),
            mode: 'overwrite',
            placesJson: PLACES_JSON,
            currentUserId: NAMES_USER,
            requestedTreeId: treeId,
        });
    });

    afterEach(async () => {
        await query('DELETE FROM "AuditLog" WHERE "TreeOwnerId" = $1', [NAMES_USER]);
        await query('DELETE FROM "People" WHERE "UserId" = $1', [NAMES_USER]);
        await query('DELETE FROM "Places" WHERE "UserId" = $1', [NAMES_USER]);
        await query('DELETE FROM "Users" WHERE "Id" = $1', [NAMES_USER]);
    });

    it('links a fact recorded under another name to the place, with no place of its own', async () => {
        const places = await query(`SELECT "Id", "Name" FROM "Places" WHERE "TreeId" = $1 ORDER BY "Name"`, [treeId]);
        expect((places.rows as { Name: string }[]).map((r) => r.Name)).toEqual(['Lviv']);
        const lviv = (places.rows[0] as { Id: number }).Id;

        const names = await query(`SELECT "PlaceId", "Name", "Language", "FromDate", "ToDate" FROM "PlaceName" WHERE "TreeId" = $1`, [treeId]);
        expect(names.rows).toEqual([{ PlaceId: lviv, Name: 'Lemberg', Language: 'de', FromDate: null, ToDate: '1918' }]);

        const people = await query(`SELECT p."LastName", ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'p')} AS "BirthPlace", p."BirthPlaceId" FROM "People" p WHERE p."TreeId" = $1 ORDER BY p."LastName"`, [treeId]);
        expect(people.rows).toEqual([
            { LastName: 'Modern', BirthPlace: 'Lviv', BirthPlaceId: lviv },
            { LastName: 'Recorded', BirthPlace: 'Lemberg', BirthPlaceId: lviv },
        ]);
    });

    it('exports the place as recorded in the .ged and its other names in places.json', async () => {
        const result = await exportGedcomService({
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: NAMES_USER, includeMedia: true,
        });
        if (result.kind !== 'zip') throw new Error(`expected a zip bundle, got ${result.kind}`);
        const zip = await JSZip.loadAsync(result.buffer);
        const ged = await zip.file(/\.ged$/)[0].async('string');
        expect(ged).toContain('2 PLAC Lemberg');
        expect(ged).toContain('2 PLAC Lviv');
        expect(ged).not.toMatch(/TRAN|_LOC/);
        const sidecar = JSON.parse(await zip.file('places.json')!.async('string'));
        expect(sidecar.places).toEqual([expect.objectContaining({
            name: 'Lviv',
            names: [{ name: 'Lemberg', language: 'de', fromDate: null, toDate: '1918' }],
        })]);
    });
});
