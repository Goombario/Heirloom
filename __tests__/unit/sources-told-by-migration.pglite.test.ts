import { describe, it, expect } from 'vitest';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

// #470 (ADR 0038): Sources."ToldBy" folds into "Author" and the column is dropped.
// The migration is guarded on the old column, so re-adding it with legacy rows and
// re-running initializeSchema exercises the production path.

describe('Sources ToldBy → Author migration (#470)', () => {
    it('folds the teller into Author, drops the column, and is a no-op afterwards', async () => {
        const db = await newEmptyClusterDb();
        const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
        await initializeSchema(executor);

        await db.query(`ALTER TABLE "Sources" ADD COLUMN "ToldBy" TEXT`);
        const source = (title: string, author: string | null, toldBy: string | null) => db.query(
            `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Type", "Author", "ToldBy") VALUES (1, 1, $1, 'Oral', $2, $3)`,
            [title, author, toldBy],
        );
        await source('teller only', null, 'Grandma Rose');
        await source('blank author', '  ', ' Grandma Rose ');
        await source('both', 'Anna Petrova', 'Ivan');
        await source('same', 'Ivan', 'Ivan');
        await source('author only', 'Parish clerk', null);
        await source('blank teller', 'Parish clerk', '   ');
        await source('line-break teller', '\tParish clerk', 'Rose\n');

        await initializeSchema(executor);

        const rows = await db.query<{ Title: string; Author: string | null }>(
            `SELECT "Title", "Author" FROM "Sources" ORDER BY "Id"`,
        );
        expect(rows.rows).toEqual([
            { Title: 'teller only', Author: 'Grandma Rose' },
            { Title: 'blank author', Author: 'Grandma Rose' },
            { Title: 'both', Author: 'Anna Petrova (told by Ivan)' },
            { Title: 'same', Author: 'Ivan' },
            { Title: 'author only', Author: 'Parish clerk' },
            { Title: 'blank teller', Author: 'Parish clerk' },
            { Title: 'line-break teller', Author: '\tParish clerk (told by Rose)' },
        ]);

        const cols = await db.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'Sources'`,
        );
        expect(cols.rows.map((c) => c.column_name)).not.toContain('ToldBy');

        // A third run changes nothing: the fold cannot apply twice.
        await initializeSchema(executor);
        const again = await db.query(`SELECT "Title", "Author" FROM "Sources" ORDER BY "Id"`);
        expect(again.rows).toEqual(rows.rows);

        await db.close();
    });
});
