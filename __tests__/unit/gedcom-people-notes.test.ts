import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations } from '@/lib/db/schema';

/**
 * ADR 0010 / #407 — People move onto the shared `Note` + `NoteLink` path.
 *
 * Export dropped People-owned notes ENTIRELY: the shared-note set excluded
 * `OwnerTable='People'` (on the reasoning that person notes emit inline from the
 * legacy column), but `generatePersonRecord` never looked up its own owner key the
 * way Families/Sources/Events/Places do — so a People-owned Note row had no path
 * out at all. Import was lossy in the mirror direction: a resolved `@N@` pointer
 * was folded into the scalar column, so a note shared between a person and their
 * family round-tripped into two unrelated notes.
 *
 * #524 completes the contract half: `People."Notes"` is DROPPED, so there is no
 * column left to fall back to and first-class notes are the only person-note store.
 * The one thing that had to survive the drop is the legacy `NICK: ` / `_AKA: `
 * prefix promotion — pre-NameVariant imports stored nicknames as literal text, and
 * init-schema's backfill mirrored that text verbatim into a Note row. The extraction
 * now reads that backfilled note, scoped by `BackfilledFromPersonId` so a note the
 * user shares with a family is never rewritten.
 */

describe('person notes — import (ADR 0010)', () => {
    it('reads an inline note as a first-class note', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 NOTE He was a farmer',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].notes).toHaveLength(1);
        expect(people[0].notes[0].text).toBe('He was a farmer');
    });

    it('resolves a shared NOTE-record pointer into the note list', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 NOTE @N1@',
            '0 @N1@ NOTE Shared research note',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].notes[0].text).toBe('Shared research note');
    });

    it('extends an inline person note with CONT continuation lines', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 NOTE First line',
            '2 CONT Second line',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].notes[0].text).toBe('First line\nSecond line');
    });

    it('keeps a note shared with a family as ONE note, by xref', () => {
        // The whole point of the shared model: this used to fork into two
        // unrelated notes because the person side folded text into a column.
        const { people, families } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 NOTE @N1@',
            '0 @F1@ FAM',
            '1 NOTE @N1@',
            '0 @N1@ NOTE A note about both',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].notes[0].xref).toBe('@N1@');
        expect(families[0].notes[0].xref).toBe('@N1@');
        expect(people[0].notes[0].text).toBe('A note about both');
    });

    it('still binds an event-level note to its event, not the person', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 OCCU Farmer',
            '2 NOTE Worked the north field',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].notes).toHaveLength(0);
        expect(people[0].events[0].notes[0].text).toBe('Worked the north field');
    });

    it('drops a person note pointer that resolves to nothing', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 NOTE @NMISSING@',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].notes).toHaveLength(0);
    });
});

function person(overrides: Partial<PersonWithRelations> = {}): PersonWithRelations {
    return {
        Id: 3, FirstName: 'John', LastName: 'Doe', Sex: 'M',
        ...overrides,
    } as unknown as PersonWithRelations;
}

describe('person notes — export (ADR 0010 / #407)', () => {
    it('emits a People-owned note as a shared record plus a pointer', () => {
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'He was a farmer' }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
        });
        expect(out).toContain('1 NOTE @N1@');
        expect(out).toContain('0 @N1@ NOTE He was a farmer');
    });

    it('emits a note shared between a person and a family exactly once', () => {
        const out = generateGedcom([person()], [{ Id: 7 } as never], undefined, {
            notes: [{ Id: 5, Text: 'A note about both' }],
            noteLinks: [
                { NoteId: 5, OwnerTable: 'People', OwnerId: 3 },
                { NoteId: 5, OwnerTable: 'Families', OwnerId: 7 },
            ],
        });
        expect(out.split('\n').filter((l) => /^0 @N\d+@ NOTE/.test(l))).toHaveLength(1);
        expect(out.split('\n').filter((l) => l.trim() === '1 NOTE @N1@')).toHaveLength(2);
    });

    // A note the migration created from the dropped column is emitted through the
    // ordinary shared-record path — there is no inline emit left to double it.
    it('emits a backfilled note as a pointer, never inline', () => {
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'He was a farmer', BackfilledFromPersonId: 3 }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
        });
        expect(out).toContain('1 NOTE @N1@');
        expect(out).toContain('0 @N1@ NOTE He was a farmer');
        expect(out).not.toContain('1 NOTE He was a farmer');
    });

    // The extraction that used to read the column now reads the backfilled note.
    // Deleting it rather than re-pointing it would silently drop every nickname
    // imported before the NameVariant promotion — ADR 0010 forbids that.
    it('promotes legacy NICK:/_AKA: prefixes out of a backfilled note', () => {
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'NICK: Bill\n_AKA: William the Elder\nA plain note', BackfilledFromPersonId: 3 }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
        });
        expect(out).toContain('1 NICK Bill');
        expect(out).toContain('1 _AKA William the Elder');
        // The prefix lines are stripped from the note BODY too, so the shared record
        // and the pointer both see the same stripped text.
        expect(out).toContain('0 @N1@ NOTE A plain note');
        expect(out).not.toContain('NICK: Bill');
        expect(out).not.toContain('_AKA: William the Elder');
    });

    it('drops a backfilled note that was nothing but prefix lines', () => {
        // Emitting it would leave an empty `0 @Nn@ NOTE` record and a pointer to it.
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'NICK: Bill', BackfilledFromPersonId: 3 }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
        });
        expect(out).toContain('1 NICK Bill');
        expect(out).not.toMatch(/^0 @N\d+@ NOTE/m);
        expect(out).not.toMatch(/^1 NOTE @N\d+@/m);
    });

    // The safety property the whole scoping rests on. A user-authored note is not
    // owned by one person, so rewriting its text could mutate what a family sees.
    // Only the migration sets BackfilledFromPersonId, so only those are touched.
    it('never strips NICK:/_AKA: text from a note that is not backfilled', () => {
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'NICK: Bill\nA plain note' }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
        });
        expect(out).not.toContain('1 NICK Bill');
        expect(out).toContain('0 @N1@ NOTE NICK: Bill');
    });

    it('dedupes a legacy prefix against a real NameVariant row', () => {
        // A person re-imported since the promotion landed has both, and emitting
        // each would double the tag.
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'NICK: Bill\nA plain note', BackfilledFromPersonId: 3 }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
            nameVariants: [{ Id: 1, PersonId: 3, Type: 'Nickname', Name: 'Bill' }],
        });
        expect(out.split('\n').filter((l) => /^\d NICK Bill$/.test(l))).toHaveLength(1);
    });
});

describe('person notes — round trip (ADR 0010 / #407)', () => {
    it('survives export → import as a first-class note', () => {
        const out = generateGedcom([person()], [], undefined, {
            notes: [{ Id: 5, Text: 'He was a farmer' }],
            noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
        });
        const { people } = parseGedcom(out);
        expect(people[0].notes[0].text).toBe('He was a farmer');
    });
});
