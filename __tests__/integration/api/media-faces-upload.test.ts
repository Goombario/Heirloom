import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { buildJpegWithXmp, mwgPacket, captionPacket } from '../../fixtures/xmp/build-fixture';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
}));

// sharp STRIPS XMP, which is exactly why capture must run on the original bytes.
// Mocking it out proves the upload path does not depend on the compressed copy.
vi.mock('sharp', () => {
    const mockSharp = vi.fn(() => ({
        rotate: vi.fn().mockReturnThis(),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        metadata: vi.fn().mockResolvedValue({ width: 2048, height: 2048 }),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
    }));
    return { default: mockSharp };
});

const describeIf = hasTestDatabase() ? describe : describe.skip;

/**
 * The wire between an UPLOAD and the face queue. Every other face test calls
 * `captureFacesForMedia` directly, so a broken call site in the upload service
 * would fail nothing (#487 review).
 */
describeIf('POST /api/media/upload stages face candidates', () => {
    afterEach(async () => { await cleanupTestData(); });

    async function upload(bytes: Uint8Array, fields: Record<string, string> = {}) {
        const formData = new FormData();
        formData.append('file', new File([bytes as BlobPart], 'reunion.jpg', { type: 'image/jpeg' }));
        for (const [k, v] of Object.entries(fields)) formData.append(k, v);
        const res = await UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
            method: 'POST', body: formData,
        }));
        return parseResponse<{ media: { Id: number; TreeId: number; Title: string; FacesFound?: number } }>(res);
    }

    it('an uploaded photo with XMP regions produces MediaFaceCandidate rows', async () => {
        const bytes = buildJpegWithXmp(mwgPacket([
            { name: 'Ada Whitcombe', x: 0.354167, y: 0.241848, w: 0.0542636, h: 0.101902 },
            { name: 'Rex Pike', x: 0.6, y: 0.3, w: 0.05, h: 0.1 },
        ]));
        const { media } = await upload(bytes, { title: 'Reunion' });

        const rows = await query(
            `SELECT "SourceName", "TreeId", "Status", "RegionX" FROM "MediaFaceCandidate"
              WHERE "MediaId" = $1 ORDER BY "SourceName"`, [media.Id]);
        const candidates = rows.rows as { SourceName: string; TreeId: number; Status: string; RegionX: number }[];
        expect(candidates.map(c => c.SourceName)).toEqual(['Ada Whitcombe', 'Rex Pike']);
        expect(candidates.every(c => c.TreeId === media.TreeId)).toBe(true);
        expect(candidates.every(c => c.Status === 'pending')).toBe(true);
        expect(candidates[0].RegionX).toBeCloseTo(32.7035, 2);
        expect(media.FacesFound).toBe(2);
    });

    it('an uploaded photo with no regions stages nothing and still uploads', async () => {
        const { media } = await upload(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { title: 'Plain' });
        expect(media.Id).toBeGreaterThan(0);
        const rows = await query(`SELECT 1 FROM "MediaFaceCandidate" WHERE "MediaId" = $1`, [media.Id]);
        expect(rows.rows).toHaveLength(0);
    });

    it('fills an untitled upload from the photo caption', async () => {
        const { media } = await upload(buildJpegWithXmp(captionPacket('With all my love, Emm, June 1936')));
        expect(media.Title).toBe('With all my love, Emm, June 1936');
    });
});
