'use client';

/**
 * Timeline — reusable medallion timeline (gradient spine, glyph medallions,
 * an age track, optional decade "chapter" markers, and notes on their own line).
 *
 * Pure presentation: the caller builds `TimelineItem[]` (mapping its own domain
 * to glyphs/labels) and this renders the spine. Used by the person life-events
 * panel and the family timeline. The age track only renders when some item has
 * an `ageLabel`.
 */

import type { ReactNode } from 'react';
import GuardedLink from '@/app/components/GuardedLink';
import { ArrowUpRight } from '@/lib/icons';

export interface TimelineItem {
    key: string;
    /** The row's element id, for links to it ("#event-44", #53). */
    anchor?: string;
    /** Rendered glyph (e.g. a Lucide icon) shown inside the medallion. */
    icon: ReactNode;
    title: ReactNode;
    /** Left-track label — usually an age ("27") or a marker. */
    ageLabel?: ReactNode;
    /** Accessible/tooltip text for `ageLabel` (e.g. "Age 27 at this event") — a bare
     *  number in the gutter otherwise carries no explanation (#695 CHIP-4). */
    ageTitle?: string;
    /** Optional chapter heading shown above this item (e.g. "1920s"). */
    chapter?: string | null;
    /** Inline meta line: date · place. */
    meta?: ReactNode;
    /** Cite chips / the add-source pin. Rendered beside the title, not on the meta
     *  line: trailing a place they read as part of it, and a wrapped place pushed
     *  them onto a line of their own (#906). */
    citations?: ReactNode;
    /** Description / note — rendered on its own line beneath the meta. */
    note?: ReactNode;
    /** Extra content (e.g. a show-map toggle + map) beneath the note. */
    extra?: ReactNode;
    /** Right-aligned per-row controls (e.g. Edit / Delete), on the title line. */
    actions?: ReactNode;
    /** When set, replaces the whole body (title/meta/note/extra) — e.g. an inline editor. */
    override?: ReactNode;
    /** Dim the medallion (deceased-state events). */
    dim?: boolean;
    /** A data check would have you fix this row's date (#833): the warning tint. */
    flagged?: boolean;
    /** An always-visible control on the title line, before `actions` (the "Check this date" mark). */
    mark?: ReactNode;
    /** A panel under the title block, above `extra`, that `mark` discloses. It follows
     *  the mark in focus order, before `actions`. */
    callout?: ReactNode;
    /**
     * A relative's event shown read-only here (#55): a child's birth on the family
     * page, a marriage on the person page. The title links to where it is edited,
     * with ↗. Such a row takes no `actions`.
     */
    href?: string;
}

/**
 * The "date · place" run on a timeline meta line (#808). It's one flex item whose
 * text wraps inside itself, and the date never breaks. The separator is glued to
 * the date and to the place's first word with no-break spaces, so a long place
 * wraps after one of its own words: no line starts or ends with "·". The old
 * separator hung off the date (or led the place) and was left orphaned when the
 * place wrapped onto its own line.
 */
export function TimelineWhenWhere({ date, place }: { date?: ReactNode; place?: ReactNode }) {
    if (!date && !place) return null;
    return (
        <span className="min-w-0">
            {date && <span className="whitespace-nowrap">{date}</span>}
            {date && place ? '\u00a0·\u00a0' : null}
            {place}
        </span>
    );
}

export function Timeline({ items }: { items: TimelineItem[] }) {
    if (items.length === 0) return null;
    // No row has an age (a family, or a person with no birth date): drop the age
    // track so the spine and text don't sit ~54px in for nothing (#897).
    const hasAges = items.some((it) => it.ageLabel != null && it.ageLabel !== false && it.ageLabel !== '');
    return (
        <div className={hasAges ? 'tl-med' : 'tl-med tl-med--no-age'}>
            {items.map((it) => (
                <div key={it.key} id={it.anchor} className={`tl-med-ev${it.dim ? ' is-dim' : ''}${it.flagged ? ' is-flagged' : ''}${it.href ? ' is-relative' : ''}`}>
                    {it.chapter && <div className="tl-med-chapter">{it.chapter}</div>}
                    {/* aria-label is ignored on a role-less div, so the explanation is
                        real (visually hidden) text and the bare number is hidden. */}
                    {hasAges && (
                        <div className="tl-med-age" title={it.ageTitle}>
                            {it.ageTitle ? <><span aria-hidden="true">{it.ageLabel}</span><span className="sr-only">{it.ageTitle}</span></> : it.ageLabel}
                        </div>
                    )}
                    <div className="tl-med-node" aria-hidden>{it.icon}</div>
                    <div className="tl-med-body">
                        {it.override ? it.override : (
                            <>
                                {/* A 2-column grid, not a flex row. The actions sit in column 2 of
                                    the TITLE row only, so the date/place line beneath them spans
                                    the body's full width instead of being permanently narrowed by
                                    a control that is invisible until hover (#438).

                                    DOM order stays title → meta → note → mark → callout → actions
                                    (reading order follows the content, and the panel a mark opens
                                    is the next Tab stop after it, #843); the mark and actions are
                                    placed onto row 1 by grid area, which grid honours regardless of
                                    source order. The title↔date gap that an earlier layout opened
                                    is avoided by keeping the buttons short enough not to drive the
                                    row's height (see .ev-act in globals.css) rather than by
                                    nesting them outside the stack. */}
                                <div className="tl-med-head">
                                    <div className="tl-med-title">
                                        {(() => {
                                            const title = it.href
                                                ? (
                                                    <GuardedLink href={it.href} className="tl-med-link inline-flex items-center gap-1 text-text no-underline hover:underline focus-ring rounded-sm">
                                                        {it.title}
                                                        <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                                                    </GuardedLink>
                                                )
                                                : it.title;
                                            return it.citations
                                                ? <span className="inline-flex items-center gap-1.5 flex-wrap">{title}{it.citations}</span>
                                                : title;
                                        })()}
                                    </div>
                                    {it.meta && <div className="tl-med-meta">{it.meta}</div>}
                                    {it.note && <div className="tl-med-note">{it.note}</div>}
                                    {it.mark && <div className="tl-med-mark">{it.mark}</div>}
                                    {it.callout && <div className="tl-med-callout">{it.callout}</div>}
                                    {it.actions && !it.href && <div className="tl-med-actions">{it.actions}</div>}
                                </div>
                                {/* `extra` (the map) is a sibling of the head, so it spans the
                                    body's full width — nested beside the actions it rendered
                                    at roughly two-thirds of the box. */}
                                {it.extra && <div className="tl-med-extra">{it.extra}</div>}
                            </>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
