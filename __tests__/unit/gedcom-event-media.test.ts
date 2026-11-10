import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * Event-level OBJE (#86 / GEDCOM 5.5.1 EVENT_DETAIL <<MULTIMEDIA_LINK>>): a
 * `2 OBJE` under an individual or family event must bind to THAT event's media
 * (→ MediaLink OwnerTable='Events'), not the person/family record.
 */
describe('parser: event-level OBJE', () => {
  // BIRT/DEAT are intrinsic (stored on the person, not as Events rows), so event
  // media applies to custom events (OCCU/RESI/…) that have a real Events row.
  it('binds 2 OBJE under an individual event to that event', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Blacksmith',
      '2 DATE 1900',
      '2 OBJE',
      '3 FILE forge.jpg',
      '3 FORM jpeg',
      '3 TITL At the forge',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.media).toHaveLength(1);
    expect(occu.media[0].FilePath).toBe('forge.jpg');
    expect(occu.media[0].Title).toBe('At the forge');
    expect(occu.media[0].Format).toBe('jpeg');
  });

  it('binds 2 OBJE under a family event to that event, not the family', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME H /X/',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 DIV',
      '2 DATE 1950',
      '2 OBJE',
      '3 FILE decree.jpg',
      '3 FORM jpeg',
      '3 TITL Divorce decree',
      '0 TRLR',
    ].join('\n');
    const { families } = parseGedcom(ged);
    const div = families[0].events.find((e) => e.Type === 'DIV')!;
    expect(div.media).toHaveLength(1);
    expect(div.media[0].FilePath).toBe('decree.jpg');
    // The family record itself has no direct media.
    expect(families[0].media).toHaveLength(0);
  });

  it('keeps person-level OBJE separate from event OBJE', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Blacksmith',
      '2 OBJE',
      '3 FILE forge.jpg',
      '1 OBJE',
      '2 FILE portrait.jpg',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.media.map((m) => m.FilePath)).toEqual(['forge.jpg']);
    expect(people[0].media.map((m) => m.FilePath)).toEqual(['portrait.jpg']);
  });

  it('keeps a shared event pointer as an owner reference instead of copying the record', () => {
    const ged = [
      '0 @I1@ INDI', '1 NAME John /Doe/',
      '1 OCCU Blacksmith',
      '2 OBJE @O1@', '3 _PRIM N',
      '0 @O1@ OBJE', '1 FILE forge.jpg', '1 TITL At the forge',
      '0 TRLR',
    ].join('\n');
    const { people, mediaRecords } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.media).toHaveLength(0);
    expect(occu.mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: 0 }]);
    expect(mediaRecords).toHaveLength(1);
    expect(mediaRecords[0]).toMatchObject({ xref: '@O1@', FilePath: 'forge.jpg', Title: 'At the forge' });
  });
});

describe('generator: event OBJE round-trip', () => {
  it('a person event\'s media survives generate → parse', () => {
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
      events: [{ Id: 100, UserId: 1, Type: 'OCCU', Date: null, Place: null, Description: 'Blacksmith', PersonId: 1, FamilyId: null }],
    } as unknown as PersonWithRelations;
    const ged = generateGedcom([person], [], undefined, {
      media: [{ Id: 7, Title: 'At the forge', FilePath: 'forge.jpg', Format: 'jpeg' }],
      mediaLinks: [{ MediaId: 7, OwnerTable: 'Events', OwnerId: 100, IsPrimary: 0 }],
    });

    const { people, mediaRecords } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.media).toHaveLength(0);
    expect(occu.mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
    expect(mediaRecords).toHaveLength(1);
    expect(mediaRecords[0]).toMatchObject({ xref: '@O1@', FilePath: 'media/O1-at-the-forge.jpg', Title: 'At the forge' });
  });

  it('a family event\'s media survives generate → parse', () => {
    const husband = { Id: 1, FirstName: 'H', LastName: 'X', Sex: 'M', events: [] } as unknown as PersonWithRelations;
    const family = {
      Id: 50, Partner1Id: 1, Partner2Id: null, MarriageDate: null, MarriagePlace: null, Type: 'Marriage',
      husband, wife: null, children: [],
      events: [{ Id: 200, UserId: 1, Type: 'DIV', Date: '1950', Place: null, Description: null, PersonId: null, FamilyId: 50 }],
    } as unknown as FamilyWithRelations;
    const ged = generateGedcom([husband], [family], undefined, {
      media: [{ Id: 9, Title: 'Decree', FilePath: 'decree.jpg', Format: 'jpeg' }],
      mediaLinks: [{ MediaId: 9, OwnerTable: 'Events', OwnerId: 200, IsPrimary: 0 }],
    });

    const { families, mediaRecords } = parseGedcom(ged);
    const div = families[0].events.find((e) => e.Type === 'DIV')!;
    expect(div.media).toHaveLength(0);
    expect(div.mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
    expect(mediaRecords).toHaveLength(1);
    expect(mediaRecords[0]).toMatchObject({ xref: '@O1@', FilePath: 'media/O1-decree.jpg', Title: 'Decree' });
  });
});
