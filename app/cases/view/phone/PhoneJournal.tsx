'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import { FilterChip, MobileRow, RadioRow, cx, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { ChevronDown, Ellipsis, ImageUp, Quote } from '@/lib/icons';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import type { CaseComment, CaseLead } from '@/lib/db/schema';
import type { CaseDetailState } from '../useCaseDetail';
import { loggedEntryText } from '../case-detail-helpers';
import { TYPES, entryShown, type EntryType } from '../desktop/WorkspaceJournal';

/** Which leads the journal shows: the open lead, one lead, or the whole case. */
type Showing = 'this' | 'case' | `${number}`;

/** The eyebrow word for an entry's kind. */
function kindKey(c: CaseComment): string {
    switch (c.Kind) {
        case 'finding': return 'type_findings_one';
        case 'search': case 'request': case 'reply': return 'type_searches_one';
        case 'status': case 'lead': return 'type_status';
        case 'conclusion': return 'type_conclusion';
        default: return 'type_notes_one';
    }
}

/**
 * The Journal tab on a phone (#135): Showing (This lead by default, following the
 * open lead), the entry-type chips with counts, and the entries. A note's ⋯ shows
 * all the time, since phones have no hover, and only on notes: it strikes the note
 * out (#1251). Entries are never edited or deleted.
 */
