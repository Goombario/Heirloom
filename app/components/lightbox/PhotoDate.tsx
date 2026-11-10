'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import DateInput from '@/app/components/DateInput';
import { PhotoDateText } from '@/app/components/media/PhotoDateText';

/** When a photo was taken, under its title in the lightbox rail (#802). */
export function PhotoDateLine({ date, className = '' }: { date: string | null | undefined; className?: string }) {
    if (!date) return null;
    return <div className={`date-mono text-meta text-white/60 ${className}`}><PhotoDateText date={date} /></div>;
}

/** The date field in the lightbox's Edit details form (#802). */
export function PhotoDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const t = useTranslations('mediaLightbox');
    const id = useId();
    return (
        <div>
            <label htmlFor={id} className="block text-xs uppercase tracking-wide text-white/50 mb-1.5">{t('date_label')}</label>
            <DateInput id={id} value={value} onChange={onChange} stacked />
        </div>
    );
}
