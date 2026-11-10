/** @vitest-environment happy-dom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaUrl } from '@/lib/media/useMediaUrl';
import { __resetObjectUrlCache } from '@/lib/media/localMediaUrlCache';

const mediaReads = vi.hoisted(() => ({
  getThumb: vi.fn(),
  getFile: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
  DATA_MODE: 'local',
  getDataClient: async () => ({ media: mediaReads }),
}));

describe('useMediaUrl local fallback', () => {
  beforeEach(() => {
    __resetObjectUrlCache();
    mediaReads.getThumb.mockReset();
    mediaReads.getFile.mockReset();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:full-image');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('can replace a failed thumbnail read with the original blob', async () => {
    mediaReads.getThumb.mockRejectedValueOnce(new Error('missing thumbnail'));
    mediaReads.getFile.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });
    const { result } = renderHook(() => useMediaUrl(42, { treeId: 7, width: 256 }));

    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.fallback());

    await waitFor(() => expect(result.current.src).toBe('blob:full-image'));
    expect(result.current.usingFullFallback).toBe(true);
    expect(mediaReads.getThumb).toHaveBeenCalledTimes(1);
    expect(mediaReads.getFile).toHaveBeenCalledTimes(1);
  });
});
