/**
 * @vitest-environment happy-dom
 *
 * End-to-end guard for the white-flash fix on the local/static (PGlite) path:
 * after a revisit (unmount → remount, e.g. Back-nav or switching people), the
 * object URL is RETAINED in the LRU, so useMediaUrl's lazy initializer reads it
 * back synchronously via peekObjectUrl — the img `src` is present on the FIRST
 * render of the revisit, with no null tick (no blank/white frame).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMediaUrl } from '@/lib/media/useMediaUrl';
import { __resetObjectUrlCache } from '@/lib/media/localMediaUrlCache';

// Force the local (blob) path and stub the data client's blob reads.
vi.mock('@/lib/data', () => ({
  DATA_MODE: 'local',
  getDataClient: async () => ({
    media: {
      getFile: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
      getThumb: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
    },
  }),
}));

let created = 0;
beforeEach(() => {
  __resetObjectUrlCache();
  created = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:local-${created++}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  __resetObjectUrlCache();
});

describe('useMediaUrl local warm-cache revisit (white-flash fix)', () => {
  it('paints the resolved src synchronously on remount — no null flash', async () => {
    // Cold first mount: src resolves asynchronously.
    const first = renderHook(() => useMediaUrl(1, { width: 500 }));
    expect(first.result.current.src).toBeNull(); // loading window
    await waitFor(() => expect(first.result.current.src).toBe('blob:local-0'));

    // Navigate away — releases the ref. With retention the URL is NOT revoked.
    first.unmount();

    // Revisit (Back-nav / re-open): the very FIRST render already has the src.
    const second = renderHook(() => useMediaUrl(1, { width: 500 }));
    expect(second.result.current.src).toBe('blob:local-0'); // warm — no blank frame
    expect(second.result.current.loading).toBe(false);
    // No second blob was created — the loader did not re-run.
    expect(created).toBe(1);
  });

  it('a cold (never-loaded) id still starts null — retention only helps revisits', () => {
    const { result } = renderHook(() => useMediaUrl(999, { width: 500 }));
    expect(result.current.src).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('NEVER returns the previous media URL when mediaId changes (crop-lag fix)', async () => {
    // Person A's photo resolves.
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useMediaUrl(id, { width: 500 }),
      { initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.src).toBe('blob:local-0'));

    // Switch to person B (new mediaId), whose blob is cold. The hook must NOT keep
    // returning person A's URL — that stale URL is what made ProfileImage paint the
    // old photo under the new person's focal. It must go null until B resolves.
    rerender({ id: 2 });
    expect(result.current.src).toBeNull();
    expect(result.current.loading).toBe(true);

    // Once B resolves, it's B's fresh URL — never A's.
    await waitFor(() => expect(result.current.src).toBe('blob:local-1'));
  });
});
