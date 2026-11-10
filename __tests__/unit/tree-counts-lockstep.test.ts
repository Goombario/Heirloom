import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `getTreeCountsService` gates the destructive overwrite import: when every
 * count it returns is 0, the confirmation dialog is skipped entirely. So any
 * table that `importGedcomService` deletes in overwrite mode but the counts
 * service does not count reads as "nothing to lose" — and its rows are wiped
 * without ever prompting the user.
 *
 * This is exactly the bug that shipped in the first cut of the gate (it counted
 * people/families/events/sources/media/cases, while overwrite also deleted
 * Places, Note, Repository and Citation — so a tree holding only standalone
 * repositories was silently destroyed). The two lists must stay in lockstep;
 * this test fails the moment they drift.
 */

const root = resolve(__dirname, '../..');
const gedcomSrc = readFileSync(resolve(root, 'lib/services/gedcom.ts'), 'utf8');
const countsSrc = readFileSync(resolve(root, 'lib/services/tree-counts.ts'), 'utf8');

/** Junction tables cleared as a side effect of their parent; they hold no rows alone. */
const JUNCTION_TABLES = new Set(['FamilyPerson']);

function overwriteDeleteBlock(src: string): string {
    const start = src.indexOf("if (mode === 'overwrite') {");
    expect(start, 'overwrite branch not found in gedcom.ts — did it move?').toBeGreaterThan(-1);
    // The branch ends at the next top-level statement after the DELETEs; the
    // personIdMap declaration is the first thing outside it.
    const end = src.indexOf('const personIdMap', start);
    expect(end, 'end of overwrite branch not found').toBeGreaterThan(start);
    return src.slice(start, end);
}

function tablesIn(src: string, pattern: RegExp): Set<string> {
    return new Set([...src.matchAll(pattern)].map((m) => m[1]));
}

describe('tree-counts stays in lockstep with the overwrite DELETE block', () => {
    const deleted = tablesIn(overwriteDeleteBlock(gedcomSrc), /DELETE FROM "(\w+)"/g);
    const counted = tablesIn(countsSrc, /FROM "(\w+)"/g);

    it('finds the tables it means to compare (guards against a silently-empty regex)', () => {
        expect(deleted.size).toBeGreaterThanOrEqual(10);
        expect(counted.size).toBeGreaterThanOrEqual(10);
        expect(deleted).toContain('People');
        expect(deleted).toContain('Repository');
        expect(deleted).toContain('DataCheckConfirmations');
    });

    it('counts every table the overwrite import deletes', () => {
        const uncounted = [...deleted].filter((t) => !counted.has(t) && !JUNCTION_TABLES.has(t));
        expect(
            uncounted,
            `These tables are deleted by an overwrite import but not counted by getTreeCountsService, ` +
            `so a tree containing only them would be wiped with no confirmation: ${uncounted.join(', ')}`,
        ).toEqual([]);
    });

    it('does not count tables the overwrite import leaves alone', () => {
        // A spurious count would confirm on a tree the import would not touch —
        // annoying rather than dangerous, but it means the two have drifted.
        const spurious = [...counted].filter((t) => !deleted.has(t));
        expect(spurious).toEqual([]);
    });
});
