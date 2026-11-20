'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/app/components/ui/SegmentedControl';
import { SelectField } from '@/app/components/ui/Select';
import { TREE_SECOND_NAME_TYPES, type TreeSecondNameType } from '@/app/components/tree/types';
import { cx } from '@/app/components/ui/cx';

/** Mini pedigree glyph flowing downward — the vertical (portrait-card) layout. */
function TreeIconVertical() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5.5" y="1.5" width="5" height="3.5" rx="1" />
            <rect x="1.5" y="11" width="5" height="3.5" rx="1" />
            <rect x="9.5" y="11" width="5" height="3.5" rx="1" />
            <path d="M8 5 V8 M4 11 V8 H12 V11" />
        </svg>
    );
}

/** Mini pedigree glyph flowing rightward — the horizontal (bar-card) layout. */
function TreeIconHorizontal() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.5" y="5.5" width="3.5" height="5" rx="1" />
            <rect x="11" y="1.5" width="3.5" height="5" rx="1" />
            <rect x="11" y="9.5" width="3.5" height="5" rx="1" />
            <path d="M5 8 H8 M8 4 V12 M8 4 H11 M8 12 H11" />
        </svg>
    );
}

export interface TreeDisplayProps {
    /** Card orientation (vertical portrait cards vs horizontal bars). */
    orientation: 'vertical' | 'horizontal';
    onOrientationChange: (o: 'vertical' | 'horizontal') => void;
    /** True in focus view — horizontal isn't available there (Phase 1). */
    orientationDisabled: boolean;
    /** DEBUG (bar review): zoom threshold for the bar's name-only mode. */
    barZoomThreshold: number;
    onBarZoomThresholdChange: (v: number) => void;
    /** Currently-applied generation limit (equals maxDepth when showing all). */
    depth: number;
    /** The tree's natural depth — the slider maximum ("all gens"). */
    maxDepth: number;
    /** Called on slider release with the chosen depth (re-lays out once, not per tick). */
    onDepthCommit: (value: number) => void;
    /** Ages on the cards, beside the status mark (#271, #736). */
    showAges: boolean;
    onShowAgesChange: (v: boolean) => void;
    /** The living-status mark on the cards (#68). Off hides only the mark. */
    showStatus: boolean;
    onShowStatusChange: (v: boolean) => void;
    /** Shape markers on branch edges, so multi-spouse families don't rely on colour alone. */
    colorblind: boolean;
    onColorblindChange: (v: boolean) => void;
    /** The name type shown as a second line on vertical cards, or null for none. */
    secondNameType: TreeSecondNameType | null;
    onSecondNameTypeChange: (v: TreeSecondNameType | null) => void;
}

/** Each "Second name" choice's label: the person page's own name-type words. */
const SECOND_NAME_LABEL = {
    Nickname: 'vtype_nickname',
    Maiden: 'vtype_maiden',
    Married: 'vtype_married',
    Anglicized: 'vtype_anglicized',
    Alias: 'vtype_alias',
    Given: 'vtype_given',
} as const satisfies Record<TreeSecondNameType, string>;

/**
 * The tree's display settings: orientation, depth, ages and the dev-only bar aids.
 * One component for the desktop Display menu (#71) and the Display sheet below lg, so a
 * setting added later can't go missing at small widths again (#936).
 */
