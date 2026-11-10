'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { foldForSearch } from '@/lib/utils/search-fold';
import { Search, X } from '@/lib/icons';
import PersonAvatar from '@/app/components/PersonAvatar';
import { InlineDataError, Lifespan, MobileRow, ScrollArea, cx } from '@/app/components/ui';
import type { SearchResult } from '@/app/components/GlobalSearch';

/** People shown before "Show all N people", so Families stays on screen (#1128). */
const PEOPLE_CAP = 6;

/**
 * Where each query word falls in `text`, as [start, end) ranges of the original string.
 * Both sides are folded like the search itself (accents dropped, lower case), so "vaxjo"
 * marks "Växjö".
 */
function matchRanges(text: string, query: string): [number, number][] {
    const words = foldForSearch(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    let folded = '';
    const origin: number[] = [];
    for (let i = 0; i < text.length;) {
        const ch = String.fromCodePoint(text.codePointAt(i)!);
        const f = foldForSearch(ch);
        for (let k = 0; k < f.length; k++) origin.push(i);
        folded += f;
        i += ch.length;
    }
    origin.push(text.length);
    const ranges: [number, number][] = [];
    for (const word of words) {
        for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + word.length)) {
            ranges.push([origin[at], Math.max(origin[at + word.length], origin[at + word.length - 1] + 1)]);
        }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
    }
    return merged;
}

/**
 * The part of a birthplace to show: the town, as on the people list, unless the query
 * matched a later part ("Minnesota"), which then shows so the row says why it matched.
 */
function placePart(place: string, query: string): string {
    const parts = place.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.find((part) => matchRanges(part, query).length > 0) ?? parts[0] ?? '';
}

function Highlight({ text, query }: { text: string; query: string }) {
    const ranges = matchRanges(text, query);
    if (ranges.length === 0) return <>{text}</>;
    const out: React.ReactNode[] = [];
    let from = 0;
    ranges.forEach(([start, end], i) => {
        if (start > from) out.push(text.slice(from, start));
        out.push(<mark key={i} className="bg-border text-text rounded-[3px] px-px">{text.slice(start, end)}</mark>);
        from = end;
    });
    if (from < text.length) out.push(text.slice(from));
    return <>{out}</>;
}

/**
 * Global search on a phone (#1128): still a full screen, now under the dark band with
 * the round field and a white Cancel. People rows follow the people list (avatar, serif
 * name, amber years, birthplace) with the matched words marked; the first six show, then
 * "Show all N people". Family rows overlap the partners' portraits and give the
 * marriage year in mono; a missing partner is a dashed disc and "Partner not recorded".
 */
