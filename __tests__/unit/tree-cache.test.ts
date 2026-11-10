import { describe, it, expect } from 'vitest';
import { buildTreeCacheKey, parseTreeMode } from '@/app/components/tree/treeCache';

describe('buildTreeCacheKey', () => {
  it('builds a key from tree, root, and mode', () => {
    expect(buildTreeCacheKey(7, 42, 'descendants')).toBe(
      'tree:tree=7:root=42:mode=descendants',
    );
    expect(buildTreeCacheKey(1, 2, 'focus')).toBe('tree:tree=1:root=2:mode=focus');
  });

  it('maps a null treeId to the default scope (distinct from explicit tree ids)', () => {
    expect(buildTreeCacheKey(null, 5, 'ancestors')).toBe(
      'tree:tree=default:root=5:mode=ancestors',
    );
  });

  it('produces distinct keys when tree, root, or mode differ', () => {
    const base = buildTreeCacheKey(1, 1, 'descendants');
    expect(buildTreeCacheKey(2, 1, 'descendants')).not.toBe(base); // owner
    expect(buildTreeCacheKey(1, 2, 'descendants')).not.toBe(base); // root
    expect(buildTreeCacheKey(1, 1, 'ancestors')).not.toBe(base); // mode
  });
});

describe('parseTreeMode', () => {
  it('returns the value for each valid mode', () => {
    expect(parseTreeMode('descendants')).toBe('descendants');
    expect(parseTreeMode('ancestors')).toBe('ancestors');
    expect(parseTreeMode('focus')).toBe('focus');
  });

  it('returns undefined for unknown, empty, or null/undefined input', () => {
    expect(parseTreeMode('bogus')).toBeUndefined();
    expect(parseTreeMode('')).toBeUndefined();
    expect(parseTreeMode(null)).toBeUndefined();
    expect(parseTreeMode(undefined)).toBeUndefined();
  });

  it('is case-sensitive (does not coerce "Focus" or "DESCENDANTS")', () => {
    expect(parseTreeMode('Focus')).toBeUndefined();
    expect(parseTreeMode('DESCENDANTS')).toBeUndefined();
  });
});
