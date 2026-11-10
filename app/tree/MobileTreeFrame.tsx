'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, ImageIcon, Search, SlidersHorizontal } from '@/lib/icons';
import { GlassButton, MobileListHeader, MobileRow, SegmentedControl } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { TreeDisplayControls, type TreeDisplayProps } from './TreeDisplayControls';
import type { TreeMode, TreePersonInfo } from './tree-page-helpers';
import type { useTreeSearch } from './useTreeSearch';

type Search = ReturnType<typeof useTreeSearch>;

/**
 * The tree page's frame on a phone (#1122); the canvas, cards and person panel are
 * unchanged. One dark row with the tree's own find (it re-roots the tree, so it isn't
 * global search) and Display; the direction switch with "Rooted at …" under it; Export
 * as image is a row in the Display sheet.
 */
export function MobileTreeFrame({
    mode, ready, modeOptions, onModeChange, currentPersonInfo, canExport, onExport, isExporting, selectedRootId, search, display,
}: {
    mode: TreeMode;
    ready: boolean;
    modeOptions: { v: string; l: string; disabled: boolean; title?: string }[];
    onModeChange: (m: TreeMode) => void;
    currentPersonInfo: TreePersonInfo | undefined;
    canExport: boolean;
    onExport: () => void;
    isExporting: boolean;
    selectedRootId: number | null;
    search: Search;
    display: TreeDisplayProps;
}) {
    const t = useTranslations('treeView');
    const tm = useTranslations('mobileTree');
    const [sheet, setSheet] = useState<'find' | 'display' | null>(null);
    const { searchQuery, setSearchQuery, allFilteredPeople, handlePersonSelect } = search;
    const openFind = () => { setSearchQuery(''); setSheet('find'); };
    const rows = allFilteredPeople.slice(0, 100);

    return (
        <>
            <MobileListHeader title={t('title')} trail={
                <>
                    <GlassButton label={tm('find_title')} icon={<Search />} onClick={openFind} disabled={!ready} />
                    <GlassButton label={t('display')} icon={<SlidersHorizontal />} onClick={() => setSheet('display')} aria-haspopup="dialog" />
                </>
            } />
            <div className="md:hidden grid gap-2 px-4 py-2.5 bg-surface border-b border-border shrink-0">
                <SegmentedControl fullWidth aria-label={t('direction')} value={mode} onChange={(v) => onModeChange(v as TreeMode)} options={modeOptions} />
                {currentPersonInfo && (
                    <button type="button" onClick={openFind} disabled={!ready}
                        className="flex items-center gap-1.5 min-h-11 -my-1.5 text-left text-sm text-text-muted cursor-pointer rounded-lg focus-ring disabled:cursor-default">
                        <span className="truncate">{t('rooted_at')} <b className="font-semibold text-text">{currentPersonInfo.name}</b></span>
                        <ChevronRight className="w-[15px] h-[15px] shrink-0" aria-hidden="true" />
                    </button>
                )}
            </div>

            <Sheet open={sheet === 'find'} onClose={() => setSheet(null)} title={tm('find_title')} size="full">
                <div className="-mx-4 -mt-3">
                    <div className="px-4 pt-3 pb-1.5">
                        <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus
                            placeholder={tm('find_placeholder')} aria-label={tm('find_placeholder')} autoComplete="off"
                            className="w-full h-11 rounded-full border border-border bg-surface px-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
                    </div>
                    {rows.length === 0 ? (
                        <p className="m-0 px-4 py-6 text-center text-sm text-text-muted">{t('no_people_found')}</p>
                    ) : (
                        <ul className="m-0 p-0 list-none">
                            {rows.map((p, i) => {
                                const note = p.id === selectedRootId ? tm('current_root')
                                    : p.isIsolated ? tm('no_relatives')
                                    : !p.hasAncestors ? tm('no_ancestors')
                                    : !p.hasDescendants ? tm('no_descendants') : undefined;
                                return (
                                    <li key={p.id}>
                                        <MobileRow divided={i > 0} label={<span className="serif text-md font-semibold">{p.name}</span>} sub={note}
                                            className={p.id === selectedRootId ? 'bg-surface-2' : undefined}
                                            onClick={() => { handlePersonSelect(p.id); setSheet(null); }} />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {allFilteredPeople.length > rows.length && (
                        <p className="m-0 px-4 py-3 text-center text-meta text-text-muted">{tm('keep_typing', { count: allFilteredPeople.length - rows.length })}</p>
                    )}
                </div>
            </Sheet>

            <Sheet open={sheet === 'display'} onClose={() => setSheet(null)} title={t('display_title')}>
                <div className="flex flex-col gap-4 pb-1">
                    <TreeDisplayControls {...display} />
                </div>
                {canExport && (
                    <div className="-mx-4 mt-4 border-t border-border">
                        <MobileRow icon={<ImageIcon className="w-[18px] h-[18px]" aria-hidden="true" />} label={isExporting ? t('exporting') : tm('export_image')}
                            sub={tm('export_hint')} disabled={isExporting || !ready} onClick={() => { setSheet(null); onExport(); }} />
                    </div>
                )}
            </Sheet>
        </>
    );
}
