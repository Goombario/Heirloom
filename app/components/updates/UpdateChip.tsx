'use client';

import { useTranslations } from 'next-intl';
import { useUpdates } from './UpdateProvider';

/**
 * "Update to 1.4.0" in the desktop top bar (#24): after Later, it stays until the
 * app is updated and opens the same dialog. Nothing shows without a newer release.
 */
export default function UpdateChip() {
    const t = useTranslations('updates');
    const { available, openDialog } = useUpdates();
    if (!available) return null;
    const label = t('chip', { version: available.version });
    return (
        <button
            type="button"
            onClick={openDialog}
            title={label}
            className="h-9 px-3 flex items-center gap-2 rounded-lg text-sm whitespace-nowrap transition-colors text-white/90 bg-white/10 hover:bg-white/20 focus-ring"
        >
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-nav-warning" />
            {label}
        </button>
    );
}
