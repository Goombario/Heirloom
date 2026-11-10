import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { createRequest, parseResponse, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sharp', () => {
    const mockSharp = vi.fn(() => ({
        rotate: vi.fn().mockReturnThis(),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
    }));
    return { default: mockSharp };
});


const describeIf = hasTestDatabase() ? describe : describe.skip;

const LIMIT_BYTES = 100 * 1024 * 1024; // 100MB

/** Build a FormData upload request for the regular upload path. */
function makeUploadRequest(personId: number, fileSize = 1024, uploadIntentId?: string): NextRequest {
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array(fileSize)], 'photo.jpg', { type: 'image/jpeg' }));
    formData.append('personId', String(personId));
    formData.append('title', 'Test Photo');
    formData.append('isPrimary', 'false');
    if (uploadIntentId) formData.append('uploadIntentId', uploadIntentId);
    return new NextRequest('http://localhost:3000/api/media/upload', {
        method: 'POST',
        body: formData,
    });
}

/** Insert a media record with a given FileSize to simulate existing storage usage. */
async function seedStorageUsage(_personId: number, fileSizeBytes: number): Promise<void> {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    await query(
        `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize")
         VALUES ($1, $2, 'existing photo', 'existing.jpg', 'JPEG', 'image/jpeg', $3)`,
        [TEST_USER.id, treeId, fileSizeBytes]
    );
}

