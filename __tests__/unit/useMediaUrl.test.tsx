/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMediaUrl } from '@/lib/media/useMediaUrl';

// DATA_MODE defaults to 'http' in tests (no NEXT_PUBLIC_DATA_MODE set).
describe('useMediaUrl (http mode)', () => {
  it('returns the static /api/media file URL synchronously', () => {
    const { result } = renderHook(() => useMediaUrl(42, { treeId: 7 }));
    expect(result.current.src).toBe('/api/media/42/file?treeId=7');
    expect(result.current.loading).toBe(false);
  });

  it('omits ownerId when not provided', () => {
    const { result } = renderHook(() => useMediaUrl(5));
    expect(result.current.src).toBe('/api/media/5/file');
  });
});
