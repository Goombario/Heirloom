'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import { Button, FilterChip, RecordMenu, SelectField, cx, fieldClass } from '@/app/components/ui';
import { Paperclip, Quote, X } from '@/lib/icons';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import type { CaseComment, CaseLead } from '@/lib/db/schema';
import type { CaseDetailState } from '../useCaseDetail';
import { loggedEntryText } from '../case-detail-helpers';

type EntryType = 'all' | 'notes' | 'findings' | 'searches' | 'status';
/** Which leads the journal shows: the open lead, one lead, or the whole case. */
type Showing = 'this' | 'case' | `${number}`;

const TYPES: EntryType[] = ['all', 'notes', 'findings', 'searches', 'status'];

/** The type filter an entry falls under. */
function entryType(c: Pick<CaseComment, 'Kind'>): Exclude<EntryType, 'all'> {
    switch (c.Kind) {
        case 'finding': return 'findings';
        case 'search': case 'request': case 'reply': return 'searches';
        case 'status': case 'lead': return 'status';
        default: return 'notes';
    }
}

/**
 * Whether the journal, showing `lead` (null for the whole case) and `type`,
 * lists the entry. A lead shows the entries filed under it and the case's
 * status changes, which concern every lead.
 */
function entryShown(c: Pick<CaseComment, 'Kind' | 'leadIds'>, lead: number | null, type: EntryType): boolean {
    if (type !== 'all' && entryType(c) !== type) return false;
    if (lead == null) return true;
    return c.Kind === 'status' || (c.leadIds ?? []).includes(lead);
}

/**
 * The workspace journal (#58): Showing (This lead by default, following the
 * open lead), entry-type filters, and the composer with its Filed under chip,
 * which defaults to the open lead whatever the view shows. Entries are
 * append-only; a note's ⋯ menu, shown on hover, strikes it out (#1251).
 */
