import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * Event-level NOTE (4.1 / GEDCOM 5.5.1 EVENT_DETAIL <<NOTE_STRUCTURE>>): a
 * `2 NOTE` under an individual event must attach to THAT event (→ NoteLink
 * OwnerTable='Events') instead of being folded into the person's biography.
 */
describe('parser: event-level NOTE', () => {
  it('binds an inline 2 NOTE under a person event to that event, not the person bio', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Blacksmith',
      '2 DATE 1900',
      '2 NOTE Worked at the village forge',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.notes.map((n) => n.text)).toEqual(['Worked at the village forge']);
    // The note did NOT leak into the person's own notes — it belongs to the event.
    // (Asserted against the scalar `Notes` column until #524 / ADR 0010 dropped it.)
    expect(people[0].notes.map((n) => n.text ?? '').join('\n')).not.toContain('village forge');
  });

  it('resolves a 2 NOTE @N@ pointer under a person event to the shared record text', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Blacksmith',
      '2 NOTE @N1@',
      '0 @N1@ NOTE Shared forge note',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.notes).toHaveLength(1);
    expect(occu.notes[0].text).toBe('Shared forge note');
    expect(occu.notes[0].xref).toBe('@N1@');
  });

  it('keeps a person-level 1 NOTE on the person, not on a preceding event', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Blacksmith',
      '2 NOTE Event note',
      '1 NOTE Person biography note',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.notes.map((n) => n.text)).toEqual(['Event note']);
    expect(people[0].notes.map((n) => n.text)).toEqual(['Person biography note']);
  });

  it('drops a dangling event NOTE pointer rather than leaking the xref', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 RESI Somewhere',
      '2 NOTE @NMISSING@',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const resi = people[0].events.find((e) => e.Type === 'RESI')!;
    expect(resi.notes).toHaveLength(0);
  });
});

describe('generator: event NOTE round-trip', () => {
  it("a person event's note survives generate → parse", () => {
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      events: [{ Id: 100, UserId: 1, Type: 'OCCU', Date: null, Place: null, Description: 'Blacksmith', PersonId: 1, FamilyId: null }],
    } as unknown as PersonWithRelations;
    const ged = generateGedcom([person], [], undefined, {
      notes: [{ Id: 7, Text: 'Worked at the village forge' }],
      noteLinks: [{ NoteId: 7, OwnerTable: 'Events', OwnerId: 100 }],
    });
    // Emitted as a pointer under the event, backed by a shared 0 @N@ NOTE record.
    expect(ged).toContain('2 NOTE @N1@');
    expect(ged).toContain('0 @N1@ NOTE Worked at the village forge');

    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.notes).toHaveLength(1);
    expect(occu.notes[0].text).toBe('Worked at the village forge');
  });

  it("a family event's note survives generate → parse", () => {
    const husband = { Id: 1, FirstName: 'H', LastName: 'X', Sex: 'M', events: [] } as unknown as PersonWithRelations;
    const family = {
      Id: 50, Partner1Id: 1, Partner2Id: null, MarriageDate: null, MarriagePlace: null, Type: 'Marriage',
      husband, wife: null, children: [],
      events: [{ Id: 200, UserId: 1, Type: 'DIV', Date: '1950', Place: null, Description: null, PersonId: null, FamilyId: 50 }],
    } as unknown as FamilyWithRelations;
    const ged = generateGedcom([husband], [family], undefined, {
      notes: [{ Id: 9, Text: 'Filed in county court' }],
      noteLinks: [{ NoteId: 9, OwnerTable: 'Events', OwnerId: 200 }],
    });
    expect(ged).toContain('2 NOTE @N1@');

    const { families } = parseGedcom(ged);
    const div = families[0].events.find((e) => e.Type === 'DIV')!;
    expect(div.notes).toHaveLength(1);
    expect(div.notes[0].text).toBe('Filed in county court');
  });
});

describe('promoted fact NOTE association', () => {
  it('keeps BIRT, DEAT, and MARR pointers associated with their promoted facts', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 BIRT',
      '2 DATE 1900',
      '2 NOTE Birth record note',
      '1 DEAT',
      '2 DATE 1970',
      '2 NOTE Death record note',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 MARR',
      '2 DATE 1920',
      '2 NOTE Marriage record note',
      '0 TRLR',
    ].join('\n');

    const { people, families } = parseGedcom(ged);

    expect(people[0].notes).toMatchObject([
      { text: 'Birth record note', ownerFact: 'Birth' },
      { text: 'Death record note', ownerFact: 'Death' },
    ]);
    expect(families[0].notes).toMatchObject([
      { text: 'Marriage record note', ownerFact: 'Marriage' },
    ]);
  });

  it('emits promoted-fact pointers below BIRT, DEAT, and MARR', () => {
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      BirthDate: '1900', DeathDate: '1970', events: [],
    } as unknown as PersonWithRelations;
    const family = {
      Id: 50, Partner1Id: 1, Partner2Id: null, MarriageDate: '1920', MarriagePlace: null,
      Type: 'Marriage', husband: person, wife: null, children: [], events: [],
    } as unknown as FamilyWithRelations;
    const noteLinks = [
      { NoteId: 7, OwnerTable: 'People', OwnerId: 1, OwnerFact: 'Birth' },
      { NoteId: 8, OwnerTable: 'People', OwnerId: 1, OwnerFact: 'Death' },
      { NoteId: 9, OwnerTable: 'Families', OwnerId: 50, OwnerFact: 'Marriage' },
    ] as unknown as NonNullable<Parameters<typeof generateGedcom>[3]>['noteLinks'];
    const ged = generateGedcom([person], [family], undefined, {
      notes: [
        { Id: 7, Text: 'Birth record note' },
        { Id: 8, Text: 'Death record note' },
        { Id: 9, Text: 'Marriage record note' },
      ],
      noteLinks,
    });

    const lines = ged.split('\n');
    expect(lines.indexOf('2 NOTE @N1@')).toBeGreaterThan(lines.indexOf('1 BIRT'));
    expect(lines.indexOf('2 NOTE @N2@')).toBeGreaterThan(lines.indexOf('1 DEAT'));
    expect(lines.indexOf('2 NOTE @N3@')).toBeGreaterThan(lines.indexOf('1 MARR'));
    expect(ged).toContain('0 @N1@ NOTE Birth record note');
    expect(ged).toContain('0 @N2@ NOTE Death record note');
    expect(ged).toContain('0 @N3@ NOTE Marriage record note');
  });
});
