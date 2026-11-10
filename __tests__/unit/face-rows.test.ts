import { describe, expect, it } from 'vitest';
import { buildFaceRows, isConfirmAllRow, NO_SPLITS, sharedNameNote } from '@/app/library/faces/faceRows';
import type { FaceGroup } from '@/lib/data/types';
import type { FaceMatchKind, MediaFaceCandidate } from '@/lib/db/schema';

const person = (id: number, name: string, birthYear: string | null) => ({ id, name, birthYear, deathYear: null, sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null });
const face = (Id: number, MediaDate: string | null, MediaId = Id * 10) => ({ Id, MediaId, MediaDate } as MediaFaceCandidate);
const MARIE = [person(21, 'Marie Gagnon', '1905'), person(22, 'Marie Ellis', '1931')];

function group(groupKey: string, matchKind: FaceMatchKind, candidates: MediaFaceCandidate[]): FaceGroup {
  const shared = matchKind === 'ambiguous';
  return {
    groupKey, sourceName: groupKey, matchKind, candidates, candidateCount: candidates.length,
    suggestedPerson: shared || matchKind === 'none' ? null : person(9, 'Thomas Ellis', '1903'),
    ambiguousPersonCount: shared ? 2 : null, ambiguousCandidates: shared ? MARIE : [],
  };
}

describe('buildFaceRows (#1156)', () => {
  it('makes one row per group, with the matched person ready to tag', () => {
    const [row] = buildFaceRows([group('te', 'exact', [face(1, '1926'), face(2, '1931')])], NO_SPLITS, new Map());
    expect(row).toMatchObject({ key: 'te', kind: 'exact', person: { id: 9 }, shared: false });
    expect(isConfirmAllRow(row)).toBe(true);
  });

  it('leaves a shared name without a person, and out of Confirm all even once picked', () => {
    const g = group('marie', 'ambiguous', [face(4, '1926'), face(5, '1958')]);
    const [row] = buildFaceRows([g], NO_SPLITS, new Map());
    expect(row.person).toBeNull();
    expect(row.sharedBy).toHaveLength(2);
    const [picked] = buildFaceRows([g], NO_SPLITS, new Map([['marie', MARIE[0]]]));
    expect(picked).toMatchObject({ kind: 'chosen', person: { id: 21 }, sharedBy: [] });
    expect(isConfirmAllRow(picked)).toBe(false);
  });

  it('keeps the match state when the pick is the matched person, and says "You chose" otherwise', () => {
    const g = group('te', 'variant', [face(1, null)]);
    expect(buildFaceRows([g], NO_SPLITS, new Map([['te', person(9, 'Thomas Ellis', '1903')]]))[0].kind).toBe('variant');
    expect(buildFaceRows([g], NO_SPLITS, new Map([['te', person(10, 'Tom', null)]]))[0].kind).toBe('chosen');
  });

  it('splits Not {person} faces into their own rows that need a name', () => {
    const rows = buildFaceRows([group('te', 'exact', [face(1, null), face(2, null), face(3, null)])],
      { notPerson: new Map([[2, 'Thomas Ellis']]), perFace: new Set() }, new Map());
    expect(rows.map(r => r.key)).toEqual(['te', 'split:2']);
    expect(rows[0].candidates.map(c => c.Id)).toEqual([1, 3]);
    expect(rows[1]).toMatchObject({ kind: 'none', person: null, splitFrom: 'Thomas Ellis' });
    expect(isConfirmAllRow(rows[1])).toBe(false);
  });

  it('splits a shared name into one row per face', () => {
    const rows = buildFaceRows([group('marie', 'ambiguous', [face(4, '1926'), face(5, '1958')])],
      { notPerson: new Map(), perFace: new Set(['marie']) }, new Map());
    expect(rows.map(r => [r.key, r.perFace])).toEqual([['face:4', { index: 1, of: 2 }], ['face:5', { index: 2, of: 2 }]]);
  });
});

describe('sharedNameNote', () => {
  it('notes a group whose photos start before a candidate was born', () => {
    const [row] = buildFaceRows([group('marie', 'ambiguous', [face(4, '1926'), face(5, 'ABT 1958')])], NO_SPLITS, new Map());
    expect(sharedNameNote(row)).toEqual({ kind: 'span', from: 1926, to: 1958, name: 'Marie Ellis', born: 1931 });
  });

  it('names the likely person on a per-face row when only one was born by then', () => {
    const rows = buildFaceRows([group('marie', 'ambiguous', [face(4, '1926'), face(5, '1958')])],
      { notPerson: new Map(), perFace: new Set(['marie']) }, new Map());
    expect(sharedNameNote(rows[0])).toEqual({ kind: 'likely', year: 1926, out: 'Marie Ellis', likely: 'Marie Gagnon' });
    expect(sharedNameNote(rows[1])).toBeNull();
  });

  it('says nothing when the photos carry no dates', () => {
    const [row] = buildFaceRows([group('marie', 'ambiguous', [face(4, null), face(5, null)])], NO_SPLITS, new Map());
    expect(sharedNameNote(row)).toBeNull();
  });
});
