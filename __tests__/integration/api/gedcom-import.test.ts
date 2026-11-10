import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/import/gedcom/route';

// Bypass in-memory rate limiter so tests don't exhaust the 5-per-15-min limit
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
}));
import { NextRequest } from 'next/server';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { parseResponse, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getDataDir } from '@/lib/data-dir';
import { MAX_GEDCOM_BYTES } from '@/lib/import-limits';

const describeIf = hasTestDatabase() ? describe : describe.skip;

const GEDCOM_TWO_PEOPLE_ONE_FAMILY = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Augustus /Finch/
1 SEX M
0 @I2@ INDI
1 NAME Cecilia /Finch/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 15 JUN 1950
2 PLAC Springfield
0 TRLR`;

const GEDCOM_WITH_CHILD = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Augustus /Finch/
1 SEX M
0 @I2@ INDI
1 NAME Cecilia /Finch/
1 SEX F
0 @I3@ INDI
1 NAME Scout /Finch/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`;

function createGedcomRequest(gedcomContent: string, mode = 'overwrite') {
    const formData = new FormData();
    formData.append('file', new File([gedcomContent], 'test.ged', { type: 'text/plain' }));
    return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=${mode}`, {
        method: 'POST',
        body: formData,
    });
}

function createGedcomRequestWithMedia(gedcomContent: string, mediaJson: string, mode = 'overwrite') {
    const formData = new FormData();
    formData.append('file', new File([gedcomContent], 'test.ged', { type: 'text/plain' }));
    formData.append('mediaJson', mediaJson);
    return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=${mode}`, {
        method: 'POST',
        body: formData,
    });
}

// @I1@ owns photo 5_1.jpg (inline OBJE); @I2@ owns nothing.
const GEDCOM_WITH_OWNED_PHOTO = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Augustus /Finch/
1 SEX M
1 OBJE
2 FILE 5_1.jpg
3 FORM JPG
0 @I2@ INDI
1 NAME Cecilia /Finch/
1 SEX F
0 TRLR`;

const GEDCOM_WITH_TOP_LEVEL_MEDIA = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Augustus /Finch/
1 SEX M
1 OBJE @O1@
0 @O1@ OBJE
1 FILE photo.jpg
1 FORM JPG
0 TRLR`;

