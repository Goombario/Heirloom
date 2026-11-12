/**
 * @vitest-environment happy-dom
 *
 * Parity tests for usePersonForm — the behavior contract extracted from
 * PersonForm.tsx (spec §6). Mocks getDataClient, useTree, useRouter, and
 * next-intl so no DB / network / provider tree is required. Does NOT boot
 * PGlite — safe in test:fast.
 *
 * These prove the extraction preserved the fragile multi-step save behavior:
 *  - DeathDate → IsDeceased='1'
 *  - empty-name guard blocks the write
 *  - new-mode save ORDER (person → variants → citations → child → partner)
 *  - subFailures → partial_save_failed WITHOUT navigation
 *  - setPrimaryVariant optimistic update + revert on server failure
 *  - variant add/remove (temp ids in new mode, server call in edit mode)
 *  - suggestion toggle activates child/partner attach
 *  - duplicate-match filter (exact case-insensitive name match)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactElement } from 'react';

// ---- Mock data client ---------------------------------------------------
const peopleCreate = vi.fn();
const peopleUpdate = vi.fn();
const peopleGet = vi.fn();
const listNameVariants = vi.fn();
const createNameVariant = vi.fn();
const setPrimaryNameVariant = vi.fn();
const removeNameVariant = vi.fn();
const peopleRemove = vi.fn();
const peopleSearch = vi.fn();
const suggestFamily = vi.fn();
const citationsListForPerson = vi.fn();
const citationsCreate = vi.fn();
const sourcesCreate = vi.fn();
const familiesSearch = vi.fn();
const familiesAddChild = vi.fn();
const familiesCreate = vi.fn();
const placesGeocodeUpsertHierarchy = vi.fn();
const placesGeocodeUpsert = vi.fn();
const placesPinChains = vi.fn();

const client = {
    people: {
        create: peopleCreate,
        update: peopleUpdate,
        get: peopleGet,
        listNameVariants,
        createNameVariant,
        setPrimaryNameVariant,
        removeNameVariant,
        remove: peopleRemove,
        search: peopleSearch,
        suggestFamily,
    },
    citations: { listForPerson: citationsListForPerson, create: citationsCreate },
    sources: { create: sourcesCreate },
    families: { search: familiesSearch, addChild: familiesAddChild, create: familiesCreate },
    places: { geocodeUpsertHierarchy: placesGeocodeUpsertHierarchy, geocodeUpsert: placesGeocodeUpsert, pinChains: placesPinChains },
};

vi.mock('@/lib/data', () => ({
    DATA_MODE: 'remote',
    getDataClient: () => Promise.resolve(client),
}));

// ---- Mock useTree -------------------------------------------------------
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99 }),
}));

// ---- Mock next/navigation router ----------------------------------------
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

// ---- Mock next-intl (t returns the key) ---------------------------------
// `t` MUST be a stable identity across renders — the load effect depends on it,
// and a fresh function each render would re-run the effect forever (real
// next-intl memoizes the translator, so this mirrors production).
const stableT = (key: string) => key;
vi.mock('next-intl', () => ({
    useTranslations: () => stableT,
}));

// ---- Mock auth/error mapping (no window.location redirect) ----------------
const { redirectIfUnauthorized } = vi.hoisted(() => ({
    redirectIfUnauthorized: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/utils/data-error', () => ({
    redirectIfUnauthorized,
    errorToastKey: vi.fn().mockReturnValue('error_generic'),
}));

// Import AFTER mocks
import { usePersonForm, type UsePersonFormProps } from '@/app/components/person-form/usePersonForm';

const newProps: UsePersonFormProps = { mode: 'new' };

beforeEach(() => {
    // usePersonForm → useIsMobile calls window.matchMedia; mock it to pin
    // matches:false (desktop) deterministically, independent of the DOM engine.
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });

    peopleCreate.mockResolvedValue({ Id: 123 });
    peopleUpdate.mockResolvedValue({ Id: 55 });
    peopleGet.mockResolvedValue({
        Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
        BirthDate: '1815', BirthPlace: '', DeathDate: '', DeathPlace: '',
        IsDeceased: 1, Notes: '', familiesAsSpouse: [], familiesAsChild: [],
        parents: [], spouses: [],
    });
    listNameVariants.mockResolvedValue([]);
    citationsListForPerson.mockResolvedValue({});
    createNameVariant.mockResolvedValue({ Id: 900, IsPrimary: 0 });
    setPrimaryNameVariant.mockResolvedValue(undefined);
    removeNameVariant.mockResolvedValue(undefined);
    peopleRemove.mockResolvedValue(undefined);
    peopleSearch.mockResolvedValue([]);
    suggestFamily.mockResolvedValue([]);
    sourcesCreate.mockResolvedValue({ Id: 7 });
    citationsCreate.mockResolvedValue(undefined);
    familiesSearch.mockResolvedValue([]);
    familiesAddChild.mockResolvedValue(undefined);
    familiesCreate.mockResolvedValue({ Id: 77 });
    placesGeocodeUpsertHierarchy.mockResolvedValue(undefined);
    placesGeocodeUpsert.mockResolvedValue(undefined);
    placesPinChains.mockResolvedValue({});
});

afterEach(() => {
    vi.clearAllMocks();
});

// =========================================================================
describe('usePersonForm — field rules', () => {
    it("setField('DeathDate', value) forces IsDeceased='1'", () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setField('DeathDate', '1990'));
        expect(result.current.form.DeathDate).toBe('1990');
        expect(result.current.form.IsDeceased).toBe('1');
    });

    it("setField('DeathDate', '') does NOT force deceased", () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setField('DeathDate', ''));
        expect(result.current.form.IsDeceased).toBe('');
    });

    it('setField on FirstName clears its fieldError', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        // Trigger the empty-name guard to set fieldErrors first.
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(result.current.fieldErrors.FirstName).toBe(true);
        act(() => result.current.setField('FirstName', 'Grace'));
        expect(result.current.fieldErrors.FirstName).toBe(false);
    });
});

describe('usePersonForm — citation pins', () => {
    it('marks a queued new-person source as pending instead of passing its queue count as a SourceId', () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.pushPendingCitation({
                factTable: 'PersonName', factLabel: 'Name', page: null, sourceId: 42,
            });
        });

        const pin = result.current.cite('Name', 'Name') as ReactElement<{ pending?: boolean; n?: number }>;
        expect(pin.props.pending).toBe(true);
        expect(pin.props.n).toBeUndefined();
    });

    it('keeps stale citations visible but disables attach until a failed read is retried', async () => {
        const stale = { 'PersonBirth:55': [{ Id: 1, SourceId: 7, sourceTitle: 'Register' }] };
        citationsListForPerson.mockResolvedValueOnce(stale).mockRejectedValueOnce(new Error('private citation details'));
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));

        await waitFor(() => expect(result.current.citationsReady).toBe(true));
        expect(result.current.citationMap).toEqual(stale);
        expect((result.current.cite('Birth', 'Birth') as ReactElement<{ children: ReactElement<{ onClick?: () => void }>[] }>).props.children[0].props.onClick).toEqual(expect.any(Function));

        await act(async () => { await result.current.refreshCitations(); });
        expect(result.current.citationError).toBe('failed_load');
        expect(result.current.citationMap).toEqual(stale);
        expect(result.current.citationsReady).toBe(false);
        expect((result.current.cite('Birth', 'Birth') as ReactElement<{ children: ReactElement<{ onClick?: () => void }>[] }>).props.children[0].props.onClick).toBeUndefined();

        citationsListForPerson.mockResolvedValueOnce({});
        await act(async () => { await result.current.refreshCitations(); });
        expect(result.current.citationError).toBeNull();
        expect(result.current.citationsReady).toBe(true);
    });

    it('hides old-record citations and ignores their late refresh after the record changes', async () => {
        const oldMap = { 'PersonBirth:55': [{ Id: 1, SourceId: 7, sourceTitle: 'Old register' }] };
        const newMap = { 'PersonBirth:56': [{ Id: 2, SourceId: 8, sourceTitle: 'New register' }] };
        let resolveOldRefresh!: (value: typeof oldMap) => void;
        citationsListForPerson
            .mockResolvedValueOnce(oldMap)
            .mockImplementationOnce(() => new Promise(resolve => { resolveOldRefresh = resolve; }))
            .mockResolvedValueOnce(newMap);
        peopleGet.mockImplementation(async (id: number) => ({
            Id: id, FirstName: 'Ada', LastName: String(id), Sex: 'F', BirthDate: '', BirthPlace: '',
            DeathDate: '', DeathPlace: '', IsDeceased: 0, Notes: '', familiesAsSpouse: [], familiesAsChild: [],
            parents: [], spouses: [],
        }));
        const { result, rerender } = renderHook(
            ({ personId }) => usePersonForm({ mode: 'edit', personId }),
            { initialProps: { personId: 55 } },
        );
        await waitFor(() => expect(result.current.citationsReady).toBe(true));

        let oldRefresh!: Promise<void>;
        act(() => { oldRefresh = result.current.refreshCitations(); });
        await waitFor(() => expect(citationsListForPerson).toHaveBeenCalledTimes(2));
        rerender({ personId: 56 });
        expect(result.current.citationsReady).toBe(false);
        expect(result.current.citationMap).toEqual({});
        await waitFor(() => expect(result.current.citationMap).toEqual(newMap));
        expect(result.current.citationsReady).toBe(true);

        await act(async () => {
            resolveOldRefresh(oldMap);
            await oldRefresh;
        });
        expect(result.current.citationMap).toEqual(newMap);
        expect(result.current.citationsReady).toBe(true);
    });
});

// =========================================================================
describe('usePersonForm — empty-name guard', () => {
    it('blocks the write and sets err_name_required when both names blank', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(result.current.error).toBe('err_name_required');
        expect(result.current.fieldErrors).toEqual({ FirstName: true, LastName: true });
        expect(peopleCreate).not.toHaveBeenCalled();
        expect(pushMock).not.toHaveBeenCalled();
        expect(result.current.saving).toBe(false);
    });
});

describe('usePersonForm — failed initial load', () => {
    it('exposes translated load error and retries the person read', async () => {
        peopleGet.mockRejectedValueOnce(new Error('database details must stay private'));
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('failed_load');
        expect(peopleGet).toHaveBeenCalledTimes(1);

        await act(async () => { result.current.retryLoad(); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(peopleGet).toHaveBeenCalledTimes(2);
    });
});

// =========================================================================
describe('usePersonForm — new-mode save order + partial failure', () => {
    async function primeFullSave(result: { current: ReturnType<typeof usePersonForm> }) {
        // name + a local variant + a pending citation + child attach + partner attach
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setNewVariantName('Gracie');
        });
        await act(async () => { await result.current.addNameVariant(); });
        act(() => {
            result.current.pushPendingCitation({ factTable: 'PersonName', factLabel: 'Name', page: null, newSource: { Title: 'Reg', Type: 'Document', Author: null, RepositoryName: null } } as never);
            result.current.setSelectedFamily({ Id: 10, MarriageDate: null, husbandName: 'A', wifeName: 'B', childCount: 0 });
            result.current.setAttachAsChild(true);
            result.current.setSelectedSpouse({ Id: 20, FirstName: 'Bob', LastName: 'X', Sex: 'M', BirthDate: null, DeathDate: null } as never);
            result.current.setAttachAsPartner(true);
        });
    }

    it('executes sub-steps in order: person → variant → source/citation → child → partner, then navigates', async () => {
        const order: string[] = [];
        peopleCreate.mockImplementation(async () => { order.push('person'); return { Id: 123 }; });
        createNameVariant.mockImplementation(async () => { order.push('variant'); return { Id: 900, IsPrimary: 0 }; });
        sourcesCreate.mockImplementation(async () => { order.push('source'); return { Id: 7 }; });
        citationsCreate.mockImplementation(async () => { order.push('citation'); });
        familiesAddChild.mockImplementation(async () => { order.push('child'); });
        familiesCreate.mockImplementation(async () => { order.push('partner'); return { Id: 77 }; });

        const { result } = renderHook(() => usePersonForm(newProps));
        await primeFullSave(result);
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(order).toEqual(['person', 'variant', 'source', 'citation', 'child', 'partner']);
        expect(familiesAddChild).toHaveBeenCalledWith(10, 123, 'Birth', 99);
        expect(pushMock).toHaveBeenCalledWith('/people/view?id=123');
        expect(result.current.error).toBeNull();
    });

    it('surfaces partial_save_failed and does NOT navigate when a sub-step fails', async () => {
        familiesAddChild.mockRejectedValueOnce(new Error('boom'));
        const { result } = renderHook(() => usePersonForm(newProps));
        await primeFullSave(result);
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(peopleCreate).toHaveBeenCalledTimes(1);
        expect(result.current.error).toBe('partial_save_failed');
        expect(pushMock).not.toHaveBeenCalled();
        expect(result.current.saving).toBe(false);
    });

    it('create person itself failing surfaces failed_save and does not navigate', async () => {
        peopleCreate.mockRejectedValueOnce(new Error('db down'));
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setField('FirstName', 'Grace'));
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(pushMock).not.toHaveBeenCalled();
        expect(result.current.error).toBe('failed_save');
    });
});

// =========================================================================
describe('usePersonForm — staged people from the phone pickers (#1065)', () => {
    const nils = { firstName: 'Nils', lastName: 'Berg', sex: 'M', birthDate: '1870' };

    it('creates a new parent with a family of their own and adds this person as its child', async () => {
        peopleCreate.mockResolvedValueOnce({ Id: 123 }).mockResolvedValueOnce({ Id: 124 });
        familiesCreate.mockResolvedValueOnce({ Id: 30 });
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setNewParent(nils);
            result.current.setChildRelationshipType('Adoption');
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(peopleCreate).toHaveBeenNthCalledWith(2, { FirstName: 'Nils', LastName: 'Berg', Sex: 'M', BirthDate: '1870' }, { treeId: 99 });
        expect(familiesCreate).toHaveBeenCalledWith({ Partner1Id: 124, Partner2Id: null }, 99);
        expect(familiesAddChild).toHaveBeenCalledWith(30, 123, 'Adoption', 99);
        expect(pushMock).toHaveBeenCalledWith('/people/view?id=123');
    });

    it('puts the children in the family made with a new partner, creating staged children too', async () => {
        peopleCreate.mockResolvedValueOnce({ Id: 123 }).mockResolvedValueOnce({ Id: 124 }).mockResolvedValueOnce({ Id: 125 });
        familiesCreate.mockResolvedValueOnce({ Id: 31 });
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setNewSpouse(nils);
            result.current.setAttachAsPartner(true);
            result.current.setMarriageDate('1893');
            result.current.setChildren([
                { kind: 'existing', person: { Id: 40, FirstName: 'Karin', LastName: 'Berg' } as never },
                { kind: 'new', draft: { firstName: 'Erik', lastName: 'Berg', sex: null, birthDate: null } },
            ]);
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(familiesCreate).toHaveBeenCalledTimes(1);
        expect(familiesCreate).toHaveBeenCalledWith({ Partner1Id: 123, Partner2Id: 124, MarriageDate: '1893', MarriagePlace: null, MarriagePlaceId: null }, 99);
        expect(familiesAddChild).toHaveBeenCalledWith(31, 40, 'Birth', 99);
        expect(familiesAddChild).toHaveBeenCalledWith(31, 125, 'Birth', 99);
        expect(result.current.error).toBeNull();
    });

    it('adds the child to a picked family with a link per parent (blended family)', async () => {
        peopleCreate.mockResolvedValueOnce({ Id: 123 });
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setSelectedFamily({ Id: 10, MarriageDate: null, husbandName: 'A', wifeName: 'B', childCount: 0 });
            result.current.setAttachAsChild(true);
            result.current.setParentLinks({ partner1: 'Birth', partner2: 'Step' });
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(familiesAddChild).toHaveBeenCalledWith(10, 123, { partner1: 'Birth', partner2: 'Step' }, 99);
    });

    it('without a partner the children join a family whose other parent is unknown', async () => {
        peopleCreate.mockResolvedValueOnce({ Id: 123 });
        familiesCreate.mockResolvedValueOnce({ Id: 32 });
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setChildren([{ kind: 'existing', person: { Id: 40, FirstName: 'Karin', LastName: 'Berg' } as never }]);
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(familiesCreate).toHaveBeenCalledWith({ Partner1Id: 123, Partner2Id: null }, 99);
        expect(familiesAddChild).toHaveBeenCalledWith(32, 40, 'Birth', 99);
    });

    it('keeps the children out of a solo family when the partner family failed, and says so', async () => {
        peopleCreate.mockResolvedValueOnce({ Id: 123 });
        familiesCreate.mockRejectedValueOnce(new Error('boom'));
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setSelectedSpouse({ Id: 20, FirstName: 'Bob', LastName: 'X' } as never);
            result.current.setAttachAsPartner(true);
            result.current.setChildren([{ kind: 'existing', person: { Id: 40, FirstName: 'Karin', LastName: 'Berg' } as never }]);
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(familiesCreate).toHaveBeenCalledTimes(1);
        expect(familiesAddChild).not.toHaveBeenCalled();
        expect(result.current.error).toBe('partial_save_failed');
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('counts staged people as changes, and stageVariant adds, edits and moves the primary', () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        expect(result.current.isDirty).toBe(false);
        act(() => result.current.setNewSpouse(nils));
        expect(result.current.isDirty).toBe(true);

        act(() => result.current.stageVariant({ Type: 'Nickname', Name: ' Nisse ', IsPrimary: true }));
        act(() => result.current.stageVariant({ Type: 'Maiden', Name: 'Moe', IsPrimary: false }));
        const [a, b] = result.current.variants;
        expect(a).toMatchObject({ Name: 'Nisse', IsPrimary: 1 });
        act(() => result.current.stageVariant({ Id: b.Id, Type: 'Married', Name: 'Moe', IsPrimary: true }));
        expect(result.current.variants.map((v) => [v.Type, v.IsPrimary])).toEqual([['Nickname', 0], ['Married', 1]]);
    });
});

// =========================================================================
describe('usePersonForm — variants add/remove', () => {
    it('new mode: addNameVariant holds a temp (negative-id) variant without a server call', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setNewVariantName('Gigi'));
        await act(async () => { await result.current.addNameVariant(); });

        expect(createNameVariant).not.toHaveBeenCalled();
        expect(result.current.variants).toHaveLength(1);
        expect(result.current.variants[0].Id).toBeLessThan(0);
        expect(result.current.variants[0].Name).toBe('Gigi');
    });

    it('new mode: saves the star where the form showed it, overriding the server promotion (#1232)', async () => {
        peopleCreate.mockResolvedValue({ Id: 123 });
        // The server promotes a first nickname (#436).
        createNameVariant.mockResolvedValueOnce({ Id: 900, IsPrimary: 1 });
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setField('FirstName', 'Margaret'));
        act(() => result.current.setNewVariantName('Peggy'));
        await act(async () => { await result.current.addNameVariant(); });
        expect(result.current.variants[0].IsPrimary).toBe(1); // the form shows the promotion
        await act(async () => { await result.current.setPrimaryVariant(null); }); // star back to the first name
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(setPrimaryNameVariant).toHaveBeenCalledWith(123, 900, false, 99);
    });

    it('new mode: leaves a kept promotion alone', async () => {
        peopleCreate.mockResolvedValue({ Id: 123 });
        createNameVariant.mockResolvedValueOnce({ Id: 900, IsPrimary: 1 });
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setField('FirstName', 'Margaret'));
        act(() => result.current.setNewVariantName('Peggy'));
        await act(async () => { await result.current.addNameVariant(); });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(setPrimaryNameVariant).not.toHaveBeenCalled();
    });

    it('new mode: removeNameVariant drops a temp variant locally', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => result.current.setNewVariantName('Gigi'));
        await act(async () => { await result.current.addNameVariant(); });
        const tempId = result.current.variants[0].Id;
        await act(async () => { await result.current.removeNameVariant(tempId); });
        expect(result.current.variants).toHaveLength(0);
        expect(removeNameVariant).not.toHaveBeenCalled();
    });

    it('edit mode: addNameVariant calls the server and appends the returned row', async () => {
        createNameVariant.mockResolvedValueOnce({ Id: 901, PersonId: 55, Type: 'Nickname', Name: 'Ace', FromDate: null, ToDate: null, IsPrimary: 0 });
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setNewVariantName('Ace'));
        await act(async () => { await result.current.addNameVariant(); });

        expect(createNameVariant).toHaveBeenCalledWith(55, { Type: 'Nickname', Name: 'Ace' }, 99);
        expect(result.current.variants.some(v => v.Id === 901)).toBe(true);
    });
});

// =========================================================================
describe('usePersonForm — setPrimaryVariant optimistic + revert', () => {
    it('edit mode: success keeps the new primary', async () => {
        listNameVariants.mockResolvedValueOnce([
            { Id: 1, PersonId: 55, Type: 'Nickname', Name: 'A', FromDate: null, ToDate: null, IsPrimary: 0 },
            { Id: 2, PersonId: 55, Type: 'Maiden', Name: 'B', FromDate: null, ToDate: null, IsPrimary: 0 },
        ]);
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.setPrimaryVariant(2); });

        expect(setPrimaryNameVariant).toHaveBeenCalledWith(55, 2, true, 99);
        expect(result.current.variants.find(v => v.Id === 2)?.IsPrimary).toBe(1);
        expect(result.current.variants.find(v => v.Id === 1)?.IsPrimary).toBe(0);
    });

    it('edit mode: server failure reverts the optimistic update and sets error', async () => {
        listNameVariants.mockResolvedValueOnce([
            { Id: 1, PersonId: 55, Type: 'Nickname', Name: 'A', FromDate: null, ToDate: null, IsPrimary: 1 },
            { Id: 2, PersonId: 55, Type: 'Maiden', Name: 'B', FromDate: null, ToDate: null, IsPrimary: 0 },
        ]);
        setPrimaryNameVariant.mockRejectedValueOnce(new Error('nope'));
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.setPrimaryVariant(2); });

        // Reverted: variant 1 is primary again, variant 2 is not.
        expect(result.current.variants.find(v => v.Id === 1)?.IsPrimary).toBe(1);
        expect(result.current.variants.find(v => v.Id === 2)?.IsPrimary).toBe(0);
        expect(result.current.error).toBe('partial_save_primary');
    });
});

// =========================================================================
describe('usePersonForm — suggestions toggle', () => {
    it('toggleSuggestion activates child attach for a child suggestion and partner attach for a spouse suggestion', async () => {
        suggestFamily.mockResolvedValue([
            { role: 'child', score: 1, familyId: 10, husbandName: 'Pa', wifeName: 'Ma', marriageDate: null, childCount: 2, personFirstName: null, personLastName: null, personName: null, personBirthDate: null },
            { role: 'spouse', score: 1, familyId: undefined, husbandName: null, wifeName: null, marriageDate: null, personId: 20, personFirstName: 'Bob', personLastName: 'X', personName: 'Bob X', personBirthDate: '1850' },
        ]);
        const { result } = renderHook(() => usePersonForm(newProps));
        // Suggestion fetch fires on LastName + 4-digit BirthDate (500ms debounce).
        act(() => {
            result.current.setField('LastName', 'Smith');
            result.current.setField('BirthDate', '1850');
        });
        await waitFor(() => expect(result.current.visibleSuggestions).toHaveLength(2));

        act(() => result.current.toggleSuggestion(0));
        expect(result.current.attachAsChild).toBe(true);
        expect(result.current.selectedFamily?.Id).toBe(10);

        act(() => result.current.toggleSuggestion(1));
        expect(result.current.attachAsPartner).toBe(true);
        expect(result.current.selectedSpouse?.Id).toBe(20);

        // Toggling the active child suggestion again clears it.
        act(() => result.current.toggleSuggestion(0));
        expect(result.current.attachAsChild).toBe(false);
        expect(result.current.selectedFamily).toBeNull();
    });
});

// Alt+1/2/3 matches the physical key (e.code), not e.key: on layouts where Alt
// composes a character over the digit row, e.key isn't '1', and the shortcut
// silently missed until a second press (#478).
describe('usePersonForm — Alt+digit suggestion shortcut (#478)', () => {
    it('toggles on e.code even when Alt turns e.key into a composed character', async () => {
        suggestFamily.mockResolvedValue([
            { role: 'child', score: 1, familyId: 10, husbandName: 'Pa', wifeName: 'Ma', marriageDate: null, childCount: 2, personFirstName: null, personLastName: null, personName: null, personBirthDate: null },
        ]);
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('LastName', 'Smith');
            result.current.setField('BirthDate', '1850');
        });
        await waitFor(() => expect(result.current.visibleSuggestions).toHaveLength(1));

        const input = document.body.appendChild(document.createElement('input'));
        act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: '¡', code: 'Digit1', altKey: true, bubbles: true })); });
        expect(result.current.attachAsChild).toBe(true);

        // Numpad 1 counts too; e.key alone (no matching code) does not.
        act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Numpad1', altKey: true, bubbles: true })); });
        expect(result.current.attachAsChild).toBe(false);
        act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'KeyQ', altKey: true, bubbles: true })); });
        expect(result.current.attachAsChild).toBe(false);
        input.remove();
    });
});

// =========================================================================
describe('usePersonForm — duplicate-match filter', () => {
    it('keeps only exact case-insensitive name matches', async () => {
        peopleSearch.mockResolvedValue([
            { Id: 1, FirstName: 'Grace', LastName: 'Hopper', BirthDate: '1906' },
            { Id: 2, FirstName: 'grace', LastName: 'hopper', BirthDate: '1900' }, // case-insensitive match
            { Id: 3, FirstName: 'Grace', LastName: 'Murray', BirthDate: '1910' }, // different surname — excluded
        ]);
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setField('LastName', 'Hopper');
        });
        await waitFor(() => expect(result.current.potentialDuplicates.length).toBe(2));
        expect(result.current.potentialDuplicates.map(p => p.Id).sort()).toEqual([1, 2]);
    });
});

// =========================================================================
describe('usePersonForm — pending place resolution (design spec §6.1)', () => {
    it('does not write to the Places gazetteer before submit is called', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Ada');
            result.current.setField('BirthPlace', 'Dover, Kent, England');
            result.current.setBirthPlaceResolution([
                { name: 'Kent', latitude: null, longitude: null },
                { name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 },
            ]);
        });
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('flushes the pending BirthPlace hierarchy only after the person save succeeds', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Ada');
            result.current.setField('BirthPlace', 'Dover, Kent, England');
            result.current.setBirthPlaceResolution([
                { name: 'Kent', latitude: null, longitude: null },
                { name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 },
            ]);
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(placesGeocodeUpsertHierarchy).toHaveBeenCalledWith(
            [
                { name: 'Kent', latitude: null, longitude: null },
                { name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 },
            ],
            99,
        );
    });

    it('a Remove Pin (null resolution) flushes as a suppression via geocodeUpsert, not the hierarchy call', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Ada');
            result.current.setField('DeathPlace', 'Dover, Kent, England');
            result.current.setDeathPlaceResolution(null);
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(placesGeocodeUpsert).toHaveBeenCalledWith(
            { name: 'Dover, Kent, England', latitude: null, longitude: null, pinSuppressed: true },
            99,
        );
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('an untouched place field (no resolution ever set) flushes nothing', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => { result.current.setField('FirstName', 'Ada'); });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
        expect(placesGeocodeUpsert).not.toHaveBeenCalled();
    });

    it('a failed place write does not block navigation or surface as a form error', async () => {
        placesGeocodeUpsertHierarchy.mockRejectedValueOnce(new Error('geocode down'));
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Ada');
            result.current.setField('BirthPlace', 'Dover, Kent, England');
            result.current.setBirthPlaceResolution([{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }]);
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(pushMock).toHaveBeenCalledWith('/people/view?id=123');
        expect(result.current.error).toBeNull();
    });
});

// =========================================================================
describe('usePersonForm — "Save & add another" resets variant state (#474)', () => {
    async function saveWithVariantThenAddAnother(result: { current: ReturnType<typeof usePersonForm> }) {
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setNewVariantName('Gracie');
        });
        await act(async () => { await result.current.addNameVariant(); });
        expect(result.current.variants).toHaveLength(1);
        await act(async () => { await result.current.submit({ addAnother: true }); });
    }

    it('clears the collected variants so they do not carry to the next person', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        await saveWithVariantThenAddAnother(result);

        expect(result.current.form.FirstName).toBe('');
        expect(result.current.variants).toEqual([]);
    });

    // The harmful half: a surviving variants array is replayed against the NEXT
    // person's id by the creation loop, writing a nickname to someone who never
    // had one — once per subsequent person, unattended.
    it('does not re-create the previous person\'s variants on the next save', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        await saveWithVariantThenAddAnother(result);
        expect(createNameVariant).toHaveBeenCalledTimes(1);

        createNameVariant.mockClear();
        peopleCreate.mockResolvedValueOnce({ Id: 124 });
        act(() => { result.current.setField('FirstName', 'Ada'); });
        await act(async () => { await result.current.submit({ addAnother: true }); });

        expect(peopleCreate).toHaveBeenCalledTimes(2);
        expect(createNameVariant).not.toHaveBeenCalled();
    });

    // A variant typed but never added is separate state from `variants`, and it
    // leaks the same way — addNameVariant is what normally clears it.
    it('clears a typed-but-unadded variant name and resets the type selector', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Grace');
            result.current.setNewVariantType('Maiden');
            result.current.setNewVariantName('Hopper');
        });
        await act(async () => { await result.current.submit({ addAnother: true }); });

        expect(result.current.newVariantName).toBe('');
        expect(result.current.newVariantType).toBe('Nickname');
    });
});

// =========================================================================
describe('usePersonForm — edit-mode pre-existing pin display', () => {
    it('looks up BirthPlace/DeathPlace pin chains once an existing person loads', async () => {
        peopleGet.mockResolvedValueOnce({
            Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
            BirthDate: '1815', BirthPlace: 'Dover, Kent, England', DeathDate: '1852', DeathPlace: 'London, England',
            IsDeceased: 1, Notes: '', familiesAsSpouse: [], familiesAsChild: [],
            parents: [], spouses: [],
        });
        placesPinChains.mockResolvedValueOnce({
            'Dover, Kent, England': [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null }],
        });

        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await waitFor(() => expect(placesPinChains).toHaveBeenCalledWith(['Dover, Kent, England', 'London, England'], 99));
        await waitFor(() => expect(result.current.birthPlaceInitialChain).toEqual([
            { name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null },
        ]));
        expect(result.current.deathPlaceInitialChain).toBeNull();
    });

    it('does not call pinChains() in new mode', async () => {
        renderHook(() => usePersonForm(newProps));
        await new Promise((r) => setTimeout(r, 0));
        expect(placesPinChains).not.toHaveBeenCalled();
    });

    it('does not re-fire the pinChains lookup when the user edits BirthPlace after load', async () => {
        peopleGet.mockResolvedValueOnce({
            Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
            BirthDate: '1815', BirthPlace: 'Dover, Kent, England', DeathDate: '1852', DeathPlace: 'London, England',
            IsDeceased: 1, Notes: '', familiesAsSpouse: [], familiesAsChild: [],
            parents: [], spouses: [],
        });
        placesPinChains.mockResolvedValueOnce({
            'Dover, Kent, England': [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null }],
        });

        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(placesPinChains).toHaveBeenCalledTimes(1));

        act(() => {
            result.current.setField('BirthPlace', 'Somewhere Else');
        });
        // Give any (incorrect) reactive effect a chance to fire before asserting.
        await new Promise((r) => setTimeout(r, 0));

        expect(placesPinChains).toHaveBeenCalledTimes(1);
        // The map only has an entry for the originally-loaded value, so editing
        // the field naturally yields no pin — correct per the load-once design.
        expect(result.current.birthPlaceInitialChain).toBeNull();
    });
});

// =========================================================================
describe('usePersonForm — death cause (#480)', () => {
    it('submits DeathCause in the create payload', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => {
            result.current.setField('FirstName', 'Ada');
            result.current.setField('DeathCause', 'Heart failure');
        });
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(peopleCreate).toHaveBeenCalledWith(
            expect.objectContaining({ DeathCause: 'Heart failure' }),
            expect.anything(),
        );
    });

    it('sends null rather than an empty string when no cause was entered', async () => {
        const { result } = renderHook(() => usePersonForm(newProps));
        act(() => { result.current.setField('FirstName', 'Ada'); });
        await act(async () => { await result.current.submit({ addAnother: false }); });

        expect(peopleCreate).toHaveBeenCalledWith(
            expect.objectContaining({ DeathCause: null }),
            expect.anything(),
        );
    });
});

// =========================================================================
describe('usePersonForm — Living or Unknown over a death (#895)', () => {
    beforeEach(() => {
        peopleGet.mockResolvedValue({
            Id: 55, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F',
            BirthDate: '1815', BirthPlace: '', DeathDate: '1852', DeathPlace: 'London', DeathCause: 'Cancer',
            IsDeceased: 1, Notes: '', familiesAsSpouse: [], familiesAsChild: [],
            parents: [], spouses: [],
        });
    });

    it('waits for confirmation, then saves Living with the death columns cleared', async () => {
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.setField('IsDeceased', '0'));

        await act(async () => { await result.current.submit({ addAnother: false }); });
        expect(peopleUpdate).not.toHaveBeenCalled();
        expect(result.current.clearDeathPending).toEqual({ addAnother: false });

        await act(async () => { result.current.confirmClearDeath(); });
        await waitFor(() => expect(peopleUpdate).toHaveBeenCalledTimes(1));
        expect(peopleUpdate.mock.calls[0][1]).toMatchObject({ IsDeceased: 0, DeathDate: null, DeathPlace: null, DeathCause: null });
    });

    it('cancel restores the status and saves nothing', async () => {
        const { result } = renderHook(() => usePersonForm({ mode: 'edit', personId: 55 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.setField('IsDeceased', ''));
        await act(async () => { await result.current.submit({ addAnother: false }); });
        act(() => result.current.cancelClearDeath());

        expect(result.current.clearDeathPending).toBeNull();
        expect(result.current.form.IsDeceased).toBe('1');
        expect(peopleUpdate).not.toHaveBeenCalled();
    });
});