describeIf('Media storage limit', () => {
    let personId: number;

    beforeEach(async () => {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: 'Alice', LastName: 'Wonderland' },
        }));
        const data = await parseResponse<{ person: { Id: number } }>(res);
        personId = data.person.Id;
    });

    afterEach(async () => {
        await cleanupTestData();
        vi.unstubAllEnvs();
    });

    // -------------------------------------------------------------------------
    // Regular upload path
    // -------------------------------------------------------------------------

    describe('regular upload (no query params)', () => {
        it('succeeds when storage is under the 100MB limit', async () => {
            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1024));
            expect(res.status).toBe(201);
        });

        it('stores FileSize on the created Media record', async () => {
            const fileSize = 8192;
            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, fileSize));
            expect(res.status).toBe(201);

            const data = await parseResponse<{ media: { Id: number; FileSize: number } }>(res);
            // FileSize reflects the compressed output size, not the raw upload size
            expect(data.media.FileSize).toBe(Buffer.from('fake-compressed-jpeg').length);
        });

        it('returns 507 when upload would push usage over 100MB', async () => {
            // Seed storage leaving only 1 byte free — any compressed output exceeds the limit
            await seedStorageUsage(personId, LIMIT_BYTES - 1);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 2 * 1024 * 1024));
            expect(res.status).toBe(507);

            const data = await parseResponse<{ error: string }>(res);
            expect(data.error).toMatch(/storage limit/i);
        });

        it('returns 507 when existing usage exactly equals the limit', async () => {
            await seedStorageUsage(personId, LIMIT_BYTES);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1));
            expect(res.status).toBe(507);
        });

        it('bypasses the storage limit when DESKTOP_MODE=true', async () => {
            vi.stubEnv('DESKTOP_MODE', 'true');

            // Seed storage well over the limit
            await seedStorageUsage(personId, LIMIT_BYTES + 1024);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1024));
            expect(res.status).toBe(201);
        });
    });

    // -------------------------------------------------------------------------
    // Env-configurable limits (#489). Both are read at call time, so stubbing
    // the env in a test is enough — nothing is captured at module load.
    // -------------------------------------------------------------------------

    describe('configurable limits', () => {
        it('MEDIA_TREE_QUOTA_BYTES lowers the per-tree quota', async () => {
            vi.stubEnv('MEDIA_TREE_QUOTA_BYTES', '2048');
            // Well under the 100MB default, so this 507 can only come from the override.
            await seedStorageUsage(personId, 2048);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1024));
            expect(res.status).toBe(507);
        });

        it('MEDIA_TREE_QUOTA_BYTES raises the per-tree quota', async () => {
            vi.stubEnv('MEDIA_TREE_QUOTA_BYTES', String(LIMIT_BYTES * 10));
            // Over the default limit, so a 201 can only come from the override.
            await seedStorageUsage(personId, LIMIT_BYTES + 1024);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1024));
            expect(res.status).toBe(201);
        });

        it('MEDIA_MAX_FILE_BYTES rejects an oversized file with 413 and the limit (#1215)', async () => {
            vi.stubEnv('MEDIA_MAX_FILE_BYTES', '512');

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 4096));
            expect(res.status).toBe(413);

            const data = await parseResponse<{ error: string }>(res);
            // The message interpolates the configured value rather than "10MB",
            // and scales the unit — a sub-MB limit must not render as "0.0MB".
            expect(data.error).toMatch(/file size exceeds/i);
            expect(data.error).not.toMatch(/10MB/);
            expect(data.error).toContain('512 bytes');
        });

        it('still renders the default per-file limit as "10MB"', async () => {
            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 11 * 1024 * 1024));
            expect(res.status).toBe(413);

            const data = await parseResponse<{ error: string; code: string; limitBytes: number }>(res);
            expect(data.error).toBe('File size exceeds 10MB limit');
            expect(data).toMatchObject({ code: 'file_too_large', limitBytes: 10 * 1024 * 1024 });
        });

        it('the per-file cap is skipped when DESKTOP_MODE=true', async () => {
            vi.stubEnv('MEDIA_MAX_FILE_BYTES', '512');
            vi.stubEnv('DESKTOP_MODE', 'true');

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 4096));
            expect(res.status).toBe(201);
        });

        it('a malformed value falls back to the default rather than disabling the limit', async () => {
            vi.stubEnv('MEDIA_TREE_QUOTA_BYTES', 'not-a-number');
            await seedStorageUsage(personId, LIMIT_BYTES);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1024));
            expect(res.status).toBe(507);
        });

        it('serializes concurrent uploads so they cannot jointly exceed the tree quota', async () => {
            vi.stubEnv('MEDIA_TREE_QUOTA_BYTES', '25');

            const responses = await Promise.all([
                UPLOAD_MEDIA(makeUploadRequest(personId, 1024)),
                UPLOAD_MEDIA(makeUploadRequest(personId, 1024)),
            ]);

            expect(responses.map(response => response.status).sort()).toEqual([201, 507]);
            const treeId = await resolveDefaultTree(TEST_USER.id);
            const stored = await query(
                `SELECT COALESCE(SUM("FileSize"), 0)::text AS total FROM "Media" WHERE "TreeId" = $1`,
                [treeId],
            );
            expect(Number((stored.rows[0] as { total?: string } | undefined)?.total)).toBeLessThanOrEqual(25);
        });

        it('returns the stored row for a concurrent upload-intent replay at the quota boundary', async () => {
            vi.stubEnv('MEDIA_TREE_QUOTA_BYTES', String(Buffer.from('fake-compressed-jpeg').length));
            const intent = '11111111-2222-3333-4444-555555555555';

            const responses = await Promise.all([
                UPLOAD_MEDIA(makeUploadRequest(personId, 1024, intent)),
                UPLOAD_MEDIA(makeUploadRequest(personId, 1024, intent)),
            ]);
            expect(responses.map(response => response.status)).toEqual([201, 201]);

            const payloads = await Promise.all(responses.map(response => parseResponse<{ media: { Id: number } }>(response)));
            expect(payloads[0]?.media.Id).toBe(payloads[1]?.media.Id);
            const treeId = await resolveDefaultTree(TEST_USER.id);
            const stored = await query(
                `SELECT COUNT(*)::text AS count FROM "Media" WHERE "TreeId" = $1 AND "UploadIntentId" = $2`,
                [treeId, intent],
            );
            expect((stored.rows[0] as { count?: string } | undefined)?.count).toBe('1');
        });
    });

    // -------------------------------------------------------------------------
    // ENOSPC error path
    // -------------------------------------------------------------------------

    describe('ENOSPC filesystem error', () => {
        let writeFileMock: MockInstance;

        beforeEach(async () => {
            const fsMock = await import('fs/promises');
            writeFileMock = fsMock.writeFile as unknown as MockInstance;
        });

        afterEach(() => {
            writeFileMock.mockResolvedValue(undefined);
        });

        it('returns 507 with storage-limit message when writeFile throws ENOSPC on regular upload', async () => {
            const enospc = Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
            writeFileMock.mockRejectedValueOnce(enospc);

            const res = await UPLOAD_MEDIA(makeUploadRequest(personId, 1024));
            expect(res.status).toBe(507);

            const data = await parseResponse<{
                error: string;
                usedBytes: number;
                limitBytes: number;
                remainingBytes: number;
            }>(res);
            expect(data.error).toMatch(/storage limit/i);
            expect(data.usedBytes).toBe(0);
            expect(data.limitBytes).toBe(LIMIT_BYTES);
            expect(data.remainingBytes).toBe(LIMIT_BYTES);
        });

    });
});
