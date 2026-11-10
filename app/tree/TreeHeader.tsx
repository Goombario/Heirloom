'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Badge, fieldClass, PAGE_COLUMN, SegmentedControl, cx } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { SlidersHorizontal } from '@/lib/icons';
import { TreeDisplayControls, type TreeDisplayProps } from './TreeDisplayControls';
import type { TreeMode, TreePersonInfo } from './tree-page-helpers';
import type { useTreeSearch } from './useTreeSearch';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileTreeFrame } from './MobileTreeFrame';

type Search = ReturnType<typeof useTreeSearch>;

export function TreeHeader({
    mode, ready, canViewDescendants, canViewAncestors, canFocus, onModeChange,
    currentPersonInfo, canExport, onExport, isExporting, selectedRootId, search, display,
}: {
    mode: TreeMode;
    /** False until the tree data lands — the chrome renders first, so its controls
     *  must be disabled rather than clickable-but-inert. */
    ready: boolean;
    canViewDescendants: boolean;
    canViewAncestors: boolean;
    canFocus: boolean;
    onModeChange: (m: TreeMode) => void;
    currentPersonInfo: TreePersonInfo | undefined;
    canExport: boolean;
    onExport: () => void;
    isExporting: boolean;
    selectedRootId: number | null;
    search: Search;
    /** The rail's display settings, offered in a sheet below lg (#936). */
    display: TreeDisplayProps;
}) {
    const t = useTranslations('treeView');
    const [displayOpen, setDisplayOpen] = useState(false);
    const isMobile = useIsMobile();
    const modeOptions = [
        { v: 'descendants', l: t('root_view'), icon: '⤓', can: canViewDescendants, why: t('no_descendants_tooltip') },
        { v: 'ancestors', l: t('leaf_view'), icon: '⤒', can: canViewAncestors, why: t('no_ancestors_tooltip') },
        { v: 'focus', l: t('focus_view'), icon: '◎', can: canFocus, why: t('no_focus_tooltip') },
    ].map(({ can, why, ...o }) => ({
        ...o,
        title: ready && !can ? why : undefined,
        disabled: !(ready && can),
    }));
    const {
        searchQuery, setSearchQuery, showDropdown, setShowDropdown, searchRef, dropdownRef,
        filteredPeople, allFilteredPeople, visibleCount, hasMore, handleDropdownScroll, handlePersonSelect,
    } = search;

    if (isMobile) {
        return (
            <MobileTreeFrame mode={mode} ready={ready} modeOptions={modeOptions.map(({ icon: _icon, ...o }) => o)} onModeChange={onModeChange}
                currentPersonInfo={currentPersonInfo} canExport={canExport} onExport={onExport} isExporting={isExporting}
                selectedRootId={selectedRootId} search={search} display={display} />
        );
    }

    return (
        <div className="border-b border-b-[color:var(--border)]" style={{ background: 'var(--card)', flexShrink: 0 }}>
            <div className={cx(PAGE_COLUMN.workspace, 'py-2.5')}>
                <div className="flex flex-wrap md:flex-nowrap items-center gap-x-3.5 gap-y-2">
                    {/* Below lg the rail's direction switch lives here, with its words: the
                        bare ⤒ ⤓ ◎ glyphs couldn't be told apart (#807). On phones it takes
                        its own row above search and export. Same order as the rail. */}
                    <SegmentedControl
                        className="lg:hidden basis-full md:basis-auto md:w-auto md:shrink-0 md:[&_button]:whitespace-nowrap"
                        fullWidth
                        aria-label={t('direction')}
                        value={mode}
                        onChange={(v) => onModeChange(v as TreeMode)}
                        options={modeOptions}
                    />
                    {/* Title + "rooted at" breadcrumb */}
                    {/* Empty below md (the h1 shows from lg, the breadcrumb from md), so it
                        leaves the flow there rather than hold a gap in the search row. */}
                    <div className="hidden md:flex items-baseline gap-2.5" style={{ minWidth: 0 }}>
                        <h1 className="title-workspace hidden lg:block" style={{ margin: 0, flexShrink: 0 }}>
                            {t('title')}
                        </h1>
                        {currentPersonInfo && (
                            <>
                                <span className="muted hidden md:inline text-meta" style={{ flexShrink: 0 }}>·</span>
                                <div className="hidden md:flex items-center gap-1.5 text-sm" style={{ minWidth: 0 }}>
                                    <span className="muted" style={{ flexShrink: 0 }}>{t('rooted_at')}</span>
                                    <span className="font-medium overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: 'var(--text)' }}>
                                        {currentPersonInfo.name}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="hidden md:block flex-1" />

                    {/* Search Autocomplete */}
                    <div ref={searchRef} className="relative flex-1 md:flex-initial" style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-1.5">
                            <label className="muted hidden lg:inline text-meta" style={{ flexShrink: 0 }}>{t('find_person')}</label>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                                onFocus={() => setShowDropdown(true)}
                                placeholder={t('search_placeholder')}
                                aria-label={t('find_person')}
                                // Disabled until the people list exists, else the dropdown
                                // answers "no people found" for a tree that has people.
                                disabled={!ready}
                                className={fieldClass('sm', 'w-full md:w-[300px] min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed')}
                            />
                        </div>
                        {ready && showDropdown && (searchQuery || filteredPeople.length > 0) && (
                            <div
                                ref={dropdownRef}
                                onScroll={handleDropdownScroll}
                                className="absolute mt-1 border border-[color:var(--border)] rounded-[8px] max-h-[288px] overflow-y-auto z-50"
                                style={{ top: '100%', left: 0, right: 0, background: 'var(--card)', boxShadow: 'var(--shadow-lg)' }}
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
                                                className={`py-2 px-3.5 text-left border-none cursor-pointer flex items-center justify-between gap-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset ${
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
                                                    {person.isIsolated && <Badge tone="neutral" style={{ fontSize: 10 }}>{t('isolated')}</Badge>}
                                                    {person.isRoot && !person.isLeaf && <Badge tone="neutral" style={{ fontSize: 10 }}>{t('root_label')}</Badge>}
                                                    {person.isLeaf && !person.isRoot && <Badge style={{ fontSize: 10 }}>{t('leaf_label')}</Badge>}
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
                        )}
                    </div>

                    {/* Below lg the rail is hidden, so its display settings open in a sheet. */}
                    <Button
                        variant="outline"
                        size="sm"
                        className="lg:hidden shrink-0"
                        onClick={() => setDisplayOpen(true)}
                        aria-haspopup="dialog"
                        title={t('display')}
                    >
                        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                        <span className="hidden md:inline ml-1">{t('display')}</span>
                        <span className="sr-only md:hidden">{t('display')}</span>
                    </Button>
                    <Sheet open={displayOpen} onClose={() => setDisplayOpen(false)} title={t('display_title')} below="lg" autoFocus>
                        <div className="flex flex-col gap-4 px-1 pb-1">
                            <TreeDisplayControls {...display} />
                        </div>
                    </Sheet>

                    {/* Export Button */}
                    {canExport && (
                        <Button
                            variant="outline"
                            onClick={onExport}
                            disabled={isExporting || !ready}
                            title={t('export_jpeg')}
                            size="sm"
                            className="shrink-0"
                        >
                            <span aria-hidden="true">↗</span>
                            <span className="hidden lg:inline ml-1">
                                {isExporting ? t('exporting') : t('export_jpeg')}
                            </span>
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
