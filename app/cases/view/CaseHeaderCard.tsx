'use client';

import { useState } from 'react';
import { Trash2, Loader2, CheckCircle2 } from '@/lib/icons';
import { DetailHero, HeroEditButton, Button } from '@/app/components/ui';
import { CaseStatus } from '../CaseStatus';
import type { CaseDetailState } from './useCaseDetail';
import CloseCaseDialog from './CloseCaseDialog';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { useReturnFocus } from '@/app/hooks/useReturnFocus';

const STATUSES = ['in_progress', 'on_hold', 'closed'] as const;

/**
 * Anchored header card for the case-detail surface (redesign direction A).
 * View mode shows status badge + meta + serif title + italic description with
 * an Edit affordance; edit mode consolidates status + title + description +
 * delete into one Save/Cancel form (replaces the old per-field inline editing).
 */
export default function CaseHeaderCard({ cd }: { cd: CaseDetailState }) {
    const { timestamp } = useTimestamp();
    const { caseData, canDelete, patchCase, saving, setShowDeleteConfirm, activePermission, t,
        composing, finishComposing, titleValue, setTitleValue, descValue, setDescValue, saveState } = cd;
    // Managing (edit/reopen) is allowed for any non-viewer, INCLUDING closed
    // cases — so an owner/editor can reopen a closed case via the status
    // control (the old rail exposed status pills on closed cases for this).
    const canManage = activePermission !== 'view';
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [dTitle, setDTitle] = useState('');
    const [dDesc, setDDesc] = useState('');
    const [dStatus, setDStatus] = useState('in_progress');
    // Choosing Closed on an open case asks for its conclusion first (#801).
    const [askConclusion, setAskConclusion] = useState(false);
    // Leaving edit mode (Save, Cancel or Escape) hands focus back to Edit (#690).
    const editButtonRef = useReturnFocus(mode === 'edit');

    if (!caseData) return null;

    // A new case stays in this form after the autosave creates it, so the fields
    // never vanish mid-typing (#912); leaving the header shows the saved one.
    if (composing) {
        return (
            <DetailHero
                tone="light"
                onBlur={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    void finishComposing();
                }}
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    {/* The draft's only heading: the title is still an input (#731). */}
                    <h1 className="m-0 text-xs font-normal text-text-muted">{t('new_case_label')}</h1>
                    {/* Nothing to report before the first save (#801, CS-4). */}
                    {saveState === 'saving' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-text-2"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />{t('saving')}</span>
                    ) : saveState === 'saved' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="w-3 h-3" aria-hidden="true" />{t('saved')}</span>
                    ) : null}
                </div>
                {/* The title is the question (CS-4): both fields carry visible labels. */}
                <label htmlFor="case-title-input" className="block text-xs font-semibold text-text-2 uppercase tracking-[0.06em] mb-1">{t('field_title_label')}</label>
                <input
                    id="case-title-input"
                    type="text"
                    value={titleValue}
                    onChange={e => setTitleValue(e.target.value)}
                    placeholder={t('title_edit_placeholder')}
                    autoFocus
                    className="w-full title-record bg-transparent border-b-2 border-transparent focus:border-focus outline-none text-text pb-1.5 mb-3 placeholder:text-text-muted transition-colors"
                />
                <label htmlFor="case-desc-input" className="block text-xs font-semibold text-text-2 uppercase tracking-[0.06em] mb-1">{t('field_description_label')}</label>
                <textarea
                    id="case-desc-input"
                    value={descValue}
                    onChange={e => setDescValue(e.target.value)}
                    placeholder={t('desc_edit_placeholder')}
                    rows={2}
                    className="w-full serif italic text-base bg-transparent border-0 border-b-2 border-transparent focus:border-focus outline-none resize-none text-text-2 leading-relaxed transition-colors"
                />
            </DetailHero>
        );
    }

    function startEdit() {
        if (!caseData) return;
        setDTitle(caseData.Title ?? '');
        setDDesc(caseData.Description ?? '');
        setDStatus(caseData.Status);
        setMode('edit');
    }

    async function saveEdit(conclusion?: string) {
        const ok = await patchCase({
            Title: dTitle.trim(),
            Description: dDesc.trim() || null,
            ...(conclusion ? { Status: 'closed', Conclusion: conclusion } : { Status: dStatus }),
        });
        setAskConclusion(false);
        if (ok) setMode('view');
    }

    function pickStatus(s: string) {
        if (s === 'closed' && caseData?.Status !== 'closed') setAskConclusion(true);
        else setDStatus(s);
    }

    const statusLabel = (s: string) => t('status_' + s);

    if (mode === 'edit' && canManage) {
        return (
            <DetailHero
                tone="light"
                onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;
                    e.stopPropagation();
                    setMode('view');
                }}
            >
                <div className="flex items-center justify-between gap-3 mb-3.5 flex-wrap">
                    <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
                        {STATUSES.map((s, i) => {
                            const on = dStatus === s;
                            return (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => pickStatus(s)}
                                    aria-pressed={on}
                                    className={`px-3 py-1.5 cursor-pointer transition-colors focus-ring-inset ${i > 0 ? 'border-l border-border' : ''} ${on ? 'bg-surface-2 text-text font-semibold' : 'text-text-muted hover:bg-surface-2'}`}
                                >
                                    {statusLabel(s)}
                                </button>
                            );
                        })}
                    </div>
                    <span className="text-xs text-text-muted italic">{t('editing_hint')}</span>
                </div>

                <label htmlFor="case-edit-title" className="block text-xs font-semibold text-text-2 uppercase tracking-[0.06em] mb-1.5">{t('field_title_label')}</label>
                <input
                    id="case-edit-title"
                    // Entering edit mode moves focus into the form; Edit unmounts.
                    autoFocus
                    value={dTitle}
                    onChange={e => setDTitle(e.target.value)}
                    placeholder={t('title_edit_placeholder')}
                    className="w-full serif text-[26px] font-semibold border border-border rounded-lg px-3 py-2 text-text mb-3.5 focus-ring"
                />

                <label htmlFor="case-edit-desc" className="block text-xs font-semibold text-text-2 uppercase tracking-[0.06em] mb-1.5">{t('field_description_label')}</label>
                <textarea
                    id="case-edit-desc"
                    value={dDesc}
                    onChange={e => setDDesc(e.target.value)}
                    rows={3}
                    placeholder={t('desc_edit_placeholder')}
                    className="w-full serif text-[15px] italic border border-border rounded-lg px-3 py-2.5 text-text-2 resize-y leading-relaxed focus-ring"
                />

                <div className="flex justify-between items-center mt-4">
                    {canDelete ? (
                        <Button variant="ghost" size="sm" className="text-error" onClick={() => setShowDeleteConfirm(true)}>
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('delete_case')}
                        </Button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setMode('view')}>{cd.tCommon('cancel')}</Button>
                        <Button variant="primary" size="sm" onClick={() => { void saveEdit(); }} disabled={saving || !dTitle.trim()}>{t('save_changes')}</Button>
                    </div>
                </div>
                {askConclusion && (
                    <CloseCaseDialog
                        busy={saving}
                        onConfirm={(conclusion) => saveEdit(conclusion)}
                        onCancel={() => setAskConclusion(false)}
                    />
                )}
            </DetailHero>
        );
    }

    return (
        <DetailHero tone="light">
            <div className="flex justify-between items-start gap-5 flex-wrap">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                        <CaseStatus status={caseData.Status} />
                        <span className="text-xs text-text-muted">
                            {t.rich('opened_meta', { date: timestamp(caseData.CreatedAt), d: (chunks) => <span className="tabular-nums">{chunks}</span> })} · {t.rich('updated_meta', { date: timestamp(caseData.UpdatedAt), d: (chunks) => <span className="tabular-nums">{chunks}</span> })}
                        </span>
                    </div>
                    <h1 className="title-record mb-2 text-text">
                        {caseData.Title || <span className="text-text-muted">{t('untitled')}</span>}
                    </h1>
                    {caseData.Description && (
                        <p className="serif italic text-base text-text-2 leading-relaxed m-0 max-w-[640px]">{caseData.Description}</p>
                    )}
                </div>
                {canManage && (
                    <HeroEditButton ref={editButtonRef} onClick={startEdit} />
                )}
            </div>
        </DetailHero>
    );
}
