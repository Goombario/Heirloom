/** @vitest-environment happy-dom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaStorageSummary } from '@/lib/data/types';

const h = vi.hoisted(() => ({
  getStorageSummary: vi.fn(),
  redirectIfUnauthorized: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/data', () => ({
  getDataClient: () => Promise.resolve({ media: { getStorageSummary: h.getStorageSummary } }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ redirectIfUnauthorized: h.redirectIfUnauthorized }),
}));

import { useMediaStorage } from '@/app/library/useMediaStorage';

const summary = (usedBytes: number): MediaStorageSummary => ({
  usedBytes,
  limitBytes: 1000,
  remainingBytes: 1000 - usedBytes,
  percentUsed: usedBytes / 10,
  quotaMode: 'tree',
});

describe('useMediaStorage', () => {
  it('loads the active tree summary independently', async () => {
    h.getStorageSummary.mockResolvedValueOnce(summary(240));

    const { result } = renderHook(() => useMediaStorage(7, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(h.getStorageSummary).toHaveBeenCalledWith(7);
    expect(result.current.summary).toEqual(summary(240));
    expect(result.current.error).toBeNull();
  });

  it('ignores a stale response after switching trees', async () => {
    const pending = new Map<number, (value: MediaStorageSummary) => void>();
    h.getStorageSummary.mockImplementation((treeId: number) => new Promise<MediaStorageSummary>((resolve) => {
      pending.set(treeId, resolve);
    }));

    const { result, rerender } = renderHook(
      ({ treeId }: { treeId: number }) => useMediaStorage(treeId, true),
      { initialProps: { treeId: 7 } },
    );
    await waitFor(() => expect(h.getStorageSummary).toHaveBeenCalledWith(7));

    rerender({ treeId: 8 });
    await waitFor(() => expect(h.getStorageSummary).toHaveBeenCalledWith(8));

    await act(async () => { pending.get(8)?.(summary(800)); });
    await waitFor(() => expect(result.current.summary).toEqual(summary(800)));
    await act(async () => { pending.get(7)?.(summary(70)); });

    expect(result.current.summary).toEqual(summary(800));
    expect(result.current.error).toBeNull();
  });

  it('keeps summary errors retryable and clears them after refresh', async () => {
    const failure = new Error('storage read failed');
    h.getStorageSummary.mockRejectedValueOnce(failure).mockResolvedValueOnce(summary(120));

    const { result } = renderHook(() => useMediaStorage(7, true));
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.summary).toBeNull();

    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.summary).toEqual(summary(120)));
    expect(result.current.error).toBeNull();
  });
});
