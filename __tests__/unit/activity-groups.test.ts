import { describe, expect, it } from 'vitest';
import { addRemoveActionKey, groupActivityRuns } from '@/lib/utils/activity-groups';
import en from '@/messages/en.json';
import type { AuditLogEntryWithUser } from '@/lib/db/schema';

let nextId = 1;
const entry = (over: Partial<AuditLogEntryWithUser> & { at: string }): AuditLogEntryWithUser => ({
    Id: nextId++,
    TreeOwnerId: 1,
    UserId: 1,
    Action: 'create',
    EntityType: 'citation',
    EntityId: nextId,
    EntityLabel: null,
    Changes: { fields: {} },
    CreatedAt: over.at,
    UserName: null,
    UserEmail: null,
    ...over,
});

// A bulk action reads as one row, "Added 88 citations" (#768, DV-3).
describe('groupActivityRuns', () => {
    it('collapses a run of same-user, same-type, same-action entries within two minutes', () => {
        const rows = groupActivityRuns([
            entry({ at: '2026-09-24T10:03:00Z' }),
            entry({ at: '2026-09-24T10:02:00Z' }),
            entry({ at: '2026-09-24T10:01:00Z' }),
            entry({ at: '2026-09-24T09:00:00Z' }), // an hour earlier: a new row
        ], 5, false);
        expect(rows.map((r) => r.GroupCount)).toEqual([3, 1]);
        expect(rows[0].CreatedAt).toBe('2026-09-24T10:03:00Z');
        expect(rows[0].GroupCountAtLeast).toBe(false);
    });

    it('splits on a different action, type or user, and never groups imports', () => {
        const at = '2026-09-24T10:00:00Z';
        const rows = groupActivityRuns([
            entry({ at }),
            entry({ at, Action: 'update' }),
            entry({ at, EntityType: 'person', Action: 'update' }),
            entry({ at, EntityType: 'person', Action: 'update', UserId: 2 }),
            entry({ at, EntityType: 'import' }),
            entry({ at, EntityType: 'import' }),
        ], 10, false);
        expect(rows.map((r) => r.GroupCount)).toEqual([1, 1, 1, 1, 1, 1]);
    });

    it('stops at the row limit and marks a run that reaches the end of a longer log', () => {
        const run = [entry({ at: '2026-09-24T10:00:02Z' }), entry({ at: '2026-09-24T10:00:01Z' })];
        expect(groupActivityRuns(run, 5, true)[0]).toMatchObject({ GroupCount: 2, GroupCountAtLeast: true });
        const many = Array.from({ length: 8 }, (_, i) => entry({ at: `2026-09-2${i}T10:00:00Z`.replace('2026-09-2', '2026-09-1') }));
        expect(groupActivityRuns(many, 5, false)).toHaveLength(5);
    });

    it('counts records, not entries: one case saved three times is one row for that case (#807)', () => {
        const rows = groupActivityRuns([
            entry({ at: '2026-09-24T10:03:00Z', Action: 'update', EntityType: 'case', EntityId: 7 }),
            entry({ at: '2026-09-24T10:02:00Z', Action: 'update', EntityType: 'case', EntityId: 7 }),
            entry({ at: '2026-09-24T10:01:00Z', Action: 'update', EntityType: 'case', EntityId: 7 }),
        ], 5, true);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ EntityId: 7, GroupCount: 1, GroupCountAtLeast: false });

        const two = groupActivityRuns([
            entry({ at: '2026-09-24T10:03:00Z', Action: 'update', EntityType: 'case', EntityId: 7 }),
            entry({ at: '2026-09-24T10:02:00Z', Action: 'update', EntityType: 'case', EntityId: 8 }),
            entry({ at: '2026-09-24T10:01:00Z', Action: 'update', EntityType: 'case', EntityId: 7 }),
        ], 5, false);
        expect(two[0].GroupCount).toBe(2);
    });
});

// A run on one record names every field it changed, not only the newest entry's (#931).
describe('groupActivityRuns — one record edited several times', () => {
    it('merges the run\'s fields newest first, each once', () => {
        const edit = (at: string, field: string) => entry({
            at, Action: 'update', EntityType: 'person', EntityId: 9,
            Changes: { fields: { [field]: { old: null, new: at } } },
        });
        const [row] = groupActivityRuns([
            edit('2026-09-24T10:00:14Z', 'BirthDate'),
            edit('2026-09-24T10:00:07Z', 'DeathDate'),
            edit('2026-09-24T10:00:00Z', 'BirthDate'),
        ], 5, false);
        expect(row.GroupCount).toBe(1);
        expect(Object.keys((row.Changes as { fields: object }).fields)).toEqual(['BirthDate', 'DeathDate']);
    });

    it('leaves a many-record run\'s changes as the newest entry\'s', () => {
        const a = entry({ at: '2026-09-24T10:00:10Z', Action: 'update', EntityId: 1, Changes: { fields: { Page: { old: 1, new: 2 } } } });
        const b = entry({ at: '2026-09-24T10:00:00Z', Action: 'update', EntityId: 2, Changes: { fields: { Url: { old: 1, new: 2 } } } });
        expect(groupActivityRuns([a, b], 5, false)[0].Changes).toBe(a.Changes);
    });
});

describe('addRemoveActionKey (#931)', () => {
    const text = (action: 'create' | 'delete', type?: string) =>
        (en.home as Record<string, string>)[addRemoveActionKey(action, type)];

    it('keeps "added to tree" for tree records', () => {
        expect(text('create', 'person')).toBe('added to tree');
        expect(text('delete', 'source')).toBe('removed from tree');
        expect(text('create')).toBe('added to tree');
    });

    it('says what happened to anything else', () => {
        expect(text('create', 'datacheck')).toBe('data check confirmed');
        expect(text('delete', 'datacheck')).toBe('data check reopened');
        expect(text('create', 'mediatag')).toBe('tagged');
        expect(text('delete', 'familychild')).toBe('unlinked');
        expect(text('create', 'citation')).toBe('added');
        expect(text('delete', 'event')).toBe('removed');
    });
});
