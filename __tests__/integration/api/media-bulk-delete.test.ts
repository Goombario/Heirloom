import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE as DELETE_MEDIA, POST as CREATE_MEDIA } from '@/app/api/media/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { query } from '@/lib/db/connection';
import * as rateLimitModule from '@/lib/rate-limit';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API DELETE /api/media (bulk)', () => {
  afterEach(async () => {
    await query('DROP TRIGGER IF EXISTS "fail_bulk_media_delete_trigger" ON "Media"');
    await query('DROP FUNCTION IF EXISTS "fail_bulk_media_delete"()');
    await cleanupTestData();
  });

  async function createMedia(title: string): Promise<number> {
    const response = await CREATE_MEDIA(createRequest('http://localhost:3000/api/media', {
      method: 'POST', body: { Title: title },
    }));
    expect(response.status).toBe(201);
    return (await parseResponse<{ media: { Id: number } }>(response)).media.Id;
  }

  function removeMany(ids: unknown, treeId?: number): Promise<Response> {
    const queryString = treeId == null ? '' : `?treeId=${treeId}`;
    return DELETE_MEDIA(createRequest(`http://localhost:3000/api/media${queryString}`, {
      method: 'DELETE', body: { ids },
    }));
  }

  function removeManyWithQuery(queryString: string, ids: unknown): Promise<Response> {
    return DELETE_MEDIA(createRequest(`http://localhost:3000/api/media?${queryString}`, {
      method: 'DELETE', body: { ids },
    }));
  }

  it('returns 401 before parsing an unauthenticated request', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const request = new NextRequest('http://localhost:3000/api/media', {
      method: 'DELETE', body: '{', headers: { 'Content-Type': 'application/json' },
    });

    expect((await DELETE_MEDIA(request)).status).toBe(401);
  });

  it('returns a stable 429 before parsing or mutating an exhausted user bucket', async () => {
    const existing = await createMedia('rate-limited');
    const limiter = vi.spyOn(rateLimitModule, 'rateLimit').mockReturnValue({ success: false, remaining: 0, retryAfterMs: 60_000 });
    try {
      const response = await DELETE_MEDIA(new NextRequest('http://localhost:3000/api/media', {
        method: 'DELETE', body: '{', headers: { 'Content-Type': 'application/json' },
      }));
      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({ error: 'Too many media delete requests. Please try again later.' });
      expect((await query('SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1', [existing])).rows[0].count).toBe(1);
    } finally {
      limiter.mockRestore();
    }
  });

  it('rejects request-wide malformed JSON and invalid id batches before mutation', async () => {
    const existing = await createMedia('untouched');
    const malformed = new NextRequest('http://localhost:3000/api/media', {
      method: 'DELETE', body: '{', headers: { 'Content-Type': 'application/json' },
    });
    expect((await DELETE_MEDIA(malformed)).status).toBe(400);

    const invalidInputs: unknown[] = [
      'not-an-array', [], [existing, existing], [0], ['1'],
      Array.from({ length: 101 }, (_, index) => index + 1),
    ];
    for (const ids of invalidInputs) {
      expect((await removeMany(ids)).status).toBe(400);
    }

    expect((await query('SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1', [existing])).rows[0].count)
      .toBe(1);
  });

  it('rejects malformed explicit tree and legacy owner scope parameters', async () => {
    const existing = await createMedia('scope-untouched');
    const malformedScopes = [
      'treeId=abc', 'treeId=1junk', 'treeId=0', 'treeId=-1',
      'ownerId=abc', 'ownerId=1junk', 'ownerId=0', 'ownerId=-1',
    ];

    for (const scope of malformedScopes) {
      const response = await removeManyWithQuery(scope, [existing]);
      expect(response.status, scope).toBe(400);
    }
    expect((await query('SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1', [existing])).rows[0].count)
      .toBe(1);
  });

  it.each(['view', 'contribute'] as const)('returns 403 for %s permission before mutation', async (permission) => {
    const mediaId = await createMedia(`protected-${permission}`);
    const tree = (await query(
      'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" LIMIT 1', [TEST_USER.id],
    )).rows[0] as { Id: number };
    await query(
      'INSERT INTO "TreeSharing" ("TreeId", "OwnerId", "SharedWithId", "Permission") VALUES ($1, $2, $3, $4)',
      [tree.Id, TEST_USER.id, TEST_USER_2.id, permission],
    );
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);

    const response = await removeMany([mediaId], tree.Id);
    expect(response.status).toBe(403);
    expect((await query('SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1', [mediaId])).rows[0].count)
      .toBe(1);
    expect((await query('SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE "Action" = \'delete\' AND "EntityId" = $1', [mediaId])).rows[0].count)
      .toBe(0);
  });

  it('returns stable mixed outcomes, counts, audit, and cascade results', async () => {
    const personResponse = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST', body: { FirstName: 'Bulk', LastName: 'Subject' },
    }));
    const personId = (await parseResponse<{ person: { Id: number } }>(personResponse)).person.Id;
    const deleted = await createMedia('deleted');
    const second = await createMedia('second');
    await query(
      'INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, $2, 1, 2, 3, 4)',
      [deleted, personId],
    );

    const foreignTree = (await query(
      'INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"',
      [TEST_USER_2.id, 'Foreign bulk tree'],
    )).rows[0] as { Id: number };
    const foreignMedia = (await query(
      'INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath") VALUES ($1, $2, $3, $4) RETURNING "Id"',
      [TEST_USER_2.id, foreignTree.Id, 'foreign', 'foreign.jpg'],
    )).rows[0] as { Id: number };

    const response = await removeMany([second, 999999, deleted, foreignMedia.Id]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        { id: second, status: 'deleted', cleanupWarning: null },
        { id: 999999, status: 'skipped', code: 'not_found', retryable: false },
        { id: deleted, status: 'deleted', cleanupWarning: null },
        { id: foreignMedia.Id, status: 'skipped', code: 'not_found', retryable: false },
      ],
      deletedCount: 2,
      skippedCount: 2,
      failedCount: 0,
      cleanupWarningCount: 0,
    });
    expect((await query(
      'SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE "Action" = \'delete\' AND "EntityType" = \'media\'',
    )).rows[0].count).toBe(2);
    expect((await query('SELECT COUNT(*)::int AS count FROM "MediaTag" WHERE "MediaId" = $1', [deleted])).rows[0].count)
      .toBe(0);
    expect((await query('SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1', [foreignMedia.Id])).rows[0].count)
      .toBe(1);
  });

  it('retries only a retryable failure on the next request', async () => {
    const good = await createMedia('good');
    const retry = await createMedia('retry');
    await query(`CREATE FUNCTION "fail_bulk_media_delete"() RETURNS trigger AS $$
      BEGIN IF OLD."Title" = 'retry' THEN RAISE EXCEPTION 'forced bulk delete failure'; END IF; RETURN OLD; END;
      $$ LANGUAGE plpgsql`);
    await query('CREATE TRIGGER "fail_bulk_media_delete_trigger" BEFORE DELETE ON "Media" FOR EACH ROW EXECUTE FUNCTION "fail_bulk_media_delete"()');

    const first = await removeMany([good, retry]);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      results: [
        { id: good, status: 'deleted', cleanupWarning: null },
        { id: retry, status: 'failed', code: 'delete_failed', retryable: true },
      ],
      deletedCount: 1,
      failedCount: 1,
    });

    await query('DROP TRIGGER "fail_bulk_media_delete_trigger" ON "Media"');
    const second = await removeMany([retry]);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      results: [{ id: retry, status: 'deleted', cleanupWarning: null }],
      deletedCount: 1,
      failedCount: 0,
    });
    expect((await query(
      'SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE "Action" = \'delete\' AND "EntityType" = \'media\'',
    )).rows[0].count).toBe(2);
  });
});
