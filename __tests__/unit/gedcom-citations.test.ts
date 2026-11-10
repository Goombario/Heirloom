import { describe, it, expect } from 'vitest';
import { generateGedcom, type GedcomExportExtras } from '@/lib/gedcom/generator';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';
import type { GedcomEvent } from '@/lib/db/schema';

function person(over: Partial<PersonWithRelations> = {}): PersonWithRelations {
  return {
    Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
    BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null,
    IsDeceased: null, events: [], media: [],
    familiesAsSpouse: [], familiesAsChild: [],
    ...over,
  } as unknown as PersonWithRelations;
}

const noFamilies: FamilyWithRelations[] = [];

describe('generateGedcom SOUR/REPO records', () => {
  const extras: GedcomExportExtras = {
    sources: [
      { Id: 7, Title: '1901 Census', Author: 'LAC', PublicationInfo: 'Ottawa', Text: 'http://x/y',
        Contents: 'Dwelling 44', Type: 'Census', Num: 12, RepositoryName: 'LAC', CallNumber: 'MS-44/2' },
    ],
    citations: [],
    sourceIdToXref: new Map([[7, '@S1@']]),
  };

  it('emits a SOUR record with standard + custom tags', () => {
    const ged = generateGedcom([person()], noFamilies, undefined, extras);
    expect(ged).toContain('0 @S1@ SOUR');
    expect(ged).toContain('1 TITL 1901 Census');
    expect(ged).toContain('1 AUTH LAC');
    expect(ged).toContain('1 PUBL Ottawa');
    expect(ged).toContain('1 TEXT Dwelling 44');     // Contents -> TEXT
    expect(ged).toContain('1 _URL http://x/y');      // Text -> _URL
    expect(ged).toContain('1 _TYPE Census');
    expect(ged).toContain('1 _NUM 12');
  });

  it('emits a deduped REPO record and references it with CALN', () => {
    const ged = generateGedcom([person()], noFamilies, undefined, extras);
    expect(ged).toContain('0 @R1@ REPO');
    expect(ged).toContain('1 NAME LAC');
    expect(ged).toContain('1 REPO @R1@');
    expect(ged).toContain('2 CALN MS-44/2');
  });
});

import { parseGedcom } from '@/lib/gedcom/parser';

const GED_WITH_SOURCE = [
  '0 HEAD',
  '0 @S1@ SOUR',
  '1 TITL 1901 Census',
  '1 AUTH LAC',
  '1 PUBL Ottawa',
  '1 TEXT Dwelling 44',
  '1 _URL http://x/y',
  '1 _TYPE Census',
  '1 _NUM 12',
  '1 REPO @R1@',
  '2 CALN MS-44/2',
  '0 @R1@ REPO',
  '1 NAME Library and Archives Canada',
  '0 TRLR',
].join('\n');

describe('parseGedcom sources', () => {
  it('parses a SOUR record with custom tags + resolved repository', () => {
    const { sources } = parseGedcom(GED_WITH_SOURCE);
    expect(sources).toHaveLength(1);
    const s = sources[0];
    expect(s.xref).toBe('@S1@');
    expect(s.Title).toBe('1901 Census');
    expect(s.Author).toBe('LAC');
    expect(s.PublicationInfo).toBe('Ottawa');
    expect(s.Contents).toBe('Dwelling 44'); // TEXT -> Contents
    expect(s.Text).toBe('http://x/y');      // _URL -> Text
    expect(s.Type).toBe('Census');
    expect(s.Num).toBe(12);
    expect(s.RepositoryName).toBe('Library and Archives Canada');
    expect(s.CallNumber).toBe('MS-44/2');
  });
});

describe('generateGedcom citation pointers', () => {
  const base: GedcomExportExtras = { sources: [
    { Id: 7, Title: 'S', Author: null, PublicationInfo: null, Text: null, Contents: null, Type: null, Num: null, RepositoryName: null, CallNumber: null },
  ], sourceIdToXref: new Map([[7, '@S1@']]) };

  it('emits 2 SOUR/3 PAGE under BIRT', () => {
    const p = person({ BirthDate: '1901-01-01' });
    const ged = generateGedcom([p], noFamilies, undefined, {
      ...base, citations: [{ FactTable: 'PersonBirth', FactId: 1, SourceId: 7, Page: 'p.7', Note: null }],
    });
    const idx = ged.indexOf('1 BIRT');
    expect(idx).toBeGreaterThan(-1);
    expect(ged.slice(idx)).toMatch(/2 SOUR @S1@\n3 PAGE p\.7/);
  });

  it('emits an empty 1 BIRT anchor when a birth citation has no birth data', () => {
    const ged = generateGedcom([person()], noFamilies, undefined, {
      ...base, citations: [{ FactTable: 'PersonBirth', FactId: 1, SourceId: 7, Page: null, Note: null }],
    });
    expect(ged).toContain('1 BIRT');
    const idx = ged.indexOf('1 BIRT');
    expect(ged.slice(idx)).toMatch(/2 SOUR @S1@/);
  });

  it('emits 2 SOUR under an event and 1 SOUR for whole-person citations', () => {
    const evt = { Id: 50, Type: 'OCCU', Description: 'Farmer', Date: null, Place: null, PersonId: 1, FamilyId: null, UserId: 0 } as unknown as GedcomEvent;
    const p = person({ events: [evt] });
    const ged = generateGedcom([p], noFamilies, undefined, {
      ...base, citations: [
        { FactTable: 'Events', FactId: 50, SourceId: 7, Page: 'fol.2', Note: null },
        { FactTable: 'People', FactId: 1, SourceId: 7, Page: null, Note: 'whole' },
      ],
    });
    const occu = ged.indexOf('1 OCCU');
    expect(ged.slice(occu)).toMatch(/2 SOUR @S1@\n3 PAGE fol\.2/);
    expect(ged).toMatch(/1 SOUR @S1@\n2 NOTE whole/);
  });
});

