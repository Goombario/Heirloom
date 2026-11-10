import { describe, it, expect, afterEach } from 'vitest';
import { POST as CREATE_MEDIA } from '@/app/api/media/route';
import { GET as LIST_MEDIA } from '@/app/api/media/route';
import { POST as SET_PRIMARY, DELETE as CLEAR_PRIMARY } from '@/app/api/media/[id]/primary/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { GET as LIST_TAGS, POST as ADD_TAG } from '@/app/api/media/[id]/tags/route';
import { createRequest, parseResponse, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase, onPglite } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { clearPrimaryMediaForPerson, setPrimaryMediaForPerson } from '@/lib/services/media';
import { NotFoundError, PrimaryMediaConflictError } from '@/lib/data/errors';
import { throwForStatus } from '@/lib/data/http/shared';

const describeIf = hasTestDatabase() ? describe : describe.skip;
const REGION = { RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 };

describeIf('Canonical MediaLink set-primary', () => {
  afterEach(async () => {
    await query(`DROP TRIGGER IF EXISTS "trace_media_primary_race_trigger" ON "MediaLink"`);
    await query(`DROP TRIGGER IF EXISTS "force_media_primary_conflict_trigger" ON "MediaLink"`);
    await query(`DROP FUNCTION IF EXISTS "trace_media_primary_race"()`);
    await query(`DROP FUNCTION IF EXISTS "force_media_primary_conflict"()`);
    await query(`DROP TABLE IF EXISTS "_MediaPrimaryRaceTrace"`);
    await cleanupTestData();
  });

  const person = async (n: string) => {
    const r = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST', body: { FirstName: n, LastName: 'Prim' } }));
    return (await parseResponse<{ person: { Id: number } }>(r)).person.Id;
  };
  const media = async (pid: number | null) => {
    const r = await CREATE_MEDIA(createRequest('http://localhost:3000/api/media', {
      method: 'POST', body: { PersonId: pid, Title: 'Photo' } }));
    return (await parseResponse<{ media: { Id: number } }>(r)).media.Id;
  };
  const tag = (mid: number, pid: number) => ADD_TAG(
    createRequest(`http://localhost:3000/api/media/${mid}/tags`, { method: 'POST', body: { PersonId: pid, ...REGION } }),
    { params: Promise.resolve({ id: String(mid) }) });
  const setPrimary = (mid: number, pid: number) => SET_PRIMARY(
    createRequest(`http://localhost:3000/api/media/${mid}/primary`, { method: 'POST', body: { personId: pid } }),
    { params: Promise.resolve({ id: String(mid) }) });
  const tagsOf = async (mid: number) => {
    const r = await LIST_TAGS(createRequest(`http://localhost:3000/api/media/${mid}/tags`), { params: Promise.resolve({ id: String(mid) }) });
    return (await parseResponse<{ tags: { PersonId: number; RegionX: number }[] }>(r)).tags;
  };
  const galleryPrimary = async (pid: number) => {
    const r = await LIST_MEDIA(createRequest(`http://localhost:3000/api/media?personId=${pid}&includeTagged=true`));
    const { media: rows } = await parseResponse<{ media: { Id: number; IsPersonPrimary: boolean }[] }>(r);
    return rows.find(m => m.IsPersonPrimary)?.Id ?? null;
  };

  const primaryLinks = async (mediaId: number) => (await query(
    `SELECT "OwnerId", "IsPrimary" FROM "MediaLink"
     WHERE "MediaId" = $1 AND "OwnerTable" = 'People' AND "IsPrimary" = 1
     ORDER BY "OwnerId"`,
    [mediaId],
  )).rows;
  const treeOf = async (mediaId: number): Promise<number> => (
    (await query(`SELECT "TreeId" FROM "Media" WHERE "Id" = $1`, [mediaId])).rows[0].TreeId
  );

  it('rejects non-positive media and person IDs at the route boundary', async () => {
    expect((await setPrimary(0, 1)).status).toBe(400);
    expect((await setPrimary(1, 0)).status).toBe(400);
  });

  it('keeps primary state owner-specific when one media is shared by two people', async () => {
    const ada = await person('Ada');
    const grace = await person('Grace');
    const shared = await media(ada);
    expect((await tag(shared, grace)).status).toBe(201);
    const treeId = await treeOf(shared);

    await setPrimaryMediaForPerson({ mediaId: shared, personId: ada, treeId, actingUserId: TEST_USER.id });
    await setPrimaryMediaForPerson({ mediaId: shared, personId: grace, treeId, actingUserId: TEST_USER.id });

    expect(await primaryLinks(shared)).toEqual([
      { OwnerId: ada, IsPrimary: 1 },
      { OwnerId: grace, IsPrimary: 1 },
    ]);

    const graceAudit = await query(
      `SELECT "Changes" FROM "AuditLog"
       WHERE "EntityType" = 'media'
         AND "Changes"->>'personId' = $1
         AND "Changes"->'fields' ? 'CanonicalPrimaryMediaId'
       ORDER BY "Id" DESC LIMIT 1`,
      [String(grace)],
    );
    expect(graceAudit.rows).toEqual([{
      Changes: {
        summary: { kind: 'canonical_primary' },
        personId: grace,
        fields: { CanonicalPrimaryMediaId: { old: null, new: shared } },
      },
    }]);

    await clearPrimaryMediaForPerson({ personId: grace, treeId, actingUserId: TEST_USER.id });
    const clearAudit = await query(
      `SELECT "Changes" FROM "AuditLog"
       WHERE "EntityType" = 'media'
         AND "Changes"->>'personId' = $1
         AND "Changes"->'fields' ? 'CanonicalPrimaryMediaId'
       ORDER BY "Id" DESC LIMIT 1`,
      [String(grace)],
    );
    expect(clearAudit.rows).toEqual([{
      Changes: {
        summary: { kind: 'canonical_primary' },
        personId: grace,
        fields: { CanonicalPrimaryMediaId: { old: shared, new: null } },
      },
    }]);
  });

  it.skipIf(onPglite())('serializes two real PostgreSQL sessions and leaves exactly one primary', async () => {
    const ada = await person('Concurrent');
    const first = await media(ada);
    const second = await media(ada);
    const treeId = await treeOf(first);
    await query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId")
       VALUES ($1, 'People', $3), ($2, 'People', $3)
       ON CONFLICT DO NOTHING`,
      [first, second, ada],
    );
    await query(`CREATE TABLE "_MediaPrimaryRaceTrace" ("BackendPid" INTEGER NOT NULL)`);
    await query(`
      CREATE FUNCTION "trace_media_primary_race"() RETURNS trigger AS $$
      BEGIN
        IF NEW."IsPrimary" = 1 THEN
          INSERT INTO "_MediaPrimaryRaceTrace" ("BackendPid") VALUES (pg_backend_pid());
          PERFORM pg_sleep(0.05);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      CREATE TRIGGER "trace_media_primary_race_trigger"
      BEFORE UPDATE OF "IsPrimary" ON "MediaLink"
      FOR EACH ROW EXECUTE FUNCTION "trace_media_primary_race"()
    `);

    const outcomes = await Promise.allSettled([
      setPrimaryMediaForPerson({ mediaId: first, personId: ada, treeId, actingUserId: TEST_USER.id }),
      setPrimaryMediaForPerson({ mediaId: second, personId: ada, treeId, actingUserId: TEST_USER.id }),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const final = await query(
      `SELECT "MediaId" FROM "MediaLink"
       WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
      [ada],
    );
    expect(final.rows).toHaveLength(1);
    expect([first, second]).toContain(final.rows[0].MediaId);
    const sessions = await query(
      `SELECT COUNT(DISTINCT "BackendPid")::int AS n FROM "_MediaPrimaryRaceTrace"`,
    );
    expect(sessions.rows[0].n).toBe(2);
  });

  it('maps a unique-index 23505 to a retryable typed HTTP 409 outcome', async () => {
    const ada = await person('Conflict');
    const selected = await media(ada);
    await query(`
      CREATE FUNCTION "force_media_primary_conflict"() RETURNS trigger AS $$
      BEGIN
        IF NEW."IsPrimary" = 1 THEN
          RAISE EXCEPTION 'forced primary conflict' USING ERRCODE = '23505';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      CREATE TRIGGER "force_media_primary_conflict_trigger"
      BEFORE UPDATE OF "IsPrimary" ON "MediaLink"
      FOR EACH ROW EXECUTE FUNCTION "force_media_primary_conflict"()
    `);

    const res = await setPrimary(selected, ada);
    expect(res.status).toBe(409);
    expect(await res.clone().json()).toMatchObject({
      code: 'primary_conflict',
      retryable: true,
    });
    const reconstructed = throwForStatus(res.clone());
    await expect(reconstructed).rejects.toBeInstanceOf(PrimaryMediaConflictError);
    await expect(reconstructed).rejects.toMatchObject({
      code: 'primary_conflict',
      retryable: true,
    });
  });

  it('treats missing or foreign-tree people and media as not found', async () => {
    const ada = await person('Scoped');
    const selected = await media(ada);
    const treeId = await treeOf(selected);
    await expect(setPrimaryMediaForPerson({
      mediaId: selected,
      personId: 999999,
      treeId,
      actingUserId: TEST_USER.id,
    })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setPrimaryMediaForPerson({
      mediaId: 999999,
      personId: ada,
      treeId,
      actingUserId: TEST_USER.id,
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps face geometry independent when an owned photo becomes primary', async () => {
    const alice = await person('Alice');
    const m = await media(alice);          // Alice owns it
    await tag(m, alice);                    // …and is tagged
    await setPrimary(m, alice);
    const t = (await tagsOf(m)).find(x => x.PersonId === alice)!;
    expect(t.RegionX).toBe(REGION.RegionX);
    expect(await galleryPrimary(alice)).toBe(m);
  });

  it('tagging a person on their existing primary photo preserves the canonical primary link', async () => {
    const grace = await person('Grace');
    const m = await media(grace);           // Grace owns it
    await setPrimary(m, grace);
    expect((await tagsOf(m)).length).toBe(0);
    await tag(m, grace);
    const t = (await tagsOf(m)).find(x => x.PersonId === grace)!;
    expect(t.RegionX).toBe(REGION.RegionX);
    expect(await galleryPrimary(grace)).toBe(m);
  });

  it('supports a canonical primary photo without a face tag', async () => {
    const bob = await person('Bob');
    const m = await media(bob);
    await setPrimary(m, bob);               // no tag drawn
    expect(await galleryPrimary(bob)).toBe(m);
    expect((await tagsOf(m)).length).toBe(0);
  });

  it('refuses a PDF document as a portrait or a face tag target (#510)', async () => {
    const ann = await person('Ann');
    const r = await CREATE_MEDIA(createRequest('http://localhost:3000/api/media', {
      method: 'POST', body: { PersonId: ann, Title: 'Register', ContentType: 'application/pdf', Format: 'PDF' } }));
    const doc = (await parseResponse<{ media: { Id: number } }>(r)).media.Id;

    expect((await setPrimary(doc, ann)).status).toBe(400);
    expect((await tag(doc, ann)).status).toBe(400);
    expect(await galleryPrimary(ann)).toBeNull();
    expect(await tagsOf(doc)).toEqual([]);
  });

  it('supports a person-specific canonical primary on shared tagged media', async () => {
    const owner = await person('Owner');
    const carol = await person('Carol');
    const m = await media(owner);
    await tag(m, carol);
    await setPrimary(m, carol);
    const t = (await tagsOf(m)).find(x => x.PersonId === carol)!;
    expect(t.RegionX).toBe(REGION.RegionX);
    expect(await galleryPrimary(carol)).toBe(m);
  });

  it('clears a portrait only while it is still the portrait (#1051)', async () => {
    const p = await person('Clear');
    const [a, b] = [await media(p), await media(p)];
    expect((await setPrimary(a, p)).status).toBe(200);
    const clear = (mid: number, pid: string) => CLEAR_PRIMARY(
      createRequest(`http://localhost:3000/api/media/${mid}/primary?personId=${pid}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: String(mid) }) });
    expect((await clear(a, 'x')).status).toBe(400);
    expect((await parseResponse<{ auditIds: number[] }>(await clear(b, String(p)))).auditIds).toEqual([]);
    expect(await galleryPrimary(p)).toBe(a);
    expect((await parseResponse<{ auditIds: number[] }>(await clear(a, String(p)))).auditIds).toHaveLength(1);
    expect(await galleryPrimary(p)).toBeNull();
  });

  it('set-primary is exclusive per person', async () => {
    const dave = await person('Dave');
    const m1 = await media(dave); await tag(m1, dave); await setPrimary(m1, dave);
    const m2 = await media(dave); await tag(m2, dave); await setPrimary(m2, dave);
    expect(await galleryPrimary(dave)).toBe(m2);
    expect(await primaryLinks(m1)).toEqual([]);
  });

  it('schema initialization is idempotent for canonical primary links and tag geometry', async () => {
    const { query } = await import('@/lib/db/connection');
    const { initializeSchema } = await import('@/lib/db/init-schema');
    const executor = { query: (text: string, params?: unknown[]) => query(text, params) };
    const eve = await person('Eve');
    const m = await media(eve);                 // Eve owns it
    await tag(m, eve);
    await setPrimary(m, eve);

    await initializeSchema(executor);

    expect(await primaryLinks(m)).toEqual([{ OwnerId: eve, IsPrimary: 1 }]);
    expect((await tagsOf(m)).find(x => x.PersonId === eve)?.RegionX).toBe(REGION.RegionX);

    await initializeSchema(executor);
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM "MediaLink"
       WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
      [eve],
    );
    expect(rows[0].n).toBe(1);
  });
});
