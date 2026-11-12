'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, FormDialog, SegmentedControl, fieldClass } from '@/app/components/ui';
import type { CaseRequest, CaseRequestState } from '@/lib/db/schema';

/**
 * Log the reply (#58): they sent it, they have nothing, or it is still waiting,
 * with a note. A reply that sent the record is added from Find a record.
 */
export function ReplyDialog({ request, onSave, onClose }: {
    request: CaseRequest;
    onSave: (reply: { state: CaseRequestState; note: string | null }) => Promise<boolean>;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const tc = useTranslations('common');
    const [state, setState] = useState<CaseRequestState>('received');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const save = async () => {
        setBusy(true);
        const ok = await onSave({ state, note: note.trim() || null });
        setBusy(false);
        if (ok) onClose();
    };

    return (
        <FormDialog
            open
            onClose={onClose}
            title={t('log_reply')}
            subtitle={request.Holder ? t('reply_from', { asked: request.AskedFor, holder: request.Holder }) : request.AskedFor}
            dirty={note.trim() !== ''}
            busy={busy}
            footer={(requestClose) => (
                <>
                    <Button variant="outline" onClick={requestClose} disabled={busy}>{tc('cancel')}</Button>
                    <Button onClick={() => { void save(); }} disabled={busy}>{t('save_reply')}</Button>
                </>
            )}
        >
            <div className="grid gap-5">
                <SegmentedControl
                    aria-label={t('reply_state')}
                    value={state}
                    onChange={(v) => setState(v as CaseRequestState)}
                    options={[
                        { v: 'received', l: t('reply_received') },
                        { v: 'nothing', l: t('reply_nothing') },
                        { v: 'waiting', l: t('reply_waiting') },
                    ]}
                />
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('reply_note')}
                    <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass()} resize-y`} />
                </label>
                {state === 'received' && <p className="m-0 text-meta text-text-muted">{t('reply_received_hint')}</p>}
            </div>
        </FormDialog>
    );
}
