/**
 * @vitest-environment happy-dom
 *
 * Regression test for the draft→live transition on /cases/new.
 *
 * The old code called router.replace('/cases/view?id=N') after creating the
 * draft, which REMOUNTED CaseDetailView; the fresh mount started with
 * loading=true and painted CaseDetailView's loading gate for a frame — the
 * visible flash. The fix transitions in place: seed the created case, flip
 * isDraft→false via an internal createdId, and update the URL with
 * history.replaceState (no router navigation, so no remount, so the loading
 * gate never re-enters).
 *
 * Mocks the data client, TreeContext, next/navigation, and next-intl so no
 * DB / provider tree is required. Does NOT boot PGlite — safe in test:fast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---- Mock data client ---------------------------------------------------
const casesCreate = vi.fn();
const casesGet = vi.fn();
const casesUpdate = vi.fn();
const client = { cases: { create: casesCreate, get: casesGet, update: casesUpdate } };
vi.mock('@/lib/data', () => ({
    DATA_MODE: 'remote',
    getDataClient: () => Promise.resolve(client),
}));

// ---- Mock useTree -------------------------------------------------------
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeOwnerId: 99, activePermission: 'owner' }),
}));

// ---- Mock next/navigation (router + searchParams) -----------------------
const replaceMock = vi.fn();
const pushMock = vi.fn();
// Router object MUST be a stable identity across renders — real useRouter()
// memoizes it, and useCaseDetail lists `router` in fetchCase's useCallback deps,
// so a fresh object each render would loop the fetch effect forever.
const routerObj = { replace: replaceMock, push: pushMock };
const searchParams = { get: (_k: string) => null };
vi.mock('next/navigation', () => ({
    useRouter: () => routerObj,
    useSearchParams: () => searchParams,
}));

// ---- Mock next-intl (stable t so effects don't re-run forever) ----------
const stableT = (key: string) => key;
vi.mock('next-intl', () => ({ useTranslations: () => stableT }));

// ---- Mock handleDataError (no redirect) ---------------------------------
vi.mock('@/lib/utils/data-error', () => ({
    handleDataError: vi.fn().mockReturnValue(false),
}));

// Import AFTER mocks
import { useCaseDetail } from '@/app/cases/view/useCaseDetail';

beforeEach(() => {
    vi.clearAllMocks();
    replaceMock.mockClear();
    pushMock.mockClear();
    casesCreate.mockResolvedValue({
        Id: 500, UserId: 99, Title: 'My case', Description: null,
        Status: 'in_progress', Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
    });
    casesGet.mockResolvedValue({
        Id: 500, UserId: 99, Title: 'My case', Description: null,
        Status: 'in_progress', Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        people: [], media: [], citations: [], comments: [],
    });
});

describe('useCaseDetail draft→live transition', () => {
    it('transitions in place — no router.replace, no re-entry into the loading gate', async () => {
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

        const { result } = renderHook(() => useCaseDetail({ forceDraft: true }));

        // Draft mount: blank case, inert.
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.isDraft).toBe(true);
        expect(result.current.caseReady).toBe(false);

        act(() => { result.current.setTitleValue('My case'); });
        await act(async () => { await result.current.saveComposed(); });

        // No route navigation → no remount → the loading gate never re-enters.
        expect(replaceMock).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);

        // URL updated in place to the live case (assert the URL arg directly —
        // jsdom's window.history.state is null, which expect.anything() rejects).
        expect(replaceStateSpy).toHaveBeenCalledTimes(1);
        expect(replaceStateSpy.mock.calls[0][2]).toBe('/cases/view?id=500');

        // State flipped to the live case, in place.
        expect(result.current.isDraft).toBe(false);
        expect(result.current.caseReady).toBe(true);
        expect(result.current.id).toBe('500');
        expect(result.current.caseData?.Title).toBe('My case');

        replaceStateSpy.mockRestore();
    });

    it('creates with the latest description and keeps the fields while typing (#912)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { result } = renderHook(() => useCaseDetail({ forceDraft: true }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // Title, then the description, with no pause long enough to save between.
        act(() => { result.current.setTitleValue('My case'); });
        act(() => { vi.advanceTimersByTime(400); });
        act(() => { result.current.setDescValue('Who were his parents?'); });
        await act(async () => { vi.advanceTimersByTime(700); });

        await waitFor(() => expect(casesCreate).toHaveBeenCalledTimes(1));
        expect(casesCreate.mock.calls[0][0]).toMatchObject({ Title: 'My case', Description: 'Who were his parents?' });
        await waitFor(() => expect(result.current.isDraft).toBe(false));
        // Still composing: the header keeps its inputs (and focus) after the create.
        expect(result.current.composing).toBe(true);
        vi.useRealTimers();
    });

    it('autosaves later edits through an update, without a second create', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        casesCreate.mockResolvedValue({
            Id: 500, UserId: 99, Title: 'My case', Description: null,
            Status: 'in_progress', Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        });
        casesUpdate.mockResolvedValue({});
        // A refetch returns what was saved: no description until the update lands.
        casesGet.mockImplementation(async () => ({
            Id: 500, UserId: 99, Title: 'My case', Description: casesUpdate.mock.calls.length > 0 ? 'More detail' : null,
            Status: 'in_progress', Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
            people: [], media: [], citations: [], comments: [],
        }));
        const { result } = renderHook(() => useCaseDetail({ forceDraft: true }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.setTitleValue('My case'); });
        await act(async () => { vi.advanceTimersByTime(700); });
        await waitFor(() => expect(result.current.isDraft).toBe(false));

        act(() => { result.current.setDescValue('More detail'); });
        await act(async () => { vi.advanceTimersByTime(700); });
        await waitFor(() => expect(casesUpdate).toHaveBeenCalledTimes(1));
        expect(casesUpdate.mock.calls[0][1]).toMatchObject({ Title: 'My case', Description: 'More detail' });
        expect(casesCreate).toHaveBeenCalledTimes(1);
        // The refetch after the save doesn't overwrite the field being typed in.
        expect(result.current.descValue).toBe('More detail');
        // Saved and settled: no further autosave once the case matches the fields.
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(casesUpdate).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});
