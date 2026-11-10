/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const harness = vi.hoisted(() => ({
  getDataClient: vi.fn(),
  listFaceQueue: vi.fn(),
  confirmFaces: vi.fn(),
}));

vi.mock('@/lib/data', () => ({ getDataClient: harness.getDataClient }));

import { useFaceQueue } from '@/app/library/faces/useFaceQueue';

const result = {
  results: [{ candidateId: 12, status: 'confirmed' as const, tagId: 44 }],
  requestedCount: 1,
  confirmedCount: 1,
  skippedCount: 0,
  failedCount: 0,
};

beforeEach(() => {
  harness.getDataClient.mockReset();
  harness.listFaceQueue.mockReset().mockResolvedValue({ groups: [], pendingTotal: 0, resolvedTotal: 0 });
  harness.confirmFaces.mockReset();
  harness.getDataClient.mockResolvedValue({
    media: { listFaceQueue: harness.listFaceQueue, confirmFaces: harness.confirmFaces },
  });
});

afterEach(cleanup);

describe('useFaceQueue confirm', () => {
  it('returns the complete result and reloads even when confirmation fails', async () => {
    harness.confirmFaces.mockRejectedValueOnce(new Error('request failed'));
    const { result: hook } = renderHook(() => useFaceQueue(7, false));
    await waitFor(() => expect(harness.listFaceQueue).toHaveBeenCalledTimes(1));

    await expect(act(async () => {
      await hook.current.confirm([12], 99);
    })).rejects.toThrow('request failed');
    await waitFor(() => expect(harness.listFaceQueue).toHaveBeenCalledTimes(2));
  });

  it('returns the full best-effort DTO, not only the confirmed count', async () => {
    harness.confirmFaces.mockResolvedValueOnce(result);
    const { result: hook } = renderHook(() => useFaceQueue(7, false));
    await waitFor(() => expect(harness.listFaceQueue).toHaveBeenCalledTimes(1));

    let returned: unknown;
    await act(async () => {
      returned = await hook.current.confirm([12], 99);
    });

    expect(returned).toEqual(result);
    await waitFor(() => expect(harness.listFaceQueue).toHaveBeenCalledTimes(2));
  });
});
