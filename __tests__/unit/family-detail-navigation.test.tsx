/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import type { FamilyDetailsResponse, PartnerPerson } from '@/app/families/view/useFamilyDetail';
import { dataCache } from '@/lib/data/cache';
import { familyKey } from '@/app/families/view/familyCache';
import { NotFoundError } from '@/lib/data/errors';

const h = vi.hoisted(() => {
    const person = (id: number, firstName: string) => ({
        Id: id,
        UserId: 42,
        TreeId: 7,
        FirstName: firstName,
        LastName: 'Fiction',
        Nickname: null,
        Sex: null,
        GedcomId: null,
        BirthDate: null,
        BirthPlace: null,
        DeathDate: null,
        DeathPlace: null,
        DeathCause: null,
        IsDeceased: 0,
        UpdatedAt: null,
    }) as unknown as PartnerPerson;

    const family = (id: number, firstName: string): FamilyDetailsResponse => ({
        family: {
            Id: id,
            Partner1Id: 1,
            Partner2Id: 2,
            MarriageDate: '1901',
            MarriagePlace: 'Fictional Bay',
            Type: 'Marriage',
        },
        husband: person(1, firstName),
        wife: person(2, 'Partner'),
        children: [],
        events: [],
    });

    const familyGet = vi.fn();
    const loadFamily = vi.fn();
    const loadPartnerFamilies = vi.fn();
    const loadFamilyCitations = vi.fn();
    const getFamilySummary = vi.fn();
    const peopleGet = vi.fn();
    const citationsListForFamily = vi.fn();
    const placesCoords = vi.fn();
    const translate = (key: string) => key;
    const redirectIfUnauthorized = vi.fn().mockReturnValue(false);
    const reportError = vi.fn();
    let activeTreeId = 7;

    return {
        family,
        familyGet,
        loadFamily,
        loadPartnerFamilies,
        loadFamilyCitations,
        getFamilySummary,
        peopleGet,
        citationsListForFamily,
        placesCoords,
        translate,
        redirectIfUnauthorized,
        reportError,
        get activeTreeId() { return activeTreeId; },
        set activeTreeId(value: number) { activeTreeId = value; },
        client: {
            families: { get: familyGet },
            people: { get: peopleGet },
            citations: { listForFamily: citationsListForFamily },
            places: { coords: placesCoords },
        },
        familyId: '1',
        familyKey: (treeId: number | null, id: string | number) => `families:get:${treeId ?? 'default'}:${id}`,
    };
});

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve(h.client),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({
        activeTreeId: h.activeTreeId,
        activePermission: 'owner',
        currentUserId: 42,
    }),
}));

vi.mock('@/app/families/view/familyCache', () => ({
    familyKey: h.familyKey,
    partnerFamiliesKey: (treeId: number | null, id: string | number) => `families:partner:${treeId ?? 'default'}:${id}`,
    familyCitationsKey: (treeId: number | null, id: string | number) => `families:citations:${treeId ?? 'default'}:${id}`,
    getFamilySummary: h.getFamilySummary,
    loadFamily: h.loadFamily,
    loadPartnerFamilies: h.loadPartnerFamilies,
    loadFamilyCitations: h.loadFamilyCitations,
}));

vi.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: () => h.familyId }),
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-intl', () => ({
    useTranslations: () => h.translate,
}));

// FamilyDetailsClient is rendered only for its loading/error branch below. Keep
// the test focused on that branch rather than pulling in the complete detail UI.
vi.mock('next/link', () => ({
    default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
        <a href={href} {...props}>{children}</a>
    ),
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: h.reportError, redirectIfUnauthorized: h.redirectIfUnauthorized }) }));
vi.mock('@/app/components/SourcesCitedCard', () => ({ default: ({ className }: { className?: string }) => <div data-testid="sources-cited" data-placement={className} /> }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({ OwnerNotesCard: () => <div />, NoteCount: () => null, biographyNote: () => null, visibleNotes: (n: unknown[]) => n }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => <div /> }));
vi.mock('@/app/components/AttachSourceSidebar', () => ({ default: () => <div /> }));
vi.mock('@/app/components/InlineEventEditor', () => ({ default: () => <div /> }));
vi.mock('@/app/components/ConfirmDialog', () => ({ default: () => <div /> }));
vi.mock('@/app/components/ui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/components/ui')>()),
    Button: (props: Record<string, unknown>) => <button {...props} />,
    PageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DetailHero: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DetailRail: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SectionHeader: ({ title, action }: { title: string; action?: ReactNode }) => <div>{title}{action}</div>,
    InlineDataError: ({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) => (
        <div role="alert">{message}<button onClick={onRetry}>{retryLabel}</button></div>
    ),
    DetailSkeleton: () => <div data-testid="family-detail-skeleton" aria-busy="true" />,
}));
vi.mock('@/app/families/view/FamilySummaryView', () => ({ FamilySummaryView: () => <div /> }));
vi.mock('@/app/families/view/sections', () => ({
    FamilyTimeline: () => <div />,
    ChildrenList: () => <div />,
    OtherPartnerships: () => <div />,
}));

