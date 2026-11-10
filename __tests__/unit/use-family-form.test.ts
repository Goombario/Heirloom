/**
 * @vitest-environment happy-dom
 *
 * Deferred place-write behavior for useFamilyForm (design spec §6.1) — mirrors
 * use-person-form.test.ts's mocking conventions (getDataClient, useTree,
 * next/navigation, next-intl). Does NOT boot PGlite — safe in test:fast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

const familiesCreate = vi.fn();
const familiesGet = vi.fn();
const familiesAddChild = vi.fn();
const peopleGet = vi.fn();
const citationsListForFact = vi.fn();
const placesGeocodeUpsertHierarchy = vi.fn();
const placesGeocodeUpsert = vi.fn();
const placesPinChains = vi.fn();

const client = {
    families: { create: familiesCreate, get: familiesGet, addChild: familiesAddChild },
    people: { get: peopleGet },
    citations: { listForFact: citationsListForFact },
    places: { geocodeUpsertHierarchy: placesGeocodeUpsertHierarchy, geocodeUpsert: placesGeocodeUpsert, pinChains: placesPinChains },
};

vi.mock('@/lib/data', () => ({
    DATA_MODE: 'remote',
    getDataClient: () => Promise.resolve(client),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99 }),
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

const stableT = (key: string) => key;
vi.mock('next-intl', () => ({
    useTranslations: () => stableT,
}));

import { useFamilyForm } from '@/app/components/family-form/useFamilyForm';

const fakeEvent = { preventDefault: () => {} } as React.FormEvent;

beforeEach(() => {
    familiesCreate.mockResolvedValue({ Id: 123 });
    familiesAddChild.mockResolvedValue(undefined);
    placesGeocodeUpsertHierarchy.mockResolvedValue(undefined);
    placesGeocodeUpsert.mockResolvedValue(undefined);
    placesPinChains.mockResolvedValue({});
    peopleGet.mockResolvedValue({ familiesAsSpouse: [] });
    citationsListForFact.mockResolvedValue([]);
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('useFamilyForm — pending place resolution (design spec §6.1)', () => {
    it('does not write to the Places gazetteer before handleSubmit is called', () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        act(() => {
            result.current.handleChange('MarriagePlace', 'Dover, Kent, England');
            result.current.setMarriagePlaceResolution([{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }]);
        });
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('flushes the pending MarriagePlace hierarchy only after the family save succeeds', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        act(() => {
            result.current.handleChange('MarriagePlace', 'Dover, Kent, England');
            result.current.setMarriagePlaceResolution([{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }]);
        });
        await act(async () => { await result.current.handleSubmit(fakeEvent); });
        expect(placesGeocodeUpsertHierarchy).toHaveBeenCalledWith(
            [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }],
            99,
        );
    });

    it('a Remove Pin (null resolution) flushes as a suppression, not the hierarchy call', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        act(() => {
            result.current.handleChange('MarriagePlace', 'Dover, Kent, England');
            result.current.setMarriagePlaceResolution(null);
        });
        await act(async () => { await result.current.handleSubmit(fakeEvent); });
        expect(placesGeocodeUpsert).toHaveBeenCalledWith(
            { name: 'Dover, Kent, England', latitude: null, longitude: null, pinSuppressed: true },
            99,
        );
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('an untouched MarriagePlace (no resolution ever set) flushes nothing', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.handleSubmit(fakeEvent); });
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
        expect(placesGeocodeUpsert).not.toHaveBeenCalled();
    });

    it('a failed place write does not block navigation or surface as a form error', async () => {
        placesGeocodeUpsertHierarchy.mockRejectedValueOnce(new Error('geocode down'));
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        act(() => {
            result.current.handleChange('MarriagePlace', 'Dover, Kent, England');
            result.current.setMarriagePlaceResolution([{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }]);
        });
        await act(async () => { await result.current.handleSubmit(fakeEvent); });
        expect(pushMock).toHaveBeenCalledWith('/families/view?id=123');
        expect(result.current.error).toBeNull();
    });
});

describe('useFamilyForm — optional partner rail reads', () => {
    it('keeps an optional partner read failure distinct from an empty result and retries only that rail', async () => {
        familiesGet.mockResolvedValueOnce({
            family: { Id: 77, MarriageDate: null, MarriagePlace: null, Type: 'Marriage' },
            husband: { Id: 10, FirstName: 'Ada', LastName: 'Lovelace' },
            wife: { Id: 11, FirstName: 'Grace', LastName: 'Hopper' },
            children: [],
        });
        peopleGet.mockRejectedValueOnce(new Error('partner service unavailable'));
        peopleGet.mockResolvedValueOnce({ familiesAsSpouse: [] });
        peopleGet.mockResolvedValueOnce({ familiesAsSpouse: [{ Id: 88 }] });

        const { result } = renderHook(() => useFamilyForm({ mode: 'edit', familyId: 77 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.partner1FamiliesError).toBe('error_generic'));
        expect(result.current.partner1Families).toEqual([]);
        await waitFor(() => expect(result.current.partner2FamiliesError).toBeNull());

        await act(async () => { result.current.retryPartner1Families(); });
        await waitFor(() => expect(result.current.partner1Families).toEqual([{ Id: 88 }]));
        expect(result.current.partner1FamiliesError).toBeNull();
        expect(result.current.partner2Families).toEqual([]);
    });
});

describe('useFamilyForm — children staged before the first save (#477)', () => {
    const kid = (Id: number, FirstName = 'Kid') => ({ Id, FirstName, LastName: 'One', Sex: null, BirthDate: null, DeathDate: null });

    it('stages a child locally instead of calling the API when there is no family yet', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.addChild(kid(5)); });
        expect(familiesAddChild).not.toHaveBeenCalled();
        expect(result.current.children.map((c) => c.person.Id)).toEqual([5]);
        // Adding closes the picker, same as the edit-mode path.
        expect(result.current.showChildPicker).toBe(false);
    });

    it('ignores a duplicate add of the same person', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.addChild(kid(5)); });
        await act(async () => { await result.current.addChild(kid(5)); });
        expect(result.current.children).toHaveLength(1);
    });

    it('stages a relationship-type change and a removal without an API call', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.addChild(kid(5)); });
        await act(async () => { await result.current.addChild(kid(6)); });
        await act(async () => { await result.current.updateChildType(5, 'Adoption'); });
        await act(async () => { await result.current.removeChild(6); });
        expect(result.current.children).toEqual([expect.objectContaining({ partner1Relationship: 'Adoption', partner2Relationship: 'Adoption' })]);
    });

    it('stages a change to one partner only (#982)', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.addChild(kid(5)); });
        await act(async () => { await result.current.updateChildType(5, 'Step', 'partner2'); });
        expect(result.current.children).toEqual([expect.objectContaining({ partner1Relationship: 'Birth', partner2Relationship: 'Step' })]);
    });

    it('flushes staged children after the family is created, each with its own type', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.addChild(kid(5)); });
        await act(async () => { await result.current.addChild(kid(6)); });
        await act(async () => { await result.current.updateChildType(6, 'Adoption'); });
        await act(async () => { await result.current.handleSubmit(fakeEvent); });

        expect(familiesAddChild).toHaveBeenCalledTimes(2);
        expect(familiesAddChild).toHaveBeenNthCalledWith(1, 123, 5, { partner1: 'Birth', partner2: 'Birth' }, 99);
        expect(familiesAddChild).toHaveBeenNthCalledWith(2, 123, 6, { partner1: 'Adoption', partner2: 'Adoption' }, 99);
        expect(pushMock).toHaveBeenCalledWith('/families/view?id=123');
    });

    // A child that fails to attach must be named, not silently dropped — the family
    // row itself is already saved, so navigating away would hide the loss.
    it('reports a failed child attach as a partial save and stays on the form', async () => {
        familiesAddChild.mockRejectedValueOnce(new Error('nope'));
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.addChild(kid(5)); });
        await act(async () => { await result.current.addChild(kid(6)); });
        await act(async () => { await result.current.handleSubmit(fakeEvent); });

        // The second child is still attempted — one failure does not abort the rest.
        expect(familiesAddChild).toHaveBeenCalledTimes(2);
        expect(result.current.error).toBe('partial_save_failed');
        expect(result.current.saving).toBe(false);
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('attaches nothing when no children were staged', async () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        await act(async () => { await result.current.handleSubmit(fakeEvent); });
        expect(familiesAddChild).not.toHaveBeenCalled();
    });
});

describe('useFamilyForm — citation pins', () => {
    it('marks a queued new-family source as pending instead of passing its queue count as a SourceId', () => {
        const { result } = renderHook(() => useFamilyForm({ mode: 'new' }));
        act(() => {
            result.current.setPendingCitations([{
                factTable: 'Families', factLabel: 'Started', page: null, sourceId: 42,
            }]);
        });

        const pin = result.current.cite('Started') as ReactElement<{ pending?: boolean; n?: number }>;
        expect(pin.props.pending).toBe(true);
        expect(pin.props.n).toBeUndefined();
    });

    it('keeps stale citations visible but disables attach until a failed read is retried', async () => {
        const stale = [{ Id: 1, SourceId: 7, sourceTitle: 'Register' }];
        citationsListForFact.mockResolvedValueOnce(stale).mockRejectedValueOnce(new Error('private citation details'));
        familiesGet.mockResolvedValueOnce({
            family: { Id: 77, MarriageDate: null, MarriagePlace: null, Type: 'Marriage' },
            husband: null, wife: null, children: [],
        });
        const { result } = renderHook(() => useFamilyForm({ mode: 'edit', familyId: 77 }));

        await waitFor(() => expect(result.current.citationsReady).toBe(true));
        expect(result.current.citations).toEqual(stale);
        expect((result.current.cite('Started') as ReactElement<{ children: ReactElement<{ onClick?: () => void }>[] }>).props.children[0].props.onClick).toEqual(expect.any(Function));

        await act(async () => { await result.current.reloadCitations(); });
        expect(result.current.citationError).toBe('failed_load');
        expect(result.current.citations).toEqual(stale);
        expect(result.current.citationsReady).toBe(false);
        expect((result.current.cite('Started') as ReactElement<{ children: ReactElement<{ onClick?: () => void }>[] }>).props.children[0].props.onClick).toBeUndefined();

        citationsListForFact.mockResolvedValueOnce([]);
        await act(async () => { await result.current.reloadCitations(); });
        expect(result.current.citationError).toBeNull();
        expect(result.current.citationsReady).toBe(true);
    });

    it('hides old-family citations and ignores their late refresh after the family changes', async () => {
        const oldCitations = [{ Id: 1, SourceId: 7, sourceTitle: 'Old register' }];
        const newCitations = [{ Id: 2, SourceId: 8, sourceTitle: 'New register' }];
        let resolveOldRefresh!: (value: typeof oldCitations) => void;
        citationsListForFact
            .mockResolvedValueOnce(oldCitations)
            .mockImplementationOnce(() => new Promise(resolve => { resolveOldRefresh = resolve; }))
            .mockResolvedValueOnce(newCitations);
        familiesGet.mockImplementation(async (id: number) => ({
            family: { Id: id, MarriageDate: null, MarriagePlace: null, Type: 'Marriage' },
            husband: null, wife: null, children: [],
        }));
        const { result, rerender } = renderHook(
            ({ familyId }) => useFamilyForm({ mode: 'edit', familyId }),
            { initialProps: { familyId: 77 } },
        );
        await waitFor(() => expect(result.current.citationsReady).toBe(true));

        let oldRefresh!: Promise<void>;
        act(() => { oldRefresh = result.current.reloadCitations(); });
        await waitFor(() => expect(citationsListForFact).toHaveBeenCalledTimes(2));
        rerender({ familyId: 78 });
        expect(result.current.citationsReady).toBe(false);
        expect(result.current.citations).toEqual([]);
        await waitFor(() => expect(result.current.citations).toEqual(newCitations));
        expect(result.current.citationsReady).toBe(true);

        await act(async () => {
            resolveOldRefresh(oldCitations);
            await oldRefresh;
        });
        expect(result.current.citations).toEqual(newCitations);
        expect(result.current.citationsReady).toBe(true);
    });
});

describe('useFamilyForm — edit-mode pre-existing pin display', () => {
    it('looks up MarriagePlace pin chain once an existing family loads', async () => {
        familiesGet.mockResolvedValueOnce({
            family: { Id: 77, MarriageDate: '1840', MarriagePlace: 'Dover, Kent, England', Type: 'Marriage' },
            husband: null, wife: null, children: [],
        });
        placesPinChains.mockResolvedValueOnce({
            'Dover, Kent, England': [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null }],
        });

        const { result } = renderHook(() => useFamilyForm({ mode: 'edit', familyId: 77 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await waitFor(() => expect(placesPinChains).toHaveBeenCalledWith(['Dover, Kent, England'], 99));
        await waitFor(() => expect(result.current.marriagePlaceInitialChain).toEqual([
            { name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null },
        ]));
    });

    it('does not call pinChains() in new mode', async () => {
        renderHook(() => useFamilyForm({ mode: 'new' }));
        await new Promise((r) => setTimeout(r, 0));
        expect(placesPinChains).not.toHaveBeenCalled();
    });

    it('does not re-fire the pinChains lookup when the user edits MarriagePlace after load', async () => {
        familiesGet.mockResolvedValueOnce({
            family: { Id: 77, MarriageDate: '1840', MarriagePlace: 'Dover, Kent, England', Type: 'Marriage' },
            husband: null, wife: null, children: [],
        });
        placesPinChains.mockResolvedValueOnce({
            'Dover, Kent, England': [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null }],
        });

        const { result } = renderHook(() => useFamilyForm({ mode: 'edit', familyId: 77 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(placesPinChains).toHaveBeenCalledTimes(1));

        act(() => {
            result.current.handleChange('MarriagePlace', 'Somewhere Else');
        });
        // Give any (incorrect) reactive effect a chance to fire before asserting.
        await new Promise((r) => setTimeout(r, 0));

        expect(placesPinChains).toHaveBeenCalledTimes(1);
        // The map only has an entry for the originally-loaded value, so editing
        // the field naturally yields no pin — correct per the load-once design.
        expect(result.current.marriagePlaceInitialChain).toBeNull();
    });
});
