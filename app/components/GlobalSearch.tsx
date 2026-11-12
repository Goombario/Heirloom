'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useTree } from '@/app/contexts/TreeContext';
import { displayFullName } from '@/lib/utils/names';
import { getDataClient } from '@/lib/data';
import { prefetchPerson } from '@/app/people/view/personCache';
import { prefetchFamily } from '@/app/families/view/familyCache';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { useFocusTrap } from '@/app/hooks/useFocusTrap';
import { InlineDataError, Lifespan, ScrollArea } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { getInitials, initialsFromName } from '@/lib/utils/initials';
import { Search } from '@/lib/icons';
import { personKin, type PersonKin } from '@/lib/utils/person-kin';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileGlobalSearch } from '@/app/components/search/MobileGlobalSearch';

const LISTBOX_ID = 'global-search-listbox';
const optionId = (idx: number) => `global-search-option-${idx}`;
/** Diameter of the result-row avatar disc, in px. */
const RESULT_AVATAR_SIZE = 32;

const RESULT_GROUPS = [
    { type: 'person', labelKey: 'group_people' },
    { type: 'family', labelKey: 'group_families' },
] as const;

/** Fixed width of the avatar slot: two discs overlapped by 12px (`-ml-3`), so a
 *  one-disc person row and a two-disc family row start their text in the same
 *  place. */
const AVATAR_SLOT_WIDTH = RESULT_AVATAR_SIZE * 2 - 12;

export interface SearchResult {
    type: 'person' | 'family';
    id: number;
    /** Empty when the record has no name; the row renders the translated fallback. */
    title: string;
    /** A person's birth and death, rendered as a compact `Lifespan` (#766). */
    lifespan?: { birth: string | null; death: string | null };
    /** Who a person is related to, so same-named people differ (#768, DV-4). */
    kin?: PersonKin;
    /** A person's birthplace, which the phone search also matches (#1128). */
    place?: string;
    /** A family's marriage date, stored raw and formatted at render. */
    date?: { kind: 'married'; value: string };
    /** One disc per person the row stands for: one for a person, always two
     *  (the partners, either possibly a blank placeholder) for a family. */
    avatars?: ResultAvatar[];
}

interface ResultAvatar {
    key: string;
    mediaId?: number;
    initials: string;
    sex: string | null;
    focalX?: number;
    focalY?: number;
    focalRadius?: number | null;
    /** The empty half of a one-parent family: the neutral `?` disc that holds
     *  the missing partner's place. */
    placeholder?: boolean;
}

/** A family partner's disc. When that side of the family is empty the disc is
 *  still rendered as the `?` disc: a family always shows the two-disc pair, so a
 *  one-parent family stays visually a family rather than reading as a person
 *  row (matching the families list, which also keeps both partner slots). The
 *  query returns each partner's name already combined, so initials come from
 *  the single-string helper. */
function spouseAvatar(
    key: string,
    name: string | null,
    sex: string | null,
    photo: { mediaId: number | null; focalX: number | null; focalY: number | null; focalRadius: number | null },
): ResultAvatar {
    if (name == null) return { key, initials: initialsFromName(null), sex: null, placeholder: true };
    return {
        key,
        mediaId: photo.mediaId ?? undefined,
        initials: initialsFromName(name),
        sex,
        focalX: photo.focalX ?? undefined,
        focalY: photo.focalY ?? undefined,
        focalRadius: photo.focalRadius,
    };
}

