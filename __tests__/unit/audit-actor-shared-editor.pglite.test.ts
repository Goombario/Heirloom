import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { createPersonService, deletePersonService, updatePersonService } from '@/lib/services/people';
import {
    addChildToFamilyService,
    createFamilyService,
    deleteFamilyService,
    moveChildService,
    removeChildService,
    updateChildTypeService,
    updateFamilyService,
} from '@/lib/services/families';
import { createEventService, deleteEventService, updateEventService } from '@/lib/services/events';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * A shared editor's changes are logged under the editor, not the tree owner
 * (#1226). Updates and deletes of people, partnerships, child links and events
 * passed the tree owner's id as the acting user.
 */
const OWNER_ID = 1226001;
const EDITOR_ID = 1226002;

describe("a shared editor's changes are logged under the editor (#1226)", () => {
    let db: PGlite;
    let treeId: number;
    const asEditor = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: EDITOR_ID });

    async function lastEntry(): Promise<{ UserId: number; TreeOwnerId: number; Action: string; EntityType: string }> {
        const { rows } = await query(
            'SELECT "UserId", "TreeOwnerId", "Action", "EntityType" FROM "AuditLog" WHERE "TreeId" = $1 ORDER BY "Id" DESC LIMIT 1',
            [treeId],
        );
        return rows[0];
    }

    async function expectEditor(action: string, entityType: string) {
        expect(await lastEntry()).toEqual({ UserId: EDITOR_ID, TreeOwnerId: OWNER_ID, Action: action, EntityType: entityType });
    }

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3), ($4, $5, $6)', [
            OWNER_ID, 'owner@test.local', 'owner-1226', EDITOR_ID, 'editor@test.local', 'editor-1226',
        ]);
        treeId = await resolveDefaultTree(OWNER_ID);
        await query(
            `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, 'edit', $3)`,
            [OWNER_ID, EDITOR_ID, treeId],
        );
    });

    it('person update and delete', async () => {
        const person = await createPersonService({ ...asEditor(), body: { FirstName: 'Ida', LastName: 'Reed' } });
        await expectEditor('create', 'person');
        await updatePersonService({ ...asEditor(), id: person.Id, body: { FirstName: 'Ada' } });
        await expectEditor('update', 'person');
        await deletePersonService({ ...asEditor(), id: person.Id });
        await expectEditor('delete', 'person');
    });

    it('partnership, child link and event changes', async () => {
        const a = await createPersonService({ ...asEditor(), body: { FirstName: 'Tom', LastName: 'Ash' } });
        const b = await createPersonService({ ...asEditor(), body: { FirstName: 'Ann', LastName: 'Ash' } });
        const kid = await createPersonService({ ...asEditor(), body: { FirstName: 'Kit', LastName: 'Ash' } });
        const family = await createFamilyService({ ...asEditor(), body: { Partner1Id: a.Id, Partner2Id: b.Id } });
        const other = await createFamilyService({ ...asEditor(), body: { Partner1Id: a.Id } });

        await updateFamilyService({ ...asEditor(), id: family.Id, body: { MarriageDate: '1901' } });
        await expectEditor('update', 'family');

        await addChildToFamilyService({ ...asEditor(), familyId: family.Id, childId: kid.Id });
        await expectEditor('create', 'familychild');
        await updateChildTypeService({ ...asEditor(), familyId: family.Id, childId: kid.Id, relationship: 'Adoption' });
        await expectEditor('update', 'familychild');
        await moveChildService({ ...asEditor(), familyId: family.Id, toFamilyId: other.Id, childId: kid.Id });
        expect((await lastEntry()).UserId).toBe(EDITOR_ID);
        await removeChildService({ ...asEditor(), familyId: other.Id, childId: kid.Id });
        await expectEditor('delete', 'familychild');

        const event = await createEventService({ ...asEditor(), body: { Type: 'OCCU', PersonId: a.Id } });
        await updateEventService({ ...asEditor(), eventId: event.Id, body: { Description: 'Miller' } });
        await expectEditor('update', 'event');
        await deleteEventService({ ...asEditor(), eventId: event.Id });
        await expectEditor('delete', 'event');

        await deleteFamilyService({ ...asEditor(), id: family.Id });
        await expectEditor('delete', 'family');
    });
});
