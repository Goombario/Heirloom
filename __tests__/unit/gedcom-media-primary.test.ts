import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { FamilyWithRelations, PersonWithRelations } from '@/lib/db/schema';

/**
 * #401 — `_PRIM` must round-trip in BOTH directions.
 *
 * The generator only ever emitted `_PRIM Y`, and both parser handlers acted only
 * on the literal `'Y'`, so:
 *
 *   - our own export of a lone non-primary photo came back PRIMARY, because the
 *     absent tag let the parser's first-photo heuristic decide; and
 *   - a foreign file that *explicitly* said `_PRIM N` was silently overridden by
 *     that same heuristic — the file stated a fact and we discarded it.
 *
 * Decided in ADR 0014: emit the negative rather than drop the heuristic, so files
 * from tools that never write `_PRIM` still import with a sensible primary.
 *
 * The heuristic and the tag interact, so the flags are asserted as a final state
 * rather than per-line: a media object is seeded `legacyPrimary: 1` when it is the
 * owner's first, and a later sibling's `_PRIM Y` clears earlier flags.
 */

const INDI = (...lines: string[]) =>
  ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 NAME Ada /Lovelace/', ...lines, '0 TRLR'].join('\n');

describe('parser: `_PRIM N` is an explicit negative, not an unknown value', () => {
  it('a lone photo marked `_PRIM N` stays non-primary', () => {
    const { people } = parseGedcom(INDI('1 OBJE', '2 FILE solo.jpg', '2 _PRIM N'));
    expect(people[0].media.map((m) => m.legacyPrimary)).toEqual([0]);
  });

  it('keeps the first-photo heuristic when no `_PRIM` is present at all', () => {
    // The reason ADR 0014 rejected dropping the heuristic: a file from a tool that
    // never writes `_PRIM` must still import with a primary photo.
    const { people } = parseGedcom(INDI('1 OBJE', '2 FILE a.jpg', '1 OBJE', '2 FILE b.jpg'));
    expect(people[0].media.map((m) => m.legacyPrimary)).toEqual([1, 0]);
  });

  it('lets an explicit `_PRIM Y` on a later sibling win over the heuristic', () => {
    const { people } = parseGedcom(
      INDI('1 OBJE', '2 FILE a.jpg', '2 _PRIM N', '1 OBJE', '2 FILE b.jpg', '2 _PRIM Y'),
    );
    expect(people[0].media.map((m) => m.legacyPrimary)).toEqual([0, 1]);
  });

  it('treats `_PRIM N` on an event OBJE the same way (applyMediaSubTag path)', () => {
    const { people } = parseGedcom(INDI('1 OCCU Farmer', '2 OBJE', '3 FILE ev.jpg', '3 _PRIM N'));
    const occu = people[0].events.find((e) => e.Type === 'OCCU')!;
    expect(occu.media.map((m) => m.legacyPrimary)).toEqual([0]);
  });

  it('does not sweep `_PRIM N` into passthrough (it is a handled media sub-tag)', () => {
    // If it were raw-captured it would re-emit alongside the modelled value.
    const { people } = parseGedcom(INDI('1 OBJE', '2 FILE solo.jpg', '2 _PRIM N'));
    expect(people[0].rawLines).toEqual([]);
  });
});

const personWithMedia = (media: Array<{ FilePath: string }>): PersonWithRelations =>
  ({
    Id: 1, UserId: 1, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
    GedcomId: '@I1@', BirthDate: null, BirthPlace: null, DeathDate: null,
    DeathPlace: null, IsDeceased: 0, Notes: null,
    media: media.map((m, i) => ({
      Id: i + 1, UserId: 1, Title: null, FilePath: m.FilePath, Format: null,
      ContentType: null,
    })),
    events: [], familiesAsSpouse: [], familiesAsChild: [],
  }) as unknown as PersonWithRelations;

const canonicalPersonMedia = (media: Array<{ Id: number; FilePath: string }>, links: Array<{ MediaId: number; IsPrimary: number }>) =>
  generateGedcom([personWithMedia([])], [], undefined, {
    media: media.map((m) => ({ Id: m.Id, Title: null, FilePath: m.FilePath, Format: null })),
    mediaLinks: links.map((l) => ({ ...l, OwnerTable: 'People' as const, OwnerId: 1 })),
  });