import { useFamilyDetail } from '@/app/families/view/useFamilyDetail';
import FamilyDetailsClient from '@/app/families/view/FamilyDetailView';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    dataCache.clear();
    h.familyId = '1';
    h.activeTreeId = 7;
    h.familyGet.mockReset();
    h.loadFamily.mockReset().mockImplementation((id: number, treeId: number | null) => h.familyGet(id, treeId));
    h.loadPartnerFamilies.mockReset().mockResolvedValue({ person: null, spouses: [] });
    h.loadFamilyCitations.mockReset().mockResolvedValue({});
    h.getFamilySummary.mockReset().mockReturnValue(null);
    h.peopleGet.mockReset().mockResolvedValue(null);
    h.citationsListForFamily.mockReset().mockResolvedValue([]);
    h.placesCoords.mockReset().mockResolvedValue({});
    h.redirectIfUnauthorized.mockReset().mockReturnValue(false);
    h.reportError.mockReset();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useFamilyDetail navigation state (#455)', () => {
    it('paints cached Family details immediately on a remount/revisit', async () => {
        const cached = h.family(1, 'Cached');
        dataCache.set(familyKey(7, '1'), cached);
        h.familyGet.mockResolvedValue(cached);

        const first = renderHook(() => useFamilyDetail());
        expect(first.result.current.details?.family.Id).toBe(1);
        expect(first.result.current.details?.husband?.FirstName).toBe('Cached');
        await waitFor(() => expect(h.familyGet).toHaveBeenCalled());

        act(() => first.unmount());
        const revisit = renderHook(() => useFamilyDetail());

        expect(revisit.result.current.details?.family.Id).toBe(1);
        expect(revisit.result.current.details?.husband?.FirstName).toBe('Cached');
    });

    it('progresses from a cold-load skeleton phase to populated details', async () => {
        const pending = deferred<FamilyDetailsResponse>();
        h.familyGet.mockReturnValue(pending.promise);

        const { result } = renderHook(() => useFamilyDetail());

        expect(result.current.familyId).toBe('1');
        expect(result.current.details).toBeNull();
        expect(result.current.phase).toBe('loading');
        expect(h.familyGet).toHaveBeenCalled();

        await waitFor(() => expect(h.familyGet).toHaveBeenCalledWith(1, 7));
        await act(async () => {
            pending.resolve(h.family(1, 'Cold'));
        });

        await waitFor(() => {
            expect(result.current.details?.husband?.FirstName).toBe('Cold');
        });
    });

    it('does not retain Family A details while Family B is loading', async () => {
        const familyB = deferred<FamilyDetailsResponse>();
        h.familyGet.mockImplementation((id: number) => (
            id === 1 ? Promise.resolve(h.family(1, 'Alpha')) : familyB.promise
        ));

        const { result, rerender } = renderHook(() => useFamilyDetail());
        await waitFor(() => expect(result.current.details?.husband?.FirstName).toBe('Alpha'));

        h.familyId = '2';
        rerender();

        expect(result.current.details).toBeNull();
        expect(result.current.details?.husband?.FirstName).not.toBe('Alpha');

        await act(async () => {
            familyB.resolve(h.family(2, 'Beta'));
            await familyB.promise;
        });
        await waitFor(() => expect(result.current.details?.husband?.FirstName).toBe('Beta'));
    });

    it('does not expose a same-id family from the previous tree', async () => {
        h.familyGet.mockResolvedValueOnce(h.family(1, 'Tree Seven'));
        const view = renderHook(() => useFamilyDetail());
        await waitFor(() => expect(view.result.current.details?.husband?.FirstName).toBe('Tree Seven'));

        const treeEight = deferred<FamilyDetailsResponse>();
        h.familyGet.mockReturnValueOnce(treeEight.promise);
        h.activeTreeId = 8;
        view.rerender();

        expect(view.result.current.details).toBeNull();

        await act(async () => { treeEight.resolve(h.family(1, 'Tree Eight')); });
        await waitFor(() => expect(view.result.current.details?.husband?.FirstName).toBe('Tree Eight'));
    });

    it('keeps partner and citation failures independent and retryable', async () => {
        h.familyGet.mockResolvedValue(h.family(1, 'Alpha'));
        h.loadPartnerFamilies.mockImplementation((personId: number) => Promise.resolve(
            personId === 1
                ? { person: null, spouses: [], error: new Error('private partner detail') }
                : { person: null, spouses: [] },
        ));
        h.loadFamilyCitations.mockRejectedValueOnce(new Error('private citation detail'));

        const { result } = renderHook(() => useFamilyDetail());

        await waitFor(() => {
            expect(result.current.partner1Error).toBe('error_generic');
            expect(result.current.citationError).toBe('error_generic');
        });
        expect(result.current.partner2Error).toBeNull();

        h.loadPartnerFamilies.mockResolvedValue({ person: null, spouses: [{ family: { Id: 9 } }] });
        h.loadFamilyCitations.mockResolvedValue({ 'Families:1': [] });
        await act(async () => {
            await result.current.retryPartner1();
            await result.current.retryCitations();
        });

        await waitFor(() => expect(result.current.partner1Error).toBeNull());
        expect(result.current.partner1Families?.spouses).toHaveLength(1);
        expect(result.current.citationError).toBeNull();
    });
});

