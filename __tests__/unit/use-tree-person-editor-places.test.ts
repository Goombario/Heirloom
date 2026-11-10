/**
 * @vitest-environment happy-dom
 *
 * #461 — the tree sidebar was the only writer of a place string in the app that
 * bypassed resolution, so a place typed there got no pin and no gazetteer link
 * while the identical edit made on the person form did. These pin the plumbing
 * that fixes it: the sidebar now holds pending resolutions and flushes them the
 * same way, in the same order, as `usePersonForm`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { NotFoundError } from '@/lib/data/errors';

const peopleGet = vi.fn();
const peopleUpdate = vi.fn();
const mediaList = vi.fn();
const geocodeUpsert = vi.fn();
const geocodeUpsertHierarchy = vi.fn();
const pinChains = vi.fn();

const client = {
    people: { get: peopleGet, update: peopleUpdate },
    media: { list: mediaList },
    places: { geocodeUpsert, geocodeUpsertHierarchy, pinChains },
};

vi.mock('@/lib/data', () => ({
    DATA_MODE: 'remote',
    getDataClient: () => Promise.resolve(client),
}));
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99, activePermission: 'edit' }),
}));
// Stable identity, as the real next-intl translator has — a fresh function each
// render would re-run the load effect forever.
const stableT = (key: string) => key;
vi.mock('next-intl', () => ({ useTranslations: () => stableT }));
const reportError = vi.fn();
const redirectIfUnauthorized = vi.fn().mockReturnValue(false);
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError, redirectIfUnauthorized }) }));

import { useTreePersonEditor } from '@/app/components/tree/person-sidebar/useTreePersonEditor';

const CHAIN = [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.3 }];

function renderEditor(personId = 55) {
    return renderHook(() => useTreePersonEditor({ personId, onClose: () => {} }));
}

/** Wait for the initial load, so `form` holds the fetched person. */
async function loaded(result: { current: ReturnType<typeof useTreePersonEditor> }) {
    await waitFor(() => expect(result.current.loadedPersonId).toBe(55));
}

beforeEach(() => {
    vi.clearAllMocks();
    peopleGet.mockResolvedValue({
        Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
        BirthDate: '1815', BirthPlace: 'Dover', DeathDate: '1852', DeathPlace: 'London',
        IsDeceased: 1, familiesAsSpouse: [], familiesAsChild: [],
    });
    peopleUpdate.mockResolvedValue({ Id: 55 });
    mediaList.mockResolvedValue({ media: [] });
    pinChains.mockResolvedValue({});
});

