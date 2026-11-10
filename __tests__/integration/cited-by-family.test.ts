import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { getCitedByForSource } from '@/lib/db/queries/citations';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
const CITED_USER = 987664;

/**
 * Family citations rendered as "Families 42" — the literal table name and the raw
 * row id — because the cited-by query carried no family data at all. These cover
 * the widened SELECT: partner names/sexes/photos, and the subject person's own.
 */
d('getCitedByForSource — family and person citation subjects', () => {
    let treeId: number;
    let sourceId: number;

    beforeEach(async () => {
        await query(
            `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)
             ON CONFLICT ("Id") DO NOTHING`,
            [CITED_USER, `cited-by-${CITED_USER}@example.com`, `cited-by-${CITED_USER}`],
        );
        treeId = await resolveDefaultTree(CITED_USER);
        const src = await query(
            `INSERT INTO "Sources" ("TreeId", "Title") VALUES ($1, 'Parish register') RETURNING "Id"`,
            [treeId],
        );
        sourceId = src.rows[0].Id as number;
    });

    afterEach(async () => {
        await query('DELETE FROM "Citation" WHERE "OwnerId" = $1', [CITED_USER]);
        await query('DELETE FROM "Sources" WHERE "TreeId" = $1', [treeId]);
        await query('DELETE FROM "Families" WHERE "UserId" = $1', [CITED_USER]);
        await query('DELETE FROM "People" WHERE "UserId" = $1', [CITED_USER]);
        await query('DELETE FROM "Users" WHERE "Id" = $1', [CITED_USER]);
    });

    async function makePerson(first: string, sex: string) {
        const res = await query(
            `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex")
             VALUES ($1, $2, $3, 'Tester', $4) RETURNING "Id"`,
            [CITED_USER, treeId, first, sex],
        );
        return res.rows[0].Id as number;
    }

    async function cite(factTable: string, factId: number) {
        await query(
            `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId")
             VALUES ($1, $2, $3, $4, $5)`,
            [CITED_USER, treeId, factTable, factId, sourceId],
        );
    }

    it('returns both partners of a cited family, with their sexes', async () => {
        const p1 = await makePerson('John', 'M');
        const p2 = await makePerson('Elizabeth', 'F');
        const fam = await query(
            `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
            [CITED_USER, treeId, p1, p2],
        );
        const famId = fam.rows[0].Id as number;
        await cite('Families', famId);

        const [row] = await getCitedByForSource(sourceId, treeId);

        expect(row.familyId).toBe(famId);
        expect(row.familyPartner1Name).toBe('John Tester');
        expect(row.familyPartner2Name).toBe('Elizabeth Tester');
        expect(row.familyPartner1Sex).toBe('M');
        expect(row.familyPartner2Sex).toBe('F');
    });

    it('reads partners still held in the legacy Husband/Wife columns', async () => {
        // The Phase-9 rename only backfilled families where BOTH new columns were
        // null, so a partially-migrated row keeps a partner in the legacy column.
        // Reading the new column alone rendered such a family as "?".
        const p1 = await makePerson('Legacy', 'M');
        const p2 = await makePerson('Spouse', 'F');
        const fam = await query(
            `INSERT INTO "Families" ("UserId", "TreeId", "HusbandId", "WifeId") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
            [CITED_USER, treeId, p1, p2],
        );
        await cite('Families', fam.rows[0].Id as number);

        const [row] = await getCitedByForSource(sourceId, treeId);

        expect(row.familyPartner1Name).toBe('Legacy Tester');
        expect(row.familyPartner2Name).toBe('Spouse Tester');
    });

    it('leaves the second partner null when a family records only one', async () => {
        const p1 = await makePerson('Solo', 'F');
        const fam = await query(
            `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id") VALUES ($1, $2, $3) RETURNING "Id"`,
            [CITED_USER, treeId, p1],
        );
        await cite('Families', fam.rows[0].Id as number);

        const [row] = await getCitedByForSource(sourceId, treeId);

        expect(row.familyPartner1Name).toBe('Solo Tester');
        expect(row.familyPartner2Name).toBeNull();
    });

    it('names the owner of a cited event: the person, or the family\'s partners (#755)', async () => {
        const personId = await makePerson('Hazel', 'F');
        const partner = await makePerson('Ash', 'M');
        const fam = await query(
            `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
            [CITED_USER, treeId, personId, partner],
        );
        const famId = fam.rows[0].Id as number;
        const events = await query(
            `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId", "FamilyId")
             VALUES ($1, $2, 'EDUC', $3, NULL), ($1, $2, 'DIV', NULL, $4)
             RETURNING "Id"`,
            [CITED_USER, treeId, personId, famId],
        );
        await cite('Events', events.rows[0].Id as number);
        await cite('Events', events.rows[1].Id as number);

        const rows = await getCitedByForSource(sourceId, treeId);
        const personEvent = rows.find(r => r.eventType === 'EDUC');
        const familyEvent = rows.find(r => r.eventType === 'DIV');

        expect(personEvent).toMatchObject({ personId, personName: 'Hazel Tester', familyId: null, familyPartner1Name: null });
        expect(familyEvent).toMatchObject({ personId: null, personName: null, familyId: famId, familyPartner1Name: 'Hazel Tester', familyPartner2Name: 'Ash Tester' });
    });

    it('carries the subject person sex and name for a person citation', async () => {
        const personId = await makePerson('Ada', 'F');
        await cite('People', personId);

        const [row] = await getCitedByForSource(sourceId, treeId);

        expect(row.personId).toBe(personId);
        expect(row.personName).toBe('Ada Tester');
        expect(row.personSex).toBe('F');
        expect(row.familyPartner1Name).toBeNull();
    });

    it('resolves the canonical primary link and ignores unlinked media', async () => {
        const personId = await makePerson('Mabel', 'F');
        const media = await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "FilePath")
             VALUES ($1, $2, 'unlinked-a.jpg'),
                    ($1, $2, 'canonical-b.jpg')
             RETURNING "Id"`,
            [CITED_USER, treeId],
        );
        const unlinkedMediaId = media.rows[0].Id as number;
        const canonicalMediaId = media.rows[1].Id as number;
        await query(
            `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
             VALUES ($1, 'People', $2, 1)`,
            [canonicalMediaId, personId],
        );
        await cite('People', personId);

        const [row] = await getCitedByForSource(sourceId, treeId);

        expect(row.personMediaId).toBe(canonicalMediaId);
        expect(row.personMediaId).not.toBe(unlinkedMediaId);

        await query('DELETE FROM "Media" WHERE "UserId" = $1', [CITED_USER]);
    });
});
