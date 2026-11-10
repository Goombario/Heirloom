import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { POST as CHECK_DUPLICATES } from '@/app/api/media/duplicates/route';
import { parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { hashBytes } from '@/lib/media/content-hash';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
}));

// The compressed output is deliberately a fixed, different string. If the stored
// hash ever matched THIS instead of the original bytes, the assertions below
// would catch it — which is the whole point of hashing pre-compression (#592).
vi.mock('sharp', () => {
    const mockSharp = vi.fn(() => ({
        rotate: vi.fn().mockReturnThis(),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        metadata: vi.fn().mockResolvedValue({ width: 512, height: 512 }),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
    }));
    return { default: mockSharp };
});

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('duplicate guard end to end', () => {
    afterEach(async () => { await cleanupTestData(); });

    async function upload(bytes: Uint8Array, name = 'photo.jpg') {
        const formData = new FormData();
        formData.append('file', new File([bytes as BlobPart], name, { type: 'image/jpeg' }));
        const res = await UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
            method: 'POST', body: formData,
        }));
        return parseResponse<{ media: { Id: number; TreeId: number } }>(res);
    }

    async function check(hashes: string[], treeId: number) {
        const res = await CHECK_DUPLICATES(new NextRequest(
            `http://localhost:3000/api/media/duplicates?treeId=${treeId}`,
            { method: 'POST', body: JSON.stringify({ hashes }), headers: { 'Content-Type': 'application/json' } },
        ));
        return parseResponse<{ matches: { hash: string; mediaId: number; title: string | null; reason: string }[] }>(res);
    }

    it('stores the hash of the ORIGINAL bytes, not the compressed copy', async () => {
        const original = new TextEncoder().encode('the-original-uploaded-bytes');
        const { media } = await upload(original);

        const rows = await query(`SELECT "ContentHash" FROM "Media" WHERE "Id" = $1`, [media.Id]);
        const stored = (rows.rows[0] as { ContentHash: string }).ContentHash;

        expect(stored).toBe(await hashBytes(original));
        expect(stored).not.toBe(await hashBytes(Buffer.from('fake-compressed-jpeg')));
    });

    it('the pre-flight check then finds that upload by its hash', async () => {
        const original = new TextEncoder().encode('nan-and-grandad-1961');
        const { media } = await upload(original, 'nan-and-grandad-1961.jpg');
        const hash = await hashBytes(original);

        const { matches } = await check([hash], media.TreeId);
        expect(matches).toHaveLength(1);
        expect(matches[0].mediaId).toBe(media.Id);
        expect(matches[0].hash).toBe(hash);
        expect(matches[0].reason).toBe('in-tree');
    });

    it('does not report a hash the tree does not hold', async () => {
        const { media } = await upload(new TextEncoder().encode('something'));
        const { matches } = await check(['f'.repeat(64)], media.TreeId);
        expect(matches).toEqual([]);
    });

    it('uploading the same bytes twice is allowed and yields two rows sharing a hash', async () => {
        const original = new TextEncoder().encode('deliberate-second-copy');
        const first = await upload(original);
        const second = await upload(original);

        expect(second.media.Id).not.toBe(first.media.Id);

        const rows = await query(
            `SELECT "Id" FROM "Media" WHERE "ContentHash" = $1 AND "TreeId" = $2 ORDER BY "Id"`,
            [await hashBytes(original), first.media.TreeId],
        );
        expect(rows.rows).toHaveLength(2);
    });
});