describe('useTreePersonEditor — place resolution plumbing (#461)', () => {
    it('keeps a failed person read distinct from the optional place badge lookup and exposes retry', async () => {
        peopleGet.mockRejectedValueOnce(new Error('private server detail'));
        const { result } = renderEditor();
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.loadError).toBe('error_generic');
        expect(result.current.person).toBeNull();

        await act(async () => { await result.current.retryLoad(); });
        await waitFor(() => expect(result.current.loadedPersonId).toBe(55));
        expect(result.current.loadError).toBeNull();
    });

    it('preserves a missing selected person as NotFound instead of a generic read error', async () => {
        peopleGet.mockRejectedValueOnce(new NotFoundError('private server detail'));
        const { result } = renderEditor();

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.person).toBeNull();
        expect(result.current.loadedPersonId).toBe(55);
        expect(result.current.loadError).toBeNull();
    });

    it('does not erase the loaded person when the optional media read fails', async () => {
        mediaList.mockRejectedValueOnce(new Error('private media detail'));
        const { result } = renderEditor();
        await loaded(result);
        await waitFor(() => expect(result.current.mediaError).toBe('error_generic'));
        expect(result.current.person?.FirstName).toBe('Ada');
        await act(async () => { await result.current.retryMedia(); });
        await waitFor(() => expect(result.current.mediaError).toBeNull());
    });

    it('uses the primary person tag geometry instead of media focal geometry', async () => {
        mediaList.mockResolvedValue({
            media: [{
                Id: 700,
                IsPersonPrimary: true,
                FocalX: 80,
                FocalY: 81,
                FocalRadius: 82,
                TagRegionX: 10,
                TagRegionY: 20,
                TagRegionW: 30,
                TagRegionH: 40,
            }],
        });
        const { result } = renderEditor();
        await loaded(result);

        await waitFor(() => expect(result.current.primaryPhotoId).toBe(700));
        expect(result.current.primaryPhotoFocal).toEqual({ x: 25, y: 40, r: 40 });
        expect(mediaList).toHaveBeenCalledWith({ personId: 55, treeId: 99, includeTagged: true });
    });

    it('seeds both pin badges from the already-saved chains, in one lookup', async () => {
        pinChains.mockResolvedValue({ Dover: CHAIN });
        const { result } = renderEditor();
        await loaded(result);

        await waitFor(() => expect(result.current.placeChains).toEqual({ Dover: CHAIN }));
        expect(pinChains).toHaveBeenCalledTimes(1);
        // Both names in one call, not one call per field.
        expect(pinChains).toHaveBeenCalledWith(['Dover', 'London'], 99);
    });

    it('a pin-only edit makes the sidebar dirty, so it can be saved at all', async () => {
        // Picking a candidate / entering coordinates / Remove pin never touches the
        // place text, and the Save-Discard footer and close guard are dirty-gated.
        const { result } = renderEditor();
        await loaded(result);
        expect(result.current.isDirty).toBe(false);

        act(() => result.current.setBirthPlaceResolution(CHAIN));
        expect(result.current.isDirty).toBe(true);

        await act(async () => { await result.current.handleSave(); });
        expect(result.current.isDirty).toBe(false);
    });

    it('an explicit Remove pin also makes it dirty — null is a change, not "unchanged"', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.setDeathPlaceResolution(null));
        expect(result.current.isDirty).toBe(true);
    });

    it('ignores a person fetch that resolves after the user clicked to another person', async () => {
        // The slow fetch is for 55; 56 lands first. 55 must not clobber 56's form
        // or blank the chains already painted for 56.
        let releaseStale: (v: unknown) => void = () => {};
        peopleGet.mockImplementationOnce(() => new Promise((res) => { releaseStale = res; }));
        peopleGet.mockImplementation(async () => ({
            Id: 56, FirstName: 'Grace', LastName: 'Hopper', Sex: 'F',
            BirthDate: '1906', BirthPlace: 'Deal', DeathDate: '', DeathPlace: '',
            IsDeceased: null, familiesAsSpouse: [], familiesAsChild: [],
        }));
        pinChains.mockResolvedValue({ Deal: CHAIN });

        const { result, rerender } = renderHook(
            ({ id }) => useTreePersonEditor({ personId: id, onClose: () => {} }),
            { initialProps: { id: 55 } },
        );
        rerender({ id: 56 });
        await waitFor(() => expect(result.current.form.FirstName).toBe('Grace'));
        await waitFor(() => expect(result.current.placeChains).toEqual({ Deal: CHAIN }));

        await act(async () => {
            releaseStale({
                Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
                BirthDate: '1815', BirthPlace: 'Dover', DeathDate: '', DeathPlace: '',
                IsDeceased: 1, familiesAsSpouse: [], familiesAsChild: [],
            });
        });

        expect(result.current.form.FirstName).toBe('Grace');
        expect(result.current.placeChains).toEqual({ Deal: CHAIN });
    });

    it('ignores a chain lookup that resolves after the user clicked to another person', async () => {
        // 55 loads fully, but its chain lookup is held open. The user then clicks 56,
        // whose lookup resolves. When 55's finally lands it must NOT replace 56's
        // chains — that would silently drop 56's pin badge.
        let releaseStale: (v: Record<string, unknown>) => void = () => {};
        pinChains.mockImplementationOnce(() => new Promise((res) => { releaseStale = res; }));

        const { result, rerender } = renderHook(
            ({ id }) => useTreePersonEditor({ personId: id, onClose: () => {} }),
            { initialProps: { id: 55 } },
        );
        await waitFor(() => expect(result.current.loadedPersonId).toBe(55));

        peopleGet.mockResolvedValue({
            Id: 56, FirstName: 'Grace', LastName: 'Hopper', Sex: 'F',
            BirthDate: '1906', BirthPlace: 'Deal', DeathDate: '', DeathPlace: '',
            IsDeceased: null, familiesAsSpouse: [], familiesAsChild: [],
        });
        pinChains.mockResolvedValue({ Deal: CHAIN });
        rerender({ id: 56 });
        await waitFor(() => expect(result.current.placeChains).toEqual({ Deal: CHAIN }));

        await act(async () => { releaseStale({ Dover: CHAIN }); });
        expect(result.current.placeChains).toEqual({ Deal: CHAIN });
    });

    it('does not look up chains for a person with no places', async () => {
        peopleGet.mockResolvedValue({
            Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: null,
            BirthDate: '', BirthPlace: '', DeathDate: '', DeathPlace: '',
            IsDeceased: null, familiesAsSpouse: [], familiesAsChild: [],
        });
        const { result } = renderEditor();
        await loaded(result);
        expect(pinChains).not.toHaveBeenCalled();
    });

    it('writes the resolution only AFTER the person update succeeds', async () => {
        const order: string[] = [];
        peopleUpdate.mockImplementation(async () => { order.push('person'); return { Id: 55 }; });
        geocodeUpsertHierarchy.mockImplementation(async () => { order.push('place'); });

        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.setBirthPlaceResolution(CHAIN));
        await act(async () => { await result.current.handleSave(); });

        expect(order).toEqual(['person', 'place']);
        expect(geocodeUpsertHierarchy).toHaveBeenCalledWith(CHAIN, 99);
    });

    it('writes nothing for a field whose resolution never changed', async () => {
        const { result } = renderEditor();
        await loaded(result);
        await act(async () => { await result.current.handleSave(); });

        expect(peopleUpdate).toHaveBeenCalled();
        expect(geocodeUpsertHierarchy).not.toHaveBeenCalled();
        expect(geocodeUpsert).not.toHaveBeenCalled();
    });

    it('treats an explicit Remove pin (null) as a suppression, not as "unchanged"', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.setBirthPlaceResolution(null));
        await act(async () => { await result.current.handleSave(); });

        expect(geocodeUpsert).toHaveBeenCalledWith(
            { name: 'Dover', latitude: null, longitude: null, pinSuppressed: true }, 99,
        );
        expect(geocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('consumes the resolution, so a later unrelated save does not rewrite the pin', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.setBirthPlaceResolution(CHAIN));
        await act(async () => { await result.current.handleSave(); });
        expect(geocodeUpsertHierarchy).toHaveBeenCalledTimes(1);

        act(() => result.current.setForm((f) => ({ ...f, FirstName: 'Augusta' })));
        await act(async () => { await result.current.handleSave(); });
        expect(geocodeUpsertHierarchy).toHaveBeenCalledTimes(1);
    });

    it('discards a pending resolution along with the text edit that produced it', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => {
            result.current.setForm((f) => ({ ...f, BirthPlace: 'Deal' }));
            result.current.setBirthPlaceResolution(CHAIN);
        });
        act(() => result.current.handleDiscard());
        await act(async () => { await result.current.handleSave(); });

        expect(geocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('drops the death-place resolution when the person is marked living', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.setDeathPlaceResolution(CHAIN));
        act(() => result.current.handleDeceasedChange(0));
        await act(async () => { await result.current.handleSave(); });
        await act(async () => { result.current.handleConfirmClearDeath(); });
        await waitFor(() => expect(peopleUpdate).toHaveBeenCalledTimes(1));

        expect(geocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('a failed place write does not surface as a failed save — the person row is already saved', async () => {
        geocodeUpsertHierarchy.mockRejectedValue(new Error('offline'));
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.setBirthPlaceResolution(CHAIN));
        await act(async () => { await result.current.handleSave(); });

        expect(peopleUpdate).toHaveBeenCalled();
        expect(reportError).not.toHaveBeenCalled();
        expect(result.current.isDirty).toBe(false);
    });
});

describe('useTreePersonEditor — Living or Unknown over a death (#895)', () => {
    it('asks before saving Living, then clears every death column on confirm', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.handleDeceasedChange(0));
        await act(async () => { await result.current.handleSave(); });
        expect(peopleUpdate).not.toHaveBeenCalled();
        expect(result.current.confirmClearDeath).toBe(true);

        await act(async () => { result.current.handleConfirmClearDeath(); });
        await waitFor(() => expect(peopleUpdate).toHaveBeenCalledTimes(1));
        expect(peopleUpdate.mock.calls[0][1]).toMatchObject({ IsDeceased: 0, DeathDate: null, DeathPlace: null, DeathCause: null });
    });

    it('puts the status and death details back on cancel', async () => {
        const { result } = renderEditor();
        await loaded(result);
        act(() => result.current.handleDeceasedChange(null));
        await act(async () => { await result.current.handleSave(); });
        act(() => result.current.handleCancelClearDeath());
        expect(result.current.confirmClearDeath).toBe(false);
        expect(result.current.form).toMatchObject({ IsDeceased: 1, DeathDate: '1852', DeathPlace: 'London' });
        expect(peopleUpdate).not.toHaveBeenCalled();
    });
});
