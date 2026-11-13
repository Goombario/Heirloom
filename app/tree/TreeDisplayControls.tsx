'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/app/components/ui/SegmentedControl';
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
}

/**
 * The tree's display settings: orientation, depth, ages and the dev-only bar aids.
 * One component for the desktop Display menu (#71) and the Display sheet below lg, so a
 * setting added later can't go missing at small widths again (#936).
 */
export function TreeDisplayControls({
    orientation, onOrientationChange, orientationDisabled,
    barZoomThreshold, onBarZoomThresholdChange,
    depth, maxDepth, onDepthCommit, showAges, onShowAgesChange, showStatus, onShowStatusChange,
}: TreeDisplayProps) {
    const t = useTranslations('treeView');

    // Live slider position while dragging. The applied depth only changes on
    // release (commit) so a large tree isn't re-laid-out on every tick.
    const [live, setLive] = useState(depth);
    useEffect(() => { setLive(depth); }, [depth]);

    // Only worth showing when there are at least two positions to choose between.
    const showDepth = maxDepth >= 2;
    const atMax = live >= maxDepth;
    const commit = () => { if (live !== depth) onDepthCommit(live); };

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

            <DisplaySwitch label={t('show_ages')} checked={showAges} onChange={onShowAgesChange} />
            <DisplaySwitch label={t('show_living_status')} checked={showStatus} onChange={onShowStatusChange} />

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
function DisplaySwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex w-full items-center gap-3 text-left cursor-pointer rounded-[6px] focus-ring"
        >
            <span className="flex-1 min-w-0 text-sm font-medium text-text">{label}</span>
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
