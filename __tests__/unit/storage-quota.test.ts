import { describe, expect, it } from 'vitest';
import { DEFAULT_TREE_QUOTA_BYTES, getTreeMediaQuotaBytes } from '@/lib/media/storage-quota';

describe('getTreeMediaQuotaBytes', () => {
  it('uses the hosted default when no override is configured', () => {
    expect(getTreeMediaQuotaBytes({})).toBe(DEFAULT_TREE_QUOTA_BYTES);
  });

  it('accepts a positive MEDIA_TREE_QUOTA_BYTES override', () => {
    expect(getTreeMediaQuotaBytes({ MEDIA_TREE_QUOTA_BYTES: '8192' })).toBe(8192);
  });

  it.each(['', 'not-a-number', '0', '-10', 'Infinity'])('falls back to the default for malformed value %s', (value) => {
    expect(getTreeMediaQuotaBytes({ MEDIA_TREE_QUOTA_BYTES: value })).toBe(DEFAULT_TREE_QUOTA_BYTES);
  });

  it('reports no invented per-tree quota in desktop mode', () => {
    expect(getTreeMediaQuotaBytes({ DESKTOP_MODE: 'true', MEDIA_TREE_QUOTA_BYTES: '8192' })).toBeNull();
  });
});
