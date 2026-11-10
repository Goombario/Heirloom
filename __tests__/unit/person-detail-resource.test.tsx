/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { NotFoundError } from '@/lib/data/errors';

const peopleGet = vi.fn();
const variantsList = vi.fn();
const mediaList = vi.fn();
const citationsList = vi.fn();
const client = {
    people: { get: peopleGet, listNameVariants: variantsList },
    media: { list: mediaList },
    citations: { listForPerson: citationsList },
};
let currentId = '5';

vi.mock('@/lib/data', () => ({ getDataClient: () => Promise.resolve(client) }));
vi.mock('@/lib/scroll', () => ({ scrollToTop: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`id=${currentId}`) }));
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 42, activePermission: 'edit', currentUserId: 7 }),
}));
const translate = (key: string) => key;
const redirectIfUnauthorized = vi.fn().mockReturnValue(false);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/app/components/useErrorToast', () => ({
    useErrorToast: () => ({ reportError: vi.fn(), redirectIfUnauthorized }),
}));

import { usePersonDetail } from '@/app/people/view/usePersonDetail';
import { dataCache } from '@/lib/data/cache';

const person = {
    Id: 5, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F', BirthDate: '1815', BirthPlace: null,
    DeathDate: null, DeathPlace: null, IsDeceased: 1, events: [], spouses: [],
};

beforeEach(() => {
    vi.clearAllMocks();
    dataCache.clear();
    currentId = '5';
    peopleGet.mockResolvedValue(person);
    variantsList.mockResolvedValue([]);
    mediaList.mockResolvedValue({ media: [] });
    citationsList.mockResolvedValue({});
});

describe('usePersonDetail resource failures', () => {
    it('keeps the primary detail visible and retries secondary resources independently', async () => {
        mediaList.mockRejectedValueOnce(new Error('media body must not leak'));
        citationsList.mockRejectedValueOnce(new Error('citation body must not leak'));
        const { result } = renderHook(() => usePersonDetail());

        await waitFor(() => expect(result.current.person?.Id).toBe(5));
        await waitFor(() => expect(result.current.mediaError).toBe('error_generic'));
        await waitFor(() => expect(result.current.citationsError).toBe('error_generic'));
        expect(result.current.personError).toBeNull();
        expect(result.current.media).toEqual([]);
        expect(result.current.citationMap).toEqual({});

        await act(async () => { await result.current.fetchMedia(); });
        expect(result.current.mediaError).toBeNull();
        expect(result.current.citationsError).toBe('error_generic');
        expect(mediaList).toHaveBeenCalledTimes(2);
        expect(citationsList).toHaveBeenCalledTimes(1);
    });

    it('does not expose a raw primary-read message and clears it after retry', async () => {
        peopleGet.mockRejectedValueOnce(new Error('database internals must not leak'));
        const { result } = renderHook(() => usePersonDetail());

        await waitFor(() => expect(result.current.personError).toBe('error_generic'));
        expect(result.current.person).toBeNull();

        peopleGet.mockResolvedValueOnce(person);
        await act(async () => { await result.current.fetchPerson(); });
        expect(result.current.person?.FirstName).toBe('Ada');
        expect(result.current.personError).toBeNull();
    });

    it('preserves the established person not-found state', async () => {
        peopleGet.mockRejectedValueOnce(new NotFoundError('private server detail'));
        const { result } = renderHook(() => usePersonDetail());

        await waitFor(() => expect(peopleGet).toHaveBeenCalled());
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.person).toBeNull();
        expect(result.current.personError).toBeNull();
    });
});
