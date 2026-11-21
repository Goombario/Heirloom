import { describe, expect, it } from 'vitest';
import {
  chooseKeep, duplicatesOf, isMergeRevertTrail, livingValue, mergeLogOf, mergeRequest, movedCounts, resultNames,
} from '@/app/components/person-merge/model';
import type { MergeSide } from '@/lib/data/types';

const side = (over: Partial<MergeSide>): MergeSide => ({
  Id: 1, FirstName: 'Anna', LastName: 'Lindqvist', DisplayFirstName: 'Anna', Sex: null, IsDeceased: null,
  BirthDate: null, BirthPlace: null, BirthPlaceId: null, DeathDate: null, DeathPlace: null, DeathPlaceId: null,
  CreatedAt: null, Imported: false, BirthSources: 0, DeathSources: 0,
  Counts: { events: 0, citations: 0, notes: 0, photos: 0, cases: 0, familyLinks: 0, names: 0 },
  ...over,
});

describe('person merge model (#28)', () => {
  const a = side({ Id: 10, FirstName: 'Anna Maria' });
  const b = side({ Id: 20, Counts: { events: 2, citations: 6, notes: 1, photos: 0, cases: 1, familyLinks: 2, names: 0 } });

  it('picking the record to keep resets every field to that record', () => {
    expect(chooseKeep('b', ['name', 'sex'])).toEqual({ keep: 'b', picks: { name: 'b', sex: 'b' } });
  });

  it('sends take only for the fields that keep the other value', () => {
    const choice = { keep: 'a' as const, picks: { name: 'b' as const, sex: 'a' as const } };
    expect(mergeRequest(a, b, choice)).toEqual({ keptId: 10, otherId: 20, take: { name: 'other' } });
    expect(mergeRequest(a, b, { keep: 'b', picks: { name: 'b', sex: 'a' } })).toEqual({ keptId: 20, otherId: 10, take: { sex: 'other' } });
  });

  it('names the result from the side whose name is kept', () => {
    expect(resultNames(a, b, { keep: 'a', picks: { name: 'b' } })).toEqual({ kept: 'Anna Lindqvist', other: 'Anna Maria Lindqvist' });
  });

  it('counts what moves without the zeros', () => {
    expect(movedCounts(b).map((m) => m.key)).toEqual(['events', 'citations', 'notes', 'cases', 'familyLinks']);
  });

  it('reads the living flag', () => {
    expect([livingValue({ IsDeceased: 1 }), livingValue({ IsDeceased: 0 }), livingValue({ IsDeceased: null })]).toEqual(['deceased', 'living', 'unknown']);
  });

  it('lists the likely duplicates of one person once each', () => {
    expect(duplicatesOf(5, [[1, 2], [5, 7, 8], [9, 5, 7]])).toEqual([7, 8, 9]);
  });

  it('reads a merge log and its revert trail from an audit entry', () => {
    const changes = { summary: { kind: 'person_merge' }, merge: { keptId: 1, mergedId: 2, keptName: 'A', mergedName: 'B', notKept: {}, alternateName: 'B', moved: {}, combined: {}, ops: [] } };
    expect(mergeLogOf(changes)?.alternateName).toBe('B');
    expect(mergeLogOf({ fields: {} })).toBeNull();
    expect(isMergeRevertTrail({ summary: { kind: 'person_merge_revert' } })).toBe(true);
    expect(isMergeRevertTrail(changes)).toBe(false);
  });
});