export default function GlobalSearch() {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    // The query the current `results` actually answer. Without this, the gap between
    // a keystroke and the debounce firing looks identical to "a search came back
    // empty", which is what made "No results found" flash while the user was typing.
    const [searchedQuery, setSearchedQuery] = useState('');
    const [searchFailed, setSearchFailed] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    // The tree whose query produced the currently stored results. A result from
    // another tree must not remain visible or actionable while the new search is
    // being debounced or fetched.
    const [resultsTreeKey, setResultsTreeKey] = useState<string | null>(null);
    /** Monotonic id of the newest dispatched search; older responses are dropped. */
    const requestIdRef = useRef(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const { activeTreeId, activeTreeName } = useTree();
    const treeScopeKey = activeTreeId == null ? 'default' : String(activeTreeId);
    const t = useTranslations('globalSearch');
    const tCommon = useTranslations('common');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const { redirectIfUnauthorized } = useErrorToast();
    const { guardNavigation } = useUnsavedChangesGuard(false);
    const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
    // The phone search also matches birthplaces and lists every match up to 100 people
    // behind "Show all" (#1128); the desktop modal keeps its five and three.
    const isMobile = useIsMobile();

    // Open modal with Ctrl+K or /
    useEffect(() => {
        function tagOf(target: EventTarget | null): string {
            return target instanceof HTMLElement ? target.tagName : '';
        }
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(true);
            }
            // A list page's own search (ListToolbar, the tree's Find) takes `/` first, in
            // the capture phase, and marks it handled.
            if (e.key === '/' && !e.defaultPrevented && !['INPUT', 'TEXTAREA'].includes(tagOf(e.target))) {
                e.preventDefault();
                setIsOpen(true);
            }
            // Alt+N: Navigate to new person form (client-side to avoid a full-reload black flash)
            if (e.altKey && e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tagOf(e.target))) {
                e.preventDefault();
                if (guardNavigation()) router.push('/people/new');
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        }
        // The navbar search button asks us to open via this custom event rather than
        // dispatching a synthetic keydown (which broke React Flow's keydown handler
        // on the tree page — "target?.hasAttribute is not a function").
        function handleOpenRequest() {
            setIsOpen(true);
        }
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('open-global-search', handleOpenRequest);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('open-global-search', handleOpenRequest);
        };
    }, [router, guardNavigation]);

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            setQuery('');
            setResults([]);
            setSearchedQuery('');
            setSearchFailed(false);
            setSelectedIndex(0);
            setResultsTreeKey(null);
            requestIdRef.current++;
        }
    }, [isOpen]);

    // Invalidate the displayed result scope synchronously on a tree switch. The
    // derived currentResults guard below also covers the render before this
    // effect runs, while this clears the old rows from state for the next search.
    useEffect(() => {
        requestIdRef.current++;
        setResults([]);
        setSearchedQuery('');
        setSearchFailed(false);
        setSelectedIndex(0);
        setResultsTreeKey(null);
    }, [activeTreeId]);

    // Debounced search
    useEffect(() => {
        if (!query.trim()) {
            // Bump the id so a request dispatched for the old query cannot land
            // after the input was cleared.
            requestIdRef.current++;
            setResults([]);
            setSearchedQuery('');
            setSearchFailed(false);
            setResultsTreeKey(null);
            setLoading(false);
            return;
        }

        // Invalidate an in-flight request immediately when the query or tree
        // changes. The debounce timer must not be the point at which an old
        // tree/query is superseded.
        const requestId = ++requestIdRef.current;
        const timer = setTimeout(async () => {
            // Requests can overlap (the debounce only cancels the timer, not an
            // in-flight call), and they do not necessarily resolve in order. Only
            // the newest one is allowed to write state — otherwise a slow earlier
            // response lands last and leaves the panel showing an older query's
            // results with no request pending to correct them.
            const searched = query.trim();
            const superseded = () => requestIdRef.current !== requestId;
            setLoading(true);
            setSearchFailed(false);
            try {
                // Both sides are server-side searches. Families used to be fetched
                // with `families.list()` — every family in the tree — and filtered
                // by name in JS on each debounce tick, which scaled with the tree
                // rather than with the query and capped results at whatever the
                // unbounded list returned.
                const [peopleList, familyList] = await Promise.all([
                    getDataClient().then(client => isMobile
                        ? client.people.search(query, activeTreeId, 100, { places: true })
                        : client.people.search(query, activeTreeId)),
                    getDataClient().then(client => client.families.search(query, activeTreeId)),
                ]);

                const searchResults: SearchResult[] = [];

                (isMobile ? peopleList : peopleList.slice(0, 5)).forEach((p) => {
                    searchResults.push({
                        type: 'person',
                        id: p.Id,
                        title: displayFullName(p),
                        lifespan: { birth: p.BirthDate ?? null, death: p.DeathDate ?? null },
                        kin: personKin(p),
                        place: p.BirthPlace ?? undefined,
                        // Free: `searchPeople` already selects the primary photo and
                        // its focal point via `primaryPhotoJoin`, so showing a face
                        // costs no extra query or round-trip — only the thumbnail.
                        avatars: [{
                            key: `person-${p.Id}`,
                            mediaId: p.PrimaryMediaId,
                            initials: getInitials(p.FirstName, p.LastName),
                            sex: p.Sex,
                            focalX: p.FocalX,
                            focalY: p.FocalY,
                            focalRadius: p.FocalRadius,
                        }],
                    });
                });

                (isMobile ? familyList : familyList.slice(0, 3)).forEach((f) => {
                    searchResults.push({
                        type: 'family',
                        id: f.Id,
                        title: [f.husbandName, f.wifeName].filter(Boolean).join(' & '),
                        date: f.MarriageDate ? { kind: 'married', value: f.MarriageDate } : undefined,
                        // A family is recognised by its partners' faces, so the row
                        // shows both rather than a group glyph — including the blank
                        // placeholder for an unknown partner, so the two-disc pair
                        // itself reads as "family". Names arrive combined from the
                        // query, hence initialsFromName.
                        avatars: [
                            spouseAvatar(`family-${f.Id}-h`, f.husbandName, f.partner1Sex, {
                                mediaId: f.husbandMediaId,
                                focalX: f.husbandFocalX,
                                focalY: f.husbandFocalY,
                                focalRadius: f.husbandFocalRadius,
                            }),
                            spouseAvatar(`family-${f.Id}-w`, f.wifeName, f.partner2Sex, {
                                mediaId: f.wifeMediaId,
                                focalX: f.wifeFocalX,
                                focalY: f.wifeFocalY,
                                focalRadius: f.wifeFocalRadius,
                            }),
                        ],
                    });
                });

                if (superseded()) return;
                setResults(searchResults);
                setSearchedQuery(searched);
                setResultsTreeKey(treeScopeKey);
                setSelectedIndex(0);
            } catch (err) {
                if (superseded()) return;
                if (redirectIfUnauthorized(err)) return;
                console.error('Search failed:', err);
                // Record the attempt so the view leaves 'searching': a failure that
                // never lands is indistinguishable from a request still in flight,
                // which parks the panel on "Searching…" with nothing pending.
                setSearchedQuery(searched);
                setResultsTreeKey(treeScopeKey);
                setSearchFailed(true);
            } finally {
                if (!superseded()) setLoading(false);
            }
        }, 200);

        return () => clearTimeout(timer);
    }, [query, activeTreeId, retryNonce, redirectIfUnauthorized, treeScopeKey, isMobile]);

    const handleSelect = useCallback((result: SearchResult) => {
        if (resultsTreeKey !== treeScopeKey) return;
        if (!guardNavigation()) return;
        setIsOpen(false);
        if (result.type === 'person') {
            router.push(`/people/view?id=${result.id}`);
        } else {
            router.push(`/families/view?id=${result.id}`);
        }
    }, [router, resultsTreeKey, treeScopeKey, guardNavigation]);

    // Warm the target's detail caches on hover/focus so pressing Enter or clicking
    // paints instantly (deduped + skipped when already cached).
    const prewarm = useCallback((result: SearchResult) => {
        if (result.type === 'person') prefetchPerson(result.id, activeTreeId);
        else prefetchFamily(result.id, activeTreeId);
    }, [activeTreeId]);

    const treeMatches = resultsTreeKey === treeScopeKey;
    const currentResults = treeMatches ? results : [];

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, currentResults.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && currentResults[selectedIndex]) {
            handleSelect(currentResults[selectedIndex]);
        }
    };

    if (!isOpen) return null;

    const trimmedQuery = query.trim();
    // Results that answer an older query are stale: shown, but dimmed, so the list
    // keeps its height while a new request is in flight instead of collapsing.
    const stale = loading || !treeMatches || searchedQuery !== trimmedQuery;
    const searchState: 'idle' | 'searching' | 'empty' | 'error' | 'results' =
        !trimmedQuery ? 'idle'
            : searchFailed && treeMatches && searchedQuery === trimmedQuery ? 'error'
            : currentResults.length > 0 ? 'results'
                    : stale ? 'searching'
                        : 'empty';

    if (isMobile) {
        return (
            <div ref={trapRef} role="dialog" aria-modal="true" aria-label={t('phone_placeholder')} className="fixed inset-0 z-50">
                <MobileGlobalSearch
                    query={query}
                    onQuery={setQuery}
                    onCancel={() => setIsOpen(false)}
                    inputRef={inputRef}
                    state={searchState}
                    results={currentResults}
                    stale={stale}
                    treeId={activeTreeId}
                    treeName={activeTreeName}
                    onSelect={handleSelect}
                    onRetry={() => {
                        setSearchFailed(false);
                        setLoading(true);
                        setRetryNonce(n => n + 1);
                    }}
                />
            </div>
        );
    }

    return (
        // Below md it is a full-screen page with Cancel (the mobile list kit's global
        // search, #1058); above, the centred modal.
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] max-md:pt-0">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in"
                onClick={() => setIsOpen(false)}
            />

            {/* Modal */}
            {/* eslint-disable-next-line no-restricted-syntax -- intentional floating search-modal surface (custom shadow-2xl/animation), not a content Card */}
            <div className="relative w-full max-w-full sm:max-w-lg mx-4 bg-card rounded-xl shadow-2xl overflow-hidden animate-fade-in-up outline-none max-md:mx-0 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:flex max-md:flex-col max-md:pt-[var(--sat)]" ref={trapRef} role="dialog" aria-modal="true" aria-label={t('placeholder')}>
                {/* Input */}
                <div className="flex items-center border-b border-border px-4">
                    <Search className="w-[18px] h-[18px] text-text-muted mr-3 shrink-0" aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        // Keyed off searchState, not results.length: the listbox renders
                        // only in the 'results' state, and clearing the input commits one
                        // render where results are still populated — which used to claim
                        // an expanded listbox and an activedescendant id that no longer
                        // existed in the DOM.
                        aria-expanded={searchState === 'results'}
                        aria-controls={LISTBOX_ID}
                        aria-activedescendant={searchState === 'results' ? optionId(selectedIndex) : undefined}
                        aria-autocomplete="list"
                        aria-label={t('placeholder')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('placeholder')}
                        className="flex-1 min-w-0 py-4 text-lg bg-transparent outline-none text-text placeholder-text-muted"
                    />
                    <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="md:hidden shrink-0 min-h-11 -mr-1 px-1 text-md font-semibold text-link cursor-pointer rounded-lg focus-ring"
                    >
                        {tCommon('cancel')}
                    </button>
                    <kbd className="hidden sm:inline-block px-2 py-1 text-xs font-mono bg-card-alt text-text-secondary rounded">
                        ESC
                    </kbd>
                </div>

                {/* Results. The container is always mounted and the list stays rendered
                    while a new request is in flight (dimmed), so switching trees or
                    typing another character does not collapse it to a one-line
                    "Searching…" block and spring back. */}
                {/* Tall enough for every result (5 people + 3 families and their group
                    headers) on a desktop, so the list never ends on half a row (DV-4);
                    it scrolls only on a short viewport. */}
                <ScrollArea className="max-h-[70vh] max-md:max-h-none max-md:flex-1 max-md:min-h-0">
                    {searchState === 'idle' && (
                        <div className="px-4 py-6 text-center text-text-secondary">
                            <div className="mb-2">{t('start_typing')}</div>
                            <div className="hidden sm:block text-xs">
                                <kbd className="px-1.5 py-0.5 bg-card-alt rounded mr-1">↑</kbd>
                                <kbd className="px-1.5 py-0.5 bg-card-alt rounded mr-2">↓</kbd>
                                {t('keyboard_hint')}
                                <kbd className="px-1.5 py-0.5 bg-card-alt rounded mx-1">Enter</kbd>
                                {t('keyboard_select')}
                            </div>
                        </div>
                    )}
                    {searchState === 'searching' && (
                        <div className="px-4 py-8 text-center text-text-secondary">{t('searching')}</div>
                    )}
                    {searchState === 'empty' && (
                        <div className="px-4 py-8 text-center text-text-secondary">{t('no_results')}</div>
                    )}
                    {searchState === 'error' && (
                        <InlineDataError
                            className="mx-4 my-3"
                            message={t('search_failed')}
                            retryLabel={tCommon('retry')}
                            onRetry={() => {
                                setSearchFailed(false);
                                setLoading(true);
                                setRetryNonce(n => n + 1);
                            }}
                        />
                    )}
                    {searchState === 'results' && (
                        <div
                            className={`py-2 transition-opacity ${stale ? 'opacity-60' : ''}`}
                            aria-busy={stale || undefined}
                            role="listbox"
                            id={LISTBOX_ID}
                            aria-label={t('placeholder')}
                        >
                            {/* Grouped under a header per type rather than a "PERSON" label
                                on every row (DV-3). The index stays flat for the keyboard. */}
                            {RESULT_GROUPS.map(({ type, labelKey }) => {
                                const rows = currentResults.map((result, idx) => ({ result, idx })).filter(({ result }) => result.type === type);
                                if (rows.length === 0) return null;
                                const headerId = `${LISTBOX_ID}-${type}`;
                                return (
                            <div key={type} role="group" aria-labelledby={headerId}>
                            <div id={headerId} className="px-4 pt-2 pb-1 text-xs font-semibold text-text-muted">{t(labelKey)}</div>
                            {rows.map(({ result, idx }) => (
                                <button
                                    key={`${result.type}-${result.id}`}
                                    id={optionId(idx)}
                                    role="option"
                                    aria-selected={idx === selectedIndex}
                                    onClick={() => handleSelect(result)}
                                    onMouseEnter={() => prewarm(result)}
                                    onFocus={() => prewarm(result)}
                                    data-selected={idx === selectedIndex}
                                    className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${idx === selectedIndex
                                        // The documented neutral selected row, not the copper
                                        // main-action fill (CL-1, #749).
                                        ? 'bg-surface-2'
                                        : 'hover:bg-card-alt'
                                        }`}
                                >
                                    {/* Decorative: the row's name and type label carry the
                                        accessible content, so the discs pass no `name`
                                        (an `alt` here would say the name twice). A face
                                        is recognised faster than a name is read (#453);
                                        people with no photo — and photos still loading —
                                        fall back to the initials disc, which is already
                                        more informative than the generic icon this
                                        replaced. A family shows both partners, so the
                                        slot is a fixed width either way and every row's
                                        text starts on the same line. */}
                                    <span
                                        className="shrink-0 flex items-center justify-center"
                                        style={{ width: AVATAR_SLOT_WIDTH }}
                                    >
                                        {result.avatars?.map((avatar, avatarIdx) => {
                                            const disc = (
                                                <PersonAvatar
                                                    key={avatar.key}
                                                    as="span"
                                                    mediaId={avatar.mediaId}
                                                    treeId={activeTreeId}
                                                    initials={avatar.initials}
                                                    sex={avatar.sex}
                                                    size={RESULT_AVATAR_SIZE}
                                                    focalX={avatar.focalX}
                                                    focalY={avatar.focalY}
                                                    focalRadius={avatar.focalRadius}
                                                    // The second partner overlaps the first and
                                                    // carries a card-coloured ring so the two
                                                    // discs stay separable rather than merging
                                                    // into one blob (same rule as AvatarStack).
                                                    className={avatarIdx > 0 ? '-ml-3' : undefined}
                                                    ringClassName={avatarIdx > 0 ? 'border-2 border-card' : ''}
                                                />
                                            );
                                            // The empty half of a one-parent family: the same
                                            // neutral `?` disc the families list keeps in its
                                            // partner slot (`initialsFromName(null)` → `?`, so
                                            // the slot reads as an unknown partner rather than
                                            // a thumbnail that failed to load). It names
                                            // nobody, so it stays out of the a11y tree.
                                            return avatar.placeholder ? (
                                                <span
                                                    key={avatar.key}
                                                    className="inline-flex"
                                                    aria-hidden="true"
                                                    data-testid="search-avatar-placeholder"
                                                >
                                                    {disc}
                                                </span>
                                            ) : disc;
                                        })}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate text-text">
                                            {result.title || (result.type === 'person' ? tCommon('unknown') : t('unknown_family'))}
                                        </div>
                                        {result.type === 'person' && (result.lifespan || result.kin) && (
                                            <div className="text-sm text-text-secondary truncate">
                                                {result.lifespan && <Lifespan birth={result.lifespan.birth} death={result.lifespan.death} />}
                                                {result.lifespan && result.kin && (result.lifespan.birth || result.lifespan.death) && ' · '}
                                                {result.kin && tCommon(result.kin.kind === 'child' ? 'child_of' : 'partner_of', { names: result.kin.names })}
                                            </div>
                                        )}
                                        {result.date && (
                                            <div className="text-sm text-text-secondary">
                                                {t.rich('married_date', {
                                                    date: formatDateForDisplay(result.date.value, language, dateWords),
                                                    // A search result's date only tells families apart, so it
                                                    // is muted, not evidence amber (#935).
                                                    d: (chunks) => <span className="date-mono date-muted">{chunks}</span>,
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </button>
                            ))}
                            </div>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
}
