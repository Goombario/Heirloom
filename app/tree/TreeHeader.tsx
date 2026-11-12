'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, PAGE_COLUMN, SegmentedControl, cx } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { SlidersHorizontal } from '@/lib/icons';
import { TreeDisplayControls, type TreeDisplayProps } from './TreeDisplayControls';
import type { TreeMode, TreePersonInfo } from './tree-page-helpers';
import type { useTreeSearch } from './useTreeSearch';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileTreeFrame } from './MobileTreeFrame';
import { TreeControlBar, type TreeRootFace } from './TreeControlBar';
import { TreeFindField } from './TreeFindField';

type Search = ReturnType<typeof useTreeSearch>;

export function TreeHeader({
    mode, ready, canViewDescendants, canViewAncestors, canFocus, onModeChange,
    currentPersonInfo, rootFace, onBringIntoView, canExport, onExport, isExporting, selectedRootId, search, display,
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
    /** The root's photo for the lg control bar (#71). */
    rootFace: TreeRootFace | null;
    /** Scroll the canvas back to the root without rebuilding the tree (#71). */
    onBringIntoView: () => void;
    canExport: boolean;
    onExport: () => void;
    isExporting: boolean;
    selectedRootId: number | null;
    search: Search;
    /** The display settings: the Display menu at lg, a sheet below it (#936). */
    display: TreeDisplayProps;
}) {
    const t = useTranslations('treeView');
    const [displayOpen, setDisplayOpen] = useState(false);
    const isMobile = useIsMobile();
    const belowLg = useIsMobile('lg');
    const modeOptions = [
        { v: 'descendants', l: t('root_view'), icon: '⤓', can: canViewDescendants, why: t('no_descendants_tooltip') },
        { v: 'ancestors', l: t('leaf_view'), icon: '⤒', can: canViewAncestors, why: t('no_ancestors_tooltip') },
        { v: 'focus', l: t('focus_view'), icon: '◎', can: canFocus, why: t('no_focus_tooltip') },
    ].map(({ can, why, ...o }) => ({
        ...o,
        title: ready && !can ? why : undefined,
        disabled: !(ready && can),
    }));

    if (isMobile) {
        return (
            <MobileTreeFrame mode={mode} ready={ready} modeOptions={modeOptions.map(({ icon: _icon, ...o }) => o)} onModeChange={onModeChange}
                currentPersonInfo={currentPersonInfo} canExport={canExport} onExport={onExport} isExporting={isExporting}
                selectedRootId={selectedRootId} search={search} display={display} />
        );
    }

    // lg and up: the v1.1 control bar, every control in one navy strip (#71).
    if (!belowLg) {
        return (
            <TreeControlBar mode={mode} ready={ready} canViewDescendants={canViewDescendants} canViewAncestors={canViewAncestors}
                canFocus={canFocus} onModeChange={onModeChange} currentPersonInfo={currentPersonInfo} rootFace={rootFace}
                onBringIntoView={onBringIntoView} canExport={canExport} onExport={onExport} isExporting={isExporting}
                selectedRootId={selectedRootId} search={search} display={display} />
        );
    }

    // Between md and lg: the white header, as before #71.
    return (
        <div className="border-b border-b-[color:var(--border)]" style={{ background: 'var(--card)', flexShrink: 0 }}>
            <div className={cx(PAGE_COLUMN.workspace, 'py-2.5')}>
                <div className="flex flex-wrap md:flex-nowrap items-center gap-x-3.5 gap-y-2">
                    {/* Below lg the direction switch lives here, with its words: the bare
                        ⤒ ⤓ ◎ glyphs couldn't be told apart (#807). Same order as the control bar. */}
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
                        {currentPersonInfo && (
                            <>
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

                    <TreeFindField search={search} ready={ready} selectedRootId={selectedRootId} variant="header" />

                    {/* Below lg the display settings open in a sheet. */}
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
