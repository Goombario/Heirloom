/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEventMediaDraft } from '@/app/components/media/useEventMediaDraft';

describe('useEventMediaDraft', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a schema-shaped UUID fallback when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    const { result } = renderHook(() => useEventMediaDraft({ treeId: 1 }));
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

    act(() => result.current.addFiles([file]));

    expect(result.current.items[0]).toMatchObject({
      kind: 'file',
      uploadIntentId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    });
  });
});
