'use client';

import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import MediaImg from '@/app/components/MediaImg';
import PersonAvatar from '@/app/components/PersonAvatar';
import { cx } from '@/app/components/ui';
import { Check, ChevronRight, Ellipsis, FileText, Plus, SearchX, X } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import type { CaseClaim, CaseClaimDecision, CaseComment, CaseFinding, CaseRequest, CaseTreeFact, Media } from '@/lib/db/schema';
import { claimConflicts, claimRelations, claimWhat, type ClaimConflict, type ClaimRelation } from '../desktop/claims';
import { LeadTimeline } from '../desktop/LeadTimeline';
import type { LeadSummary } from '../desktop/useCaseWorkspace';
import { Eyebrow } from './PhoneKit';

const shortDate = { month: 'short', day: 'numeric' } as const;

/**
 * The Lead tab on a phone (#135): the lead's people and its ⋯; the timeline;
 * Waiting on with Log the reply; Two findings disagree with Which holds?; one
 * full-width group per record, its claims decided in place with a 38px
 * Accept / Reject / Undecided control; nothing found as plain rows; and media.
 */
export function PhoneLead({ summary, findings, facts = [], requests, comments, settledLeadIds, treeId, canEdit, busy, onMenu, onDecide, onReply, onWhichHolds, onOpenRecord, onOpenMedia, onAddMedia }: {
    summary: LeadSummary;
    findings: CaseFinding[];
    facts?: CaseTreeFact[];
    requests: CaseRequest[];
    comments: CaseComment[];
    settledLeadIds: ReadonlySet<number>;
    treeId: number | null;
    canEdit: boolean;
    busy: boolean;
    /** The lead's ⋯ sheet; left out for viewers. */
    onMenu?: () => void;
    onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void;
    onReply: (request: CaseRequest) => void;
    onWhichHolds: (conflict: ClaimConflict) => void;
    onOpenRecord: (finding: CaseFinding) => void;
    onOpenMedia: (media: Media) => void;
    onAddMedia?: () => void;
}) {
    const t = useTranslations('caseResearch');
    const format = useFormatter();
    const { lead, status } = summary;
    const settled = status === 'settled';
    const mine = useMemo(() => findings.filter((f) => f.leadIds.includes(lead.Id)), [findings, lead.Id]);
    const records = mine.filter((f) => f.Kind === 'record');
    const nothing = mine.filter((f) => f.Kind === 'nothing');
    const waiting = requests.filter((r) => r.LeadId === lead.Id && r.State === 'waiting');
    const relations = useMemo(() => claimRelations(records), [records]);
    const conflicts = useMemo(() => claimConflicts(records), [records]);
    const locked = (f: CaseFinding) => !canEdit || f.leadIds.some((id) => settledLeadIds.has(id));

    const media = useMemo(() => {
        const seen = new Set<number>();
        const out: Array<{ media: Media; label: string }> = [];
        for (const f of records) if (f.media && !seen.has(f.media.Id)) { seen.add(f.media.Id); out.push({ media: f.media, label: f.citation?.sourceTitle ?? '' }); }
        for (const c of comments) {
            if (c.media && (c.leadIds ?? []).includes(lead.Id) && !seen.has(c.media.Id)) { seen.add(c.media.Id); out.push({ media: c.media, label: c.media.Title ?? '' }); }
        }
        return out;
    }, [records, comments, lead.Id]);

    const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), shortDate);

    return (
        <div className="pb-4">
            <div className="flex items-start gap-2 px-4 pt-4 pb-1">
                <ul aria-label={t('lead_people')} className="m-0 p-0 list-none flex flex-wrap gap-2 flex-1 min-w-0">
                    {lead.people.map((p) => {
                        const name = displayFullName(p) || t('unnamed');
                        return (
                            <li key={p.Id}>
                                <Link href={`/people/view?id=${p.Id}`} className="inline-flex items-center gap-1.5 h-8 rounded-full border border-border bg-card pl-[3px] pr-3 serif text-base font-semibold text-text no-underline focus-ring">
                                    <PersonAvatar as="span" size={26} treeId={treeId} mediaId={p.PrimaryMediaId} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius}
                                        sex={p.Sex} name={name} initials={initialsFromName(name)} />
                                    {name}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
                {onMenu && (
                    <button type="button" onClick={onMenu} aria-label={t('lead_menu')}
                        className="relative grid place-items-center w-8 h-8 shrink-0 rounded-full border border-border bg-card text-text cursor-pointer focus-ring before:absolute before:-inset-1.5 before:content-['']">
                        <Ellipsis className="w-4 h-4" aria-hidden="true" />
                    </button>
                )}
            </div>

            {settled && <p className="m-0 mx-4 mt-3 rounded-card bg-surface-2 px-3.5 py-2.5 text-sm text-text-secondary">{t('settled_note')}</p>}

            {/* The timeline draws itself only when the lead has years. */}
            <div className="px-4 pt-4 empty:hidden"><LeadTimeline lead={lead} findings={mine} facts={facts} /></div>

            {waiting.map((r) => (
                <div key={r.Id} className="mx-4 mt-3 grid gap-1.5 rounded-[14px] border border-warning-border bg-warning-bg px-3.5 py-3">
                    <span className="eyebrow !text-warning-text">{t('waiting_on')}</span>
                    <span className="text-base font-semibold text-text leading-snug">{r.Holder ? t('reply_from', { asked: r.AskedFor, holder: r.Holder }) : r.AskedFor}</span>
                    <span className="text-meta text-text-secondary leading-snug">
                        {[r.SentOn && t('sent_on', { date: day(r.SentOn) }), r.Reference && t('their_reference', { reference: r.Reference }),
                            r.RemindOn && t('remind_on', { date: day(r.RemindOn) })].filter(Boolean).join(' · ')}
                    </span>
                    {canEdit && (
                        <button type="button" onClick={() => onReply(r)} disabled={busy}
                            className="justify-self-start min-h-11 -my-2 bg-transparent border-0 p-0 text-sm font-semibold text-link cursor-pointer focus-ring rounded-sm">
                            {t('log_reply')}
                        </button>
                    )}
                </div>
            ))}

            {conflicts.map((c) => {
                const about = [claimWhat(c.a.claim.What, t), c.a.claim.personLabel ?? c.a.claim.PersonName].filter(Boolean).join(', ');
                const isLocked = locked(c.a.finding) || locked(c.b.finding) || c.a.claim.AppliedAt != null || c.b.claim.AppliedAt != null;
                return (
                    <div key={c.key} className="mx-4 mt-3 grid gap-1.5 rounded-[14px] border border-border bg-card px-3.5 py-3">
                        <span className="eyebrow">{t('disagree_title')}</span>
                        <span className="text-base font-semibold text-text">{about}</span>
                        <div className="grid grid-cols-2 gap-2">
                            {[c.a, c.b].map((s) => (
                                <div key={s.claim.Id} className="grid gap-0.5 rounded-[10px] bg-surface px-2.5 py-2 min-w-0">
                                    <b className="text-sm text-text break-words">{[s.claim.Says, s.claim.Date, s.claim.Place].filter(Boolean).join(', ') || t('says_nothing')}</b>
                                    <span className="text-xs text-text-muted break-words">{s.finding.citation?.sourceTitle || t('untitled_record')}</span>
                                </div>
                            ))}
                        </div>
                        {!isLocked && (
                            <button type="button" onClick={() => onWhichHolds(c)} disabled={busy}
                                className="justify-self-start inline-flex items-center gap-1 min-h-11 -my-2 bg-transparent border-0 p-0 text-sm font-semibold text-link cursor-pointer focus-ring rounded-sm">
                                {t('which_holds')}<ChevronRight className="w-4 h-4" aria-hidden="true" />
                            </button>
                        )}
                    </div>
                );
            })}

            <Eyebrow count={records.length + nothing.length}>{t('findings')}</Eyebrow>
            {records.length + nothing.length === 0 && <p className="m-0 px-4 text-sm text-text-muted">{t('no_findings')}</p>}
            {records.map((f) => (
                <FindingGroup key={f.Id} finding={f} relations={relations} locked={locked(f)} busy={busy} onDecide={onDecide} onOpenRecord={onOpenRecord} />
            ))}
            {nothing.length > 0 && (
                <div className={cx(records.length > 0 && 'mt-2.5', 'bg-card border-y border-border')}>
                    {nothing.map((f, i) => (
                        <div key={f.Id} className={cx('flex items-center gap-3 min-h-12 px-4 py-2.5 text-sm text-text-secondary', i > 0 && 'border-t border-border')}>
                            <SearchX className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
                            <span className="min-w-0 break-words">
                                {t('nothing_found_in', { searched: f.Searched ?? '' })}
                                {(f.Site || f.Note) && <span className="block text-meta text-text-muted">{[f.Site, f.Note].filter(Boolean).join(' · ')}</span>}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {(media.length > 0 || (canEdit && !settled && onAddMedia)) && (
                <>
                    <Eyebrow action={canEdit && !settled && onAddMedia ? { label: t('add_media'), icon: <Plus className="w-[15px] h-[15px]" aria-hidden="true" />, onClick: onAddMedia } : undefined}>
                        {t('media')}
                    </Eyebrow>
                    {media.length === 0 ? <p className="m-0 px-4 text-sm text-text-muted">{t('no_lead_media')}</p> : (
                        <ul className="m-0 px-4 list-none grid grid-cols-3 gap-1">
                            {media.map(({ media: m, label }) => (
                                <li key={m.Id}>
                                    <button type="button" onClick={() => onOpenMedia(m)} aria-label={label || t('photo')}
                                        className="relative block w-full aspect-square overflow-hidden rounded-lg border-0 p-0 bg-card-alt cursor-pointer focus-ring">
                                        <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={240} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}

/** One record's group: its header opens the Record sheet; each claim decides in place. */
function FindingGroup({ finding, relations, locked, busy, onDecide, onOpenRecord }: {
    finding: CaseFinding;
    relations: Map<number, ClaimRelation>;
    locked: boolean;
    busy: boolean;
    onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void;
    onOpenRecord: (finding: CaseFinding) => void;
}) {
    const t = useTranslations('caseResearch');
    const title = finding.citation?.sourceTitle || t('untitled_record');
    const sub = [finding.citation?.Page,
        finding.SourceNature && t(`nature_${finding.SourceNature}`),
        finding.Information && t(`information_${finding.Information}`)].filter(Boolean).join(' · ');
    return (
        <section aria-label={title} className="bg-card border-y border-border [&+section]:mt-2.5">
            <button type="button" onClick={() => onOpenRecord(finding)}
                className="flex w-full items-start gap-3 min-h-14 px-4 py-[11px] bg-transparent border-0 text-left cursor-pointer active:bg-surface-2 focus-ring-inset">
                <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[10px] bg-surface-2 text-text"><FileText className="w-[17px] h-[17px]" /></span>
                <span className="grid gap-0.5 flex-1 min-w-0">
                    <span className="serif font-semibold text-md leading-snug text-text break-words">{title}</span>
                    {sub && <span className="text-meta text-text-muted">{sub}</span>}
                </span>
                <ChevronRight className="w-[18px] h-[18px] shrink-0 mt-2 text-text-muted" aria-hidden="true" />
            </button>
            {finding.claims.length === 0 ? (
                <p className="m-0 border-t border-border px-4 py-2.5 text-meta text-text-muted">{t('no_claims_yet')}</p>
            ) : finding.claims.map((c) => {
                const rel = relations.get(c.Id);
                const value = [c.Says, c.Date, c.Place].filter(Boolean).join(', ');
                const about = c.personLabel || c.PersonName;
                return (
                    <div key={c.Id} className="grid gap-2 border-t border-border px-4 pt-2.5 pb-3">
                        <div className="flex items-baseline justify-between gap-2.5">
                            <b className="text-base text-text break-words min-w-0">
                                {claimWhat(c.What, t)}: {value || t('says_nothing')}
                                {about && <span className="font-normal text-text-muted"> · {about}</span>}
                            </b>
                            {c.Evidence && <span className="text-meta text-text-muted shrink-0">{t(`evidence_${c.Evidence}`)}</span>}
                        </div>
                        {rel && rel.conflicts.length > 0 ? (
                            <span className="text-meta font-medium text-warning-text">{t('conflicts_with', { source: rel.conflicts[0] || t('untitled_record'), count: rel.conflicts.length })}</span>
                        ) : rel && rel.agrees > 0 ? (
                            <span className="text-meta font-medium text-success">{t('agrees_with', { count: rel.agrees })}</span>
                        ) : null}
                        <PhoneDecision claim={c} disabled={locked || busy || c.AppliedAt != null} onDecide={onDecide} />
                    </div>
                );
            })}
        </section>
    );
}

const DECISIONS: Array<{ v: CaseClaimDecision; idle: string; on: string; onClass: string; icon?: 'check' | 'x' }> = [
    { v: 'accepted', idle: 'accept', on: 'claim_accepted', onClass: 'bg-success-bg text-success font-semibold', icon: 'check' },
    { v: 'rejected', idle: 'reject', on: 'claim_rejected', onClass: 'bg-error-bg text-error font-semibold', icon: 'x' },
    { v: 'undecided', idle: 'undecided', on: 'undecided', onClass: 'bg-text text-card font-semibold' },
];

/** Accept / Reject / Undecided, 38px tall for thumbs; the chosen one is filled and reads Accepted or Rejected. */
function PhoneDecision({ claim, disabled, onDecide }: { claim: CaseClaim; disabled: boolean; onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void }) {
    const t = useTranslations('caseResearch');
    return (
        <div role="group" aria-label={t('decide_claim', { what: claimWhat(claim.What, t) })}
            className={cx('flex h-[38px] gap-[3px] rounded-[11px] border border-border bg-surface p-[3px]', disabled && 'opacity-60')}>
            {DECISIONS.map((d) => {
                const pressed = claim.Decision === d.v;
                return (
                    <button key={d.v} type="button" aria-pressed={pressed} disabled={disabled}
                        onClick={() => { if (!pressed) onDecide(claim, d.v); }}
                        className={cx('flex-1 inline-flex items-center justify-center gap-1 rounded-lg border-0 text-sm cursor-pointer focus-ring-inset disabled:cursor-default',
                            pressed ? d.onClass : 'bg-transparent font-medium text-text-secondary')}>
                        {pressed && d.icon === 'check' && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                        {pressed && d.icon === 'x' && <X className="w-3.5 h-3.5" aria-hidden="true" />}
                        {t(pressed ? d.on : d.idle)}
                    </button>
                );
            })}
        </div>
    );
}