export function WorkspaceJournal({ cd, leads, openLeadId }: { cd: CaseDetailState; leads: CaseLead[]; openLeadId: number | null }) {
    const t = useTranslations('caseResearch');
    const tCases = useTranslations('cases');
    const { timestamp } = useTimestamp();
    const { caseData, canEdit, commentBody, setCommentBody, postComment, postingComment, journalFile, setJournalFile, pendingCommentCite, setPendingCommentCite } = cd;
    const [showing, setShowing] = useState<Showing>('this');
    const [type, setType] = useState<EntryType>('all');
    // Filed under follows the open lead until it is changed for this lead.
    const [filedFor, setFiledFor] = useState<{ lead: number | null; ids: number[] } | null>(null);
    const filed = filedFor && filedFor.lead === openLeadId ? filedFor.ids : (openLeadId != null ? [openLeadId] : []);
    const [choosing, setChoosing] = useState(false);
    const [added, setAdded] = useState<number[] | null>(null);
    const [striking, setStriking] = useState<{ id: number; reason: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const shownLead = showing === 'case' ? null : showing === 'this' ? openLeadId : Number(showing);
    const comments = useMemo(() => [...(caseData?.comments ?? [])].reverse(), [caseData?.comments]);
    const visible = comments.filter((c) => entryShown(c, shownLead, type));
    const leadName = (id: number) => leads.find((l) => l.Id === id)?.Question ?? '';
    const filedLabel = (ids: number[]) => (ids.length === 0 ? t('whole_case') : ids.map(leadName).join(', '));
    // A note just added that the view hides says where it went, with Show.
    const hiddenAdded = added && ((type !== 'all' && type !== 'notes') || (shownLead != null && !added.includes(shownLead))) ? added : null;

    if (!caseData) return null;

    const post = async () => {
        const ids = filed;
        if (await postComment(ids)) { setAdded(ids); setChoosing(false); }
    };
    const toggleFiled = (id: number | 'case') => {
        const next = id === 'case' ? [] : filed.includes(id) ? filed.filter((x) => x !== id) : [...filed, id];
        setFiledFor({ lead: openLeadId, ids: next });
    };
    const struckLine = (c: CaseComment) => {
        const when = timestamp(c.StruckAt ?? '');
        const head = c.StruckByName ? tCases('journal_struck_by', { name: c.StruckByName, date: when }) : tCases('journal_struck', { date: when });
        return c.StruckReason ? `${head} · ${c.StruckReason}` : head;
    };

    return (
        <section aria-labelledby="journal-title" className={cx('rounded-panel', 'grid gap-4 bg-card border border-border p-5')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="journal-title" className="m-0 serif text-md font-semibold text-text">{t('journal')}</h2>
                <label className="flex items-center gap-2 text-meta text-text-muted">
                    <span>{t('showing')}</span>
                    <SelectField<Showing> size="sm" width="w-44" aria-label={t('showing')} value={showing} onChange={setShowing}
                        options={[
                            { value: 'this', label: t('this_lead') },
                            ...leads.map((l) => ({ value: `${l.Id}` as Showing, label: l.Question })),
                            { value: 'case', label: t('whole_case') },
                        ]} />
                </label>
            </div>
            <div role="group" aria-label={t('entry_types')} className="flex flex-wrap gap-1.5">
                {TYPES.map((k) => (
                    <FilterChip key={k} active={type === k} onClick={() => setType(k)}>{t(`type_${k}`)}</FilterChip>
                ))}
            </div>

            {canEdit && caseData.Status !== 'closed' && (
                <div className={cx('rounded-card', 'grid gap-2 border border-border bg-card-alt p-3 focus-ring-within')}>
                    <textarea aria-label={t('add_note')} value={commentBody} onChange={(e) => setCommentBody(e.target.value)} rows={2}
                        placeholder={t('add_note')} className="w-full border-0 outline-none resize-none bg-transparent text-sm text-text"
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void post(); }} />
                    {(journalFile || pendingCommentCite) && (
                        <div className="flex flex-wrap items-center gap-2 text-meta text-text-secondary">
                            {journalFile && (
                                <span className="inline-flex items-center gap-1">{journalFile.name}
                                    <button type="button" aria-label={t('remove_photo')} onClick={() => setJournalFile(null)} className="grid place-items-center w-6 h-6 rounded-full bg-transparent border-0 text-text-muted hover:text-text cursor-pointer focus-ring"><X className="w-3 h-3" aria-hidden="true" /></button>
                                </span>
                            )}
                            {pendingCommentCite && (
                                <span className="inline-flex items-center gap-1 font-mono text-xs px-1.5 rounded bg-evidence-soft text-evidence">
                                    <Quote className="w-3 h-3" aria-hidden="true" />{pendingCommentCite.sourceTitle ?? pendingCommentCite.newSource?.Title}
                                    <button type="button" aria-label={t('remove_cite')} onClick={() => setPendingCommentCite(null)} className="grid place-items-center w-5 h-5 bg-transparent border-0 text-current cursor-pointer focus-ring"><X className="w-3 h-3" aria-hidden="true" /></button>
                                </span>
                            )}
                        </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-2">
                        <label className="inline-flex items-center gap-1.5 h-7 rounded-btn border border-border bg-card px-2.5 text-meta text-text-secondary cursor-pointer hover:bg-hover-surface focus-ring-within">
                            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setJournalFile(f); e.target.value = ''; }} />
                            <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />{t('photo')}
                        </label>
                        <button type="button" onClick={() => cd.setShowComposerCite(true)}
                            className="inline-flex items-center gap-1.5 h-7 rounded-btn border border-border bg-card px-2.5 text-meta text-text-secondary cursor-pointer hover:bg-hover-surface focus-ring">
                            <Quote className="w-3.5 h-3.5" aria-hidden="true" />{t('cite')}
                        </button>
                        <button type="button" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}
                            className="inline-flex min-w-0 max-w-full items-center gap-1 h-7 rounded-full bg-surface-2 px-2.5 text-meta text-text cursor-pointer focus-ring">
                            <span className="text-text-muted shrink-0">{t('filed_under')}</span>
                            <span className="truncate">{filedLabel(filed)}</span>
                        </button>
                        <Button size="sm" className="ml-auto" onClick={() => { void post(); }} disabled={postingComment || !commentBody.trim()}>{t('add_note_button')}</Button>
                    </div>
                    {choosing && (
                        <fieldset className="m-0 grid gap-1.5 border-0 border-t border-border-light p-0 pt-2">
                            <legend className="sr-only">{t('filed_under')}</legend>
                            {leads.map((l) => (
                                <label key={l.Id} className="flex items-start gap-2 text-sm text-text cursor-pointer">
                                    <input type="checkbox" checked={filed.includes(l.Id)} onChange={() => toggleFiled(l.Id)} className="mt-0.5" />
                                    <span className="break-words">{l.Question}</span>
                                </label>
                            ))}
                            <label className="flex items-start gap-2 text-sm text-text cursor-pointer">
                                <input type="checkbox" checked={filed.length === 0} onChange={() => toggleFiled('case')} className="mt-0.5" />
                                <span>{t('whole_case')}</span>
                            </label>
                        </fieldset>
                    )}
                </div>
            )}

            {hiddenAdded && (
                <p role="status" className="m-0 text-meta text-text-secondary">
                    {t('added_to', { where: filedLabel(hiddenAdded) })} · 
                    <button type="button" onClick={() => { setShowing('case'); setType('all'); setAdded(null); }}
                        className="bg-transparent border-0 p-0 text-meta text-link underline cursor-pointer focus-ring rounded-sm">{t('show')}</button>
                </p>
            )}

            {visible.length === 0 ? (
                <p className="m-0 text-sm text-text-muted">{t('journal_empty')}</p>
            ) : (
                <ol className="m-0 p-0 list-none grid">
                    {visible.map((c) => {
                        const logged = loggedEntryText(c, tCases);
                        const author = c.UserName || c.UserEmail || `#${c.UserId}`;
                        const filedNames = shownLead == null && (c.leadIds ?? []).length > 0 ? (c.leadIds ?? []).map(leadName).filter(Boolean) : [];
                        if (logged != null) {
                            return (
                                <li key={c.Id} className="border-t border-border-light first:border-t-0 py-2 text-meta text-text-muted" data-entry-kind={c.Kind ?? undefined}>
                                    <span className="font-medium text-text-secondary">{logged}</span> · <span className="tabular-nums">{timestamp(c.CreatedAt)}</span> · {author}
                                    {filedNames.length > 0 && <span> · {filedNames.join(', ')}</span>}
                                </li>
                            );
                        }
                        const struck = c.StruckAt != null;
                        const menu = cd.canStrikeNote(c) ? [struck
                            ? { label: tCases('journal_unstrike'), onSelect: () => { void cd.setNoteStruck(c, false); } }
                            : { label: tCases('journal_strike'), onSelect: () => setStriking({ id: c.Id, reason: '' }) }] : [];
                        return (
                            <li key={c.Id} className="group border-t border-border-light first:border-t-0 py-3 grid gap-1" data-struck={struck || undefined}>
                                <div className="flex items-center gap-2 text-meta text-text-muted">
                                    {c.Kind === 'conclusion' && <span className="eyebrow text-success">{tCases('journal_conclusion')}</span>}
                                    <span className="font-medium text-text-secondary">{author}</span>
                                    <span className="tabular-nums">{timestamp(c.CreatedAt)}</span>
                                    {menu.length > 0 && (
                                        <span className="ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                            <RecordMenu recordName={t('note_from', { date: timestamp(c.CreatedAt) })} items={menu} />
                                        </span>
                                    )}
                                </div>
                                <p className={cx('m-0 whitespace-pre-wrap text-sm', struck ? 'text-text-muted line-through' : 'text-text')}>
                                    {struck && <span className="sr-only">{tCases('journal_struck_sr')} </span>}
                                    {c.Body}
                                    {c.citationLabel && (
                                        <button type="button" onClick={(e) => { void cd.openCommentCitation(c, e.currentTarget); }}
                                            className="ml-1.5 inline-flex items-center align-middle font-mono text-xs px-1.5 rounded bg-evidence-soft text-evidence cursor-pointer hover:underline focus-ring">
                                            {c.citationLabel}
                                        </button>
                                    )}
                                </p>
                                {struck && <p className="m-0 text-meta text-text-muted">{struckLine(c)}</p>}
                                {filedNames.length > 0 && <p className="m-0 text-meta text-text-muted">{t('filed_under')} · {filedNames.join(', ')}</p>}
                                {striking?.id === c.Id && (
                                    <form className={cx('rounded-card', 'grid gap-2 border border-border bg-card-alt p-3')}
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            setBusy(true);
                                            const ok = await cd.setNoteStruck(c, true, striking.reason);
                                            setBusy(false);
                                            if (ok) setStriking(null);
                                        }}>
                                        <label className="grid gap-1 text-sm text-text">
                                            {t('strike_why')}
                                            <input autoFocus maxLength={500} value={striking.reason} onChange={(e) => setStriking({ id: c.Id, reason: e.target.value })}
                                                onKeyDown={(e) => { if (e.key === 'Escape') setStriking(null); }} className={fieldClass('sm')} />
                                        </label>
                                        <p className="m-0 text-meta text-text-muted">{t('strike_keeps')}</p>
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setStriking(null)} disabled={busy}>{t('cancel')}</Button>
                                            <Button type="submit" variant="outline" size="sm" disabled={busy}>{tCases('journal_strike')}</Button>
                                        </div>
                                    </form>
                                )}
                                {c.media && (
                                    <MediaImg mediaId={c.media.Id} contentType={c.media.ContentType} treeId={cd.activeTreeId} width={320} alt={c.media.Title || t('photo')}
                                        className={cx('max-w-[16rem] rounded-btn object-cover', struck && 'opacity-50 grayscale')} />
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}
