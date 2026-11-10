import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { resolveEntityLabel } from '@/lib/db/queries/audit-capture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The citation label lookups (#701) run their SQL against the real schema. A
 * wrong table or column name would be swallowed by resolveEntityLabel's
 * fallback, so each case asserts the resolved subject, not just "no throw".
 */
describe('citation audit labels (PGlite)', () => {
    let mdb: PGlite;
    let personId: number;
    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Arbor')`, []);
        const p = await query(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ('Aster', 'Arbor', 1) RETURNING "Id"`, []);
        personId = (p.rows[0] as { Id: number }).Id;
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    const label = (FactTable: string, FactId: number) => resolveEntityLabel('citation', { Id: 1, FactTable, FactId, TreeId: 1 });

    it('names the cited source after the subject (#768)', async () => {
        const src = await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('1901 Census', 1) RETURNING "Id"`, []);
        const SourceId = (src.rows[0] as { Id: number }).Id;
        await expect(resolveEntityLabel('citation', { Id: 1, FactTable: 'PersonBirth', FactId: personId, SourceId, TreeId: 1 }))
            .resolves.toBe('Citation — Aster Arbor · birth ← 1901 Census');
    });

    it('resolves person-keyed facts', async () => {
        await expect(label('PersonBirth', personId)).resolves.toBe('Citation — Aster Arbor · birth');
    });

    it('resolves a name variant through its person', async () => {
        const v = await query(
            `INSERT INTO "NameVariant" ("OwnerId", "PersonId", "Name", "TreeId") VALUES (1, $1, 'Asta', 1) RETURNING "Id"`, [personId]);
        await expect(label('NameVariant', (v.rows[0] as { Id: number }).Id)).resolves.toBe('Citation — Aster Arbor · name variant');
    });

    it('resolves an event through its type and subject', async () => {
        const e = await query(`INSERT INTO "Events" ("Type", "PersonId", "TreeId") VALUES ('GRAD', $1, 1) RETURNING "Id"`, [personId]);
        await expect(label('Events', (e.rows[0] as { Id: number }).Id)).resolves.toBe('Citation — Aster Arbor · graduation');
    });

    it('resolves a family by its partners', async () => {
        const f = await query(`INSERT INTO "Families" ("Partner1Id", "TreeId") VALUES ($1, 1) RETURNING "Id"`, [personId]);
        await expect(label('Families', (f.rows[0] as { Id: number }).Id)).resolves.toBe('Citation — Aster Arbor · partnership');
    });

    it('resolves case and journal-entry facts to the case title', async () => {
        const c = await query(`INSERT INTO "Cases" ("UserId", "Title", "TreeId") VALUES (1, 'Arbor origins', 1) RETURNING "Id"`, []);
        const caseId = (c.rows[0] as { Id: number }).Id;
        const cc = await query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body") VALUES ($1, 1, 'note') RETURNING "Id"`, [caseId]);
        await expect(label('Cases', caseId)).resolves.toBe('Citation — Arbor origins · research case');
        await expect(label('CaseComments', (cc.rows[0] as { Id: number }).Id)).resolves.toBe('Citation — Arbor origins · journal entry');
    });
});

/**
 * Capture-label lookups are filtered by the audited record's tree (#847): an id
 * from another tree yields the fallback label, never that tree's names.
 */
describe('audit labels stay in the record\'s tree (PGlite)', () => {
    let mdb: PGlite;
    let foreignPerson: number;
    let foreignFamily: number;
    let foreignSource: number;
    let foreignEvent: number;
    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Mine'), (2, 1, 'Other')`, []);
        const p = await query(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ('Foreign', 'Name', 2) RETURNING "Id"`, []);
        foreignPerson = (p.rows[0] as { Id: number }).Id;
        const f = await query(`INSERT INTO "Families" ("Partner1Id", "TreeId") VALUES ($1, 2) RETURNING "Id"`, [foreignPerson]);
        foreignFamily = (f.rows[0] as { Id: number }).Id;
        const s = await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('Foreign census', 2) RETURNING "Id"`, []);
        foreignSource = (s.rows[0] as { Id: number }).Id;
        const e = await query(`INSERT INTO "Events" ("Type", "PersonId", "TreeId") VALUES ('GRAD', $1, 2) RETURNING "Id"`, [foreignPerson]);
        foreignEvent = (e.rows[0] as { Id: number }).Id;
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it('names a same-tree record', async () => {
        await expect(resolveEntityLabel('datacheck', { PersonId: foreignPerson, TreeId: 2 })).resolves.toBe('Foreign Name');
    });

    it('gives no name for a record without a tree, even against unscoped rows', async () => {
        const orphan = await query(`INSERT INTO "People" ("FirstName", "LastName") VALUES ('Orphan', 'Row') RETURNING "Id"`, []);
        const PersonId = (orphan.rows[0] as { Id: number }).Id;
        await expect(resolveEntityLabel('datacheck', { PersonId })).resolves.not.toContain('Orphan');
    });

    it('gives no name for another tree\'s person, family, event or source', async () => {
        const labels = await Promise.all([
            resolveEntityLabel('datacheck', { PersonId: foreignPerson, TreeId: 1 }),
            resolveEntityLabel('mediatag', { Id: 5, PersonId: foreignPerson, TreeId: 1 }),
            resolveEntityLabel('family', { Id: foreignFamily, Partner1Id: foreignPerson, TreeId: 1 }),
            resolveEntityLabel('familychild', { FamilyId: foreignFamily, ChildId: foreignPerson, TreeId: 1 }),
            resolveEntityLabel('event', { Id: 9, Type: 'GRAD', PersonId: foreignPerson, TreeId: 1 }),
            resolveEntityLabel('event', { Id: 9, Type: 'MARR', FamilyId: foreignFamily, TreeId: 1 }),
            resolveEntityLabel('citation', { Id: 1, FactTable: 'Events', FactId: foreignEvent, SourceId: foreignSource, TreeId: 1 }),
        ]);
        for (const label of labels) {
            expect(label).not.toContain('Foreign');
        }
    });
});
