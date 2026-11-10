import { describe, it, expect } from 'vitest';
import { createMedia, findMediaByHashes } from '@/lib/db/queries/media';
import { hashBytes } from '@/lib/media/content-hash';
import { hasTestDatabase } from '../../setup/db-helpers';
import { getTestUserIds } from '../../setup/test-user-ids';

const describeIf = hasTestDatabase() ? describe : describe.skip;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

// Tree ids well outside anything the other suites seed. "Media" has no foreign
// key on "TreeId", so these need no Trees rows — the query under test only ever
// compares the column.
const TREE_A = 9101;
const TREE_B = 9102;
const TREE_C = 9103;
const TREE_D = 9104;

function mediaRow(treeId: number, userId: number, over: Partial<Parameters<typeof createMedia>[0]> = {}) {
    return {
        UserId: userId,
        TreeId: treeId,
        Title: 'Untitled',
        FilePath: 'x.jpg',
        Format: 'JPG',
        ContentType: 'image/jpeg',
        IsPrimary: 0,
        PersonId: null,
        FileSize: 10,
        ...over,
    };
}

describeIf('findMediaByHashes', () => {
    it('finds a hash in its own tree and ignores one in another tree', async () => {
        const { user1 } = getTestUserIds();

        await createMedia(mediaRow(TREE_A, user1, {
            Title: 'Wedding portrait, 1961', ContentHash: HASH_A,
        }), user1);
        await createMedia(mediaRow(TREE_B, user1, {
            Title: 'Other tree photo', ContentHash: HASH_B,
        }), user1);

        const matches = await findMediaByHashes([HASH_A, HASH_B], TREE_A);
        expect(matches).toHaveLength(1);
        expect(matches[0].ContentHash).toBe(HASH_A);
        expect(matches[0].Title).toBe('Wedding portrait, 1961');
    });

    it('returns nothing for an empty hash list without querying', async () => {
        expect(await findMediaByHashes([], TREE_A)).toEqual([]);
    });

    it('never matches rows whose hash is NULL', async () => {
        const { user1 } = getTestUserIds();
        await createMedia(mediaRow(TREE_C, user1, { Title: 'Legacy row' }), user1);

        expect(await findMediaByHashes(['c'.repeat(64)], TREE_C)).toEqual([]);
    });

    it('returns one row per hash even when the tree holds several copies', async () => {
        const { user1 } = getTestUserIds();
        const hash = 'd'.repeat(64);
        await createMedia(mediaRow(TREE_D, user1, { Title: 'First copy', ContentHash: hash }), user1);
        await createMedia(mediaRow(TREE_D, user1, { Title: 'Second copy', ContentHash: hash }), user1);

        const matches = await findMediaByHashes([hash], TREE_D);
        expect(matches).toHaveLength(1);
        // The earliest row wins, so the name shown to the user is stable.
        expect(matches[0].Title).toBe('First copy');
    });
});

describeIf('upload paths persist ContentHash', () => {
    it('round-trips a real hash of original bytes through create and lookup', async () => {
        const { user1 } = getTestUserIds();
        const treeId = 9105;
        const original = Buffer.from('original-bytes-that-differ-from-the-compressed-copy');
        const expected = await hashBytes(original);

        const media = await createMedia(mediaRow(treeId, user1, {
            Title: 'Nan and Grandad', FileSize: original.length, ContentHash: expected,
        }), user1);

        expect(media.ContentHash).toBe(expected);
        expect(media.ContentHash).toMatch(/^[a-f0-9]{64}$/);

        const matches = await findMediaByHashes([expected], treeId);
        expect(matches.map(m => m.Id)).toContain(media.Id);
    });
});