export function MobileGlobalSearch({ query, onQuery, onCancel, inputRef, state, results, stale, treeId, treeName, onSelect, onRetry }: {
    query: string;
    onQuery: (value: string) => void;
    onCancel: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    state: 'idle' | 'searching' | 'empty' | 'error' | 'results';
    results: SearchResult[];
    stale: boolean;
    treeId: number | null;
    treeName: string | null;
    onSelect: (result: SearchResult) => void;
    onRetry: () => void;
}) {
    const t = useTranslations('globalSearch');
    const tc = useTranslations('common');
    const tf = useTranslations('families');
    // Reset when the query changes, so a new search starts capped again.
    const [allFor, setAllFor] = useState<string | null>(null);
    const trimmed = query.trim();
    const people = results.filter((r) => r.type === 'person');
    const families = results.filter((r) => r.type === 'family');
    const shownPeople = allFor === trimmed ? people : people.slice(0, PEOPLE_CAP);

    const eyebrow = (id: string, label: string, count: number, first: boolean) => (
        <h2 id={id} className={cx('eyebrow m-0 flex items-baseline justify-between gap-2.5 px-4 pb-1.5', first ? 'pt-[18px]' : 'pt-6')}>
            {label}<span className="font-mono font-normal tracking-normal"><span className="sr-only">, </span>{count}</span>
        </h2>
    );

    return (
        <div className="flex flex-col h-full bg-surface">
            <div className="relative shrink-0 flex items-center gap-2.5 px-3.5 pt-[calc(10px+var(--sat))] pb-2.5">
                {/* The list pages' header band (slate in light mode, warm in dark), as a backdrop
                    only: inside a dark island the light field's text would turn white. */}
                <div aria-hidden="true" className="hero-dark mp-slim-bar absolute inset-0 rounded-none shadow-none p-0" />
                <div className="relative flex-1 min-w-0 z-[1]">
                    <Search className="absolute left-[13px] top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="search"
                        enterKeyHint="search"
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        placeholder={t('phone_placeholder')}
                        aria-label={t('phone_placeholder')}
                        autoComplete="off"
                        className="w-full h-11 rounded-full border border-border bg-surface pl-10 pr-10 text-md text-text placeholder:text-text-muted input-nozoom focus-ring [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && (
                        // A 32px disc in a 44px hit.
                        <button
                            type="button"
                            onClick={() => { onQuery(''); inputRef.current?.focus(); }}
                            aria-label={tc('clear_search')}
                            title={tc('clear_search')}
                            className="absolute right-0 top-0 grid place-items-center w-11 h-11 rounded-full cursor-pointer focus-ring"
                        >
                            <span className="grid place-items-center w-8 h-8 rounded-full bg-surface-2 text-text">
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </span>
                        </button>
                    )}
                </div>
                <button type="button" onClick={onCancel} className="relative shrink-0 min-h-11 px-1 text-md font-semibold text-white cursor-pointer rounded-lg focus-ring">
                    {tc('cancel')}
                </button>
            </div>

            <ScrollArea className="flex-1 min-h-0 pb-[env(safe-area-inset-bottom,0px)]">
                {state === 'idle' && (
                    <p className="m-0 px-[18px] py-[26px] text-center text-sm text-text-muted">
                        {treeName ? t('phone_intro_tree', { tree: treeName }) : t('phone_intro')}
                    </p>
                )}
                {state === 'searching' && <p className="m-0 px-4 py-8 text-center text-sm text-text-muted">{t('searching')}</p>}
                {state === 'empty' && (
                    <div className="grid justify-items-center gap-2 px-[26px] pt-[34px] pb-2.5 text-center">
                        <b className="serif text-lg font-semibold">{t('no_one_called', { query: trimmed })}</b>
                        <p className="m-0 max-w-[30ch] text-sm text-text-muted">{t('no_one_hint')}</p>
                    </div>
                )}
                {state === 'error' && <InlineDataError className="mx-4 my-3" message={t('search_failed')} retryLabel={tc('retry')} onRetry={onRetry} />}
                {state === 'results' && (
                    <div className={cx('transition-opacity', stale && 'opacity-60')} aria-busy={stale || undefined}>
                        {people.length > 0 && (
                            <section aria-labelledby="gs-people">
                                {eyebrow('gs-people', t('group_people'), people.length, true)}
                                {shownPeople.map((r, i) => {
                                    const avatar = r.avatars?.[0];
                                    const place = r.place ? placePart(r.place, trimmed) : '';
                                    const hasYears = !!formatYearOrEmpty(r.lifespan?.birth ?? null) || !!formatYearOrEmpty(r.lifespan?.death ?? null);
                                    return (
                                        <MobileRow
                                            key={r.id}
                                            divided={i > 0}
                                            onClick={() => onSelect(r)}
                                            className="min-h-[60px] py-2.5"
                                            lead={avatar && (
                                                <PersonAvatar as="span" mediaId={avatar.mediaId} treeId={treeId} initials={avatar.initials} sex={avatar.sex}
                                                    size={40} focalX={avatar.focalX} focalY={avatar.focalY} focalRadius={avatar.focalRadius} />
                                            )}
                                            label={(
                                                <span className="block truncate serif text-md">
                                                    {r.title ? <Highlight text={r.title} query={trimmed} /> : <span className="italic text-text-muted">{tc('unknown')}</span>}
                                                </span>
                                            )}
                                            sub={(hasYears || place) ? (
                                                <span className="block truncate">
                                                    {hasYears && <Lifespan birth={r.lifespan?.birth ?? null} death={r.lifespan?.death ?? null} />}
                                                    {hasYears && place && ' · '}
                                                    {place && <Highlight text={place} query={trimmed} />}
                                                </span>
                                            ) : undefined}
                                        />
                                    );
                                })}
                                {shownPeople.length < people.length && (
                                    <MobileRow divided onClick={() => setAllFor(trimmed)}
                                        label={<span className="text-link">{t('show_all_people', { count: people.length })}</span>} />
                                )}
                            </section>
                        )}
                        {families.length > 0 && (
                            <section aria-labelledby="gs-families">
                                {eyebrow('gs-families', t('group_families'), families.length, people.length === 0)}
                                {families.map((r, i) => {
                                    const year = r.date ? formatYearOrEmpty(r.date.value) : '';
                                    const missing = r.avatars?.some((a) => a.placeholder);
                                    return (
                                        <MobileRow
                                            key={r.id}
                                            divided={i > 0}
                                            onClick={() => onSelect(r)}
                                            className="min-h-[60px] py-2.5"
                                            lead={(
                                                <span className="flex shrink-0 [&>*+*]:-ml-2.5">
                                                    {r.avatars?.map((a) => a.placeholder ? (
                                                        <span key={a.key} aria-hidden="true" data-testid="search-avatar-placeholder"
                                                            className="grid place-items-center w-9 h-9 rounded-full border-[1.5px] border-dashed border-text-muted bg-surface text-meta font-semibold text-text-muted">?</span>
                                                    ) : (
                                                        <PersonAvatar key={a.key} as="span" mediaId={a.mediaId} treeId={treeId} initials={a.initials} sex={a.sex}
                                                            size={36} focalX={a.focalX} focalY={a.focalY} focalRadius={a.focalRadius} ringClassName="border-2 border-surface" />
                                                    ))}
                                                </span>
                                            )}
                                            label={(
                                                <span className="block truncate">
                                                    {r.title ? <Highlight text={r.title} query={trimmed} /> : <span className="italic text-text-muted">{t('unknown_family')}</span>}
                                                </span>
                                            )}
                                            sub={year ? <span className="date-mono date-muted">{tf('married_year', { year })}</span>
                                                : missing ? t('partner_not_recorded') : undefined}
                                        />
                                    );
                                })}
                            </section>
                        )}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