describe('FamilyDetailsClient failed-load surface (#455)', () => {
    it('renders a translated retryable error instead of a raw message or blank state', async () => {
        h.familyGet.mockRejectedValue(new Error('synthetic family load failed'));

        render(<FamilyDetailsClient />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('error_generic');
        });
        expect(screen.queryByText('synthetic family load failed')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
        expect(screen.getByText('back_to_families')).toBeInTheDocument();
        expect(screen.queryByTestId('family-detail-skeleton')).not.toBeInTheDocument();
    });

    it('renders the shared RecordNotFound, with no Retry, for a missing family (#697)', async () => {
        h.familyGet.mockRejectedValue(new NotFoundError('Family not found'));

        render(<FamilyDetailsClient />);

        await waitFor(() => {
            expect(screen.getByTestId('record-not-found')).toHaveTextContent('not_found_family');
        });
        expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /back_to_families/ })).toHaveAttribute('href', '/families');
        expect(screen.getByRole('link', { name: 'open_audit_log' })).toHaveAttribute('href', '/audit');
    });
});

describe('FamilyDetailsClient Sources cited (#904)', () => {
    it('reserves no skeleton for a card that may resolve to nothing', async () => {
        h.familyGet.mockResolvedValue(h.family(1, 'Ada'));
        const citations = deferred<Record<string, never>>();
        h.loadFamilyCitations.mockReturnValue(citations.promise);

        const { container } = render(<FamilyDetailsClient />);
        await waitFor(() => expect(screen.queryByTestId('family-detail-skeleton')).not.toBeInTheDocument());
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();

        await act(async () => { citations.resolve({}); });
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('closes the page as its own section, the last in the section list (#119)', async () => {
        h.familyGet.mockResolvedValue(h.family(1, 'Ada'));
        h.loadFamilyCitations.mockResolvedValue({});

        render(<FamilyDetailsClient />);
        await screen.findByRole('heading', { level: 1 });
        const sources = document.getElementById('sources');
        expect(sources).not.toBeNull();
        expect(sources).toHaveTextContent('detail_sources_cited');
        // The section list ends with Sources.
        expect([...document.querySelectorAll('.detail-body section[id]')].map((s) => s.id).pop()).toBe('sources');
    });
});
