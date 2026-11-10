/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => currentSearchParams,
}));

import { useLibraryTab } from '@/app/library/useLibraryTab';

describe('useLibraryTab', () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentSearchParams = new URLSearchParams();
  });

  it('defaults to Photos when the URL has no tab (#1157)', () => {
    const { result } = renderHook(() => useLibraryTab());

    expect(result.current.tab).toBe('photos');
  });

  it('accepts Faces as a valid tab', () => {
    currentSearchParams = new URLSearchParams('tab=faces');

    const { result } = renderHook(() => useLibraryTab());

    expect(result.current.tab).toBe('faces');
  });

  it('falls back to Photos for an invalid tab value', () => {
    currentSearchParams = new URLSearchParams('tab=documents');

    const { result } = renderHook(() => useLibraryTab());

    expect(result.current.tab).toBe('photos');
  });

  it('removes only tab when selecting Photos', () => {
    currentSearchParams = new URLSearchParams('filter=recent&tab=uncited&view=compact');
    const { result } = renderHook(() => useLibraryTab());

    act(() => result.current.setTab('photos'));

    expect(pushMock).toHaveBeenCalledWith('/library?filter=recent&view=compact', { scroll: false });
  });

  it('sets a tab while preserving unrelated query parameters', () => {
    currentSearchParams = new URLSearchParams('filter=recent&source=17');
    const { result } = renderHook(() => useLibraryTab());

    act(() => result.current.setTab('faces'));

    expect(pushMock).toHaveBeenCalledWith('/library?filter=recent&source=17&tab=faces', { scroll: false });
  });

  it('uses the bare library URL when Photos is selected without other parameters', () => {
    currentSearchParams = new URLSearchParams('tab=sources');
    const { result } = renderHook(() => useLibraryTab());

    act(() => result.current.setTab('photos'));

    expect(pushMock).toHaveBeenCalledWith('/library', { scroll: false });
  });

  it('writes tab=sources explicitly, and reads it back as Sources', () => {
    const { result, rerender } = renderHook(() => useLibraryTab());
    pushMock.mockImplementationOnce((url: string) => {
      currentSearchParams = new URLSearchParams(url.split('?')[1] ?? '');
    });

    act(() => result.current.setTab('sources'));
    expect(pushMock).toHaveBeenCalledWith('/library?tab=sources', { scroll: false });
    rerender();
    expect(result.current.tab).toBe('sources');
  });

  it('updates the active tab after a browser URL change', () => {
    const { result, rerender } = renderHook(() => useLibraryTab());

    currentSearchParams = new URLSearchParams('tab=repositories');
    rerender();

    expect(result.current.tab).toBe('repositories');
  });

  it('propagates a refreshed non-Photos URL through successive tab selections', () => {
    currentSearchParams = new URLSearchParams('filter=recent&source=17&view=compact&tab=sources');
    pushMock.mockImplementation((url: string) => {
      currentSearchParams = new URLSearchParams(url.split('?')[1] ?? '');
    });

    const { result, rerender } = renderHook(() => useLibraryTab());

    expect(result.current.tab).toBe('sources');

    act(() => result.current.setTab('repositories'));
    expect(pushMock).toHaveBeenLastCalledWith(
      '/library?filter=recent&source=17&view=compact&tab=repositories',
      { scroll: false },
    );
    rerender();
    expect(result.current.tab).toBe('repositories');

    act(() => result.current.setTab('uncited'));
    expect(pushMock).toHaveBeenLastCalledWith(
      '/library?filter=recent&source=17&view=compact&tab=uncited',
      { scroll: false },
    );
    rerender();
    expect(result.current.tab).toBe('uncited');

    act(() => result.current.setTab('faces'));
    expect(pushMock).toHaveBeenLastCalledWith(
      '/library?filter=recent&source=17&view=compact&tab=faces',
      { scroll: false },
    );
    rerender();
    expect(result.current.tab).toBe('faces');

    act(() => result.current.setTab('photos'));
    expect(pushMock).toHaveBeenLastCalledWith('/library?filter=recent&source=17&view=compact', {
      scroll: false,
    });
    rerender();
    expect(result.current.tab).toBe('photos');

    act(() => result.current.setTab('sources'));
    expect(pushMock).toHaveBeenLastCalledWith(
      '/library?filter=recent&source=17&view=compact&tab=sources',
      { scroll: false },
    );
    rerender();
    expect(result.current.tab).toBe('sources');
  });
});