export function TreeDisplayControls({
    orientation, onOrientationChange, orientationDisabled,
    barZoomThreshold, onBarZoomThresholdChange,
    depth, maxDepth, onDepthCommit, showAges, onShowAgesChange, showStatus, onShowStatusChange,
    colorblind, onColorblindChange, secondNameType, onSecondNameTypeChange,
}: TreeDisplayProps) {
    const t = useTranslations('treeView');
    const tNames = useTranslations('personDetail');

    // Live slider position while dragging. The applied depth only changes on
    // release (commit) so a large tree isn't re-laid-out on every tick.
    const [live, setLive] = useState(depth);
    useEffect(() => { setLive(depth); }, [depth]);

    // Only worth showing when there are at least two positions to choose between.
    const showDepth = maxDepth >= 2;
    const atMax = live >= maxDepth;
    const commit = () => { if (live !== depth) onDepthCommit(live); };

    // Bars (horizontal) don't draw the second line yet; the choice is kept for vertical.
    const secondNameId = useId();
    const secondNameDisabled = orientation === 'horizontal';
    const secondNameOptions = [
        { value: 'none', label: t('second_name_none') },
        ...TREE_SECOND_NAME_TYPES.map((type) => ({ value: type, label: tNames(SECOND_NAME_LABEL[type]) })),
    ];

    return (
        <>
            <div>
                <div className="eyebrow mb-2">{t('orientation')}</div>
                {/* Stays truthful in focus view: the control is disabled there, but the
                    canvas is still laid out vertically, so the current layout stays marked. */}
                <SegmentedControl
                    fullWidth
                    aria-label={t('orientation')}
                    disabled={orientationDisabled}
                    value={orientation}
                    onChange={(v) => onOrientationChange(v as typeof orientation)}
                    options={[
                        { v: 'vertical', l: t('layout_vertical'), icon: <TreeIconVertical /> },
                        { v: 'horizontal', l: t('layout_horizontal'), icon: <TreeIconHorizontal /> },
                    ]}
                />
                {orientationDisabled && (
                    <div className="muted text-xs mt-1">{t('orientation_focus_na')}</div>
                )}
            </div>

            {showDepth && (
                <div>
                    <div className="row mb-1.5" style={{ justifyContent: 'space-between' }}>
                        <span className="eyebrow">{t('depth')}</span>
                        <span className="tabular-nums text-xs muted">
                            {atMax ? t('all_gens') : t('depth_gens', { count: live })}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={1}
                        max={maxDepth}
                        value={live}
                        aria-label={t('depth')}
                        onChange={(e) => setLive(Number(e.target.value))}
                        onPointerUp={commit}
                        onKeyUp={commit}
                        onBlur={commit}
                        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                    <div className="row text-xs" style={{ justifyContent: 'space-between' }}>
                        <span className="muted">1</span>
                        <span className="muted">{maxDepth}</span>
                    </div>
                </div>
            )}

            <div>
                <label htmlFor={secondNameId} className="eyebrow mb-2 block">{t('second_name')}</label>
                <SelectField
                    id={secondNameId}
                    value={secondNameType ?? 'none'}
                    onChange={(v) => onSecondNameTypeChange(v === 'none' ? null : v as TreeSecondNameType)}
                    options={secondNameOptions}
                    disabled={secondNameDisabled}
                />
                <div className="muted text-xs mt-1">
                    {secondNameDisabled ? t('second_name_vertical_only') : t('second_name_help')}
                </div>
            </div>

            <DisplaySwitch label={t('show_ages')} checked={showAges} onChange={onShowAgesChange} />
            <DisplaySwitch label={t('show_living_status')} checked={showStatus} onChange={onShowStatusChange} />
            <DisplaySwitch label={t('colorblind_mode')} description={t('colorblind_mode_help')} checked={colorblind} onChange={onColorblindChange} />

            {/* DEBUG — horizontal-bar review aid. Dev-only; not shipped. Tunes the
                zoom-out threshold live. */}
            {process.env.NODE_ENV === 'development' && orientation === 'horizontal' && !orientationDisabled && (
                <div className="border-t border-t-[color:var(--border)] border-dashed pt-2.5">
                    <div className="eyebrow mb-2" style={{ color: 'var(--text-muted)' }}>Debug · bar</div>

                    <div className="row mb-1.5" style={{ justifyContent: 'space-between' }}>
                        <span className="eyebrow" style={{ color: 'var(--text-muted)' }}>Zoom cutoff</span>
                        <span className="tabular-nums text-xs muted">{barZoomThreshold.toFixed(2)}</span>
                    </div>
                    <input
                        type="range"
                        min={0.3}
                        max={0.9}
                        step={0.05}
                        value={barZoomThreshold}
                        aria-label="Bar zoom cutoff"
                        onChange={(e) => onBarZoomThresholdChange(Number(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                </div>
            )}
        </>
    );
}

/** One on/off row in the Display controls. */
function DisplaySwitch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
    const labelId = useId();
    const descriptionId = useId();
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            // Named by the label alone; the description is read as a description.
            aria-labelledby={labelId}
            aria-describedby={description ? descriptionId : undefined}
            onClick={() => onChange(!checked)}
            className="flex w-full items-center gap-3 text-left cursor-pointer rounded-[6px] focus-ring"
        >
            <span className="flex-1 min-w-0">
                <span id={labelId} className="block text-sm font-medium text-text">{label}</span>
                {description && <span id={descriptionId} className="block muted text-xs mt-0.5">{description}</span>}
            </span>
            <span
                aria-hidden="true"
                className={cx(
                    'relative shrink-0 w-9 h-[22px] rounded-full transition-colors motion-reduce:transition-none',
                    checked ? 'bg-text' : 'bg-border',
                )}
            >
                <span className={cx(
                    'absolute left-[3px] top-[3px] w-4 h-4 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform motion-reduce:transition-none',
                    checked ? 'translate-x-[14px] bg-card' : 'bg-white',
                )} />
            </span>
        </button>
    );
}
