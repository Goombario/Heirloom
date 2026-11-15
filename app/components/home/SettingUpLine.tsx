'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from '@/lib/icons';

/** The home band's meta line while a first visit creates the database. */
export function SettingUpLine() {
    const t = useTranslations('home');
    return (
        <span role="status" className="inline-flex items-center gap-1.5 align-middle font-sans">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
            {t('setting_up')}
        </span>
    );
}
