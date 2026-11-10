import { describe, it, expect, beforeEach } from 'vitest';
import { dataCache } from '@/lib/data/cache';

describe('dataCache', () => {
  beforeEach(() => dataCache.clear());

  it('stores and retrieves values by key', () => {
    expect(dataCache.get('k')).toBeUndefined();
    dataCache.set('k', { a: 1 });
    expect(dataCache.get('k')).toEqual({ a: 1 });
    expect(dataCache.has('k')).toBe(true);
  });

  it('clear() empties everything', () => {
    dataCache.set('a', 1);
    dataCache.set('b', 2);
    dataCache.clear();
    expect(dataCache.has('a')).toBe(false);
    expect(dataCache.has('b')).toBe(false);
  });

  it('generation() advances on clear (and only on clear)', () => {
    const g = dataCache.generation();
    dataCache.set('a', 1);
    dataCache.get('a');
    dataCache.has('a');
    expect(dataCache.generation()).toBe(g); // reads/writes don't bump it
    dataCache.clear();
    expect(dataCache.generation()).toBe(g + 1);
  });
});
