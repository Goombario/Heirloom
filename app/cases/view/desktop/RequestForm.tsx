'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, SegmentedControl, cx, fieldClass } from '@/app/components/ui';
import { Copy } from '@/lib/icons';
import type { CaseRequestSentBy } from '@/lib/db/schema';
import type { CaseRequestInput } from '@/lib/data/types';

const today = () => new Date().toISOString().slice(0, 10);

/** `date` plus `weeks`, as YYYY-MM-DD; null when either is missing. */
function remindDate(date: string, weeks: number): string | null {
    if (!weeks || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weeks * 7);
    return d.toISOString().slice(0, 10);
}

/**
 * Request it (#58): a record you ask an archive, a parish or a relative for.
 * Heirloom sends nothing; it keeps the request, a reminder, and the case details
 * to copy into their form. Saving puts the lead in Waiting.
 */
export function RequestForm({ details, onSave }: {
    /** The case details to copy into their form, as label and value. */
    details: Array<{ label: string; value: string }>;
    onSave: (input: CaseRequestInput) => Promise<boolean>;
}) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const [askedFor, setAskedFor] = useState('');
    const [holder, setHolder] = useState('');
    const [sentBy, setSentBy] = useState<CaseRequestSentBy>('online');
    const [sentOn, setSentOn] = useState(today);
    const [reference, setReference] = useState('');
    const [weeks, setWeeks] = useState('8');
    const [copied, setCopied] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const ready = askedFor.trim() !== '' && !busy;
    const save = async () => {
        if (!ready) return;
        setBusy(true);
        const ok = await onSave({
            askedFor: askedFor.trim(), holder: holder.trim() || null, sentBy,
            sentOn: sentOn || null, reference: reference.trim() || null,
            remindOn: remindDate(sentOn || today(), Number(weeks)),
        });
        if (!ok) setBusy(false);
    };
    const copy = async (label: string, value: string) => {
        try { await navigator.clipboard.writeText(value); setCopied(label); } catch { setCopied(null); }
    };

    return (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="grid gap-1.5 text-sm text-text-secondary">
                {t('request_asked_for')}
                <input value={askedFor} onChange={(e) => setAskedFor(e.target.value)} maxLength={500} className={fieldClass()} placeholder={t('request_asked_for_hint')} />
            </label>
            <label className="grid gap-1.5 text-sm text-text-secondary">
                {t('request_holder')}
                <input value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={500} className={fieldClass()} placeholder={t('request_holder_hint')} />
            </label>
            <div className="grid gap-1.5 text-sm text-text-secondary">
                <span aria-hidden="true">{t('request_sent_by')}</span>
                <SegmentedControl aria-label={t('request_sent_by')} value={sentBy} onChange={(v) => setSentBy(v as CaseRequestSentBy)} fullWidth
                    options={[{ v: 'online', l: t('sent_online') }, { v: 'email', l: t('sent_email') }, { v: 'post', l: t('sent_post') }, { v: 'in_person', l: t('sent_in_person') }]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('request_sent_on')}
                    <input type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} className={cx(fieldClass(), 'date-mono')} />
                </label>
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('request_reference')}
                    <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={fieldClass()} />
                </label>
            </div>
            <div className="grid gap-1.5 text-sm text-text-secondary">
                <span aria-hidden="true">{t('request_remind')}</span>
                <SegmentedControl aria-label={t('request_remind')} value={weeks} onChange={setWeeks} fullWidth
                    options={[{ v: '4', l: t('weeks', { count: 4 }) }, { v: '8', l: t('weeks', { count: 8 }) }, { v: '12', l: t('weeks', { count: 12 }) }, { v: '0', l: t('remind_none') }]} />
            </div>
            {details.length > 0 && (
                <section aria-labelledby={`${id}-details`} className={cx('rounded-card', 'grid gap-2 border border-border bg-card-alt p-3')}>
                    <h3 id={`${id}-details`} className="m-0 text-sm font-semibold text-text">{t('request_details')}</h3>
                    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-meta">
                        {details.map((d) => (
                            <div key={d.label} className="contents">
                                <dt className="text-text-muted">{d.label}</dt>
                                <dd className="m-0 text-text break-words">{d.value}</dd>
                                <dd className="m-0">
                                    <button type="button" onClick={() => { void copy(d.label, d.value); }} aria-label={t('copy_detail', { label: d.label })}
                                        className="grid place-items-center w-7 h-7 rounded-md bg-transparent border-0 text-text-muted hover:text-text hover:bg-hover-surface cursor-pointer focus-ring">
                                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <span role="status" className="sr-only">{copied ? t('detail_copied', { label: copied }) : ''}</span>
                </section>
            )}
            <div className="flex justify-end border-t border-border pt-3">
                <Button type="submit" disabled={!ready}>{t('save_request')}</Button>
            </div>
        </form>
    );
}
