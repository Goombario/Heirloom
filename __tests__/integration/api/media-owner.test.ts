import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_MEDIA } from '@/app/api/media/route';
import { DELETE as DELETE_MEDIA } from '@/app/api/media/[id]/route';
import { POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { linkMediaForOwnerService } from '@/lib/services/media-links';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getMediaForCaseLinkedPeople } from '@/lib/db/queries/cases';
import { updateMediaService } from '@/lib/services/media';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface MediaShape { Id: number; Title: string | null; IsExplicit?: boolean; IsInferred?: boolean }

describeIf('API /api/media (owner attachments)', () => {
    afterEach(async () => {
        await query(`DROP TRIGGER IF EXISTS "fail_combined_media_update_trigger" ON "Media"`);
        await query(`DROP FUNCTION IF EXISTS "fail_combined_media_update"()`);
        await cleanupTestData();
    });

    async function createSource(): Promise<{ Id: number }> {
        const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
            method: 'POST', body: { Title: 'Parish register', Type: 'Church' },
        }));
        return (await parseResponse<{ source: { Id: number } }>(res)).source;
    }

    async function createFamily(): Promise<{ Id: number }> {
        const res = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST', body: { MarriageDate: '1900' },
        }));
        return (await parseResponse<{ family: { Id: number } }>(res)).family;
    }

    // Seed a non-person media row owned by the tree, then attach it via the service
    // (mirrors what the upload route does after createMedia). Resolves the tree id
    // fresh each call — cleanupTestData() drops the test user's "Trees" row every
    // afterEach, so a value cached once in beforeAll goes stale after the first test.
    async function attachMedia(ownerTable: string, ownerId: number, title: string): Promise<number> {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const ins = await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
             VALUES ($1, $2, $3, 'doc.jpg') RETURNING "Id"`,
            [TEST_USER.id, treeId, title],
        );
        const mediaId = (ins.rows[0] as { Id: number }).Id;
        await linkMediaForOwnerService({
            mediaId, ownerTable, ownerId, requestedTreeId: null, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });
        return mediaId;
    }

    function listUrl(ownerTable: string, recordId: number): string {
        return `http://localhost:3000/api/media?ownerTable=${ownerTable}&recordId=${recordId}`;
    }

    it('lists and unlinks media attached to a source', async () => {
        const source = await createSource();
        const mediaId = await attachMedia('Sources', source.Id, 'Title page');

        const listRes = await LIST_MEDIA(createRequest(listUrl('Sources', source.Id)));
        const { media, count } = await parseResponse<{ media: MediaShape[]; count: number }>(listRes);
        expect(count).toBe(1);
        expect(media[0].Title).toBe('Title page');

        const delRes = await DELETE_MEDIA(
            createRequest(`http://localhost:3000/api/media/${mediaId}?ownerTable=Sources&recordId=${source.Id}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );
        expect(delRes.status).toBe(204);

        const afterRes = await LIST_MEDIA(createRequest(listUrl('Sources', source.Id)));
        expect((await parseResponse<{ media: MediaShape[] }>(afterRes)).media).toHaveLength(0);
    });

    it('attaches media to a family', async () => {
        const family = await createFamily();
        await attachMedia('Families', family.Id, 'Wedding photo');
        const listRes = await LIST_MEDIA(createRequest(listUrl('Families', family.Id)));
        expect((await parseResponse<{ media: MediaShape[] }>(listRes)).media[0].Title).toBe('Wedding photo');
    });

    it('gallery=true includes qualifying family tags with explicit capability flags', async () => {
        const family = await createFamily();
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const people = await query(
            `INSERT INTO "People" ("UserId", "TreeId", "FirstName")
             VALUES ($1, $2, 'Partner one'), ($1, $2, 'Partner two') RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        await query(
            `UPDATE "Families" SET "Partner1Id" = $1, "Partner2Id" = $2 WHERE "Id" = $3 AND "TreeId" = $4`,
            [people.rows[0].Id, people.rows[1].Id, family.Id, treeId],
        );
        const inserted = await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
             VALUES ($1, $2, 'Tagged family photo', 'tagged-family.jpg') RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        const inferredId = (inserted.rows[0] as { Id: number }).Id;
        await query(
            `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
             VALUES ($1, $2, 1, 1, 10, 10), ($1, $3, 20, 20, 10, 10)`,
            [inferredId, people.rows[0].Id, people.rows[1].Id],
        );

        const gallery = await LIST_MEDIA(createRequest(listUrl('Families', family.Id) + '&gallery=true'));
        expect(gallery.status).toBe(200);
        expect((await parseResponse<{ media: MediaShape[] }>(gallery)).media).toEqual([
            expect.objectContaining({ Id: inferredId, IsExplicit: false, IsInferred: true }),
        ]);

        const explicit = await LIST_MEDIA(createRequest(listUrl('Families', family.Id)));
        expect((await parseResponse<{ media: MediaShape[] }>(explicit)).media).toEqual([]);

        const nonExactGallery = await LIST_MEDIA(createRequest(listUrl('Families', family.Id) + '&gallery=TRUE'));
        expect((await parseResponse<{ media: MediaShape[] }>(nonExactGallery)).media).toEqual([]);
    });

    it('uses canonical People links for person lists and case-linked labels', async () => {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const people = await query(
            `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName")
             VALUES ($1, $2, 'Legacy', 'Owner'), ($1, $2, 'Canonical', 'Owner') RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        const canonicalPersonId = people.rows[1].Id as number;
        const media = await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
             VALUES ($1, $2, 'Unlinked A', 'unlinked-a.jpg'),
                    ($1, $2, 'Canonical B', 'canonical-b.jpg')
             RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        const legacyMediaId = media.rows[0].Id as number;
        const canonicalMediaId = media.rows[1].Id as number;
        await query(
            `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
             VALUES ($1, 'People', $2, 1)`,
            [canonicalMediaId, canonicalPersonId],
        );

        const canonicalList = await LIST_MEDIA(createRequest(
            `http://localhost:3000/api/media?personId=${canonicalPersonId}`,
        ));
        expect((await parseResponse<{ media: MediaShape[] }>(canonicalList)).media.map((row) => row.Id))
            .toEqual([canonicalMediaId]);

        const testCase = await query(
            `INSERT INTO "Cases" ("UserId", "TreeId", "Title") VALUES ($1, $2, 'Canonical case') RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        await query(
            `INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ($1, $2)`,
            [testCase.rows[0].Id, canonicalPersonId],
        );
        const caseMedia = await getMediaForCaseLinkedPeople(testCase.rows[0].Id as number, treeId);
        expect(caseMedia.map((row) => ({ id: row.Id, firstName: row.PersonFirstName })))
            .toEqual([{ id: canonicalMediaId, firstName: 'Canonical' }]);

        const links = await query(
            `SELECT "OwnerId", "IsPrimary" FROM "MediaLink"
             WHERE "MediaId" = $1 AND "OwnerTable" = 'People'`,
            [canonicalMediaId],
        );
        expect(links.rows).toEqual([{ OwnerId: canonicalPersonId, IsPrimary: 1 }]);
        expect(legacyMediaId).not.toBe(canonicalMediaId);
    });

    it('rolls back metadata and audits when an update fails', async () => {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const people = await query(
            `INSERT INTO "People" ("UserId", "TreeId", "FirstName")
             VALUES ($1, $2, 'Before owner'), ($1, $2, 'After owner') RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        const beforeOwnerId = people.rows[0].Id as number;
        const inserted = await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
             VALUES ($1, $2, 'Before title', 'atomic.jpg') RETURNING "Id"`,
            [TEST_USER.id, treeId],
        );
        const mediaId = inserted.rows[0].Id as number;
        await query(
            `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES ($1, 'People', $2)`,
            [mediaId, beforeOwnerId],
        );
        const auditBefore = (await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n as number;
        await query(`
            CREATE FUNCTION "fail_combined_media_update"() RETURNS trigger AS $$
            BEGIN
              IF NEW."Title" = 'Forced later failure' THEN
                RAISE EXCEPTION 'forced later combined-update failure';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await query(`
            CREATE TRIGGER "fail_combined_media_update_trigger"
            BEFORE UPDATE OF "Title" ON "Media"
            FOR EACH ROW EXECUTE FUNCTION "fail_combined_media_update"()
        `);

        await expect(updateMediaService({
            id: mediaId,
            body: { Title: 'Forced later failure' },
            requestedTreeId: treeId,
            requestedOwnerId: null,
            currentUserId: TEST_USER.id,
        })).rejects.toThrow(/forced later combined-update failure/i);

        expect((await query(
            `SELECT "OwnerId", "IsPrimary" FROM "MediaLink"
             WHERE "MediaId" = $1 AND "OwnerTable" = 'People' ORDER BY "OwnerId"`,
            [mediaId],
        )).rows).toEqual([{ OwnerId: beforeOwnerId, IsPrimary: 0 }]);
        expect((await query(
            `SELECT "Title" FROM "Media" WHERE "Id" = $1`,
            [mediaId],
        )).rows).toEqual([{ Title: 'Before title' }]);
        expect((await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n).toBe(auditBefore);
    });

    it('rejects an invalid ownerTable with 400', async () => {
        const res = await LIST_MEDIA(createRequest(listUrl('Robert"); DROP', 1)));
        expect(res.status).toBe(400);
    });

    it('unlink of a non-existent link returns 404', async () => {
        const source = await createSource();
        const res = await DELETE_MEDIA(
            createRequest(`http://localhost:3000/api/media/999999?ownerTable=Sources&recordId=${source.Id}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: '999999' }) },
        );
        expect(res.status).toBe(404);
    });

    it('view-only collaborator gets 403 unlinking media', async () => {
        const source = await createSource();
        const mediaId = await attachMedia('Sources', source.Id, 'Locked');
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
        }));
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await DELETE_MEDIA(
            createRequest(`http://localhost:3000/api/media/${mediaId}?ownerTable=Sources&recordId=${source.Id}&ownerId=${TEST_USER.id}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );
        expect(res.status).toBe(403);
    });

    async function mediaExists(mediaId: number): Promise<boolean> {
        const r = await query('SELECT 1 FROM "Media" WHERE "Id" = $1', [mediaId]);
        return (r.rowCount ?? 0) > 0;
    }

    async function shareTree(permission: 'contribute' | 'edit'): Promise<void> {
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST', body: { email: TEST_USER_2.email, permission },
        }));
    }

    function detachUrl(mediaId: number, sourceId: number, asCollaborator: boolean): string {
        const owner = asCollaborator ? `&ownerId=${TEST_USER.id}` : '';
        return `http://localhost:3000/api/media/${mediaId}?ownerTable=Sources&recordId=${sourceId}${owner}`;
    }

    it('contribute collaborator detaching the sole link unlinks but does NOT delete the media row', async () => {
        const source = await createSource();
        const mediaId = await attachMedia('Sources', source.Id, 'Contributed doc');
        await shareTree('contribute');

        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await DELETE_MEDIA(
            createRequest(detachUrl(mediaId, source.Id, true), { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );
        expect(res.status).toBe(204);

        // Link is gone …
        const listRes = await LIST_MEDIA(createRequest(listUrl('Sources', source.Id)));
        expect((await parseResponse<{ media: MediaShape[] }>(listRes)).media).toHaveLength(0);
        // … but the media row persists in the library (detach is unlink-only, #86).
        expect(await mediaExists(mediaId)).toBe(true);
    });

    it('owner detaching the sole link unlinks but keeps the media row in the library (#86)', async () => {
        const source = await createSource();
        const mediaId = await attachMedia('Sources', source.Id, 'Owned doc');

        const res = await DELETE_MEDIA(
            createRequest(detachUrl(mediaId, source.Id, false), { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );
        expect(res.status).toBe(204);
        // Detach is unlink-only: the Media row persists in the library (independent
        // media). Explicit deletion is a separate library action.
        expect(await mediaExists(mediaId)).toBe(true);
    });

    it('edit collaborator detaching the sole link unlinks but keeps the media row (#86)', async () => {
        const source = await createSource();
        const mediaId = await attachMedia('Sources', source.Id, 'Editable doc');
        await shareTree('edit');

        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await DELETE_MEDIA(
            createRequest(detachUrl(mediaId, source.Id, true), { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );
        expect(res.status).toBe(204);
        expect(await mediaExists(mediaId)).toBe(true);
    });
});
