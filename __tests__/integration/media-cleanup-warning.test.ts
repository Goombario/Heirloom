import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// The disk cleanup is what fails here; everything else runs for real (#945).
const cleanup = vi.hoisted(() => ({ counting: vi.fn() }));
vi.mock('@/lib/media-thumbnail', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/media-thumbnail')>(),
  cleanupMediaFilesCounting: cleanup.counting,
}));

import { query } from '@/lib/db/connection';
import { POST as CREATE_TREE } from '@/app/api/trees/route';
import { DELETE as DELETE_TREE } from '@/app/api/trees/[id]/route';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createRequest, parseResponse, TEST_USER } from '../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';
import type { Tree } from '@/lib/db/schema';

const d = hasTestDatabase() ? describe : describe.skip;

async function addMediaFile(treeId: number, filePath: string): Promise<void> {
  await query(
    `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath") VALUES ($1, $2, 'Photo', $3)`,
    [TEST_USER.id, treeId, filePath],
  );
}

d('media files left on disk are reported, not hidden (#945)', () => {
  beforeEach(() => cleanup.counting.mockReset());
  afterEach(async () => { await cleanupTestData(); });

  it('tree delete still succeeds and returns how many files stayed on disk', async () => {
    await resolveDefaultTree(TEST_USER.id); // the last tree can't be deleted
    const res = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name: 'Doomed' } }));
    const { tree } = await parseResponse<{ tree: Tree }>(res);
    await addMediaFile(tree.Id, 'a.jpg');
    await addMediaFile(tree.Id, 'b.jpg');
    cleanup.counting.mockResolvedValue(2);

    const del = await DELETE_TREE(
      createRequest(`http://localhost:3000/api/trees/${tree.Id}`, { method: 'DELETE', headers: { 'X-Confirm-Delete-Tree': 'CONFIRM_DELETE_TREE' } }),
      { params: Promise.resolve({ id: String(tree.Id) }) },
    );

    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ cleanupWarningCount: 2 });
    expect(cleanup.counting).toHaveBeenCalledWith(TEST_USER.id, expect.arrayContaining(['a.jpg', 'b.jpg']));
    expect((await query(`SELECT 1 FROM "Trees" WHERE "Id" = $1`, [tree.Id])).rows).toEqual([]);
  });

  it('an overwrite import reports the count and a warning, and a clean one reports neither', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const ged = new File(['0 HEAD\n0 @I1@ INDI\n1 NAME Ada /Test/\n0 TRLR'], 'tree.ged', { type: 'text/plain' });

    await addMediaFile(treeId, 'old.jpg');
    cleanup.counting.mockResolvedValue(1);
    const failed = await importGedcomService({ file: ged, mode: 'overwrite', currentUserId: TEST_USER.id });
    expect(failed.success).toBe(true);
    expect(failed.cleanupWarningCount).toBe(1);
    expect(failed.warnings).toContainEqual({ code: 'media_cleanup_failed', values: { count: 1 } });

    await addMediaFile(treeId, 'older.jpg');
    cleanup.counting.mockResolvedValue(0);
    const clean = await importGedcomService({ file: ged, mode: 'overwrite', currentUserId: TEST_USER.id });
    expect(clean.cleanupWarningCount).toBe(0);
    expect(clean.warnings.map((w) => w.code)).not.toContain('media_cleanup_failed');
  });
});
