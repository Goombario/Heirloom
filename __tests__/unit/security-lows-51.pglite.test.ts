import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { addCommentService, createCaseService, updateCaseService } from '@/lib/services/cases';
import { listAuditService, revertAuditService } from '@/lib/services/audit';
import { renamePlaceService, getPlaceCoordsService } from '@/lib/services/places';
import { createFamilyService } from '@/lib/services/families';
import { AccessError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** Regression tests for the security audit's Low findings (#51). */

const OWNER = 1;
const CONTRIB = 2;
const VIEWER = 3;
const TREE = 1;
type Row = Record<string, unknown>;

describe('security audit Lows (#51)', () => {
    let db: PGlite;
    let ada: number;
    const as = (currentUserId: number) => ({ requestedTreeId: TREE, requestedOwnerId: null, currentUserId });
    const rows = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows as Row[];

    beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
    afterAll(async () => { __setTestDb(null); await db.close(); });
    beforeEach(async () => {
        await truncateAllTables(db);
        for (const [id, name] of [[OWNER, 'owner'], [CONTRIB, 'contrib'], [VIEWER, 'viewer']] as const) {
            await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId", "Name") VALUES ($1, $2, $3, $4)`, [id, `${name}@example.test`, name, name === 'owner' ? null : name]);
        }
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES ($1, $2, 'Arbor')`, [TREE, OWNER]);
        await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, 'contribute', $3), ($1, $4, 'view', $3)`, [OWNER, CONTRIB, TREE, VIEWER]);
        ada = Number((await rows(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, 'Ada', 'Moss') RETURNING "Id"`, [OWNER, TREE]))[0].Id);
    });

    it('L-5: a case update without personIds or mediaIds keeps its links', async () => {
        const created = await createCaseService({ body: { Title: 'Who was Ada?', personIds: [ada] }, ...as(OWNER) });
        await updateCaseService({ id: created.Id, body: { Title: 'Who was Ada Moss?' }, ...as(OWNER) });
        expect(await rows(`SELECT * FROM "CasePerson" WHERE "CaseId" = $1`, [created.Id])).toHaveLength(1);
        await updateCaseService({ id: created.Id, body: { personIds: [] }, ...as(OWNER) });
        expect(await rows(`SELECT * FROM "CasePerson" WHERE "CaseId" = $1`, [created.Id])).toHaveLength(0);
        await expect(updateCaseService({ id: created.Id, body: { personIds: [[ada]] }, ...as(OWNER) })).rejects.toBeInstanceOf(ValidationError);
    });

    it('L-5: a journal entry may only attach this tree\'s media', async () => {
        const created = await createCaseService({ body: { Title: 'Who was Ada?' }, ...as(OWNER) });
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (2, $1, 'Other')`, [OWNER]);
        const foreign = Number((await rows(`INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, 2, 'x') RETURNING "Id"`, [OWNER]))[0].Id);
        await expect(addCommentService({ id: created.Id, body: 'Found it', mediaId: foreign, ...as(OWNER) })).rejects.toBeInstanceOf(ValidationError);
    });

    it('L-1: bad audit paging, dates and revert ids are validation errors', async () => {
        await expect(listAuditService({ ...as(OWNER), page: Number.NaN })).rejects.toBeInstanceOf(ValidationError);
        await expect(listAuditService({ ...as(OWNER), dateFrom: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
        await expect(listAuditService({ ...as(OWNER), dateTo: 'yesterday' })).rejects.toBeInstanceOf(ValidationError);
        await expect(listAuditService({ ...as(OWNER), dateFrom: '2026-02-28' })).resolves.toBeTruthy();
        await expect(revertAuditService({ ids: [1.5], ...as(OWNER) })).rejects.toBeInstanceOf(ValidationError);
    });

    it('L-1: family partner ids must be whole ids, and what is stored is the checked id', async () => {
        await expect(createFamilyService({ body: { Partner1Id: [ada] }, ...as(OWNER) })).rejects.toBeInstanceOf(ValidationError);
        const family = await createFamilyService({ body: { Partner1Id: String(ada) }, ...as(OWNER) });
        expect((await rows(`SELECT "Partner1Id" FROM "Families" WHERE "Id" = $1`, [family.Id]))[0].Partner1Id).toBe(ada);
    });

    it('L-6: place lookups are bounded', async () => {
        const names = Array.from({ length: 10001 }, (_, i) => `Place ${i}`);
        await expect(getPlaceCoordsService({ names, ...as(OWNER) })).rejects.toBeInstanceOf(ValidationError);
        await expect(getPlaceCoordsService({ names: ['x'.repeat(1001)], ...as(OWNER) })).rejects.toBeInstanceOf(ValidationError);
    });

    it('L-4: view-only members see editors\' names but not their emails', async () => {
        await query(
            `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "TreeId", "Action", "EntityType", "EntityId", "EntityLabel", "Changes")
             VALUES ($1, $2, $3, 'update', 'person', $4, 'Ada Moss', '{}')`,
            [OWNER, CONTRIB, TREE, ada],
        );
        const viewer = await listAuditService(as(VIEWER));
        expect(viewer.entries[0].UserName).toBe('contrib');
        expect(viewer.entries[0].UserEmail).toBeNull();
        const owner = await listAuditService(as(OWNER));
        expect(owner.entries[0].UserEmail).toBe('contrib@example.test');
    });

    it('L-7: contributors can rename a place but not merge one', async () => {
        for (const name of ['Leeds', 'Leeds, Yorkshire', 'York']) {
            await query(`INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES ($1, $2, $3)`, [OWNER, TREE, name]);
        }
        await expect(renamePlaceService({ from: 'Leeds', to: 'Leeds, Yorkshire', ...as(CONTRIB) })).rejects.toBeInstanceOf(AccessError);
        expect(await rows(`SELECT 1 FROM "Places" WHERE "Name" = 'Leeds' AND "TreeId" = $1`, [TREE])).toHaveLength(1);
        await expect(renamePlaceService({ from: 'York', to: 'York, Yorkshire', ...as(CONTRIB) })).resolves.toMatchObject({ wasMerge: false });
        await expect(renamePlaceService({ from: 'Leeds', to: 'Leeds, Yorkshire', ...as(OWNER) })).resolves.toMatchObject({ wasMerge: true });
    });
});
