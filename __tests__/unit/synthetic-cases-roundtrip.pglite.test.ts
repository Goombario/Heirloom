import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { readBundle, type Bundle } from '../setup/gedcom-bundle';
import { buildSyntheticDataset, seedSyntheticDataset } from '@/scripts/synthetic-data-fixture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * #913: the synthetic fixture's cases go through cases.json. Export the seeded
 * tree, re-import the bundle into an empty tree, and compare each case's
 * details, journal (with each entry's photo and citation), linked people,
 * evidence and photos (#1068, #1035).
 */

const USER_ID = 913913;

type CaseView = {
    Title: string;
    Description: string | null;
    Status: string;
    Tags: string[];
    CreatedAt: string;
    comments: Array<[string, string | null, string, string | null, string | null]>;
    people: string[];
    evidence: Array<[string, string | null, string | null]>;
    photos: string[];
};

async function casesOf(treeId: number): Promise<CaseView[]> {
    const cases = (await query(
        `SELECT "Id", "Title", "Description", "Status", "Tags", "CreatedAt" FROM "Cases" WHERE "TreeId" = $1 ORDER BY "Title"`,
        [treeId],
    )).rows as Array<{ Id: number; Title: string; Description: string | null; Status: string; Tags: string[]; CreatedAt: string | Date }>;
    const iso = (v: string | Date) => new Date(v).toISOString();
    const views: CaseView[] = [];
    for (const c of cases) {
        const comments = (await query(
            `SELECT cc."Body", cc."Kind", cc."CreatedAt", m."Title" AS "Photo",
                    (SELECT s."Title" || ' | ' || COALESCE(ci."Page", '') FROM "Citation" ci JOIN "Sources" s ON s."Id" = ci."SourceId"
                      WHERE ci."TreeId" = $2 AND ci."FactTable" = 'CaseComments' AND ci."FactId" = cc."Id" ORDER BY ci."Id" LIMIT 1) AS "Cited"
             FROM "CaseComments" cc LEFT JOIN "Media" m ON m."Id" = cc."MediaId"
             WHERE cc."CaseId" = $1 ORDER BY cc."CreatedAt", cc."Id"`,
            [c.Id, treeId],
        )).rows as Array<{ Body: string; Kind: string | null; CreatedAt: string | Date; Photo: string | null; Cited: string | null }>;
        const photos = (await query(
            `SELECT m."Title" FROM "CaseMedia" cm JOIN "Media" m ON m."Id" = cm."MediaId" WHERE cm."CaseId" = $1 ORDER BY 1`,
            [c.Id],
        )).rows as Array<{ Title: string }>;
        const people = (await query(
            `SELECT p."FirstName" || ' ' || p."LastName" AS name FROM "CasePerson" cp JOIN "People" p ON p."Id" = cp."PersonId" WHERE cp."CaseId" = $1 ORDER BY 1`,
            [c.Id],
        )).rows as Array<{ name: string }>;
        const evidence = (await query(
            `SELECT s."Title", ci."Page", ci."Note" FROM "Citation" ci JOIN "Sources" s ON s."Id" = ci."SourceId"
             WHERE ci."TreeId" = $1 AND ci."FactTable" = 'Cases' AND ci."FactId" = $2 ORDER BY 1, 2, 3`,
            [treeId, c.Id],
        )).rows as Array<{ Title: string; Page: string | null; Note: string | null }>;
        views.push({
            Title: c.Title, Description: c.Description, Status: c.Status, Tags: c.Tags, CreatedAt: iso(c.CreatedAt),
            comments: comments.map((cm) => [cm.Body, cm.Kind ?? null, iso(cm.CreatedAt), cm.Photo, cm.Cited]),
            people: people.map((p) => p.name),
            evidence: evidence.map((e) => [e.Title, e.Page, e.Note]),
            photos: photos.map((p) => p.Title),
        });
    }
    return views;
}

describe('synthetic fixture cases round-trip through cases.json (#913)', () => {
    let db: PGlite;
    let source: number;
    let target: number;
    let bundle: Bundle;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'cases-roundtrip@test.local', 'cases-roundtrip']);
        source = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Seeded') RETURNING "Id"`, [USER_ID])).rows[0] as { Id: number }).Id;
        target = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Restored') RETURNING "Id"`, [USER_ID])).rows[0] as { Id: number }).Id;
        await seedSyntheticDataset({ query: (text, params) => db.query(text, params) }, { userId: USER_ID, treeId: source, storage: 'local' });

        const { exportGedcomLocalService } = await import('@/lib/data/local/gedcom-export');
        const { importGedcomService } = await import('@/lib/services/gedcom');
        // The seed stores its photos as local blobs, so the local exporter packs
        // them and the case photo links have media to point at. The hosted
        // exporter's cases.json is covered by the semantic round trip.
        const exported = await exportGedcomLocalService({ requestedTreeId: source, currentUserId: USER_ID, includeMedia: true });
        if (exported.kind !== 'zip') throw new Error(`expected a zip bundle, got ${exported.kind}`);
        bundle = await readBundle(Buffer.from(await exported.blob.arrayBuffer()));
        await importGedcomService({
            file: new File([bundle.ged], 'family_tree.ged', { type: 'text/plain' }),
            mode: 'overwrite',
            casesJson: JSON.stringify(bundle.cases),
            sourcesJson: JSON.stringify(bundle.sources),
            mediaJson: JSON.stringify(bundle.media),
            placesJson: JSON.stringify(bundle.places),
            currentUserId: USER_ID,
            requestedTreeId: target,
        });
    }, 120_000);

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('exports every seeded case in cases.json', () => {
        const titles = (bundle.cases.cases as Array<{ Title: string }>).map((c) => c.Title).sort();
        expect(titles).toEqual(buildSyntheticDataset().cases.map((c) => c.title).sort());
    });

    it('re-imports each case with its details, journal, people, evidence and photos', async () => {
        const before = await casesOf(source);
        expect(before).toHaveLength(buildSyntheticDataset().cases.length);
        // Guard against a vacuous pass: the seed has case photos, journal photos and journal citations.
        expect(before.flatMap((c) => c.photos).length).toBeGreaterThan(0);
        expect(before.flatMap((c) => c.comments).filter((cm) => cm[3] !== null).length).toBeGreaterThan(0);
        expect(before.flatMap((c) => c.comments).filter((cm) => cm[4] !== null).length).toBeGreaterThan(0);
        expect(await casesOf(target)).toEqual(before);
    });
});
