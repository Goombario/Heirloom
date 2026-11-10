import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { getPlaceFactLinks } from '@/lib/db/queries/places';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { insertRecord } from '../setup/fact-places';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
const LINKS_USER = 987663;
const PLACE = 'Paris, Ontario';

/**
 * People linked to a place used to cover births and deaths only, so someone who
 * married there, or lived there for forty years, simply did not appear on the
 * place's page. These assert the widened linkage: every fact type whose place
 * matches, one row per fact, each carrying its own reason.
 */
d('getPlaceFactLinks — every fact type that names a place', () => {
    let treeId: number;

    beforeEach(async () => {
        await query(
            `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)
             ON CONFLICT ("Id") DO NOTHING`,
            [LINKS_USER, `place-links-${LINKS_USER}@example.com`, `place-links-${LINKS_USER}`],
        );
        treeId = await resolveDefaultTree(LINKS_USER);
    });

    afterEach(async () => {
        await query('DELETE FROM "MediaTag" WHERE "MediaId" IN (SELECT "Id" FROM "Media" WHERE "UserId" = $1)', [LINKS_USER]);
        await query('DELETE FROM "Media" WHERE "UserId" = $1', [LINKS_USER]);
        await query('DELETE FROM "Events" WHERE "UserId" = $1', [LINKS_USER]);
        await query('DELETE FROM "Families" WHERE "UserId" = $1', [LINKS_USER]);
        await query('DELETE FROM "People" WHERE "UserId" = $1', [LINKS_USER]);
        await query('DELETE FROM "Places" WHERE "UserId" = $1', [LINKS_USER]);
        await query('DELETE FROM "Users" WHERE "Id" = $1', [LINKS_USER]);
    });

    async function linksFor(name: string) {
        const ids = await query(`SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = $2`, [treeId, name]);
        return getPlaceFactLinks((ids.rows as { Id: number }[]).map((r) => r.Id), treeId);
    }

    async function makePerson(first: string, opts: { birthPlace?: string; birthDate?: string; deathPlace?: string; deathDate?: string } = {}) {
        const row = await insertRecord({ query }, 'People', {
            UserId: LINKS_USER, TreeId: treeId, FirstName: first, LastName: 'Tester', Sex: 'F',
            BirthPlace: opts.birthPlace ?? null, BirthDate: opts.birthDate ?? null, DeathPlace: opts.deathPlace ?? null, DeathDate: opts.deathDate ?? null,
        });
        return row.Id;
    }

    it('links a person by birth, marriage, and a residence event', async () => {
        const personId = await makePerson('Ada', { birthPlace: PLACE, birthDate: '1887' });
        const spouseId = await makePerson('Bea');
        await insertRecord({ query }, 'Families', { UserId: LINKS_USER, TreeId: treeId, Partner1Id: personId, Partner2Id: spouseId, MarriageDate: '1910', MarriagePlace: PLACE });
        await insertRecord({ query }, 'Events', { UserId: LINKS_USER, TreeId: treeId, PersonId: personId, Type: 'RESI', Date: '1920', Place: PLACE });

        const links = await linksFor(PLACE);
        const ada = links.filter((l) => l.personId === personId);

        expect(ada.map((l) => l.kind).sort()).toEqual(['birth', 'event', 'marriage']);
        expect(ada.find((l) => l.kind === 'event')?.eventType).toBe('RESI');
        expect(ada.find((l) => l.kind === 'birth')?.date).toBe('1887');
        expect(ada.find((l) => l.kind === 'marriage')?.date).toBe('1910');
    });

    it('returns one row per fact, so a person born and died there appears twice', async () => {
        const personId = await makePerson('Cora', { birthPlace: PLACE, birthDate: '1850', deathPlace: PLACE, deathDate: '1921' });

        const links = await linksFor(PLACE);

        expect(links.filter((l) => l.personId === personId).map((l) => l.kind).sort()).toEqual(['birth', 'death']);
    });

    it('names each person the way the rest of the app does', async () => {
        const personId = await makePerson('Dot', { birthPlace: PLACE });
        await query(
            `INSERT INTO "NameVariant" ("OwnerId", "PersonId", "TreeId", "Name", "Type", "IsPrimary")
             VALUES ($1, $2, $3, 'Dorothy', 'Birth', 1)`,
            [LINKS_USER, personId, treeId],
        );

        const links = await linksFor(PLACE);

        expect(links.find((l) => l.personId === personId)?.name).toBe('Dorothy Tester');
    });

    it('ignores facts in another tree', async () => {
        const otherTree = await query(
            `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Other') RETURNING "Id"`,
            [LINKS_USER],
        );
        const otherTreeId = otherTree.rows[0].Id as number;
        await insertRecord({ query }, 'People', { UserId: LINKS_USER, TreeId: otherTreeId, FirstName: 'Elsewhere', LastName: 'Tester', BirthPlace: PLACE });

        const links = await linksFor(PLACE);

        expect(links.some((l) => l.name.startsWith('Elsewhere'))).toBe(false);
    });

    it('returns an empty list for a place nobody references', async () => {
        expect(await linksFor('Nowhere')).toEqual([]);
    });

    /**
     * The avatars on the explore panel and the place page are focal-cropped by
     * `ProfileImage`, but this query used to select the media id ALONE (the
     * scalar `primaryMediaIdFor`). With no focal values the component falls back
     * to a centred object-cover — the whole photo in a 30px disc instead of the
     * face — so the crop is part of this payload's contract, not a UI detail.
     */
    describe('primary photo + focal crop', () => {
        async function makeMedia(personId: number, isPrimary: 0 | 1, focal?: { x: number; y: number; r: number }) {
            const res = await query(
                `INSERT INTO "Media" ("UserId", "TreeId", "FilePath", "FocalX", "FocalY", "FocalRadius")
                 VALUES ($1, $2, 'portrait.jpg', $3, $4, $5) RETURNING "Id"`,
                [LINKS_USER, treeId, focal?.x ?? null, focal?.y ?? null, focal?.r ?? null],
            );
            const mediaId = res.rows[0].Id as number;
            await query(
                `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
                 VALUES ($1, 'People', $2, $3)`,
                [mediaId, personId, isPrimary],
            );
            return mediaId;
        }

        it('carries the focal crop of an untagged owned portrait', async () => {
            const personId = await makePerson('Harriet', { birthPlace: PLACE, birthDate: '1863' });
            const mediaId = await makeMedia(personId, 1, { x: 42, y: 30, r: 25 });

            const [link] = await linksFor(PLACE);

            expect(link.primaryMediaId).toBe(mediaId);
            expect(link.focalX).toBeCloseTo(42);
            expect(link.focalY).toBeCloseTo(30);
            expect(link.focalRadius).toBeCloseTo(25);
        });

        it('derives the focal crop from a tag on the canonical primary link', async () => {
            const personId = await makePerson('Ida', { birthPlace: PLACE });
            // An owned primary AND a tagged primary: the tag wins, and its region
            // becomes the focal point (centre of the box, radius = its larger edge).
            await makeMedia(personId, 1, { x: 50, y: 50, r: 100 });
            const taggedId = await makeMedia(personId, 0);
            await query(
                `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
                 VALUES ($1, $2, 20, 10, 30, 40)`,
                [taggedId, personId],
            );
            await query(
                `UPDATE "MediaLink" SET "IsPrimary" = CASE WHEN "MediaId" = $1 THEN 1 ELSE 0 END
                 WHERE "OwnerTable" = 'People' AND "OwnerId" = $2`,
                [taggedId, personId],
            );

            const [link] = await linksFor(PLACE);

            expect(link.primaryMediaId).toBe(taggedId);
            expect(Number(link.focalX)).toBeCloseTo(35); // 20 + 30/2
            expect(Number(link.focalY)).toBeCloseTo(30); // 10 + 40/2
            expect(Number(link.focalRadius)).toBeCloseTo(40); // max(30, 40)
        });

        it('chooses the canonical primary link and its person tag', async () => {
            const personId = await makePerson('Canonical', { birthPlace: PLACE });
            const legacyId = await makeMedia(personId, 1, { x: 1, y: 2, r: 3 });
            const canonicalId = await makeMedia(personId, 0, { x: 80, y: 80, r: 80 });
            await query(
                `UPDATE "MediaLink" SET "IsPrimary" = CASE WHEN "MediaId" = $1 THEN 1 ELSE 0 END
                 WHERE "OwnerTable" = 'People' AND "OwnerId" = $2`,
                [canonicalId, personId],
            );
            await query(
                `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
                 VALUES ($1, $2, 12, 24, 20, 10)`,
                [canonicalId, personId],
            );

            const [link] = await linksFor(PLACE);

            expect(link.primaryMediaId).toBe(canonicalId);
            expect(Number(link.focalX)).toBeCloseTo(22);
            expect(Number(link.focalY)).toBeCloseTo(29);
            expect(Number(link.focalRadius)).toBeCloseTo(20);
            expect(link.primaryMediaId).not.toBe(legacyId);
        });

        it('reports null focal values (not a missing key) for a person with no photo', async () => {
            await makePerson('Nell', { birthPlace: PLACE });

            const [link] = await linksFor(PLACE);

            expect(link.primaryMediaId).toBeNull();
            expect(link.focalX).toBeNull();
            expect(link.focalRadius).toBeNull();
        });

        it('keeps the focal crop on every fact row of a multi-fact person', async () => {
            const personId = await makePerson('Vera', { birthPlace: PLACE, deathPlace: PLACE });
            await makeMedia(personId, 1, { x: 60, y: 20, r: 33 });
            await insertRecord({ query }, 'Events', { UserId: LINKS_USER, TreeId: treeId, PersonId: personId, Type: 'RESI', Date: '1920', Place: PLACE });

            const links = await linksFor(PLACE);

            expect(links).toHaveLength(3);
            // groupFactLinks reads focal off the FIRST row it sees for a person, so a
            // branch that dropped the join would surface as an uncropped avatar only
            // for people whose first fact came from that branch.
            for (const link of links) expect(Number(link.focalRadius)).toBeCloseTo(33);
        });
    });
});
