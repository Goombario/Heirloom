'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, SegmentedControl, cx } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { useTree } from '@/app/contexts/TreeContext';
import { ArrowDownFromLine, ArrowUpToLine, ChevronDown, Crosshair, Download, Target } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { TreeDisplayControls, type TreeDisplayProps } from './TreeDisplayControls';
import { TreeFindField } from './TreeFindField';
import type { TreeMode, TreePersonInfo } from './tree-page-helpers';
import type { useTreeSearch } from './useTreeSearch';

/** What the bar shows of the person the tree is built around. */
export interface TreeRootFace {
    photoMediaId: number | null;
    focalX?: number;
    focalY?: number;
    focalRadius?: number | null;
    sex?: string | null;
}

/**
 * The desktop tree's one control bar (#71), lg and up: an ink navy strip under the
 * top nav that holds every control, so there is no left rail. Find and Export on
 * the left, then the person the tree is built around with Bring into view, then the
 * direction switch and the Display menu on the right. No page title: the tree
 * switcher in the top nav already names the tree.
 */
export function TreeControlBar({
    mode, ready, canViewDescendants, canViewAncestors, canFocus, onModeChange,
    currentPersonInfo, rootFace, onBringIntoView, canExport, onExport, isExporting, selectedRootId, search, display,
}: {
    mode: TreeMode;
    ready: boolean;
    canViewDescendants: boolean;
    canViewAncestors: boolean;
    canFocus: boolean;
    onModeChange: (m: TreeMode) => void;
    currentPersonInfo: TreePersonInfo | undefined;
    rootFace: TreeRootFace | null;
    onBringIntoView: () => void;
    canExport: boolean;
    onExport: () => void;
    isExporting: boolean;
    selectedRootId: number | null;
    search: ReturnType<typeof useTreeSearch>;
    display: TreeDisplayProps;
}) {
    const t = useTranslations('treeView');
    const tn = useTranslations('nav');
    const { activeTreeId } = useTree();
    const iconClass = 'w-4 h-4';
    const modeOptions = [
        { v: 'descendants', l: t('root_view'), icon: <ArrowDownFromLine className={iconClass} />, can: canViewDescendants, why: t('no_descendants_tooltip') },
        { v: 'ancestors', l: t('leaf_view'), icon: <ArrowUpToLine className={iconClass} />, can: canViewAncestors, why: t('no_ancestors_tooltip') },
        { v: 'focus', l: t('focus_view'), icon: <Target className={iconClass} />, can: canFocus, why: t('no_focus_tooltip') },
    ].map(({ can, why, ...o }) => ({
        ...o,
        // Say why only once the data can actually say so (#751).
        title: ready && !can ? why : undefined,
        disabled: !(ready && can),
    }));
    const exportLabel = isExporting ? t('exporting') : t('export_jpeg');

    return (
        <div className="dark-island tree-control-bar shrink-0 px-4 py-2 bg-[color:var(--color-hero-bg)]">
            <h1 className="sr-only">{tn('tree')}</h1>
            <div className="flex items-center gap-2.5 min-w-0">
                <TreeFindField search={search} ready={ready} selectedRootId={selectedRootId} variant="bar" />
                {canExport && (
                    <button
                        type="button"
                        onClick={onExport}
                        disabled={isExporting || !ready}
                        aria-label={exportLabel}
                        title={exportLabel}
                        className="grid place-items-center w-8 h-8 shrink-0 rounded-btn border border-[color:var(--color-control-border)] text-text cursor-pointer hover:bg-surface-2 focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download className={iconClass} aria-hidden="true" />
                    </button>
                )}

                <span className="h-6 w-px shrink-0 bg-[color:var(--color-border)] mx-1" aria-hidden="true" />

                {currentPersonInfo && (
                    <div className="flex items-center gap-2 min-w-0">
                        <PersonAvatar
                            as="span"
                            size={30}
                            mediaId={rootFace?.photoMediaId ?? null}
                            focalX={rootFace?.focalX}
                            focalY={rootFace?.focalY}
                            focalRadius={rootFace?.focalRadius ?? undefined}
                            sex={rootFace?.sex ?? null}
                            initials={initialsFromName(currentPersonInfo.name)}
                            name={currentPersonInfo.name}
                            treeId={activeTreeId}
                            className="shrink-0"
                        />
                        <span className="text-sm font-medium text-text truncate">{currentPersonInfo.name}</span>
                        {/* The label never carries the name, so the button keeps its size. */}
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 rounded-full! whitespace-nowrap"
                            icon={<Crosshair className="w-3.5 h-3.5" aria-hidden="true" />}
                            onClick={onBringIntoView}
                            disabled={!ready}
                            title={t('bring_into_view_tip', { name: currentPersonInfo.name })}
                        >
                            {t('bring_into_view')}
                        </Button>
                    </div>
                )}

                <div className="flex-1" />

                <SegmentedControl
                    className="shrink-0 [&_button]:whitespace-nowrap"
                    aria-label={t('direction')}
                    value={mode}
                    onChange={(v) => onModeChange(v as TreeMode)}
                    options={modeOptions}
                />
                <DisplayMenu display={display} />
            </div>
        </div>
    );
}

/** Display ⌄: Layout, Depth and Show ages in a white popover anchored at its right edge. */
function DisplayMenu({ display }: { display: TreeDisplayProps }) {
    const t = useTranslations('treeView');
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            trigger.current?.focus();
        };
        const onResize = () => setOpen(false);
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onResize);
        };
    }, [open]);

    return (
        <>
            <button
                ref={trigger}
                type="button"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                aria-haspopup="dialog"
                onClick={() => {
                    if (open) { setOpen(false); return; }
                    const r = trigger.current?.getBoundingClientRect();
                    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
                    setOpen(true);
                }}
                className={cx(
                    'inline-flex items-center gap-1.5 min-h-8 px-3 shrink-0 rounded-btn border border-[color:var(--color-control-border)] text-meta font-medium text-text cursor-pointer hover:bg-surface-2 focus-ring',
                    open && 'bg-surface-2',
                )}
            >
                {t('display')}
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            {open && pos && createPortal(
                <div
                    ref={panel}
                    id={panelId}
                    role="dialog"
                    aria-label={t('display_title')}
                    className="fixed z-50 w-72 flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-lg)] text-text"
                    style={{ top: pos.top, right: pos.right }}
                >
                    <TreeDisplayControls {...display} />
                </div>,
                document.body,
            )}
        </>
    );
}
