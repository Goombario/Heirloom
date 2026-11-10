'use client';
import React from 'react';

/**
 * The family hero's inner layout — title/subtitle row + the partnership ribbon
 * (two partner cards flanking the ⚭ glyph) — shared by the full FamilyDetailView
 * and the FamilySummaryView loading paint so the two can't drift. Rendered inside
 * a <DetailHero> island; the partner cards differ per surface (live PartnerCard vs
 * SummaryPartnerCard) and are passed in as `left`/`right`.
 *
 * While `editing`, the title stays in place above the editor (#759) so it's clear
 * which partnership is being edited; only the Edit action and the ribbon give way.
 */
export function FamilyHeroContent({
    title, subtitle, flag, action, left, right, centerLabel, centerNote, editor, editing = false,
}: {
    title: string;
    subtitle: string;
    /** Beside the subtitle: the family's "dates to check" flag (#833). */
    flag?: React.ReactNode;
    /** Top-right hero action (the Edit button). Not rendered while `editing`. */
    action?: React.ReactNode;
    left: React.ReactNode;
    right: React.ReactNode;
    centerLabel?: string;
    /**
     * How the partnership ended, under the date range ("ended by divorce"). Only
     * set for an explicit end-event — a bare range is the death-derived case.
     * Text, never colour: the reason must not be encoded by hue alone.
     */
    centerNote?: string;
    editor?: React.ReactNode;
    editing?: boolean;
}) {
    return (
        <>
            <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                <div className="min-w-0">
                    <h1 className="title-record" style={{ margin: 0 }}>{title}</h1>
                    {(subtitle || flag) && (
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-0.5">
                            {subtitle && <p className="muted text-base m-0">{subtitle}</p>}
                            {flag}
                        </div>
                    )}
                </div>
                {action && !editing && <div className="shrink-0 self-start">{action}</div>}
            </div>
            {editor ?? (
                <div className="partnership-ribbon" style={{ marginBottom: 0 }}>
                    {left}
                    <div className="partnership-center flex flex-col items-center justify-center select-none">
                        <div className="text-2xl leading-[1]" style={{ color: 'var(--color-date)', fontFamily: 'var(--font-fraunces), Georgia, serif' }}>⚭</div>
                        {centerLabel && (
                            <div className="date-mono text-sm mt-0.5" style={{ color: 'var(--color-date)' }}>{centerLabel}</div>
                        )}
                        {centerNote && (
                            <div className="muted text-xs mt-0.5 text-center">{centerNote}</div>
                        )}
                    </div>
                    {right}
                </div>
            )}
        </>
    );
}