const GEDCOM_WITH_NICKNAMES = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME William /Smith/
2 NICK Bill
1 _AKA William the Elder
0 TRLR`;

describeIf('API /api/import/gedcom', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    // #1222 (audit M-1): a .ged over the cap is refused before it is read.
    describe('size cap', () => {
        function overCapRequest(dryRun: boolean) {
            const formData = new FormData();
            formData.append('file', new File([new Uint8Array(MAX_GEDCOM_BYTES + 1)], 'huge.ged', { type: 'text/plain' }));
            return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=overwrite&dryRun=${dryRun}`, {
                method: 'POST',
                body: formData,
            });
        }

        it.each([true, false])('rejects a .ged over the cap with 400 (dryRun=%s)', async (dryRun) => {
            await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY));
            const res = await POST(overCapRequest(dryRun));
            expect(res.status).toBe(400);
            const body = await parseResponse<{ error: string }>(res);
            expect(body.error).toMatch(/Maximum GEDCOM size is 100 MB/);
            // Nothing was replaced: the earlier import is intact.
            const people = await query(`SELECT 1 FROM "People" WHERE "UserId" = $1`, [TEST_USER.id]);
            expect(people.rows).toHaveLength(2);
        });
    });

    // NICK/_AKA used to be appended to People.Notes as text, so nothing in the app
    // could read them — the nickname display path keys off NameVariant.
    describe('name variants', () => {
        async function importedVariants() {
            const rows = await query(
                `SELECT nv."Type", nv."Name" FROM "NameVariant" nv
                   JOIN "People" p ON p."Id" = nv."PersonId"
                  WHERE p."UserId" = $1
                  ORDER BY nv."Id"`,
                [TEST_USER.id],
            );
            return rows.rows;
        }

        it('creates NameVariant rows for NICK and _AKA', async () => {
            const res = await POST(createGedcomRequest(GEDCOM_WITH_NICKNAMES));
            expect(res.status).toBe(200);

            expect(await importedVariants()).toEqual([
                { Type: 'Nickname', Name: 'Bill' },
                { Type: 'Alias', Name: 'William the Elder' },
            ]);
        });

        it('leaves the tags out of the imported notes', async () => {
            await POST(createGedcomRequest(GEDCOM_WITH_NICKNAMES));

            // Asserted against People."Notes" until #524 / ADR 0010 dropped it;
            // the person's first-class notes are where a leak would show now.
            const rows = await query(
                `SELECT n."Text" FROM "Note" n
                   JOIN "NoteLink" l ON l."NoteId" = n."Id"
                   JOIN "People" p ON p."Id" = l."OwnerId"
                  WHERE l."OwnerTable" = 'People' AND p."UserId" = $1`,
                [TEST_USER.id],
            );
            const text = (rows.rows as { Text: string }[]).map((r) => r.Text).join('\n');
            expect(text).not.toContain('NICK');
            expect(text).not.toContain('_AKA');
        });

        it('does not duplicate variants when the same file is merged twice', async () => {
            await POST(createGedcomRequest(GEDCOM_WITH_NICKNAMES, 'overwrite'));
            await POST(createGedcomRequest(GEDCOM_WITH_NICKNAMES, 'merge'));

            expect(await importedVariants()).toEqual([
                { Type: 'Nickname', Name: 'Bill' },
                { Type: 'Alias', Name: 'William the Elder' },
            ]);
        });
    });

    describe('overwrite mode', () => {
        it('imports people and families', async () => {
            const res = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY));
            expect(res.status).toBe(200);
            const data = await parseResponse<{ peopleCount: number; familiesCount: number }>(res);
            expect(data.peopleCount).toBe(2);
            expect(data.familiesCount).toBe(1);
        });

        it('replaces existing data on second import', async () => {
            await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY));
            const res = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY));
            expect(res.status).toBe(200);
            const data = await parseResponse<{ peopleCount: number; familiesCount: number }>(res);
            expect(data.peopleCount).toBe(2);
            expect(data.familiesCount).toBe(1);

            const { rows: people } = await query('SELECT "Id" FROM "People" WHERE "UserId" = $1', [TEST_USER.id]);
            const { rows: families } = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1', [TEST_USER.id]);
            expect(people).toHaveLength(2);
            expect(families).toHaveLength(1);
        });

        it('removes the previous media files from disk so the volume does not accumulate orphans', async () => {
            // Seed an existing media row + its on-disk file for this user.
            const filename = `test_orphan_${Date.now()}.jpg`;
            const mediaDir = path.join(getDataDir(), 'uploads', String(TEST_USER.id), 'media');
            const filePath = path.join(mediaDir, filename);
            await mkdir(mediaDir, { recursive: true });
            await writeFile(filePath, Buffer.from('fake-image-bytes'));
            // Overwrite cleanup pre-reads FilePaths of the TREE being wiped, so the
            // seeded row must carry the TreeId the import will resolve.
            const treeId = await resolveDefaultTree(TEST_USER.id);
            await query(
                `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format") VALUES ($1, $2, $3, $4, $5)`,
                [TEST_USER.id, treeId, 'Orphan', filename, 'JPG']
            );
            expect(existsSync(filePath)).toBe(true);

            try {
                // Overwrite import clears existing data; it must also remove the
                // old file, not just the DB row.
                const res = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'overwrite'));
                expect(res.status).toBe(200);

                expect(existsSync(filePath)).toBe(false);
            } finally {
                await unlink(filePath).catch(() => undefined);
            }
        });
    });

    describe('merge mode — families', () => {
        it('does not create a duplicate family when re-importing the same file', async () => {
            // First import
            const res1 = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));
            expect(res1.status).toBe(200);
            const data1 = await parseResponse<{ familiesCount: number }>(res1);
            expect(data1.familiesCount).toBe(1);

            // Second import with same data — family already exists
            const res2 = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));
            expect(res2.status).toBe(200);
            const data2 = await parseResponse<{ familiesCount: number }>(res2);
            expect(data2.familiesCount).toBe(0);

            const { rows: families } = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1', [TEST_USER.id]);
            expect(families).toHaveLength(1);
        });

        it('does not create a duplicate family when spouses were already imported', async () => {
            // First import seeds the people and family
            await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));

            // Second import should skip both the people and the family
            const res = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));
            expect(res.status).toBe(200);

            const { rows: families } = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1', [TEST_USER.id]);
            expect(families).toHaveLength(1);
        });

        it('links a new child to an existing family without creating a duplicate', async () => {
            // First import: family without child
            await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));

            // Second import: same family but now includes a child
            const res = await POST(createGedcomRequest(GEDCOM_WITH_CHILD, 'merge'));
            expect(res.status).toBe(200);

            const { rows: families } = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1', [TEST_USER.id]);
            expect(families).toHaveLength(1);

            const { rows: children } = await query(
                'SELECT * FROM "FamilyPerson" WHERE "FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "UserId" = $1)',
                [TEST_USER.id]
            );
            expect(children).toHaveLength(1);
        });

        it('does not create duplicate children when re-importing a family with children', async () => {
            // First import with child
            await POST(createGedcomRequest(GEDCOM_WITH_CHILD, 'merge'));

            // Second import with same child — should not duplicate
            const res = await POST(createGedcomRequest(GEDCOM_WITH_CHILD, 'merge'));
            expect(res.status).toBe(200);

            const { rows: children } = await query(
                'SELECT * FROM "FamilyPerson" WHERE "FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "UserId" = $1)',
                [TEST_USER.id]
            );
            expect(children).toHaveLength(1);
        });

        it('does not duplicate people on re-import', async () => {
            await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));
            await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY, 'merge'));

            const { rows: people } = await query('SELECT "Id" FROM "People" WHERE "UserId" = $1', [TEST_USER.id]);
            expect(people).toHaveLength(2);
        });
    });

    describe('validation', () => {
        it('rejects invalid mode', async () => {
            const formData = new FormData();
            formData.append('file', new File([GEDCOM_TWO_PEOPLE_ONE_FAMILY], 'test.ged', { type: 'text/plain' }));
            const req = new NextRequest('http://localhost:3000/api/import/gedcom?mode=invalid', {
                method: 'POST',
                body: formData,
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('rejects non-.ged files', async () => {
            const formData = new FormData();
            formData.append('file', new File(['data'], 'test.txt', { type: 'text/plain' }));
            const req = new NextRequest('http://localhost:3000/api/import/gedcom', {
                method: 'POST',
                body: formData,
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('returns 400 when no file provided', async () => {
            const formData = new FormData();
            const req = new NextRequest('http://localhost:3000/api/import/gedcom', {
                method: 'POST',
                body: formData,
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });
    });

    describe('media.json sidecar', () => {
        it('restores library photos and face tags', async () => {
            const mediaJson = JSON.stringify({
                version: 1,
                libraryMedia: [
                    { file: 'group.jpg', title: 'Group', format: 'JPG', focalX: null, focalY: null, focalRadius: null },
                ],
                tags: [
                    // @I2@ tagged in @I1@'s owned photo, set as her avatar
                    { file: '5_1.jpg', person: '@I2@', region: [10, 20, 30, 40], primary: true },
                    // @I1@ tagged in the ownerless library photo
                    { file: 'group.jpg', person: '@I1@', region: [5, 5, 10, 10], primary: false },
                ],
            });

            const res = await POST(createGedcomRequestWithMedia(GEDCOM_WITH_OWNED_PHOTO, mediaJson));
            expect(res.status).toBe(200);
            const data = await parseResponse<{ tagsCount: number; libraryMediaCount: number }>(res);
            expect(data.tagsCount).toBe(2);
            expect(data.libraryMediaCount).toBe(1);

            // Library photo: a Media row with no canonical owner link.
            const { rows: library } = await query(
                `SELECT m."Id" FROM "Media" m
                 WHERE m."UserId" = $1
                   AND NOT EXISTS (SELECT 1 FROM "MediaLink" l WHERE l."MediaId" = m."Id")`,
                [TEST_USER.id]
            );
            expect(library).toHaveLength(1);

            // Two face tags, scoped to this user's media
            const { rows: tags } = await query(
                `SELECT mt."Id" FROM "MediaTag" mt
                 JOIN "Media" m ON m."Id" = mt."MediaId"
                 WHERE m."UserId" = $1`,
                [TEST_USER.id]
            );
            expect(tags).toHaveLength(2);

            const { rows: taggedPerson } = await query(
                'SELECT "Id" FROM "People" WHERE "UserId" = $1 AND "GedcomId" = $2',
                [TEST_USER.id, '@I2@'],
            );
            const { rows: canonicalPrimary } = await query(
                `SELECT l."OwnerId", l."IsPrimary"
                 FROM "MediaLink" l
                 JOIN "Media" m ON m."Id" = l."MediaId"
                 WHERE l."OwnerTable" = 'People' AND l."OwnerId" = $1 AND l."IsPrimary" = 1
                   AND m."UserId" = $2`,
                [taggedPerson[0].Id, TEST_USER.id],
            );
            expect(canonicalPrimary).toHaveLength(1);
        });

        it('returns 400 on invalid mediaJson', async () => {
            const res = await POST(createGedcomRequestWithMedia(GEDCOM_TWO_PEOPLE_ONE_FAMILY, '{ not json'));
            expect(res.status).toBe(400);
        });

        it('applies v2 geometry and face tags through current-import xrefs', async () => {
            const mediaJson = JSON.stringify({
                version: 2,
                focalGeometry: [{ media: '@O1@', x: 40, y: 60, radius: 25 }],
                tags: [{ media: '@O1@', person: '@I1@', region: [10, 20, 30, 40] }],
            });

            const res = await POST(createGedcomRequestWithMedia(GEDCOM_WITH_TOP_LEVEL_MEDIA, mediaJson));
            expect(res.status).toBe(200);

            const { rows: media } = await query(
                'SELECT "Id", "FocalX", "FocalY", "FocalRadius" FROM "Media" WHERE "UserId" = $1',
                [TEST_USER.id],
            );
            expect(media).toHaveLength(1);
            expect(media[0]).toMatchObject({ FocalX: 40, FocalY: 60, FocalRadius: 25 });

            const { rows: tags } = await query(
                `SELECT mt."RegionX", mt."RegionY", mt."RegionW", mt."RegionH", mt."PersonId"
                 FROM "MediaTag" mt JOIN "Media" m ON m."Id" = mt."MediaId"
                 WHERE m."UserId" = $1`,
                [TEST_USER.id],
            );
            expect(tags).toHaveLength(1);
            expect(tags[0]).toMatchObject({ RegionX: 10, RegionY: 20, RegionW: 30, RegionH: 40 });
        });
    });

    it('returns 401 when unauthenticated', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await POST(createGedcomRequest(GEDCOM_TWO_PEOPLE_ONE_FAMILY));
        expect(res.status).toBe(401);
    });
});
