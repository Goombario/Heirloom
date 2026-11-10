'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import DateInput from '@/app/components/DateInput';
import { Button, fieldClass } from '@/app/components/ui';
import { escapeToCancel } from '@/app/hooks/useEditorFocusReturn';
import { useErrorToast } from '@/app/components/useErrorToast';
import { errorToastKey } from '@/lib/utils/data-error';

interface InlineDateEditorProps {
    /** The field's visible label, which says whose date it is: "Mary Ellen died". */
    label: string;
    /** The stored date. */
    value: string;
    /** Store the new date. A throw keeps the editor open with the error. */
    onSave: (date: string) => Promise<void>;
    onCancel: () => void;
    /** The date as typed, or null while it can't be read, for a live `hint` (#832). */
    onDraft?: (date: string | null) => void;
    /** One line under the field, such as whether the date clears a problem. */
    hint?: ReactNode;
}

/**
 * Edit one stored date in place (#832): the app's `DateInput`, with Save and
 * Cancel beside it that wrap below on a narrow pane. It's the date-only
 * counterpart of `InlineEventEditor`, for a fix that is only ever one date, so
 * it has no type, place, note or media fields. Enter saves the date as typed,
 * without waiting for the box to blur, and Escape cancels.
 */
export default function InlineDateEditor({ label, value, onSave, onCancel, onDraft, hint }: InlineDateEditorProps) {
    const tc = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();
    const id = useId();
    const inputRef = useRef<HTMLDivElement>(null);
    const [committed, setCommitted] = useState(value);
    // What Save would store: the draft as typed, or null while it can't be read.
    const [current, setCurrent] = useState<string | null>(value);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Opening puts focus in the date box, not the qualifier: typing is the fix.
    useEffect(() => { inputRef.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus(); }, []);

    const draft = (next: string | null) => {
        setCurrent(next);
        setError(null);
        onDraft?.(next);
    };
    const canSave = !saving && current != null && current.trim() !== '' && current !== value;

    const submit = async () => {
        if (current == null) {
            // Unreadable text: leaving the box shows the "keep as written" choice (#475).
            (document.activeElement as HTMLElement | null)?.blur();
            return;
        }
        if (!canSave) return;
        setSaving(true);
        try {
            await onSave(current);
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            setError(tc(errorToastKey(e)));
            setSaving(false);
        }
    };

    return (
        <form className="flex flex-col gap-1.5" noValidate
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
            onKeyDown={escapeToCancel(() => { if (!saving) onCancel(); })}>
            <label htmlFor={id} className="text-meta font-semibold text-text-secondary">{label}</label>
            <div className="flex flex-wrap items-start gap-2">
                {/* The hint sits in the field's column, so on a narrow pane it stays
                    directly under the date, above the wrapped Save/Cancel (#843). */}
                <div className="flex-[1_1_240px] min-w-0 flex flex-col gap-1.5">
                    <div ref={inputRef}>
                        <DateInput id={id} value={committed} className={fieldClass('sm')}
                            onChange={(v) => { setCommitted(v); draft(v); }} onDraft={draft} />
                    </div>
                    {hint}
                </div>
                <div className="flex items-center gap-2">
                    <Button type="submit" variant="primary" size="sm" disabled={!canSave && current != null}>
                        {saving ? tc('saving') : tc('save')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>{tc('cancel')}</Button>
                </div>
            </div>
            {error && <p role="alert" className="m-0 text-meta text-error">{error}</p>}
        </form>
    );
}