describe('generator: canonical media primary pointers', () => {
  it('does not export legacy p.media as an inline OBJE fallback', () => {
    const ged = generateGedcom([personWithMedia([{ FilePath: 'legacy.jpg' }])], []);
    expect(ged).not.toContain('1 OBJE\n2 FILE legacy.jpg');
  });

  it('emits no top-level primary marker for a non-primary People link', () => {
    const ged = canonicalPersonMedia([{ Id: 1, FilePath: 'solo.jpg' }], [{ MediaId: 1, IsPrimary: 0 }]);
    expect(ged).toContain('1 OBJE @O1@');
    expect(ged).toContain('0 @O1@ OBJE\n1 FILE media/O1-solo.jpg');
    expect(ged).not.toMatch(/^1 _PRIM /m);
  });

  it('emits the People xref for a primary link, never `_PRIM Y/N`', () => {
    const ged = canonicalPersonMedia([{ Id: 1, FilePath: 'solo.jpg' }], [{ MediaId: 1, IsPrimary: 1 }]);
    expect(ged).toContain('1 OBJE @O1@');
    expect(ged).toContain('0 @O1@ OBJE\n1 FILE media/O1-solo.jpg\n1 _PRIM @I1@');
    expect(ged).not.toMatch(/^1 _PRIM [YN]$/m);
  });

  it('emits one top-level primary marker per primary People owner', () => {
    const ged = generateGedcom([
      personWithMedia([]),
      { ...personWithMedia([]), Id: 2, GedcomId: '@I2@' },
    ], [], undefined, {
      media: [{ Id: 1, Title: null, FilePath: 'shared.jpg', Format: null }],
      mediaLinks: [
        { MediaId: 1, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 },
        { MediaId: 1, OwnerTable: 'People', OwnerId: 2, IsPrimary: 1 },
      ],
    });
    expect(ged.match(/^1 _PRIM @I[12]@$/gm)).toEqual(['1 _PRIM @I1@', '1 _PRIM @I2@']);
    expect(ged).not.toMatch(/^1 _PRIM [YN]$/m);
  });

  it('names a family whose photo it is with `_PRIM @F…@`, never for a marriage photo (#119)', () => {
    const family = { Id: 7, UserId: 1, Partner1Id: 1, Partner2Id: null, MarriageDate: null, MarriagePlace: null, UpdatedAt: null } as unknown as FamilyWithRelations;
    const ged = generateGedcom([personWithMedia([])], [family], undefined, {
      media: [{ Id: 1, Title: null, FilePath: 'wedding.jpg', Format: null }, { Id: 2, Title: null, FilePath: 'cert.jpg', Format: null }],
      mediaLinks: [
        { MediaId: 1, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 },
        { MediaId: 1, OwnerTable: 'Families', OwnerId: 7, IsPrimary: 1 },
        { MediaId: 2, OwnerTable: 'Families', OwnerId: 7, OwnerFact: 'Marriage', IsPrimary: 1 },
      ],
    });
    expect(ged).toContain('0 @O1@ OBJE\n1 FILE media/O1-wedding.jpg\n1 _PRIM @I1@\n1 _PRIM @F1@');
    expect(ged.match(/^1 _PRIM .*$/gm)).toEqual(['1 _PRIM @I1@', '1 _PRIM @F1@']);
    // Read back, both owners are named on the record.
    expect(parseGedcom(ged).mediaRecords.find((r) => r.xref === '@O1@')?.primaryPersonXrefs).toEqual(['@I1@', '@F1@']);
  });
});

describe('round trip: canonical media pointers preserve identity', () => {
  it('does not flip to primary', () => {
    const ged = canonicalPersonMedia([{ Id: 1, FilePath: 'solo.jpg' }], [{ MediaId: 1, IsPrimary: 0 }]);
    const parsed = parseGedcom(ged);
    expect(parsed.people[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
    expect(parsed.mediaRecords[0]).toMatchObject({ xref: '@O1@', FilePath: 'media/O1-solo.jpg' });
  });

  it('preserves which of several photos is primary', () => {
    const ged = canonicalPersonMedia(
      [{ Id: 1, FilePath: 'a.jpg' }, { Id: 2, FilePath: 'b.jpg' }],
      [{ MediaId: 1, IsPrimary: 0 }, { MediaId: 2, IsPrimary: 1 }],
    );
    const parsed = parseGedcom(ged);
    expect(parsed.people[0].mediaRefs).toEqual([
      { xref: '@O1@', legacyPrimary: null }, { xref: '@O2@', legacyPrimary: null },
    ]);
    expect(parsed.mediaRecords.map((m) => m.FilePath)).toEqual(['media/O1-a.jpg', 'media/O2-b.jpg']);
  });
});
