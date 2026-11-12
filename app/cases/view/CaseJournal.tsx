/* eslint-disable @next/next/no-img-element */
'use client';

import { useState } from 'react';
import { Paperclip, Quote, RotateCcw, Strikethrough, X } from '@/lib/icons';
import { Button, SectionHeader, fieldClass } from '@/app/components/ui';
import MediaImg from '@/app/components/MediaImg';
import type { CaseComment } from '@/lib/db/schema';
import type { CaseDetailState } from './useCaseDetail';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import CaseGuidedStart from './CaseGuidedStart';
import { loggedEntryText, writtenEntries } from './case-detail-helpers';

/**
 * Research-journal main column: composer (Attach + Cite + Add entry) and a
 * newest-first timeline of entries. Case-level Cite (same as the rail's).
 */
export default function CaseJournal({ cd, bare = false }: { cd: CaseDetailState; bare?: boolean }) {
    const { timestamp } = useTimestamp();
    const {
        caseData, canEdit, caseReady, isDraft, activeTreeId, commentBody, setCommentBody,
        postComment, postingComment, journalFile, setJournalFile,
        journalFilePreview, setJournalFilePreview,
        pendingCommentCite, setPendingCommentCite, setShowComposerCite, t,
    } = cd;
    // The note whose strike-out form is open, with its reason (#1251).
    const [striking, setStriking] = useState<{ id: number; reason: string } | null>(null);
    const [busy, setBusy] = useState(false);

    if (!caseData) return null;
    // "Struck out by Ada · 3 Nov 2026, 14:02 · wrong Ada" (#1251).
    const struckLine = (c: CaseComment) => {
        const when = timestamp(c.StruckAt ?? '');
        const head = c.StruckByName ? t('journal_struck_by', { name: c.StruckByName, date: when }) : t('journal_struck', { date: when });
        return c.StruckReason ? `${head} · ${c.StruckReason}` : head;
    };
    const comments = caseData.comments;
    const written = writtenEntries(comments);
    const showGuided = written.length === 0 && canEdit;
    const Composer = canEdit ? (
        <div className={`border border-border rounded-[10px] p-3 mb-5 bg-card-alt focus-ring-within transition-shadow ${!caseReady ? 'opacity-60' : ''}`}>
                    <textarea
                        id="case-composer"
                        value={commentBody}
                        onChange={e => setCommentBody(e.target.value)}
                        placeholder={t('composer_placeholder')}
                        rows={2}
                        disabled={!caseReady}
                        className="w-full border-0 outline-none resize-none bg-transparent text-[13.5px] text-text disabled:cursor-not-allowed"
                        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); }}
                    />
                    <div className="flex gap-2 items-center mt-2 border-t border-border-light pt-2.5">
                        <label className="inline-flex items-center gap-1.5 text-xs text-text-2 border border-border rounded-md px-2.5 py-1 bg-card cursor-pointer hover:bg-surface-2 transition-colors">
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={!caseReady}
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (!f) return;
                                    setJournalFile(f);
                                    setJournalFilePreview(URL.createObjectURL(f));
                                    e.target.value = '';
                                }}
                            />
                            <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />{t('attach')}
                        </label>
                        {!isDraft && (
                            <button
                                type="button"
                                onClick={() => setShowComposerCite(true)}
                                className="inline-flex items-center gap-1.5 text-xs text-text-2 border border-border rounded-md px-2.5 py-1 bg-card cursor-pointer hover:bg-surface-2 transition-colors focus-ring"
                            >
                                <Quote className="w-3.5 h-3.5" aria-hidden="true" />{t('cite')}
                            </button>
                        )}
                        <Button variant="primary" size="sm" className="ml-auto" onClick={() => { void postComment(); }} disabled={!caseReady || postingComment || !commentBody.trim()}>
                            {postingComment ? t('posting') : t('add_entry')}
                        </Button>
                    </div>
                    {pendingCommentCite && (
                        <div className="flex items-center gap-1.5 mt-2">
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 h-[18px] rounded bg-evidence-soft text-evidence">
                                <Quote className="w-2.5 h-2.5" aria-hidden="true" />{pendingCommentCite.sourceTitle ?? pendingCommentCite.newSource?.Title}
                            </span>
                            <button type="button" onClick={() => setPendingCommentCite(null)} className="text-text-muted hover:text-error inline-flex cursor-pointer" aria-label={cd.tCommon('remove')}>
                                <X className="w-3 h-3" aria-hidden="true" />
                            </button>
                        </div>
                    )}
                    {journalFile && (
                        <div className="flex items-center gap-1 text-xs text-text-secondary mt-2">
                            {journalFile.name}
                            <button type="button" onClick={() => { setJournalFile(null); setJournalFilePreview(null); }} className="hover:text-error ml-1 cursor-pointer" aria-label={cd.tCommon('remove')}>×</button>
                        </div>
                    )}
                    {journalFilePreview && (
                        <img src={journalFilePreview} className="max-h-24 rounded-lg object-cover mt-2" alt={t('section_media')} />
                    )}
                </div>
            ) : null;

    return (
        <div className={bare ? 'min-w-0' : 'bg-card border border-border rounded-2xl shadow-sm p-5 md:p-6 min-w-0'}>
            {!bare && <SectionHeader title={t('research_journal')} count={written.length} />}

            {bare && showGuided && <CaseGuidedStart cd={cd} />}
            {Composer}
            {!bare && showGuided && <CaseGuidedStart cd={cd} />}
            {comments.length === 0 && !canEdit && <p className="text-text-muted text-sm">{t('no_journal_entries')}</p>}
            {comments.length > 0 && (
                <div className="relative pl-5">
                    {/* vertical timeline rail */}
                    <div className="absolute left-[3px] top-1.5 bottom-2 w-0.5 bg-border" aria-hidden="true" />
                    {[...comments].reverse().map((comment: CaseComment, i: number) => {
                        const recent = i === 0; // newest entry gets the ink dot
                        const author = comment.UserName || comment.UserEmail || `#${comment.UserId}`;
                        const logged = loggedEntryText(comment, t);
                        if (logged != null) {
                            // A line the app logged (#801, #58): one quiet line, no dot fill.
                            return (
                                <div key={comment.Id} className="relative mb-4 last:mb-0" data-entry-kind="status">
                                    <span className="absolute -left-5 top-1 w-2 h-2 rounded-full border-2 border-border bg-card" aria-hidden="true" />
                                    <p className="m-0 text-xs text-text-muted">
                                        <span className="font-medium text-text-2">{logged}</span>
                                        {' · '}<span className="tabular-nums">{timestamp(comment.CreatedAt)}</span>
                                        {' · '}{author}
                                    </p>
                                </div>
                            );
                        }
                        const conclusion = comment.Kind === 'conclusion';
                        const struck = comment.StruckAt != null;
                        return (
                            <div key={comment.Id} className="relative mb-5 last:mb-0" data-struck={struck || undefined}>
                                <span
                                    className={`absolute -left-5 top-1 w-2 h-2 rounded-full ${recent ? 'bg-link shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-link)_20%,var(--color-card))]' : 'bg-border shadow-[0_0_0_3px_var(--color-surface)]'}`}
                                    aria-hidden="true"
                                />
                                <div className="flex items-baseline gap-2 mb-1">
                                    {conclusion && <span className="eyebrow text-success">{t('journal_conclusion')}</span>}
                                    <span className="text-xs text-text-muted tabular-nums">{timestamp(comment.CreatedAt)}</span>
                                    <span className="text-xs text-text-muted">· {author}</span>
                                    {cd.canStrikeNote(comment) && striking?.id !== comment.Id && (
                                        <span className="ml-auto">
                                            {struck ? (
                                                <Button variant="ghost" size="sm" className="!h-6 !px-1.5 text-xs" disabled={busy}
                                                    aria-label={t('journal_unstrike_label', { date: timestamp(comment.CreatedAt) })}
                                                    onClick={async () => { setBusy(true); await cd.setNoteStruck(comment, false); setBusy(false); }}>
                                                    <RotateCcw className="w-3 h-3" aria-hidden="true" />{t('journal_unstrike')}
                                                </Button>
                                            ) : (
                                                <Button variant="ghost" size="sm" className="!h-6 !px-1.5 text-xs"
                                                    aria-label={t('journal_strike_label', { date: timestamp(comment.CreatedAt) })}
                                                    onClick={() => setStriking({ id: comment.Id, reason: '' })}>
                                                    <Strikethrough className="w-3 h-3" aria-hidden="true" />{t('journal_strike')}
                                                </Button>
                                            )}
                                        </span>
                                    )}
                                </div>
                                <p className={`text-[13.5px] leading-relaxed whitespace-pre-wrap m-0 ${struck ? 'text-text-muted line-through decoration-text-muted' : conclusion ? 'text-text border-l-2 border-success pl-3' : 'text-text-2'}`}>
                                    {struck && <span className="sr-only">{t('journal_struck_sr')} </span>}
                                    {comment.Body}
                                    {comment.citationLabel && (
                                        // Opens the entry's citation in the shared preview (#918).
                                        <button
                                            type="button"
                                            onClick={(e) => { void cd.openCommentCitation(comment, e.currentTarget); }}
                                            className={`ml-1.5 inline-flex items-center align-middle font-mono text-[10px] px-1.5 h-[17px] rounded bg-evidence-soft text-evidence cursor-pointer hover:underline focus-ring ${struck ? 'opacity-60' : ''}`}
                                        >
                                            {comment.citationLabel}
                                        </button>
                                    )}
                                </p>
                                {struck && (
                                    <p className="m-0 mt-1 text-xs text-text-muted" data-testid="struck-line">
                                        {struckLine(comment)}
                                    </p>
                                )}
                                {striking?.id === comment.Id && (
                                    <div className="mt-2 border border-border rounded-lg p-3 bg-card-alt">
                                        <p className="m-0 mb-2 text-xs text-text-2">{t('journal_strike_body')}</p>
                                        <label htmlFor={`strike-reason-${comment.Id}`} className="block text-xs font-medium text-text-2 mb-1">{t('journal_strike_reason')}</label>
                                        <input
                                            id={`strike-reason-${comment.Id}`}
                                            type="text"
                                            maxLength={500}
                                            value={striking.reason}
                                            onChange={(e) => setStriking({ id: comment.Id, reason: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Escape') setStriking(null); }}
                                            placeholder={t('journal_strike_reason_placeholder')}
                                            autoFocus
                                            className={`${fieldClass()} text-sm`}
                                        />
                                        <div className="flex justify-end gap-2 mt-2">
                                            <Button variant="outline" size="sm" onClick={() => setStriking(null)} disabled={busy}>{cd.tCommon('cancel')}</Button>
                                            <Button variant="primary" size="sm" disabled={busy}
                                                onClick={async () => {
                                                    setBusy(true);
                                                    const ok = await cd.setNoteStruck(comment, true, striking.reason);
                                                    setBusy(false);
                                                    if (ok) setStriking(null);
                                                }}>
                                                {t('journal_strike')}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {comment.media && (
                                    <MediaImg
                                        mediaId={comment.media.Id}
                                        contentType={comment.media.ContentType}
                                        treeId={activeTreeId}
                                        alt={comment.media.Title || t('section_media')}
                                        className={`mt-2 max-w-[16rem] rounded-lg object-cover ${struck ? 'opacity-50 grayscale' : ''}`}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
