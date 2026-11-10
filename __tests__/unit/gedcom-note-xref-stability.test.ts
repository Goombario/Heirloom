import { describe, it, expect } from 'vitest';
import { generateGedcom, type GedcomExportExtras } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * #405 — `@Nn@` labels must not depend on `Note."Id"` order.
 *
 * `getNotesForTree` returns notes `ORDER BY "Id" ASC`, and the generator numbered
 * them by position in that array. Row ids are assigned by whenever the user
 * happened to create each note, but a reimport re-creates them in *emission*
 * order — so the same logical tree exported, reimported and re-exported produced a
 * different `@Nn@` assignment, and two exports of "the same" tree diffed.
 *
 * The invariant that fixes it: numbering follows the order each note is first
 * REFERENCED by an emitted record, which is stable because record order is stable.
 * These tests state that invariant directly — same logical tree, different row
 * ids, byte-identical output — rather than asserting a particular numbering, so
 * they keep holding if record order itself is ever deliberately changed.
 */

const person = (): PersonWithRelations =>
  ({
    Id: 1, UserId: 1, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
    GedcomId: '@I1@', BirthDate: null, BirthPlace: null, DeathDate: null,
    DeathPlace: null, IsDeceased: 0, Notes: null,
    media: [], events: [], familiesAsSpouse: [], familiesAsChild: [],
  }) as unknown as PersonWithRelations;

const family = (): FamilyWithRelations =>
  ({
    Id: 7, UserId: 1, HusbandId: null, WifeId: null, Partner1Id: null, Partner2Id: null,
    MarriageDate: null, MarriagePlace: null, Type: 'Marriage',
    children: [], events: [],
  }) as unknown as FamilyWithRelations;

/**
 * The person's note and the family's note, with their row ids supplied by the
 * caller. `notes` is ordered by id, mirroring `getNotesForTree`.
 */
const extrasWithIds = (personNoteId: number, familyNoteId: number): GedcomExportExtras => {
  const notes = [
    { Id: personNoteId, Text: 'Note about the person.' },
    { Id: familyNoteId, Text: 'Note about the family.' },
  ].sort((a, b) => a.Id - b.Id);
  return {
    notes,
    noteLinks: [
      { NoteId: personNoteId, OwnerTable: 'People', OwnerId: 1 },
      { NoteId: familyNoteId, OwnerTable: 'Families', OwnerId: 7 },
    ],
  };
};

describe('note @Nn@ labels are stable across a round trip', () => {
  it('assigns the same labels regardless of which note holds the lower row id', () => {
    // Scenario A: the person's note was created first (lower id) — the original tree.
    const a = generateGedcom([person()], [family()], undefined, extrasWithIds(1, 2));
    // Scenario B: after an export -> import cycle the ids were reassigned and the
    // family's note now sorts first. Same tree, same text, same attachments.
    const b = generateGedcom([person()], [family()], undefined, extrasWithIds(2, 1));

    expect(b).toBe(a);
  });

  it('numbers notes in the order records reference them, not by row id', () => {
    // Person records are emitted before family records, so the person's note is
    // always @N1@ — even when the family's note holds the lower id.
    const ged = generateGedcom([person()], [family()], undefined, extrasWithIds(2, 1));

    const personNoteXref = ged.match(/^0 @I1@ INDI$[\s\S]*?^1 NOTE (@N\d+@)$/m)?.[1];
    expect(personNoteXref).toBe('@N1@');
    expect(ged).toMatch(/^0 @N1@ NOTE Note about the person\.$/m);
    expect(ged).toMatch(/^0 @N2@ NOTE Note about the family\.$/m);
  });

  it('emits each referenced note exactly once', () => {
    const ged = generateGedcom([person()], [family()], undefined, extrasWithIds(1, 2));
    expect(ged.match(/^0 @N\d+@ NOTE /gm)).toHaveLength(2);
  });

  it('emits no record for a note with no links at all', () => {
    // Regression guard rather than new behaviour: the old id-order numbering also
    // filtered these out, via a `referencedNoteIds` set. Kept so the replacement
    // scheme is held to the same standard.
    const ged = generateGedcom([person()], [family()], undefined, {
      notes: [{ Id: 1, Text: 'Attached.' }, { Id: 99, Text: 'Orphan.' }],
      noteLinks: [{ NoteId: 1, OwnerTable: 'People', OwnerId: 1 }],
    });
    expect(ged).not.toContain('Orphan.');
    expect(ged.match(/^0 @N\d+@ NOTE /gm)).toHaveLength(1);
  });

  it('emits no record for a note whose owner is never emitted, and does not burn a label on it', () => {
    // This one IS new behaviour, and it is the reason labels must be minted on
    // emission rather than up front. The old scheme counted any note carrying a
    // link as "referenced", so a link to an owner the generator never reaches
    // produced a `0 @Nn@ NOTE` record with no pointer at it — and consumed a label,
    // shifting every subsequent one.
    //
    // Reachable in practice: an `Events:<id>` link for a BIRT/DEAT row the person
    // path suppresses, or a `Places:<id>` whose name no longer matches any emitted
    // PLAC string. Such a record was always dropped on reimport (the parser only
    // resolves notes reachable from an owner), so nothing round-trippable is lost.
    const ged = generateGedcom([person()], [family()], undefined, {
      notes: [
        { Id: 1, Text: 'Unreachable owner.' },
        { Id: 2, Text: 'Reachable owner.' },
      ],
      noteLinks: [
        { NoteId: 1, OwnerTable: 'Events', OwnerId: 9999 }, // no such event in this tree
        { NoteId: 2, OwnerTable: 'People', OwnerId: 1 },
      ],
    });
    expect(ged).not.toContain('Unreachable owner.');
    expect(ged.match(/^0 @N\d+@ NOTE /gm)).toHaveLength(1);
    // The surviving note takes @N1@ — the skipped one did not consume it.
    expect(ged).toMatch(/^0 @N1@ NOTE Reachable owner\.$/m);
  });

  it('gives a note shared by two owners one label and one record', () => {
    // The shared-note case ADR 0010 exists to enable: one note, two pointers.
    const ged = generateGedcom([person()], [family()], undefined, {
      notes: [{ Id: 5, Text: 'Shared between them.' }],
      noteLinks: [
        { NoteId: 5, OwnerTable: 'People', OwnerId: 1 },
        { NoteId: 5, OwnerTable: 'Families', OwnerId: 7 },
      ],
    });
    expect(ged.match(/^0 @N\d+@ NOTE /gm)).toHaveLength(1);
    expect(ged.match(/^1 NOTE @N1@$/gm)).toHaveLength(2);
  });
});
