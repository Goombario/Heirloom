'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import MediaImg from '@/app/components/MediaImg';
import { Button, RecordMenu, SectionHeader, cx, type RecordMenuItem } from '@/app/components/ui';
import { Check, Plus, RotateCcw } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import type { CaseClaim, CaseClaimDecision, CaseComment, CaseFinding, CasePersonRef, CaseRequest, CaseTreeFact, Media } from '@/lib/db/schema';
import type { CaseClaimInput } from '@/lib/data/types';
import { ClaimForm } from './ClaimForm';
import { LeadStatusChip } from './LeadStatus';
import { claimConflicts, claimRelations, claimWhat, type ClaimRelation } from './claims';
import { Disagreements } from './Disagreements';
import { LeadTimeline } from './LeadTimeline';
import { yearsLabel } from './LeadsRail';
import type { LeadSummary } from './useCaseWorkspace';

const shortDate = { month: 'short', day: 'numeric' } as const;

/**
 * The open lead (#58): its eyebrow, question, status and people; Waiting on while
 * a request is out; its findings, each with its claims decided in place; nothing
 * found as plain rows; and the lead's media. A settled lead locks its decisions
 * and offers Reopen lead.
 */
export function LeadView({ summary, findings, facts = [], requests, comments, settledLeadIds, treeId, canEdit, busy, actions, openRecordId, onOpenRecord, onEdit, onSettle, onReopen, onDrop, onDecide, onReply, onOpenMedia, onAddMedia, onAddClaim, casePeople = [] }: {
    summary: LeadSummary;
    /** Every finding of the case: the lead's own are picked here. */
    findings: CaseFinding[];
    /** What the tree knows about the case's lead people, for the timeline. */
    facts?: CaseTreeFact[];
    requests: CaseRequest[];
    comments: CaseComment[];
    /** Leads that are settled: a finding filed under any of them is locked. */
    settledLeadIds: ReadonlySet<number>;
    treeId: number | null;
    canEdit: boolean;
    busy: boolean;
    /** The lead's main action and anything beside it (Find a record). */
    actions?: React.ReactNode;
    /** The finding shown in the Record tab, marked here. */
    openRecordId?: number | null;
    /** Show a finding's record in the right column. */
    onOpenRecord?: (finding: CaseFinding) => void;
    onEdit: () => void;
    onSettle: () => void;
    onReopen: () => void;
    onDrop: () => void;
    onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void;
    onReply: (request: CaseRequest) => void;
    onOpenMedia: (media: Media) => void;
    /** + Add media: a scan or photo added straight to the lead. */
    onAddMedia?: () => void;
    /** Add a claim to one of the lead's records; resolves false when it failed. */
    onAddClaim?: (finding: CaseFinding, claim: CaseClaimInput) => Promise<boolean>;
    /** The case's people, after the lead's own, for who a new claim is about. */
    casePeople?: CasePersonRef[];
}) {
    const t = useTranslations('caseResearch');
    const format = useFormatter();
    const { lead, status, undecided } = summary;
    const people = useMemo(() => [...lead.people, ...casePeople.filter((p) => !lead.people.some((l) => l.Id === p.Id))], [lead.people, casePeople]);
    const settled = status === 'settled';
    const mine = useMemo(() => findings.filter((f) => f.leadIds.includes(lead.Id)), [findings, lead.Id]);
    const records = mine.filter((f) => f.Kind === 'record');
    const nothing = mine.filter((f) => f.Kind === 'nothing');
    const waiting = requests.filter((r) => r.LeadId === lead.Id && r.State === 'waiting');
    const relations = useMemo(() => claimRelations(records), [records]);
    const conflicts = useMemo(() => claimConflicts(records), [records]);
    const locked = (f: CaseFinding) => !canEdit || f.leadIds.some((id) => settledLeadIds.has(id));
    const years = yearsLabel(lead.FromYear, lead.ToYear);

    // The lead's media: scans from its findings, then photos posted in its journal.
    const media = useMemo(() => {
        const seen = new Set<number>();
        const out: Array<{ media: Media; from: 'finding' | 'journal'; label: string }> = [];
        for (const f of records) {
            if (f.media && !seen.has(f.media.Id)) { seen.add(f.media.Id); out.push({ media: f.media, from: 'finding', label: f.citation?.sourceTitle ?? '' }); }
        }
        for (const c of comments) {
            if (c.media && (c.leadIds ?? []).includes(lead.Id) && !seen.has(c.media.Id)) {
                seen.add(c.media.Id);
                out.push({ media: c.media, from: 'journal', label: c.media.Title ?? '' });
            }
        }
        return out;
    }, [records, comments, lead.Id]);

    const menu: RecordMenuItem[] = !canEdit ? [] : [
        { label: t('edit_lead'), onSelect: onEdit },
        settled
            ? { label: t('reopen_lead'), onSelect: onReopen }
            : { label: t('settle_lead'), onSelect: onSettle, disabled: undecided > 0, disabledReason: undecided > 0 ? t('settle_blocked', { count: undecided }) : undefined },
        { label: t('drop_lead'), onSelect: onDrop, danger: true, separated: true },
    ];

    return (
        <article aria-labelledby="lead-title" className="grid gap-6">
            <header className="flex flex-wrap items-start gap-4">
                <div className="grid gap-2 min-w-0 flex-1">
                    <p className="eyebrow m-0">{t('lead')}</p>
                    <h2 id="lead-title" className="title m-0 serif text-text break-words">{lead.Question}</h2>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
                        <LeadStatusChip status={status} />
                        {years && <span className="date-mono">{years}</span>}
                        {!settled && undecided > 0 && <span>{t('undecided_count', { count: undecided })}</span>}
                        {settled && lead.SettledAt && <span>{t('settled_on', { date: format.dateTime(new Date(lead.SettledAt), { dateStyle: 'medium' }) })}</span>}
                    </div>
                    {lead.people.length > 0 && (
                        <ul aria-label={t('lead_people')} className="m-0 p-0 list-none flex flex-wrap gap-2">
                            {lead.people.map((p) => {
                                const name = displayFullName(p) || t('unnamed');
                                return (
                                    <li key={p.Id}>
                                        <Link href={`/people/view?id=${p.Id}`} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-3 text-sm text-text no-underline hover:underline focus-ring">
                                            <PersonAvatar as="span" size={22} treeId={treeId} mediaId={p.PrimaryMediaId} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius}
                                                sex={p.Sex} name={name} initials={initialsFromName(name)} />
                                            {name}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {canEdit && !settled && undecided === 0 && records.length + nothing.length > 0 && (
                        <Button variant="outline" icon={<Check className="w-4 h-4" aria-hidden="true" />} onClick={onSettle} disabled={busy}>{t('settle_lead')}</Button>
                    )}
                    {canEdit && settled && (
                        <Button variant="outline" icon={<RotateCcw className="w-4 h-4" aria-hidden="true" />} onClick={onReopen} disabled={busy}>{t('reopen_lead')}</Button>
                    )}
                    {!settled && actions}
                    <RecordMenu recordName={lead.Question} items={menu} />
                </div>
            </header>

            {settled && <p className="m-0 rounded-card bg-surface-2 px-4 py-3 text-sm text-text-secondary">{t('settled_note')}</p>}

            {waiting.length > 0 && (
                <section aria-labelledby="waiting-title" className="grid gap-2">
                    <SectionHeader level="label" headingId="waiting-title" title={t('waiting_on')} />
                    {waiting.map((r) => (
                        <div key={r.Id} className={cx('rounded-card', 'flex flex-wrap items-center gap-3 border border-warning-border bg-warning-bg px-4 py-3')}>
                            <div className="grid min-w-0 flex-1">
                                <span className="text-sm font-semibold text-text">{r.AskedFor}</span>
                                <span className="text-meta text-text-secondary">
                                    {[r.Holder, r.SentOn && t('sent_on', { date: format.dateTime(new Date(`${r.SentOn}T12:00:00Z`), shortDate) }),
                                        r.Reference && t('their_reference', { reference: r.Reference }),
                                        r.RemindOn && t('remind_on', { date: format.dateTime(new Date(`${r.RemindOn}T12:00:00Z`), shortDate) })].filter(Boolean).join(' · ')}
                                </span>
                            </div>
                            {canEdit && <Button variant="outline" size="sm" onClick={() => onReply(r)} disabled={busy}>{t('log_reply')}</Button>}
                        </div>
                    ))}
                </section>
            )}

            <LeadTimeline lead={lead} findings={mine} facts={facts} />

            {conflicts.length > 0 && (
                <Disagreements conflicts={conflicts} busy={busy} onDecide={onDecide}
                    isLocked={(f, c) => locked(f) || c.AppliedAt != null} />
            )}

            <section aria-labelledby="findings-title" className="grid gap-2.5">
                <SectionHeader level="label" headingId="findings-title" title={t('findings')} count={records.length + nothing.length} />
                {records.length + nothing.length === 0 ? (
                    <p className="m-0 text-sm text-text-muted">{t('no_findings')}</p>
                ) : (
                    <>
                        {records.map((f) => (
                            <FindingCard
                                key={f.Id}
                                finding={f}
                                relations={relations}
                                locked={locked(f)}
                                busy={busy}
                                otherLeads={f.leadIds.length - 1}
                                onDecide={onDecide}
                                open={openRecordId === f.Id}
                                onOpenRecord={onOpenRecord}
                                people={people}
                                onAddClaim={onAddClaim && !locked(f) ? (claim) => onAddClaim(f, claim) : undefined}
                            />
                        ))}
                        {nothing.map((f) => (
                            <div key={f.Id} className={cx('rounded-card', 'grid gap-0.5 border border-border bg-card px-4 py-3')}>
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="text-sm font-medium text-text-secondary">{t('nothing_found_in', { searched: f.Searched ?? '' })}</span>
                                    <span className="font-mono text-meta text-text-muted">{format.dateTime(new Date(f.CreatedAt), shortDate)}</span>
                                </div>
                                {(f.Site || f.Note) && <span className="text-meta text-text-muted">{[f.Site, f.Note].filter(Boolean).join(' · ')}</span>}
                            </div>
                        ))}
                    </>
                )}
            </section>

            {(media.length > 0 || (canEdit && !settled && onAddMedia)) && (
                <section aria-labelledby="lead-media-title" className="grid gap-2.5">
                    <SectionHeader level="label" headingId="lead-media-title" title={t('media')} count={media.length}
                        action={canEdit && !settled && onAddMedia && (
                            <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" aria-hidden="true" />} onClick={onAddMedia} disabled={busy}>
                                {t('add_media')}
                            </Button>
                        )} />
                    {media.length === 0 && <p className="m-0 text-sm text-text-muted">{t('no_lead_media')}</p>}
                    {media.length > 0 && <ul className="m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
                        {media.map(({ media: m, from, label }) => (
                            <li key={m.Id}>
                                <button type="button" onClick={() => onOpenMedia(m)} className="grid w-full gap-1.5 bg-transparent border-0 p-0 text-left cursor-pointer focus-ring rounded-btn">
                                    <span className="block aspect-[4/3] overflow-hidden rounded-btn border border-border bg-card-alt">
                                        <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={264} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    </span>
                                    <span className="grid">
                                        <span className="text-meta text-text line-clamp-2">{label || t('photo')}</span>
                                        <span className="text-xs text-text-muted">{from === 'finding' ? t('from_finding') : t('from_journal')}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>}
                </section>
            )}
        </article>
    );
}

/** One source with its claims, each decided in place. Claim rows are divided by straight lines. */
function FindingCard({ finding, relations, locked, busy, otherLeads, onDecide, open, onOpenRecord, people, onAddClaim }: {
    finding: CaseFinding;
    people: CasePersonRef[];
    /** Add a claim to this record; left out while it is locked. */
    onAddClaim?: (claim: CaseClaimInput) => Promise<boolean>;
    open: boolean;
    onOpenRecord?: (finding: CaseFinding) => void;
    relations: Map<number, ClaimRelation>;
    locked: boolean;
    busy: boolean;
    otherLeads: number;
    onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void;
}) {
    const t = useTranslations('caseResearch');
    const format = useFormatter();
    const title = finding.citation?.sourceTitle || t('untitled_record');
    const sub = [finding.citation?.sourceRepo, finding.citation?.Page].filter(Boolean).join(' · ');
    const [adding, setAdding] = useState(false);
    return (
        <article className={cx('rounded-card', 'border bg-card overflow-hidden', open ? 'border-text' : 'border-border')} aria-label={title}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 pt-3 pb-2.5">
                <h3 className="m-0 text-base font-semibold text-text break-words">
                    {onOpenRecord ? (
                        <button type="button" onClick={() => onOpenRecord(finding)} aria-expanded={open}
                            className="bg-transparent border-0 p-0 text-left font-semibold text-text hover:underline cursor-pointer focus-ring rounded-sm">{title}</button>
                    ) : title}
                </h3>
                <span className="font-mono text-meta text-text-muted">{format.dateTime(new Date(finding.CreatedAt), shortDate)}</span>
                {(sub || otherLeads > 0) && (
                    <p className="m-0 col-span-2 text-meta text-text-muted">
                        {[sub, otherLeads > 0 && t('also_under', { count: otherLeads })].filter(Boolean).join(' · ')}
                    </p>
                )}
            </div>
            {finding.claims.length === 0 ? (
                <p className="m-0 border-t border-border-light bg-card px-4 py-2.5 text-meta text-text-muted">{t('no_claims_yet')}</p>
            ) : (
                <ul className="m-0 p-0 list-none">
                    {finding.claims.map((c) => {
                        const rel = relations.get(c.Id);
                        const value = [c.Says, c.Date, c.Place].filter(Boolean).join(', ');
                        const about = c.personLabel || c.PersonName;
                        return (
                            <li key={c.Id} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border-light bg-card px-4 py-2.5 text-sm">
                                <span className="text-meta text-text-muted break-words">{claimWhat(c.What, t)}</span>
                                <span className="min-w-0 text-text break-words">
                                    {value || <span className="text-text-muted">{t('says_nothing')}</span>}
                                    {about && <span className="text-text-muted"> · {about}</span>}
                                    {rel && rel.conflicts.length > 0 ? (
                                        <small className="block text-meta text-error">{t('conflicts_with', { source: rel.conflicts[0] || t('untitled_record'), count: rel.conflicts.length })}</small>
                                    ) : rel && rel.agrees > 0 ? (
                                        <small className="block text-meta text-success">{t('agrees_with', { count: rel.agrees })}</small>
                                    ) : null}
                                </span>
                                <Decision claim={c} disabled={locked || busy || c.AppliedAt != null} onDecide={onDecide} />
                            </li>
                        );
                    })}
                </ul>
            )}
            {onAddClaim && (adding ? (
                <div className="border-t border-border-light bg-card px-4 py-3">
                    <ClaimForm people={people} onCancel={() => setAdding(false)}
                        onAdd={(claim) => { void onAddClaim(claim).then((ok) => { if (ok) setAdding(false); }); }} />
                </div>
            ) : (
                <div className="border-t border-border-light bg-card px-4 py-2">
                    <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => setAdding(true)} disabled={busy}>
                        {t('add_claim')}
                    </Button>
                </div>
            ))}
        </article>
    );
}

const DECISIONS: Array<{ v: CaseClaimDecision; key: string; on: string }> = [
    { v: 'accepted', key: 'accept', on: 'bg-success-bg text-success font-semibold' },
    { v: 'rejected', key: 'reject', on: 'bg-error-bg text-error font-semibold' },
    { v: 'undecided', key: 'undecided', on: 'bg-surface-2 text-text font-semibold' },
];

/** Accept / Reject / Undecided, one pressed. */
function Decision({ claim, disabled, onDecide }: { claim: CaseClaim; disabled: boolean; onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void }) {
    const t = useTranslations('caseResearch');
    return (
        <div role="group" aria-label={t('decide_claim', { what: claimWhat(claim.What, t) })} className="inline-flex overflow-hidden rounded-btn border border-border">
            {DECISIONS.map((d, i) => {
                const pressed = claim.Decision === d.v;
                return (
                    <button
                        key={d.v}
                        type="button"
                        aria-pressed={pressed}
                        disabled={disabled}
                        onClick={() => { if (!pressed) onDecide(claim, d.v); }}
                        className={cx(
                            'h-[30px] px-2.5 text-meta border-0 cursor-pointer focus-ring-inset disabled:cursor-not-allowed',
                            i > 0 && 'border-l border-border',
                            pressed ? d.on : 'bg-card text-text-secondary enabled:hover:bg-hover-surface disabled:opacity-60',
                        )}
                    >
                        {t(d.key)}
                    </button>
                );
            })}
        </div>
    );
}
