'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, DialogActions, DialogHeader, fieldClass } from '@/app/components/ui';

/**
 * "What did you conclude?" — the prompt that closing a case opens (#801, CS-2).
 * The answer becomes the case's final journal entry; the service rejects a close
 * without one. Cancel leaves the status as it was. Mounted only while open, so
 * the draft resets each time.
 */
export default function CloseCaseDialog({ busy, onConfirm, onCancel }: {
    busy: boolean;
    onConfirm: (conclusion: string) => void | Promise<void>;
    onCancel: () => void;
}) {
    const t = useTranslations('cases');
    const tCommon = useTranslations('common');
    const [conclusion, setConclusion] = useState('');
    const titleId = useId();
    const fieldId = useId();
    const hintId = useId();
    const ready = conclusion.trim() !== '' && !busy;

    return (
        <Modal open onClose={onCancel} size="sm" disableClose={busy} labelledBy={titleId} elevated>
            <form
                className="bg-card rounded-2xl shadow-xl overflow-hidden"
                onSubmit={(e) => { e.preventDefault(); if (ready) void onConfirm(conclusion.trim()); }}
            >
                <div className="p-5">
                    <DialogHeader title={t('close_case_title')} titleId={titleId} className="mb-4" />
                    <label htmlFor={fieldId} className="block text-sm font-medium text-text-secondary mb-1.5">
                        {t('close_case_question')}
                    </label>
                    <textarea
                        id={fieldId}
                        autoFocus
                        rows={4}
                        value={conclusion}
                        onChange={(e) => setConclusion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready) void onConfirm(conclusion.trim()); }}
                        aria-describedby={hintId}
                        className={`${fieldClass()} resize-y`}
                    />
                    <p id={hintId} className="text-xs text-text-muted mt-1.5 mb-0">{t('close_case_hint')}</p>
                </div>
                <DialogActions>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{tCommon('cancel')}</Button>
                    <Button type="submit" variant="primary" disabled={!ready}>{t('close_case_confirm')}</Button>
                </DialogActions>
            </form>
        </Modal>
    );
}
