import { describe, it, expect } from 'vitest';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

// #982 (ADR 0027): FamilyPerson."RelationshipType" becomes one value per partner.
// The migration is guarded on the old column, so re-adding it with legacy rows and
// re-running initializeSchema exercises the production path.

describe('FamilyPerson relationship → per-partner migration (#982)', () => {
    it('copies the old type to both partners, lets FTM lines set each, and drops the column', async () => {
        const db = await newEmptyClusterDb();
        const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
        await initializeSchema(executor);

        await db.query(`ALTER TABLE "FamilyPerson" ADD COLUMN "RelationshipType" TEXT DEFAULT 'Birth'`);
        const link = (child: number, type: string | null, chil: string | null = null) => db.query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId", "RelationshipType", "ChilRawGedcom") VALUES (1, $1, $2, $3)`,
            [child, type, chil],
        );
        await link(1, 'Adoption');
        await link(2, null);
        // The old import made this Adoption ("a non-birth type either parent states").
        await link(3, 'Adoption', '2 _FREL Natural\n2 _MREL Adopted\n2 _PREF Y');
        // Step had no type before; now each partner gets its own.
        await link(4, 'Birth', '2 _FREL Step\n2 _MREL natural');
        // A value with no type stays raw, and that partner keeps the old type.
        await link(5, 'Foster', '2 _FREL Private\n2 _MREL Foster');
        // A value outside the set is copied as it was, not lost.
        await link(6, 'Sealed');
        // As the parser reads it: the first typed line counts, an untyped one before
        // it stays, and a second typed line for the same partner stays raw.
        await link(7, 'Birth', '2 _FREL Private\n2 _FREL Adopted\n3 NOTE why\n2 _MREL Natural\n2 _MREL Step');

        await initializeSchema(executor);

        const rows = await db.query<{ ChildrenId: number; Partner1Relationship: string; Partner2Relationship: string; ChilRawGedcom: string | null }>(
            `SELECT "ChildrenId", "Partner1Relationship", "Partner2Relationship", "ChilRawGedcom" FROM "FamilyPerson" ORDER BY "ChildrenId"`,
        );
        expect(rows.rows).toEqual([
            { ChildrenId: 1, Partner1Relationship: 'Adoption', Partner2Relationship: 'Adoption', ChilRawGedcom: null },
            { ChildrenId: 2, Partner1Relationship: 'Birth', Partner2Relationship: 'Birth', ChilRawGedcom: null },
            { ChildrenId: 3, Partner1Relationship: 'Birth', Partner2Relationship: 'Adoption', ChilRawGedcom: '2 _PREF Y' },
            { ChildrenId: 4, Partner1Relationship: 'Step', Partner2Relationship: 'Birth', ChilRawGedcom: null },
            { ChildrenId: 5, Partner1Relationship: 'Foster', Partner2Relationship: 'Foster', ChilRawGedcom: '2 _FREL Private' },
            { ChildrenId: 6, Partner1Relationship: 'Sealed', Partner2Relationship: 'Sealed', ChilRawGedcom: null },
            { ChildrenId: 7, Partner1Relationship: 'Adoption', Partner2Relationship: 'Birth', ChilRawGedcom: '2 _FREL Private\n2 _MREL Step' },
        ]);

        const cols = await db.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'FamilyPerson'`,
        );
        expect(cols.rows.map((c) => c.column_name)).not.toContain('RelationshipType');

        // A third run is a no-op.
        await initializeSchema(executor);
        const again = await db.query(`SELECT "ChildrenId", "Partner1Relationship", "Partner2Relationship", "ChilRawGedcom" FROM "FamilyPerson" ORDER BY "ChildrenId"`);
        expect(again.rows).toEqual(rows.rows);

        await db.close();
    });
});
