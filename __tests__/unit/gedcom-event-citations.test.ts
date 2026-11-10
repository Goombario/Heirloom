import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom, type GedcomExportExtras } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

/**
 * Event-scoped SOURCE_CITATION (§4.3 / GEDCOM 5.5.1 EVENT_DETAIL
 * <<SOURCE_CITATION>>): a `2 SOUR` under an individual OR family event must
 * bind to THAT event's fact citation (→ Citation FactTable='Events'), not to
 * the enclosing person/family record. This mirrors how the person page
 * surfaces an event and its sources together in one section.
 */
describe('parser: event-scoped SOUR binding', () => {
  it('binds a 2 SOUR under a family DIV event to the event, not the family', () => {
    const ged = [
      '0 HEAD',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 DIV',
      '2 DATE 1950',
      '2 SOUR @S1@',
      '3 PAGE p.42',
      '0 @S1@ SOUR',
      '1 TITL Divorce Decree',
      '0 TRLR',
    ].join('\n');
    const { families } = parseGedcom(ged);
    const fam = families[0];
    const div = fam.events.find((e) => e.Type === 'DIV')!;
    // The citation lives on the event...
    expect(div.citations).toEqual([
      { sourceXref: '@S1@', page: 'p.42', note: null, quay: null, dataText: null, dataDate: null, even: null, role: null },
    ]);
    // ...and NOT on the whole family.
    expect(fam.citations).toHaveLength(0);
  });

  it('keeps a family-level 1 SOUR as a whole-family citation (not on a preceding event)', () => {
    const ged = [
      '0 HEAD',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 DIV',
      '2 SOUR @S1@',
      '1 SOUR @S1@',
      '2 PAGE whole-family',
      '0 @S1@ SOUR',
      '1 TITL S',
      '0 TRLR',
    ].join('\n');
    const { families } = parseGedcom(ged);
    const fam = families[0];
    const div = fam.events.find((e) => e.Type === 'DIV')!;
    // The `2 SOUR` bound to the event.
    expect(div.citations).toHaveLength(1);
    expect(div.citations[0]).toMatchObject({ sourceXref: '@S1@', page: null });
    // The `1 SOUR` stayed on the family.
    expect(fam.citations).toHaveLength(1);
    expect(fam.citations[0]).toMatchObject({ sourceXref: '@S1@', page: 'whole-family' });
  });

  it('binds a 2 SOUR under an ANUL event with evidence sub-fields to the event', () => {
    const ged = [
      '0 HEAD',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 ANUL',
      '2 SOUR @S1@',
      '3 PAGE fol.3',
      '3 QUAY 3',
      '3 DATA',
      '4 TEXT Marriage voided',
      '0 @S1@ SOUR',
      '1 TITL S',
      '0 TRLR',
    ].join('\n');
    const { families } = parseGedcom(ged);
    const anul = families[0].events.find((e) => e.Type === 'ANUL')!;
    expect(anul.citations).toHaveLength(1);
    expect(anul.citations[0]).toMatchObject({ sourceXref: '@S1@', page: 'fol.3', quay: '3', dataText: 'Marriage voided' });
    expect(families[0].citations).toHaveLength(0);
  });

  it('binds a 2 SOUR under a person OCCU event to the event, not the person (regression)', () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 OCCU Farmer',
      '2 SOUR @S1@',
      '3 PAGE fol.2',
      '0 @S1@ SOUR',
      '1 TITL S',
      '0 TRLR',
    ].join('\n');
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.citations).toEqual([
      { sourceXref: '@S1@', page: 'fol.2', note: null, quay: null, dataText: null, dataDate: null, even: null, role: null },
    ]);
    // No whole-person citation leaked.
    expect(people[0].citations.filter((c) => c.factTable === 'People')).toHaveLength(0);
  });
});

