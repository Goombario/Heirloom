'use client';

import { useTranslations } from 'next-intl';
import type { TreeMode } from './tree-page-helpers';
import { SegmentedControl } from '@/app/components/ui/SegmentedControl';
import { TreeDisplayControls, type TreeDisplayProps } from './TreeDisplayControls';

export function TreeLeftRail({
    mode, ready, canViewDescendants, canViewAncestors, canFocus, onModeChange, display,
}: {
    mode: TreeMode;
    /** False until the tree data lands. The rail renders first, so a direction it
     *  cannot know about yet stays disabled without claiming it's unavailable. */
    ready: boolean;
    canViewDescendants: boolean;
    canViewAncestors: boolean;
    canFocus: boolean;
    onModeChange: (m: TreeMode) => void;
    display: TreeDisplayProps;
}) {
    const t = useTranslations('treeView');

    return (
        <aside
            className="hidden lg:flex w-[180px] py-3.5 px-3 gap-3.5 border-r border-r-[color:var(--border)]"
            style={{ background: 'var(--card)', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}
        >
            <div>
                <div className="eyebrow mb-2">{t('direction')}</div>
                <SegmentedControl
                    orientation="vertical"
                    aria-label={t('direction')}
                    value={mode}
                    onChange={(v) => onModeChange(v as typeof mode)}
                    options={[
                        { v: 'descendants', l: t('root_view'), sub: t('dir_down'), icon: '⤓', can: canViewDescendants, why: t('no_descendants_tooltip') },
                        { v: 'ancestors', l: t('leaf_view'), sub: t('dir_up'), icon: '⤒', can: canViewAncestors, why: t('no_ancestors_tooltip') },
                        { v: 'focus', l: t('focus_view'), sub: t('dir_both'), icon: '◎', can: canFocus, why: t('no_focus_tooltip') },
                    ].map(({ can, why, ...o }) => ({
                        ...o,
                        // Say why only once the data can actually say so (#751).
                        title: ready && !can ? why : undefined,
                        disabled: !(ready && can),
                    }))}
                />
            </div>

            <TreeDisplayControls {...display} stacked />

            <div className="muted text-[10px] leading-[1.4]">
                <strong style={{ color: 'var(--text-2)' }}>{t('tip_label')}</strong>{t('tip_text')}
            </div>
        </aside>
    );
}
