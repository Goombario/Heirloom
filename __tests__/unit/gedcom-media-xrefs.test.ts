import { describe, expect, it } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { assignMediaXrefs } from '@/lib/gedcom/generator';

describe('GEDCOM media identity and owner references', () => {
  it('assigns deterministic media xrefs by ascending Media ID', () => {
    expect([...assignMediaXrefs([{ Id: 30 }, { Id: 10 }, { Id: 20 }])]).toEqual([
      [10, '@O1@'], [20, '@O2@'], [30, '@O3@'],
    ]);
  });

  it('retains each top-level media record and resolves pointers from every owner context', () => {
    const parsed = parseGedcom([
      '0 @I1@ INDI', '1 NAME Ada /Lovelace/',
      '1 OBJE @O1@', '2 _PRIM Y',
      '1 OCCU Programmer', '2 OBJE @O1@', '3 _PRIM N',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 OBJE @O1@',
      '1 DIV', '2 OBJE @O1@',
      '0 @S1@ SOUR', '1 TITL Register', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE media/O1/photo.jpg', '2 FORM jpeg', '2 TITL Shared photograph',
      '1 FILE media/O1/ignored.jpg',
      '0 @O2@ OBJE', '1 FILE media/O2/photo.jpg', '1 FORM jpeg',
      '0 @O3@ OBJE', '1 FILE',
      '0 TRLR',
    ].join('\n'));

    expect(parsed.mediaRecords.map((media) => media.xref)).toEqual(['@O1@', '@O2@', '@O3@']);
    expect(parsed.mediaRecords[0]).toMatchObject({
      xref: '@O1@', FilePath: 'media/O1/photo.jpg', Format: 'jpeg', Title: 'Shared photograph',
    });
    expect(parsed.mediaRecords[1]).toMatchObject({ xref: '@O2@', FilePath: 'media/O2/photo.jpg' });
    expect(parsed.mediaRecords[2]).toMatchObject({ xref: '@O3@', FilePath: null });

    expect(parsed.people[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: 1 }]);
    expect(parsed.people[0].events[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: 0 }]);
    expect(parsed.families[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
    expect(parsed.families[0].events[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
    expect(parsed.sources[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
  });

  it('keeps ownerless records and repeated pointers, but drops only dangling references', () => {
    const parsed = parseGedcom([
      '0 @I1@ INDI', '1 NAME Ada /Lovelace/',
      '1 OBJE @O1@', '1 OBJE @OMISSING@', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE same.jpg',
      '0 @O2@ OBJE', '1 FILE same.jpg',
      '0 TRLR',
    ].join('\n'));

    expect(parsed.mediaRecords.map((media) => media.xref)).toEqual(['@O1@', '@O2@']);
    expect(parsed.people[0].mediaRefs).toEqual([
      { xref: '@O1@', legacyPrimary: null },
      { xref: '@O1@', legacyPrimary: null },
    ]);
  });

  it('keeps the first FILE subtree as one coherent media record', () => {
    const parsed = parseGedcom([
      '0 @O1@ OBJE',
      '1 FILE first.jpg', '2 FORM jpeg', '2 TITL First',
      '1 FILE second.png', '2 FORM png', '2 TITL Second',
      '0 TRLR',
    ].join('\n'));

    expect(parsed.mediaRecords).toHaveLength(1);
    expect(parsed.mediaRecords[0]).toMatchObject({
      FilePath: 'first.jpg', Format: 'jpeg', Title: 'First',
    });
  });

  it('keeps legacy inline media independent from top-level identities', () => {
    const parsed = parseGedcom([
      '0 @I1@ INDI', '1 NAME Ada /Lovelace/',
      '1 OBJE', '2 FILE inline.jpg', '2 FORM jpeg', '2 _PRIM N',
      '0 @F1@ FAM',
      '1 OBJE', '2 FILE inline-family.jpg', '2 _PRIM Y',
      '0 TRLR',
    ].join('\n'));

    expect(parsed.mediaRecords).toEqual([]);
    expect(parsed.people[0].media[0]).toMatchObject({ xref: null, FilePath: 'inline.jpg', legacyPrimary: 0 });
    expect(parsed.families[0].media[0]).toMatchObject({ xref: null, FilePath: 'inline-family.jpg', legacyPrimary: 1 });
  });
});
