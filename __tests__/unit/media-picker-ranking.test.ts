import { describe, expect, it } from 'vitest';
import { rankOwnerRelevant } from '@/app/components/media/add-media/library';

describe('rankOwnerRelevant', () => {
  const items = [
    { Id: 1, Title: 'unrelated', TaggedPersonIds: [99] },
    { Id: 2, Title: 'relevant later', TaggedPersonIds: [12] },
    { Id: 3, Title: 'same name, different person', TaggedPersonIds: [50], TaggedPersonNames: ['Owner'] },
    { Id: 4, Title: 'relevant first', TaggedPersonIds: [7, 12] },
    { Id: 5, Title: 'untagged' },
  ];

  it('stable-partitions items tagged to any relevant numeric ID first', () => {
    expect(rankOwnerRelevant(items, [12, 7]).map((item) => item.Id)).toEqual([2, 4, 1, 3, 5]);
  });

  it('does not rank same-name people and preserves a no-op for empty IDs', () => {
    expect(rankOwnerRelevant(items, [12]).map((item) => item.Id)).toEqual([2, 4, 1, 3, 5]);
    expect(rankOwnerRelevant(items, [])).toEqual(items);
  });

  it('keeps unrelated media in the searchable remainder after ranking', () => {
    const ranked = rankOwnerRelevant(items, [12]);
    expect(ranked.filter((item) => item.Title.includes('unrelated'))).toHaveLength(1);
  });
});
