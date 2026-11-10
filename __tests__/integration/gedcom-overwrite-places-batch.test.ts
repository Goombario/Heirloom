import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { getPlaces } from '@/lib/db/queries/places';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

const PLACES_USER = 987662;

function gedFile(text: string): File {
    return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

// Two people whose birthplaces SHARE parent segments ("Massachusetts, USA",
// "USA") and one of which carries PLAC.MAP coordinates. This exercises the two
// risk areas of batching the post-commit Places upserts: (1) a multi-row
// ON CONFLICT DO UPDATE must NOT see the same (TreeId,Name) twice — the shared
// parents must be deduped within the batch; (2) coordinates must still land.
const GEDCOM = `0 HEAD
1 PLAC
2 FORM City, County, State, Country
0 @I1@ INDI
1 NAME Alpha /Root/
1 BIRT
2 PLAC Boston, Suffolk, Massachusetts, USA
3 MAP
4 LATI N42.36
4 LONG W71.06
0 @I2@ INDI
1 NAME Beta /Root/
1 BIRT
2 PLAC Cambridge, Middlesex, Massachusetts, USA
0 TRLR`;

d('overwrite import batches Places without losing hierarchy/forms/coords', () => {
    let treeId: number;

    beforeEach(async () => {
        await query(
            `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)
             ON CONFLICT ("Id") DO NOTHING`,
            [PLACES_USER, `places-batch-${PLACES_USER}@example.com`, `places-batch-${PLACES_USER}`]
        );
        treeId = await resolveDefaultTree(PLACES_USER);
    });

    afterEach(async () => {
        await query('DELETE FROM "Places" WHERE "UserId" = $1', [PLACES_USER]);
        await query('DELETE FROM "People" WHERE "UserId" = $1', [PLACES_USER]);
        await query('DELETE FROM "Users" WHERE "Id" = $1', [PLACES_USER]);
    });

    it('creates one row per distinct segment, wires parents, keeps forms + coordinates', async () => {
        await importGedcomService({ file: gedFile(GEDCOM), mode: 'overwrite', currentUserId: PLACES_USER });

        const places = await getPlaces(treeId);
        const byName = new Map(places.map((p) => [p.Name, p]));

        // Every distinct segment exists exactly once (shared parents not duplicated).
        const expected = [
            'Boston, Suffolk, Massachusetts, USA',
            'Suffolk, Massachusetts, USA',
            'Cambridge, Middlesex, Massachusetts, USA',
            'Middlesex, Massachusetts, USA',
            'Massachusetts, USA',
            'USA',
        ];
        for (const name of expected) expect(byName.has(name)).toBe(true);
        // No duplicate rows for the shared parents.
        expect(places.filter((p) => p.Name === 'Massachusetts, USA')).toHaveLength(1);
        expect(places.filter((p) => p.Name === 'USA')).toHaveLength(1);

        // Leaf form recorded.
        expect(byName.get('Boston, Suffolk, Massachusetts, USA')!.Form).toBe('City, County, State, Country');

        // Hierarchy: each leaf → its immediate parent; shared grandparent is one node.
        expect(byName.get('Boston, Suffolk, Massachusetts, USA')!.ParentId)
            .toBe(byName.get('Suffolk, Massachusetts, USA')!.Id);
        expect(byName.get('Cambridge, Middlesex, Massachusetts, USA')!.ParentId)
            .toBe(byName.get('Middlesex, Massachusetts, USA')!.Id);
        expect(byName.get('Suffolk, Massachusetts, USA')!.ParentId)
            .toBe(byName.get('Massachusetts, USA')!.Id);
        expect(byName.get('Middlesex, Massachusetts, USA')!.ParentId)
            .toBe(byName.get('Massachusetts, USA')!.Id);
        expect(byName.get('Massachusetts, USA')!.ParentId).toBe(byName.get('USA')!.Id);

        // Coordinates landed on the coord'd leaf only.
        const boston = byName.get('Boston, Suffolk, Massachusetts, USA')!;
        expect(Number(boston.Latitude)).toBeCloseTo(42.36, 1);
        expect(Number(boston.Longitude)).toBeCloseTo(-71.06, 1);
        expect(byName.get('Cambridge, Middlesex, Massachusetts, USA')!.Latitude).toBeNull();
    });
});