describe('generator: event-scoped SOUR emission', () => {
  const source: GedcomExportExtras['sources'] = [
    { Id: 7, Title: 'S', Author: null, PublicationInfo: null, Text: null, Contents: null, Type: null, Num: null, RepositoryName: null, CallNumber: null },
  ];
  const sourceIdToXref = new Map([[7, '@S1@']]);

  it('emits 2 SOUR/3 PAGE under a family event', () => {
    const husband = { Id: 1, FirstName: 'H', LastName: 'X', Sex: 'M', events: [] } as unknown as PersonWithRelations;
    const family = {
      Id: 50, Partner1Id: 1, Partner2Id: null, MarriageDate: null, MarriagePlace: null, Type: 'Marriage',
      children: [],
      events: [{ Id: 200, UserId: 1, Type: 'DIV', Date: '1950', Place: null, Description: null, PersonId: null, FamilyId: 50 }],
    } as unknown as FamilyWithRelations;
    const ged = generateGedcom([husband], [family], undefined, {
      sources: source,
      sourceIdToXref,
      citations: [{ FactTable: 'Events', FactId: 200, SourceId: 7, Page: 'p.42', Note: null }],
    });
    const div = ged.indexOf('1 DIV');
    expect(div).toBeGreaterThan(-1);
    expect(ged.slice(div)).toMatch(/2 SOUR @S1@\n3 PAGE p\.42/);
  });

  it("writes a part citation under its DATE or PLAC, or at the event when that line isn't written (#990)", () => {
    const person = {
      Id: 1, FirstName: 'H', LastName: 'X', Sex: 'M', familiesAsSpouse: [], familiesAsChild: [], media: [],
      events: [
        { Id: 100, UserId: 1, Type: 'RESI', Date: '1770', Place: 'Leeds', Description: null, PersonId: 1, FamilyId: null },
        { Id: 101, UserId: 1, Type: 'CENS', Date: null, Place: 'York', Description: null, PersonId: 1, FamilyId: null },
      ],
    } as unknown as PersonWithRelations;
    const ged = generateGedcom([person], [], undefined, {
      sources: source,
      sourceIdToXref,
      citations: [
        { FactTable: 'Events', FactId: 100, SourceId: 7, Page: 'date', Note: null, Part: 'DATE' },
        { FactTable: 'Events', FactId: 100, SourceId: 7, Page: 'place', Note: null, Part: 'PLAC' },
        { FactTable: 'Events', FactId: 101, SourceId: 7, Page: 'dateless', Note: null, Part: 'DATE' },
      ],
    });
    expect(ged).toContain('1 RESI\n2 DATE 1770\n3 SOUR @S1@\n4 PAGE date\n2 PLAC Leeds\n3 SOUR @S1@\n4 PAGE place\n');
    // The census's date was removed after import: its date citation stays with the event.
    expect(ged).toContain('1 CENS\n2 PLAC York\n2 SOUR @S1@\n3 PAGE dateless\n');
  });
});

describe('round-trip: event-scoped citations', () => {
  const source: GedcomExportExtras['sources'] = [
    { Id: 7, Title: 'Census', Author: null, PublicationInfo: null, Text: null, Contents: null, Type: null, Num: null, RepositoryName: null, CallNumber: null },
  ];
  const sourceIdToXref = new Map([[7, '@S1@']]);

  it("a family event's citation survives generate → parse", () => {
    const husband = { Id: 1, FirstName: 'H', LastName: 'X', Sex: 'M', events: [] } as unknown as PersonWithRelations;
    const family = {
      Id: 50, Partner1Id: 1, Partner2Id: null, MarriageDate: null, MarriagePlace: null, Type: 'Marriage',
      children: [],
      events: [{ Id: 200, UserId: 1, Type: 'DIV', Date: '1950', Place: null, Description: null, PersonId: null, FamilyId: 50 }],
    } as unknown as FamilyWithRelations;
    const ged = generateGedcom([husband], [family], undefined, {
      sources: source,
      sourceIdToXref,
      citations: [{ FactTable: 'Events', FactId: 200, SourceId: 7, Page: 'p.42', Note: 'divorce record' }],
    });
    const { families } = parseGedcom(ged);
    const div = families[0].events.find((e) => e.Type === 'DIV')!;
    expect(div.citations).toHaveLength(1);
    expect(div.citations[0]).toMatchObject({ sourceXref: '@S1@', page: 'p.42', note: 'divorce record' });
    // Not misfiled as a whole-family citation.
    expect(families[0].citations).toHaveLength(0);
  });

  it("a person event's citation survives generate → parse", () => {
    const person = {
      Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M', familiesAsSpouse: [], familiesAsChild: [], media: [],
      events: [{ Id: 100, UserId: 1, Type: 'OCCU', Date: null, Place: null, Description: 'Farmer', PersonId: 1, FamilyId: null }],
    } as unknown as PersonWithRelations;
    const ged = generateGedcom([person], [], undefined, {
      sources: source,
      sourceIdToXref,
      citations: [{ FactTable: 'Events', FactId: 100, SourceId: 7, Page: 'fol.2', Note: null }],
    });
    const { people } = parseGedcom(ged);
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.citations).toHaveLength(1);
    expect(occu.citations[0]).toMatchObject({ sourceXref: '@S1@', page: 'fol.2' });
  });
});
