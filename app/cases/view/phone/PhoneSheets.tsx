'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CopperPill, RadioRow, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import PersonAvatar from '@/app/components/PersonAvatar';
import MediaImg from '@/app/components/MediaImg';
import { initialsFromName } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { CheckCircle2, ClipboardList, Clock, Download, Info, LinkIcon, Pencil, Plus, RotateCcw, Trash2 } from '@/lib/icons';
import type { CaseClaimDecision, CaseClaim, CaseRequest, CaseRequestState, CaseWithRelations } from '@/lib/db/schema';
import { claimWhat, holdsDecisions, whichHolds, type ClaimConflict, type Holds } from '../desktop/claims';
import { LeadStatusDot } from '../desktop/LeadStatus';
import { yearsLabel } from '../desktop/LeadsRail';
import type { LeadSummary } from '../desktop/useCaseWorkspace';
import { Eyebrow, SheetRow } from './PhoneKit';

/**
 * The Leads sheet (#135): every lead with its status, the open one shaded and
 * ticked, + New lead, and the case's own pages: All evidence and About this case.
 */
export function LeadsSheet({ open, summaries, currentLeadId, onEvidence, evidenceCount, aboutLine, canAdd, onPick, onNewLead, onAbout, onClose }: {
    open: boolean;
    summaries: LeadSummary[];
    currentLeadId: number | null;
    onEvidence: () => void;
    evidenceCount: number;
    aboutLine: string;
    canAdd: boolean;
    onPick: (leadId: number) => void;
    onNewLead: () => void;
    onAbout: () => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    return (
        <Sheet open={open} onClose={onClose} title={t('leads')}>
            <div className="-mx-4 -mt-3">
                <Eyebrow count={summaries.length}
                    action={canAdd ? { label: t('new_lead'), icon: <Plus className="w-[15px] h-[15px]" aria-hidden="true" />, onClick: onNewLead } : undefined}>
                    {t('leads')}
                </Eyebrow>
                {summaries.map((s, i) => (
                    <SheetRow key={s.lead.Id} divided={i > 0} serif current={s.lead.Id === currentLeadId}
                        dot={<LeadStatusDot status={s.status} />}
                        label={s.lead.Question} sub={t(`status_${s.status}`)}
                        onClick={() => onPick(s.lead.Id)} />
                ))}
                <div className="mt-1.5 border-t border-border">
                    <Eyebrow>{t('case_section')}</Eyebrow>
                    <SheetRow divided={false} icon={<ClipboardList />} label={t('all_evidence')}
                        end={<span className="flex items-center gap-1.5 text-text-muted"><span className="font-mono text-meta">{evidenceCount}</span></span>}
                        onClick={onEvidence} />
                    <SheetRow icon={<Info />} label={t('about_case')} sub={aboutLine || undefined} end="chevron" onClick={onAbout} />
                </div>
            </div>
        </Sheet>
    );
}

/** The lead's ⋯ (#135): Edit, Add media, Settle (blocked while claims are undecided) or Reopen, and Drop. */
export function LeadMenuSheet({ open, summary, onEdit, onAddMedia, onSettle, onReopen, onDrop, onClose }: {
    open: boolean;
    summary: LeadSummary;
    onEdit: () => void;
    onAddMedia: () => void;
    onSettle: () => void;
    onReopen: () => void;
    onDrop: () => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const settled = summary.status === 'settled';
    const then = (fn: () => void) => () => { onClose(); fn(); };
    return (
        <Sheet open={open} onClose={onClose} title={t('this_lead')}>
            <div className="-mx-4 -mt-3">
                <SheetRow divided={false} icon={<Pencil />} label={t('edit_lead')} sub={t('edit_lead_hint')} onClick={then(onEdit)} />
                {!settled && <SheetRow icon={<Plus />} label={t('add_media')} sub={t('add_media_hint')} onClick={then(onAddMedia)} />}
                {settled
                    ? <SheetRow icon={<RotateCcw />} label={t('reopen_lead')} onClick={then(onReopen)} />
                    : <SheetRow icon={<CheckCircle2 />} label={t('settle_lead')} disabled={summary.undecided > 0}
                        sub={summary.undecided > 0 ? t('settle_blocked', { count: summary.undecided }) : undefined} onClick={then(onSettle)} />}
                <SheetRow tone="danger" icon={<Trash2 />} label={t('drop_lead')} sub={t('drop_lead_hint')} onClick={then(onDrop)} />
            </div>
        </Sheet>
    );
}

/**
 * The case's ⋯ (#135): Answer and close first, as the copper action, then Edit the
 * question, hold or resume, Copy link, Export, and Delete (only while nothing has
 * been added to the tree).
 */
export function CaseMenuSheet({ open, manage, canClose, closed, onHold, canDelete, canExport, onAnswer, onEditQuestion, onToggleHold, onReopen, onCopyLink, onExport, onDelete, onClose }: {
    open: boolean;
    manage: boolean;
    canClose: boolean;
    closed: boolean;
    onHold: boolean;
    canDelete: boolean;
    canExport: boolean;
    onAnswer: () => void;
    onEditQuestion: () => void;
    onToggleHold: () => void;
    onReopen: () => void;
    onCopyLink: () => void;
    onExport: () => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const then = (fn: () => void) => () => { onClose(); fn(); };
    // The row under Answer and close (or the top row) has no hairline above it.
    const firstRow = manage ? (closed ? 'reopen' : 'edit') : 'copy';
    return (
        <Sheet open={open} onClose={onClose} title={t('case_section')}>
            <div className="-mx-4 -mt-3">
                {canClose && (
                    <div className="px-4 pt-3.5 pb-1.5">
                        <CopperPill icon={<CheckCircle2 aria-hidden="true" />} onClick={then(onAnswer)}>{t('answer_and_close')}</CopperPill>
                    </div>
                )}
                {manage && !closed && <SheetRow divided={firstRow !== 'edit'} icon={<Pencil />} label={t('edit_question')} sub={t('edit_question_hint')} onClick={then(onEditQuestion)} />}
                {manage && !closed && <SheetRow icon={onHold ? <RotateCcw /> : <Clock />} label={onHold ? t('resume_case') : t('put_on_hold')} onClick={then(onToggleHold)} />}
                {manage && closed && <SheetRow divided={firstRow !== 'reopen'} icon={<RotateCcw />} label={t('reopen_case')} onClick={then(onReopen)} />}
                <SheetRow divided={firstRow !== 'copy'} icon={<LinkIcon />} label={t('copy_link')} onClick={then(onCopyLink)} />
                {canExport && <SheetRow icon={<Download />} label={t('export_case')} sub={t('export_hint')} onClick={then(onExport)} />}
                {canDelete && <SheetRow tone="danger" icon={<Trash2 />} label={t('delete_case')} sub={t('delete_case_hint')} onClick={then(onDelete)} />}
            </div>
        </Sheet>
    );
}

/**
 * Which holds? (#135): each record's value with its source, Both can be true, or
 * Undecided. Picking one accepts its claim and rejects the other.
 */
export function WhichHoldsSheet({ conflict, onDecide, onClose }: {
    conflict: ClaimConflict;
    onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const initial = whichHolds(conflict);
    const [holds, setHolds] = useState<Holds>(initial);
    const value = (c: CaseClaim) => [c.Says, c.Date, c.Place].filter(Boolean).join(', ') || t('says_nothing');
    const source = (side: ClaimConflict['a']) => [side.finding.citation?.sourceTitle || t('untitled_record'), side.finding.citation?.Page].filter(Boolean).join(', ');
    const about = [claimWhat(conflict.a.claim.What, t), conflict.a.claim.personLabel ?? conflict.a.claim.PersonName].filter(Boolean).join(', ');
    const options: Array<{ v: Holds; label: string; hint?: string }> = [
        { v: 'a', label: value(conflict.a.claim), hint: source(conflict.a) },
        { v: 'b', label: value(conflict.b.claim), hint: source(conflict.b) },
        { v: 'both', label: t('holds_both'), hint: t('holds_both_hint') },
        { v: 'undecided', label: t('undecided') },
    ];
    return (
        <Sheet open onClose={onClose} title={t('which_holds')} dirty={holds !== initial} saveDisabled={holds === initial}
            onSave={() => {
                const [x, y] = holdsDecisions(holds);
                if (conflict.a.claim.Decision !== x) onDecide(conflict.a.claim, x);
                if (conflict.b.claim.Decision !== y) onDecide(conflict.b.claim, y);
                onClose();
            }}>
            <p className="m-0 -mt-1 mb-2 text-sm text-text-muted">{about}</p>
            <div role="radiogroup" aria-label={t('which_holds_for', { what: about })} className="-mx-4">
                {options.map((o, i) => (
                    <RadioRow key={o.v} checked={holds === o.v} label={o.label} hint={o.hint} divided={i > 0} onSelect={() => setHolds(o.v)} />
                ))}
            </div>
            <p className="m-0 pt-3 text-meta text-text-muted">{t('which_holds_hint')}</p>
        </Sheet>
    );
}

/**
 * Log the reply (#135): they sent it (next, you add the record they sent), they
 * have nothing, or still waiting, with a note.
 */
export function LogReplySheet({ request, onSave, onClose }: {
    request: CaseRequest;
    onSave: (reply: { state: CaseRequestState; note: string | null }) => Promise<boolean>;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const ids = useId();
    const [state, setState] = useState<CaseRequestState>('received');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const options: Array<{ v: CaseRequestState; label: string; hint?: string }> = [
        { v: 'received', label: t('reply_received'), hint: t('reply_received_next') },
        { v: 'nothing', label: t('reply_nothing') },
        { v: 'waiting', label: t('reply_waiting') },
    ];
    return (
        <Sheet open onClose={onClose} title={t('log_reply')} dirty={note.trim() !== ''} saveWhenClean saveDisabled={busy}
            onSave={async () => {
                setBusy(true);
                const ok = await onSave({ state, note: note.trim() || null });
                setBusy(false);
                if (ok) onClose();
            }}>
            <p className="m-0 -mt-1 mb-2 text-sm text-text-muted">{request.Holder ? t('reply_from', { asked: request.AskedFor, holder: request.Holder }) : request.AskedFor}</p>
            <div role="radiogroup" aria-label={t('reply_state')} className="-mx-4">
                {options.map((o, i) => (
                    <RadioRow key={o.v} checked={state === o.v} label={o.label} hint={o.hint} divided={i > 0} onSelect={() => setState(o.v)} />
                ))}
            </div>
            <label htmlFor={`${ids}-n`} className="block mt-4 mb-1.5 text-sm font-semibold text-text">{t('reply_note')}</label>
            <textarea id={`${ids}-n`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass()} resize-y`} />
        </Sheet>
    );
}

/**
 * About this case (#135): what you already know, the people, the scope, the
 * photos from the library (with Add), and tags. Edit opens Edit the question.
 */
export function AboutCaseSheet({ open, caseData, treeId, canEdit, onEdit, onAddPhotos, onOpenPhoto, onClose }: {
    open: boolean;
    caseData: CaseWithRelations;
    treeId: number | null;
    canEdit: boolean;
    onEdit: () => void;
    onAddPhotos: () => void;
    onOpenPhoto: (index: number) => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const tc = useTranslations('common');
    const years = yearsLabel(caseData.FromYear, caseData.ToYear);
    const then = (fn: () => void) => () => { onClose(); fn(); };
    return (
        <Sheet open={open} onClose={onClose} title={t('about_case')} size="full"
            onSave={canEdit ? then(onEdit) : undefined} saveLabel={tc('edit')} saveWhenClean>
            <div className="grid gap-5">
                {caseData.Description && (
                    <section className="grid gap-1.5">
                        <h3 className="eyebrow m-0 text-text-muted">{t('background')}</h3>
                        <p className="m-0 text-base text-text-secondary whitespace-pre-wrap break-words">{caseData.Description}</p>
                    </section>
                )}
                <section className="grid gap-2">
                    <h3 className="eyebrow m-0 text-text-muted">{t('people')}</h3>
                    {caseData.people.length === 0 ? <p className="m-0 text-sm text-text-muted">{t('no_people')}</p> : (
                        <ul className="m-0 p-0 list-none grid gap-2">
                            {caseData.people.map((p) => {
                                const name = displayFullName(p) || t('unnamed');
                                return (
                                    <li key={p.Id}>
                                        <Link href={`/people/view?id=${p.Id}`} className="flex items-center gap-2.5 min-h-11 text-base text-text no-underline focus-ring rounded-sm">
                                            <PersonAvatar as="span" size={32} treeId={treeId} mediaId={p.PrimaryMediaId} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius}
                                                sex={p.Sex} name={name} initials={initialsFromName(name)} />
                                            <span className="serif min-w-0 truncate">{name}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
                {(years || caseData.Place) && (
                    <section className="grid gap-2">
                        <h3 className="eyebrow m-0 text-text-muted">{t('scope')}</h3>
                        <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-base">
                            {years && <><dt className="text-text-muted">{t('years')}</dt><dd className="m-0 date-mono">{years}</dd></>}
                            {caseData.Place && <><dt className="text-text-muted">{t('place')}</dt><dd className="m-0 text-text break-words">{caseData.Place}</dd></>}
                        </dl>
                    </section>
                )}
                <section className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="eyebrow m-0 text-text-muted">{t('from_library')}</h3>
                        {canEdit && (
                            <button type="button" onClick={then(onAddPhotos)}
                                className="inline-flex items-center gap-1 min-h-11 bg-transparent border-0 p-0 text-sm text-link cursor-pointer focus-ring rounded-sm">
                                <Plus className="w-[15px] h-[15px]" aria-hidden="true" />{t('add')}
                            </button>
                        )}
                    </div>
                    {caseData.media.length > 0 ? (
                        <div className="grid grid-cols-4 gap-1.5">
                            {caseData.media.map((m, i) => (
                                <button key={m.Id} type="button" onClick={then(() => onOpenPhoto(i))} aria-label={m.Title || t('photo')}
                                    className="aspect-square overflow-hidden rounded-btn border-0 p-0 bg-card-alt cursor-pointer focus-ring">
                                    <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={120} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </button>
                            ))}
                        </div>
                    ) : <p className="m-0 text-sm text-text-muted">{t('photos_added', { count: 0 })}</p>}
                </section>
                {(caseData.Tags?.length ?? 0) > 0 && (
                    <section className="grid gap-2">
                        <h3 className="eyebrow m-0 text-text-muted">{t('tags')}</h3>
                        <p className="m-0 text-base text-text-secondary break-words">{caseData.Tags?.join(', ')}</p>
                    </section>
                )}
            </div>
        </Sheet>
    );
}
