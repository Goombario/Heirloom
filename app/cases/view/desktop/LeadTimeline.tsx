'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { SectionHeader, cx } from '@/app/components/ui';
import { sortableYear } from '@/lib/date-utils';
import type { CaseFinding, CaseLead, CaseTreeFact } from '@/lib/db/schema';
import { claimWhat } from './claims';

/** Years with no record longer than this show as a hatched stretch. */
const GAP = 5;
/** One date shows this many years either side. */
const SPAN = 20;

interface Point { year: number; kind: 'known' | 'found'; label: string }

/** The years a lead's timeline covers: its two years, or one year with SPAN either side. */
function timelineRange(lead: CaseLead): [number, number] | null {
    const { FromYear: from, ToYear: to } = lead;
    if (from != null && to != null) return from === to ? [from - SPAN, to + SPAN] : [from, to];
    const one = from ?? to;
    return one == null ? null : [one - SPAN, one + SPAN];
}

/**
 * A lead's timeline (#58), only when the lead has dates: what the tree knows
 * about its people (filled dot), what its findings found (ring), and the
 * stretches with no record (hatched). A list under it says the same in words.
 */
export function LeadTimeline({ lead, findings, facts }: { lead: CaseLead; findings: CaseFinding[]; facts: CaseTreeFact[] }) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const range = timelineRange(lead);
    if (!range) return null;
    const [start, end] = range;
    const people = new Set(lead.people.map((p) => p.Id));
    const name = (personId: number) => {
        const p = lead.people.find((x) => x.Id === personId);
        return p ? [p.EffectiveFirstName ?? p.FirstName, p.LastName].filter(Boolean).join(' ') : '';
    };

    const points: Point[] = [];
    for (const f of facts) {
        const year = sortableYear(f.Date);
        if (year == null || !people.has(f.PersonId) || year < start || year > end) continue;
        points.push({ year, kind: 'known', label: [claimWhat(f.Type, t), name(f.PersonId)].filter(Boolean).join(' · ') });
    }
    for (const f of findings) {
        for (const c of f.claims) {
            const year = sortableYear(c.Date);
            if (year == null || c.Decision === 'rejected' || year < start || year > end) continue;
            points.push({ year, kind: 'found', label: [claimWhat(c.What, t), f.citation?.sourceTitle].filter(Boolean).join(' · ') });
        }
    }
    points.sort((a, b) => a.year - b.year);

    // Stretches with no record: gaps longer than GAP years between start, the points and end.
    const marks = [start, ...points.map((p) => p.year), end];
    const gaps: Array<[number, number]> = [];
    for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > GAP) gaps.push([marks[i - 1], marks[i]]);

    const at = (year: number) => `${((year - start) / Math.max(1, end - start)) * 100}%`;
    const ticks = [start, Math.round((start + end) / 2), end];

    return (
        <section aria-labelledby={`${id}-title`} className="grid gap-2.5">
            <SectionHeader level="label" headingId={`${id}-title`} title={t('timeline')} />
            <div className={cx('rounded-card', 'grid gap-2 border border-border bg-card px-5 pt-6 pb-3')} aria-hidden="true">
                <div className="relative h-4">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                    {gaps.map(([a, b]) => (
                        <div key={`${a}-${b}`} className="absolute top-0 h-4 timeline-gap" style={{ left: at(a), width: `calc(${at(b)} - ${at(a)})` }} />
                    ))}
                    {/* Rings first, so a fact the tree already holds shows as a dot inside its ring. */}
                    {[...points].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'found' ? -1 : 1)).map((p, i) => (
                        <span key={`${p.kind}-${p.year}-${i}`} title={`${p.year} · ${p.label}`}
                            className={cx('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                                p.kind === 'known' ? 'w-1.5 h-1.5 bg-text' : 'w-3.5 h-3.5 bg-card border-2 border-evidence')}
                            style={{ left: at(p.year) }} />
                    ))}
                </div>
                <div className="relative h-4 font-mono text-meta text-text-muted">
                    {ticks.map((y, i) => (
                        <span key={y} className={cx('absolute', i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: at(y) }}>{y}</span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-4 text-meta text-text-secondary">
                    <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-text" />{t('timeline_known')}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2 border-evidence" />{t('timeline_found')}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-4 h-2.5 timeline-gap" />{t('timeline_gap')}</span>
                </div>
            </div>
            <ul className="sr-only">
                {points.map((p, i) => (
                    <li key={`${p.kind}-${p.year}-${i}`}>{t(p.kind === 'known' ? 'timeline_known_item' : 'timeline_found_item', { year: p.year, what: p.label })}</li>
                ))}
                {gaps.map(([a, b]) => <li key={`g${a}`}>{t('timeline_gap_item', { from: a, to: b })}</li>)}
            </ul>
        </section>
    );
}
