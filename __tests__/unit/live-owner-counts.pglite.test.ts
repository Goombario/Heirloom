import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPersonService, deletePersonService } from '@/lib/services/people';
import { addChildToFamilyService, createFamilyService, deleteFamilyService, listFamiliesService } from '@/lib/services/families';
import { createEventService } from '@/lib/services/events';
import { createSourceService, listSourcesService } from '@/lib/services/sources';
import { createCitationService } from '@/lib/services/citations';
import { getDashboardService } from '@/lib/services/dashboard';
import { listPlacesService } from '@/lib/services/places';
import { revertAuditService } from '@/lib/services/audit';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * A person or family delete strands its events, citations and child links so a
 * revert can restore them (#881). The counts the user sees go through a live
 * owner: they drop on the delete and come back on the revert.
 */
const USER_ID = 881881;

describe('user-visible counts skip stranded rows (#881)', () => {
    let db: PGlite;
    let treeId: number;
    const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID });

    async function counts() {
        const dashboard = await getDashboardService(ctx());
        const { sources } = await listSourcesService({ ...ctx(), withCounts: true });
        const { families } = await listFamiliesService(ctx());
        const { places } = await listPlacesService(ctx());
        return {
            events: dashboard.stats.events,
            citations: (sources as SourceWithCitationCount[]).map((s) => s.citationCount),
            children: families.map((f) => f.childCount),
            dover: places.find((p) => p.name === 'Dover')?.count ?? 0,
        };
    }

    async function lastAuditId(): Promise<number> {
        const { rows } = await query('SELECT MAX("Id") AS id FROM "AuditLog" WHERE "TreeId" = $1', [treeId]);
        return rows[0].id;
    }

    let child: { Id: number };
    let familyId: number;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'live-owner@test.local', 'live-owner']);
        treeId = await resolveDefaultTree(USER_ID);

        const father = await createPersonService({ ...ctx(), body: { FirstName: 'Tom', LastName: 'Ash' } });
        const mother = await createPersonService({ ...ctx(), body: { FirstName: 'Ann', LastName: 'Ash' } });
        child = await createPersonService({ ...ctx(), body: { FirstName: 'Kit', LastName: 'Ash' } });
        const family = await createFamilyService({ ...ctx(), body: { Partner1Id: father.Id, Partner2Id: mother.Id } });
        familyId = family.Id;
        await addChildToFamilyService({ ...ctx(), familyId, childId: child.Id });

        const source = await createSourceService({ ...ctx(), input: { Title: 'Parish register' } });
        const event = await createEventService({ ...ctx(), body: { Type: 'OCCU', PersonId: child.Id, Place: 'Dover' } });
        const marriage = await createEventService({ ...ctx(), body: { Type: 'ENGA', FamilyId: familyId, Place: 'Dover' } });
        await createCitationService({ ...ctx(), input: { FactTable: 'Events', FactId: event.Id, SourceId: source.Id } });
        await createCitationService({ ...ctx(), input: { FactTable: 'PersonBirth', FactId: child.Id, SourceId: source.Id } });
        await createCitationService({ ...ctx(), input: { FactTable: 'Events', FactId: marriage.Id, SourceId: source.Id } });
        await createCitationService({ ...ctx(), input: { FactTable: 'People', FactId: father.Id, SourceId: source.Id } });
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('drops on a person delete and comes back on its revert', async () => {
        const before = await counts();
        expect(before).toEqual({ events: 2, citations: [4], children: [1], dover: 2 });

        await deletePersonService({ ...ctx(), id: child.Id });
        // The rows are still there for the revert...
        const stranded = await query('SELECT COUNT(*)::int AS n FROM "Events" WHERE "PersonId" = $1', [child.Id]);
        expect(stranded.rows[0].n).toBe(1);
        // ...but nothing the user sees counts them.
        expect(await counts()).toEqual({ events: 1, citations: [2], children: [0], dover: 1 });

        await revertAuditService({ ...ctx(), ids: [await lastAuditId()] });
        expect(await counts()).toEqual(before);
    });

    it('drops on a family delete and comes back on its revert', async () => {
        const before = await counts();
        await deleteFamilyService({ ...ctx(), id: familyId });
        expect(await counts()).toEqual({ events: 1, citations: [3], children: [], dover: 1 });

        await revertAuditService({ ...ctx(), ids: [await lastAuditId()] });
        expect(await counts()).toEqual(before);
    });
});
