/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
    listSources: vi.fn(),
    listMedia: vi.fn(),
}));
vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({ sources: { list: h.listSources }, media: { list: h.listMedia } }),
}));
vi.mock('@/app/components/useErrorToast', () => {
    const toast = { redirectIfUnauthorized: () => false };
    return { useErrorToast: () => toast };
});

import { useLibrarySources } from '@/app/library/useLibrarySources';

describe('useLibrarySources refetch (#799)', () => {
    it('refreshes after a change without going back to the loading state', async () => {
        h.listSources.mockResolvedValue({ sources: [{ Id: 1, Title: 'Census' }], count: 1 });
        h.listMedia.mockResolvedValue({ media: [] });
        const { result } = renderHook(() => useLibrarySources(7, true));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let resolveList!: (v: unknown) => void;
        h.listSources.mockImplementationOnce(() => new Promise(r => { resolveList = r; }));
        let pending!: Promise<void>;
        act(() => { pending = result.current.refetch(); });
        // A foreground load would show the skeleton and unmount an open source.
        await waitFor(() => expect(h.listSources).toHaveBeenCalledTimes(2));
        expect(result.current.loading).toBe(false);
        await act(async () => { resolveList({ sources: [{ Id: 1, Title: 'Census' }, { Id: 2, Title: 'Register' }], count: 2 }); await pending; });
        expect(result.current.sources).toHaveLength(2);
    });

    it('refreshes photos in place too, so an open lightbox survives a tag (#802, MD-1)', async () => {
        h.listSources.mockResolvedValue({ sources: [], count: 0 });
        h.listMedia.mockResolvedValue({ media: [{ Id: 4, Title: 'Wedding' }] });
        const { result } = renderHook(() => useLibrarySources(7, true));
        await waitFor(() => expect(result.current.photoLoading).toBe(false));

        let resolveMedia!: (v: unknown) => void;
        h.listMedia.mockImplementationOnce(() => new Promise(r => { resolveMedia = r; }));
        const before = h.listMedia.mock.calls.length;
        let pending!: Promise<void>;
        act(() => { pending = result.current.refetch(); });
        await waitFor(() => expect(h.listMedia).toHaveBeenCalledTimes(before + 1));
        expect(result.current.photoLoading).toBe(false);
        await act(async () => { resolveMedia({ media: [{ Id: 4, Title: 'Wedding, 1921' }] }); await pending; });
        expect(result.current.photos[0].Title).toBe('Wedding, 1921');
    });
});