const GED_WITH_CITATIONS = [
  '0 HEAD',
  '0 @I1@ INDI',
  '1 NAME John /Doe/',
  '2 SOUR @S1@',
  '3 PAGE p.4',
  '1 BIRT',
  '2 DATE 1901',
  '2 SOUR @S1@',
  '3 PAGE p.7',
  '3 NOTE transcribed',
  '1 OCCU Farmer',
  '2 SOUR @S1@',
  '3 PAGE fol.2',
  '1 SOUR @S1@',
  '2 NOTE whole-person',
  '0 @S1@ SOUR',
  '1 TITL S',
  '0 TRLR',
].join('\n');

describe('parseGedcom citations', () => {
  it('attaches citations to the correct fact by level + context', () => {
    const { people } = parseGedcom(GED_WITH_CITATIONS);
    const p = people[0];
    const byTable = (t: string) => p.citations.filter((c) => c.factTable === t);
    // Slice 3 added evidence sub-fields (quay/dataText/dataDate/even/role), null here.
    const noEvidence = { quay: null, dataText: null, dataDate: null, even: null, role: null };
    expect(byTable('PersonName')).toEqual([{ factTable: 'PersonName', sourceXref: '@S1@', page: 'p.4', note: null, ...noEvidence }]);
    expect(byTable('PersonBirth')[0]).toMatchObject({ sourceXref: '@S1@', page: 'p.7', note: 'transcribed' });
    expect(byTable('People')[0]).toMatchObject({ sourceXref: '@S1@', note: 'whole-person' });
    expect(p.events[0].citations).toEqual([{ sourceXref: '@S1@', page: 'fol.2', note: null, ...noEvidence }]);
  });

  // Every NOTE in this fixture belongs to a citation (`3 NOTE transcribed`,
  // `2 NOTE whole-person`) — the INDI record has no `1 NOTE` of its own. They must
  // stay on their citations rather than becoming notes about the person. This used
  // to assert against the scalar `Notes` column, gone in #524 / ADR 0010; the
  // first-class note list is the surface that can leak now.
  it('does not leak citation NOTE into the person note list', () => {
    const { people } = parseGedcom(GED_WITH_CITATIONS);
    expect(people[0].notes).toEqual([]);
  });
});

describe('generate -> parse round-trip', () => {
  it('preserves a source and a birth citation', () => {
    const p = person({ Id: 1, BirthDate: '1901-01-01' });
    const extras: GedcomExportExtras = {
      sources: [{ Id: 7, Title: 'Census', Author: 'LAC', PublicationInfo: null, Text: 'http://x', Contents: 'txt', Type: 'Census', Num: 3, RepositoryName: 'LAC', CallNumber: 'C1' }],
      citations: [{ FactTable: 'PersonBirth', FactId: 1, SourceId: 7, Page: 'p.7', Note: null }],
      sourceIdToXref: new Map([[7, '@S1@']]),
    };
    const ged = generateGedcom([p], noFamilies, undefined, extras);
    const parsed = parseGedcom(ged);
    expect(parsed.sources[0]).toMatchObject({ Title: 'Census', Type: 'Census', Num: 3, RepositoryName: 'LAC', CallNumber: 'C1', Text: 'http://x', Contents: 'txt' });
    expect(parsed.people[0].citations).toContainEqual({ factTable: 'PersonBirth', sourceXref: '@S1@', page: 'p.7', note: null, quay: null, dataText: null, dataDate: null, even: null, role: null });
  });
});

describe('source xref numbering', () => {
  it('numbers source xrefs from @S1@ (no story offset)', () => {
    const p = person({ Id: 1, BirthDate: '1901-01-01' });
    const extras: GedcomExportExtras = {
      sources: [{ Id: 7, Title: 'Census', Author: null, PublicationInfo: null, Text: null, Contents: null, Type: null, Num: null, RepositoryName: null, CallNumber: null }],
      citations: [],
      // No sourceIdToXref — triggers the generator's auto-build path.
    };
    const ged = generateGedcom([p], noFamilies, undefined, extras);
    expect(ged).toContain('0 @S1@ SOUR');
  });
});
