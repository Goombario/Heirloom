import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import {
    auditCanonicalPrimaryChange, auditCreate, auditDelete, auditFamilyChild, auditImport, auditPlaceRename, auditUpdate,
} from '@/lib/db/queries/audit-capture';
import { getAuditRecords } from '@/lib/db/queries/audit-records';
import type { AuditLogEntry } from '@/lib/db/schema';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const insert = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown> & { Id: number };

/**
 * The Record column names the record an entry belongs to, built when the log is
 * read (#930). These run the lookups against the real schema, so a wrong table
 * or column fails here rather than quietly reading as "Deleted person".
 */
describe('audit records (PGlite)', () => {
    let mdb: PGlite;
    let person: Record<string, unknown> & { Id: number };
    let otherTreePersonId: number;

    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Arbor'), (2, 1, 'Elsewhere')`, []);
        person = await insert(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ('Aster', 'Arbor', 1) RETURNING *`);
        otherTreePersonId = (await insert(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ('Other', 'Tree', 2) RETURNING "Id"`)).Id;
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    async function recordsFor(ids: (number | null)[]) {
        const rows = (await query(`SELECT * FROM "AuditLog" WHERE "Id" = ANY($1::int[]) ORDER BY "Id"`, [ids])).rows as AuditLogEntry[];
        const records = await getAuditRecords(1, rows);
        return ids.map((id) => records[id!]);
    }

    it('names a person by their current name and links them', async () => {
        const id = await auditUpdate('person', person, { ...person, LastName: 'Arbour' }, new Set(['LastName']), 1, 1);
        await query(`UPDATE "People" SET "FirstName" = 'Astra' WHERE "Id" = $1`, [person.Id]);
        const [record] = await recordsFor([id]);
        expect(record).toEqual({ kind: 'person', id: person.Id, name: 'Astra Arbor', live: true, item: null });
    });

    it('finds the person an updated event belongs to, and its type', async () => {
        const event = await insert(`INSERT INTO "Events" ("Type", "PersonId", "TreeId") VALUES ('OCCU', $1, 1) RETURNING *`, [person.Id]);
        const id = await auditUpdate('event', event, { ...event, Place: 'Dover' }, new Set(['Place']), 1, 1);
        const [record] = await recordsFor([id]);
        expect(record).toMatchObject({ kind: 'person', id: person.Id, name: 'Aster Arbor', live: true, item: { kind: 'event', code: 'OCCU' } });
    });

    it('follows an updated citation to its event and names the source', async () => {
        const event = await insert(`INSERT INTO "Events" ("Type", "PersonId", "TreeId") VALUES ('GRAD', $1, 1) RETURNING *`, [person.Id]);
        const source = await insert(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('1901 Census', 1) RETURNING "Id"`);
        const citation = await insert(
            `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId") VALUES (1, 1, 'Events', $1, $2) RETURNING *`,
            [event.Id, source.Id],
        );
        const id = await auditUpdate('citation', citation, { ...citation, Page: 'p. 4' }, new Set(['Page']), 1, 1);
        const [record] = await recordsFor([id]);
        expect(record).toMatchObject({
            kind: 'person', id: person.Id, live: true,
            item: { kind: 'citation', fact: 'event', eventCode: 'GRAD', source: '1901 Census' },
        });
    });

    it('finds a tag\'s person and photo, and a profile picture\'s person', async () => {
        const media = await insert(`INSERT INTO "Media" ("TreeId", "Title") VALUES (1, 'Wedding') RETURNING *`);
        const tag = await insert(
            `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, $2, 1, 1, 10, 10) RETURNING *`,
            [media.Id, person.Id],
        );
        const tagEntry = await auditUpdate('mediatag', { ...tag, TreeId: 1 }, { ...tag, TreeId: 1, RegionX: 2 }, new Set(['RegionX']), 1, 1);
        const exec = { query: (sql: string, params: unknown[]) => query(sql, params) };
        const picture = await auditCanonicalPrimaryChange({ personId: person.Id, oldMediaId: null, newMediaId: media.Id, treeOwnerId: 1, userId: 1, treeId: 1, exec });
        const [tagRecord, pictureRecord] = await recordsFor([tagEntry, picture]);
        expect(tagRecord).toMatchObject({ kind: 'person', id: person.Id, item: { kind: 'photoTag', photo: 'Wedding' } });
        expect(pictureRecord).toMatchObject({ kind: 'person', id: person.Id, item: { kind: 'profilePicture', photo: 'Wedding' } });
    });

    it('names a child link by family, with the child as the item', async () => {
        const family = await insert(`INSERT INTO "Families" ("Partner1Id", "TreeId") VALUES ($1, 1) RETURNING "Id"`, [person.Id]);
        const child = await insert(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ('Hazel', 'Arbor', 1) RETURNING "Id"`);
        const id = await auditFamilyChild('create', { FamilyId: family.Id, ChildId: child.Id, Partner1Relationship: 'Birth', Partner2Relationship: 'Birth', TreeId: 1 }, 1, 1);
        const [record] = await recordsFor([id]);
        expect(record).toMatchObject({ kind: 'family', id: family.Id, name: 'Aster Arbor', live: true, item: { kind: 'child', name: 'Hazel Arbor' } });
    });

    it('keeps the names a saved label holds once the family and child are deleted', async () => {
        const family = await insert(`INSERT INTO "Families" ("Partner1Id", "TreeId") VALUES ($1, 1) RETURNING "Id"`, [person.Id]);
        const child = await insert(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ('Hazel', 'Arbor', 1) RETURNING "Id"`);
        const id = await auditFamilyChild('delete', { FamilyId: family.Id, ChildId: child.Id, Partner1Relationship: 'Birth', Partner2Relationship: 'Birth', TreeId: 1 }, 1, 1);
        await query(`DELETE FROM "Families" WHERE "Id" = $1`, [family.Id]);
        await query(`DELETE FROM "People" WHERE "Id" IN ($1, $2)`, [child.Id, person.Id]);
        const [record] = await recordsFor([id]);
        expect(record).toMatchObject({ kind: 'family', name: 'Aster Arbor', live: false, item: { kind: 'child', name: 'Hazel Arbor', live: false } });
    });

    it('names a renamed place, and the tree for an import', async () => {
        const place = await insert(`INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES (1, 1, 'Dover, Kent') RETURNING "Id"`);
        const rename = await auditPlaceRename(1, 1, { from: 'Dovr', to: 'Dover, Kent', wasMerge: false, affected: [] }, place.Id, undefined, 1);
        await auditImport('merge', { people: 3, families: 1 }, 1, 1, undefined, 1);
        const importId = ((await query(`SELECT "Id" FROM "AuditLog" WHERE "EntityType" = 'import'`, [])).rows[0] as { Id: number }).Id;
        const [placeRecord, importRecord] = await recordsFor([rename, importId]);
        expect(placeRecord).toEqual({ kind: 'place', id: place.Id, name: 'Dover, Kent', live: true, item: null });
        expect(importRecord).toEqual({ kind: 'tree', id: null, name: 'Arbor', live: true, item: null });
    });

    it('keeps a deleted person\'s saved name, unlinked, and admits an item it can no longer place', async () => {
        const deleted = await auditDelete('person', { ...person, Id: 999_999, FirstName: 'Edith', LastName: 'Gone' }, 1, 1);
        const goneEvent = await auditUpdate('event', { Id: 999_998, TreeId: 1, Type: 'BIRT' }, { Id: 999_998, TreeId: 1, Type: 'BIRT', Place: 'X' }, new Set(['Place']), 1, 1);
        const [personRecord, eventRecord] = await recordsFor([deleted, goneEvent]);
        expect(personRecord).toEqual({ kind: 'person', id: 999_999, name: 'Edith Gone', live: false, item: null });
        expect(eventRecord).toMatchObject({ kind: null, live: false, item: { kind: 'event', code: null } });
    });

    it('keeps a deleted event\'s type and person from its saved label', async () => {
        const event = await insert(`INSERT INTO "Events" ("Type", "PersonId", "TreeId") VALUES ('OCCU', $1, 1) RETURNING *`, [person.Id]);
        const id = await auditUpdate('event', event, { ...event, Place: 'Dover' }, new Set(['Place']), 1, 1);
        await query(`DELETE FROM "Events" WHERE "Id" = $1`, [event.Id]);
        await query(`DELETE FROM "People" WHERE "Id" = $1`, [person.Id]);
        const [record] = await recordsFor([id]);
        expect(record).toMatchObject({ name: 'Aster Arbor', live: false, item: { kind: 'event', code: 'OCCU' } });
    });

    it('never names a record from another tree', async () => {
        const id = await auditCreate('event', { Id: 5, TreeId: 1, Type: 'BIRT', PersonId: otherTreePersonId }, 1, 1);
        const [record] = await recordsFor([id]);
        expect(record).toMatchObject({ kind: 'person', id: otherTreePersonId, name: null, live: false });
    });
});
