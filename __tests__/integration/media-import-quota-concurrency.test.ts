import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/connection';
import { createMediaImportItem } from '@/lib/db/queries/media-import-items';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { materializeImportMediaService } from '@/lib/services/media-upload';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';
import { TEST_USER } from '../setup/test-helpers';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('sharp', () => ({
  default: () => ({
    rotate() { return this; },
    resize() { return this; },
    jpeg() { return this; },
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed')),
  }),
}));
vi.mock('@/lib/services/media-face-capture', () => ({
  captureFacesForMedia: vi.fn().mockResolvedValue({ captured: 0, caption: null }),
}));

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('hosted media import quota serialization', () => {
  beforeEach(async () => {
    await cleanupTestData();
    vi.stubEnv('DESKTOP_MODE', 'false');
    vi.stubEnv('MEDIA_TREE_QUOTA_BYTES', '10');
  });

  afterEach(async () => {
    await cleanupTestData();
    vi.unstubAllEnvs();
  });

  it('serializes SUM and metadata writes so concurrent items cannot jointly exceed quota', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const media = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title")
       VALUES ($1, $2, 'first'), ($1, $2, 'second') RETURNING "Id"`,
      [TEST_USER.id, treeId],
    );
    const executor = { query };
    const first = await createMediaImportItem({
      importId: 'quota-concurrent', documentMediaId: '@O1@', treeId,
      mediaId: (media.rows[0] as { Id: number }).Id,
      archivePath: 'media/O1/first.svg', originalFilename: 'first.svg',
    }, executor);
    const second = await createMediaImportItem({
      importId: 'quota-concurrent', documentMediaId: '@O2@', treeId,
      mediaId: (media.rows[1] as { Id: number }).Id,
      archivePath: 'media/O2/second.svg', originalFilename: 'second.svg',
    }, executor);
    // Different bytes, each within quota alone: identical bytes would be reused rather than stored twice (#858).
    const makeFile = (name: string) => new File([name.startsWith('first') ? '<svg/>' : '<svg />'], name, { type: 'image/svg+xml' });

    const outcomes = await Promise.all([
      materializeImportMediaService({
        itemId: first.id, archivePath: first.archivePath, file: makeFile('first.svg'),
        requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
      }),
      materializeImportMediaService({
        itemId: second.id, archivePath: second.archivePath, file: makeFile('second.svg'),
        requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.failureCode).sort()).toEqual([null, 'storage_capacity']);
    const statuses = await query(
      `SELECT "Status", "FailureCode" FROM "MediaImportItem" WHERE "TreeId" = $1 ORDER BY "Id"`,
      [treeId],
    );
    expect(statuses.rows.filter((row) => (row as { Status: string }).Status === 'ready')).toHaveLength(1);
    expect(statuses.rows.filter((row) => (row as { FailureCode: string | null }).FailureCode === 'storage_capacity')).toHaveLength(1);
  });
});
