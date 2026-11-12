'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Badge, fieldClass } from '@/app/components/ui';
import { Search as SearchIcon } from '@/lib/icons';
import type { useTreeSearch } from './useTreeSearch';

type Search = ReturnType<typeof useTreeSearch>;

/** True when a key press belongs to a field or a dialog, so `/` must leave it alone. */
function typingIn(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    return el.closest('[role="dialog"]') != null || el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * The tree's Find field and its dropdown of people. Picking someone moves the tree
 * to them. The v1.1 control bar (#71) shows it with a search icon and the `/`
 * shortcut; the header between md and lg shows it with its "Find person:" label.
 */
export function TreeFindField({ search, ready, selectedRootId, variant }: {
    search: Search;
    ready: boolean;
    selectedRootId: number | null;
    variant: 'bar' | 'header';
}) {
    const t = useTranslations('treeView');
    const inputRef = useRef<HTMLInputElement>(null);
    const {
        searchQuery, setSearchQuery, showDropdown, setShowDropdown, searchRef, dropdownRef,
        filteredPeople, allFilteredPeople, visibleCount, hasMore, handleDropdownScroll, handlePersonSelect,
    } = search;
    const isBar = variant === 'bar';
    // The bar is a dark island, so its list is portalled to <body> to stay a white
    // page popover in both themes; it is placed under the field when it opens.
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const place = () => {
        const r = searchRef.current?.getBoundingClientRect();
        if (r) setPos({ top: r.bottom + 4, left: r.left });
    };

    useEffect(() => {
        if (!isBar) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typingIn(e.target)) return;
            e.preventDefault();
            inputRef.current?.focus();
        };
        // Capture phase, so this runs before the global search's own `/` (#59).
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [isBar]);

    const label = isBar ? t('find_in_tree') : t('find_person');

    const list = (
        <div
            ref={dropdownRef}
            onScroll={handleDropdownScroll}
            className={isBar
                ? 'fixed border border-[color:var(--border)] rounded-[8px] max-h-[288px] overflow-y-auto z-50'
                : 'absolute mt-1 border border-[color:var(--border)] rounded-[8px] max-h-[288px] overflow-y-auto z-50'}
            style={isBar
                ? { top: pos?.top, left: pos?.left, width: 320, background: 'var(--card)', boxShadow: 'var(--shadow-lg)' }
                : { top: '100%', left: 0, right: 0, background: 'var(--card)', boxShadow: 'var(--shadow-lg)' }}
        >
            {filteredPeople.length === 0 ? (
                <div className="muted py-2.5 px-3.5 text-sm">{t('no_people_found')}</div>
            ) : (
                <>
                    {filteredPeople.map((person) => (
                        <button
                            key={person.id}
                            onClick={() => handlePersonSelect(person.id)}
                            // Background lives in classes, not inline style: an inline
                            // `background` beat the `hover:` utility, so these rows had
                            // no hover affordance at all.
                            style={{ width: '100%', color: 'var(--text)' }}
                            className={`py-2 px-3.5 text-left border-none cursor-pointer flex items-center justify-between gap-2 text-sm transition-colors focus-ring-inset ${
                                // No hover on the current root: --color-hover-surface is LIGHTER than
                                // --surface-2 in the light theme, so hovering it would read as less
                                // selected than its neighbours.
                                person.id === selectedRootId
                                    ? 'bg-surface-2'
                                    : 'bg-transparent hover:bg-[color:var(--color-hover-surface)]'
                            }`}
                        >
                            <span>{person.name}</span>
                            <div className="flex gap-1">
                                {person.isIsolated && <Badge tone="neutral" className="text-xs">{t('isolated')}</Badge>}
                                {person.isRoot && !person.isLeaf && <Badge tone="neutral" className="text-xs">{t('root_label')}</Badge>}
                                {person.isLeaf && !person.isRoot && <Badge className="text-xs">{t('leaf_label')}</Badge>}
                            </div>
                        </button>
                    ))}
                    {hasMore && (
                        <div className="muted py-1.5 px-3.5 text-meta text-center border-t border-t-[color:var(--border)]">
                            {t('scroll_for_more', { remaining: allFilteredPeople.length - visibleCount })}
                        </div>
                    )}
                </>
            )}
        </div>
    );

    return (
        <div ref={searchRef} className={isBar ? 'relative w-[260px] shrink-0' : 'relative flex-1 md:flex-initial'} style={{ minWidth: 0 }}>
            <div className="flex items-center gap-1.5">
                {!isBar && <label className="muted hidden lg:inline text-meta" style={{ flexShrink: 0 }}>{t('find_person')}</label>}
                <div className={isBar ? 'relative w-full' : 'contents'}>
                    {isBar && <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />}
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); place(); }}
                        onFocus={() => { setShowDropdown(true); place(); }}
                        onKeyDown={(e) => { if (e.key === 'Escape') setShowDropdown(false); }}
                        placeholder={isBar ? t('find_in_tree') : t('search_placeholder')}
                        aria-label={label}
                        aria-keyshortcuts={isBar ? '/' : undefined}
                        // Disabled until the people list exists, else the dropdown
                        // answers "no people found" for a tree that has people.
                        disabled={!ready}
                        className={fieldClass('sm', isBar
                            ? 'w-full pl-8 disabled:opacity-50 disabled:cursor-not-allowed'
                            : 'w-full md:w-[300px] min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed')}
                    />
                </div>
            </div>
            {ready && showDropdown && (searchQuery || filteredPeople.length > 0) && (isBar
                ? (pos && createPortal(list, document.body))
                : list)}
        </div>
    );
}