export function PhoneJournal({ cd, leads, openLeadId, lastFiled, onClearFiled, onStrike }: {
    cd: CaseDetailState;
    /** Where the note just added was filed, until the view shows it. */
    lastFiled: number[] | null;
    onClearFiled: () => void;
    leads: CaseLead[];
    openLeadId: number | null;
    /** Open the strike-out sheet for a note. */
    onStrike: (note: CaseComment) => void;
}) {
    const t = useTranslations('caseResearch');
    const tCases = useTranslations('cases');
    const { timestamp } = useTimestamp();
    const [showing, setShowing] = useState<Showing>('this');
    const [type, setType] = useState<EntryType>('all');
    const [picking, setPicking] = useState(false);
    const comments = useMemo(() => [...(cd.caseData?.comments ?? [])].reverse(), [cd.caseData?.comments]);
    const shownLead = showing === 'case' ? null : showing === 'this' ? openLeadId : Number(showing);
    const visible = comments.filter((c) => entryShown(c, shownLead, type));
    const leadName = (id: number) => leads.find((l) => l.Id === id)?.Question ?? '';
    const showingLabel = showing === 'this' ? t('this_lead') : showing === 'case' ? t('whole_case') : leadName(Number(showing));
    const added = lastFiled;
    const hiddenAdded = added && ((type !== 'all' && type !== 'notes') || (shownLead != null && !added.includes(shownLead))) ? added : null;
    const filedLabel = (ids: number[]) => (ids.length === 0 ? t('whole_case') : ids.map(leadName).join(', '));
    const struckLine = (c: CaseComment) => {
        const when = timestamp(c.StruckAt ?? '');
        const head = c.StruckByName ? tCases('journal_struck_by', { name: c.StruckByName, date: when }) : tCases('journal_struck', { date: when });
        return c.StruckReason ? `${head} · ${c.StruckReason}` : head;
    };

    const options: Array<{ value: Showing; label: string }> = [
        { value: 'this', label: t('this_lead') },
        ...leads.map((l) => ({ value: `${l.Id}` as Showing, label: l.Question })),
        { value: 'case', label: t('whole_case') },
    ];

    return (
        <div className="pb-4">
            <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog"
                className="flex w-full items-center gap-2 min-h-12 px-4 bg-transparent border-0 border-b border-border text-left cursor-pointer focus-ring-inset">
                <span className="text-sm text-text-muted">{t('showing')}</span>
                <span className="flex-1 min-w-0 truncate text-sm font-semibold text-text">{showingLabel}</span>
                <ChevronDown className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
            </button>
            <div role="group" aria-label={t('entry_types')} className="hscroll-strip flex gap-1.5 px-4 pt-2.5 pb-3 border-b border-border">
                {TYPES.map((k) => (
                    <FilterChip key={k} active={type === k} count={comments.filter((c) => entryShown(c, shownLead, k)).length} onClick={() => setType(k)}>{t(`type_${k}`)}</FilterChip>
                ))}
            </div>

            {hiddenAdded && (
                <p role="status" className="m-0 px-4 py-2.5 text-meta text-text-secondary border-b border-border">
                    {t('added_to', { where: filedLabel(hiddenAdded) })} ·{' '}
                    <button type="button" onClick={() => { setShowing('case'); setType('all'); onClearFiled(); }}
                        className="bg-transparent border-0 p-0 text-meta font-semibold text-link underline cursor-pointer focus-ring rounded-sm">{t('show')}</button>
                </p>
            )}

            {visible.length === 0 ? (
                <p className="m-0 px-4 pt-4 text-sm text-text-muted">{t('journal_empty')}</p>
            ) : (
                <ol className="m-0 p-0 list-none">
                    {visible.map((c) => {
                        const logged = loggedEntryText(c, tCases);
                        const author = c.UserName || c.UserEmail || `#${c.UserId}`;
                        const struck = c.StruckAt != null;
                        const filedNames = (c.leadIds ?? []).map(leadName).filter(Boolean);
                        const canStrike = logged == null && !struck && cd.canStrikeNote(c);
                        return (
                            <li key={c.Id} className="grid gap-1.5 px-4 py-3 border-b border-border" data-entry-kind={c.Kind ?? 'note'} data-struck={struck || undefined}>
                                <div className="flex items-center gap-2 min-h-6 text-meta text-text-muted">
                                    <span className="eyebrow">{t(kindKey(c))}</span>
                                    {c.Kind !== 'status' && <span className="font-semibold text-text-secondary">{author}</span>}
                                    <span className="font-mono">{timestamp(c.CreatedAt, 'date')}</span>
                                    {canStrike && (
                                        <button type="button" onClick={() => onStrike(c)} aria-label={t('note_menu', { date: timestamp(c.CreatedAt, 'date') })}
                                            className="relative ml-auto grid place-items-center w-7 h-7 rounded-full border-0 bg-transparent text-text-muted cursor-pointer focus-ring before:absolute before:-inset-2 before:content-['']">
                                            <Ellipsis className="w-[18px] h-[18px]" aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                                <p className={cx('m-0 whitespace-pre-wrap break-words', logged != null ? 'text-sm text-text-secondary' : 'text-base', struck ? 'text-text-muted line-through' : logged == null && 'text-text')}>
                                    {struck && <span className="sr-only">{tCases('journal_struck_sr')} </span>}
                                    {logged ?? c.Body}
                                    {c.citationLabel && (
                                        <button type="button" onClick={(e) => { void cd.openCommentCitation(c, e.currentTarget); }}
                                            className="ml-1.5 inline-flex items-center align-middle font-mono text-xs px-1.5 rounded bg-evidence-soft text-evidence cursor-pointer focus-ring">
                                            {c.citationLabel}
                                        </button>
                                    )}
                                </p>
                                {struck && <p className="m-0 text-meta text-text-muted">{struckLine(c)}</p>}
                                {logged == null && filedNames.length > 0 && (
                                    <p className="m-0 text-meta text-text-muted">
                                        {shownLead != null && filedNames.length === 1 && c.leadIds?.[0] === shownLead ? t('filed_under_this') : t('filed_under_names', { names: filedNames.join(', ') })}
                                    </p>
                                )}
                                {c.media && (
                                    <MediaImg mediaId={c.media.Id} contentType={c.media.ContentType} treeId={cd.activeTreeId} width={320} alt={c.media.Title || t('photo')}
                                        className={cx('max-w-[14rem] rounded-lg object-cover', struck && 'opacity-50 grayscale')} />
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}

            <Sheet open={picking} onClose={() => setPicking(false)} title={t('showing')}>
                <div role="radiogroup" aria-label={t('showing')} className="-mx-4 -mt-3">
                    {options.map((o, i) => (
                        <RadioRow key={o.value} checked={showing === o.value} label={o.label} divided={i > 0}
                            onSelect={() => { setShowing(o.value); setPicking(false); }} />
                    ))}
                </div>
            </Sheet>
        </div>
    );
}

/**
 * Add a note (#135): the text, Photo and Cite, and Filed under as checkbox rows (every
 * lead, the open one ticked, and The whole case). A photo or citation added here
 * becomes a source in All evidence, filed under the same leads.
 */
export function AddNoteSheet({ open, cd, leads, openLeadId, onFiled, onClose }: {
    open: boolean;
    onFiled: (leadIds: number[]) => void;
    cd: CaseDetailState;
    leads: CaseLead[];
    openLeadId: number | null;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const fileRef = useRef<HTMLInputElement>(null);
    const ids = useId();
    const [filedFor, setFiledFor] = useState<{ lead: number | null; ids: number[] } | null>(null);
    const filed = filedFor && filedFor.lead === openLeadId ? filedFor.ids : (openLeadId != null ? [openLeadId] : []);
    const pending = cd.pendingCommentCite;
    const dirty = cd.commentBody.trim() !== '' || pending != null || cd.journalFile != null;
    const discard = () => { cd.setCommentBody(''); cd.setPendingCommentCite(null); cd.setJournalFile(null); cd.setJournalFilePreview(null); setFiledFor(null); onClose(); };
    const toggle = (id: number | 'case') => {
        const next = id === 'case' ? [] : filed.includes(id) ? filed.filter((x) => x !== id) : [...filed, id];
        setFiledFor({ lead: openLeadId, ids: next });
    };
    return (
        <Sheet open={open} onClose={discard} title={t('add_note')} size="full" dirty={dirty} saveLabel={t('add')}
            saveDisabled={!cd.commentBody.trim() || cd.postingComment}
            onSave={async () => {
                if (await cd.postComment(filed, true)) { onFiled(filed); setFiledFor(null); onClose(); }
            }}>
            <label htmlFor={`${ids}-n`} className="sr-only">{t('add_note')}</label>
            <textarea id={`${ids}-n`} value={cd.commentBody} onChange={(e) => cd.setCommentBody(e.target.value)} placeholder={t('note_placeholder')} rows={6}
                className={cx(fieldClass(), 'min-h-[140px] text-md mt-1')} />
            <div className="-mx-4 mt-2.5">
                <MobileRow icon={<ImageUp aria-hidden="true" />}
                    label={cd.journalFile ? cd.journalFile.name : t('photo')}
                    sub={cd.journalFile ? t('remove_photo') : undefined}
                    end={cd.journalFile ? 'none' : 'chevron'}
                    onClick={() => (cd.journalFile ? (cd.setJournalFile(null), cd.setJournalFilePreview(null)) : fileRef.current?.click())} />
                <MobileRow divided icon={<Quote aria-hidden="true" />}
                    label={pending ? (pending.sourceTitle ?? pending.newSource?.Title ?? '') : t('cite')}
                    sub={pending ? t('remove_cite') : undefined}
                    end={pending ? 'none' : 'chevron'}
                    onClick={() => (pending ? cd.setPendingCommentCite(null) : cd.setShowComposerCite(true))} />
                <input ref={fileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        cd.setJournalFile(f);
                        cd.setJournalFilePreview(URL.createObjectURL(f));
                        e.target.value = '';
                    }} />
                <h3 className="eyebrow m-0 px-4 pt-[18px] pb-1.5 border-t border-border">{t('filed_under')}</h3>
                <div role="group" aria-label={t('filed_under')}>
                    {leads.map((l, i) => (
                        <MobileRow key={l.Id} divided={i > 0} checked={filed.includes(l.Id)} label={l.Question}
                            sub={l.Id === openLeadId ? t('lead_you_are_on') : undefined} onClick={() => toggle(l.Id)} />
                    ))}
                    <MobileRow divided={leads.length > 0} checked={filed.length === 0} label={t('whole_case')} onClick={() => toggle('case')} />
                </div>
                <p className="m-0 px-4 pt-3 text-meta text-text-muted">{t('add_note_hint')}</p>
            </div>
            {cd.journalFilePreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cd.journalFilePreview} alt="" className="mt-3 w-[120px] aspect-[4/3] rounded-lg object-cover" />
            )}
        </Sheet>
    );
}

/** Strike out a note (#1251): the note quoted, why it is no longer accurate, and that it stays crossed out. */
export function StrikeSheet({ note, cd, onClose }: { note: CaseComment; cd: CaseDetailState; onClose: () => void }) {
    const t = useTranslations('caseResearch');
    const tCases = useTranslations('cases');
    const ids = useId();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    return (
        <Sheet open onClose={onClose} title={tCases('journal_strike')} dirty={reason.trim() !== ''} saveWhenClean
            saveLabel={tCases('journal_strike')} saveDisabled={busy}
            onSave={async () => {
                setBusy(true);
                const ok = await cd.setNoteStruck(note, true, reason);
                setBusy(false);
                if (ok) onClose();
            }}>
            <blockquote className="m-0 mt-1 border-l-2 border-border pl-3 text-base text-text-secondary whitespace-pre-wrap line-clamp-4">{note.Body}</blockquote>
            <label htmlFor={`${ids}-r`} className="block mt-4 mb-1.5 text-sm font-semibold text-text">{t('strike_why')}</label>
            <input id={`${ids}-r`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={fieldClass()} />
            <p className="m-0 mt-3 text-meta text-text-muted">{t('strike_keeps')}</p>
        </Sheet>
    );
}
