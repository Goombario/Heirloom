'use client';

import React, { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, DialogActions, fieldClass } from '@/app/components/ui';
import { Trash2, AlertTriangle, Info } from '@/lib/icons';

interface ConfirmDialogProps {
    open: boolean;
    variant: 'calm' | 'type-to-confirm';
    tone?: 'danger' | 'default';
    title: string;
    body: React.ReactNode;
    bullets?: string[];
    /** Optional amber warning callout (calm variant) — alert-triangle + warning tokens. */
    warning?: string;
    confirmLabel: string;
    cancelLabel?: string;
    /** Required when variant === 'type-to-confirm'. Case-sensitive exact match. */
    confirmPhrase?: string;
    busy?: boolean;
    /** When true, portals the underlying Modal above stacking contexts (z-80).
     *  Default false — all existing callers are unaffected. */
    elevated?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

/** Inner component — only mounted while open, so typed state resets automatically on close. */
function ConfirmDialogInner({
    variant,
    tone = 'default',
    title,
    body,
    bullets,
    warning,
    confirmLabel,
    cancelLabel,
    confirmPhrase,
    busy = false,
    elevated = false,
    onConfirm,
    onCancel,
}: Omit<ConfirmDialogProps, 'open'>) {
    const tc = useTranslations('common');
    const [typed, setTyped] = useState('');
    const titleId = useId();

    const needsPhrase = variant === 'type-to-confirm';
    const phraseOk = !needsPhrase || typed === confirmPhrase;
    const confirmDisabled = busy || !phraseOk;
    const confirmVariant = tone === 'danger' ? 'danger' : 'primary';

    if (variant === 'calm') {
        const Icon = tone === 'danger' ? Trash2 : Info;
        return (
            <Modal open onClose={onCancel} size="sm" disableClose={busy} labelledBy={titleId} elevated={elevated}>
                <div className="bg-card rounded-2xl shadow-xl p-6 text-center">
                    <div className="w-14 h-14 rounded-full bg-error-bg mx-auto mb-4 flex items-center justify-center">
                        <Icon className={`w-6 h-6 ${tone === 'danger' ? 'text-error' : 'text-text-muted'}`} aria-hidden="true" />
                    </div>
                    <h3 id={titleId} className="serif text-xl font-semibold text-text mb-2">{title}</h3>
                    <div className="text-sm text-text-secondary leading-relaxed mb-6">{body}</div>
                    {bullets && bullets.length > 0 && (
                        <ul className="list-disc list-inside text-text-secondary text-sm text-left mb-6 space-y-1">
                            {bullets.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                    )}
                    {warning && (
                        <div role="alert" className="flex items-start gap-2.5 text-left rounded-lg p-3 mb-6 bg-warning-bg border border-warning-text/30">
                            <AlertTriangle className="w-4.5 h-4.5 shrink-0 mt-px text-warning-text" aria-hidden="true" />
                            <span className="text-sm text-warning-text leading-relaxed">{warning}</span>
                        </div>
                    )}
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1 justify-center">
                            {cancelLabel ?? tc('cancel')}
                        </Button>
                        <Button variant={confirmVariant} onClick={() => onConfirm()} disabled={confirmDisabled} className="flex-1 justify-center">
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </Modal>
        );
    }

    // type-to-confirm
    return (
        <Modal open onClose={onCancel} size="sm" disableClose={busy} labelledBy={titleId} elevated={elevated}>
            <div className="bg-card rounded-2xl shadow-xl overflow-hidden">
                <div className="p-5 border-b border-border flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-error-bg flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-[18px] h-[18px] text-error" aria-hidden="true" />
                    </div>
                    <h3 id={titleId} className="serif text-lg font-semibold text-text">{title}</h3>
                </div>
                <div className="p-5">
                    <div role="alert" className="bg-error-bg border-l-[3px] border-error rounded-md p-3 text-sm text-error mb-4">
                        {body}
                        {bullets && bullets.length > 0 && (
                            <ul className="list-disc list-inside mt-2 space-y-1">
                                {bullets.map((b) => <li key={b}>{b}</li>)}
                            </ul>
                        )}
                    </div>
                    <label className="block text-sm text-text-secondary mb-2">
                        {tc('type_to_confirm', { phrase: confirmPhrase ?? '' })}
                    </label>
                    <input
                        type="text"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={confirmPhrase}
                        aria-label={tc('type_to_confirm', { phrase: confirmPhrase ?? '' })}
                        className={`${fieldClass()} font-mono`}
                    />
                </div>
                <DialogActions>
                    <Button variant="outline" onClick={onCancel} disabled={busy}>
                        {cancelLabel ?? tc('cancel')}
                    </Button>
                    <Button variant={confirmVariant} onClick={() => onConfirm()} disabled={confirmDisabled}>
                        {confirmLabel}
                    </Button>
                </DialogActions>
            </div>
        </Modal>
    );
}

export default function ConfirmDialog({ open, ...rest }: ConfirmDialogProps) {
    if (!open) return null;
    return <ConfirmDialogInner {...rest} />;
}
