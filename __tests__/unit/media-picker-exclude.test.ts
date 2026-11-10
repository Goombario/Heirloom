import { describe, it, expect } from 'vitest';
import { excludeAttached, rankOwnerRelevant } from '@/app/components/media/add-media/library';

describe('excludeAttached', () => {
  it('drops media already attached to the owner, keeps the rest, preserves order', () => {
    const all = [{ Id: 1 }, { Id: 2 }, { Id: 3 }, { Id: 4 }];
    expect(excludeAttached(all, new Set([2, 4])).map((m) => m.Id)).toEqual([1, 3]);
  });

  it('returns all when nothing is attached', () => {
    const all = [{ Id: 7 }, { Id: 8 }];
    expect(excludeAttached(all, new Set<number>())).toHaveLength(2);
  });

  it('excludes attached rows before ranking the complete remaining list', () => {
    const remaining = excludeAttached([
      { Id: 1, TaggedPersonIds: [10] },
      { Id: 2, TaggedPersonIds: [20] },
      { Id: 3, TaggedPersonIds: [10] },
    ], new Set([2]));

    expect(rankOwnerRelevant(remaining, [10]).map((m) => m.Id)).toEqual([1, 3]);
  });
});
