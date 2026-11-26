'use client';

import { useTranslations } from 'next-intl';
import { Download } from '@/lib/icons';
import { useUpdates } from './UpdateProvider';

/**
 * "Update to 1.4.0" in the desktop top bar (#24): after Later, it stays until the
 * app is updated and opens the same dialog. Below xl it is an icon with the dot, as
 * the backup chip is. Nothing shows without a newer release.
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
            aria-label={label}
            className="relative h-9 w-9 xl:w-auto xl:px-3 flex items-center justify-center gap-2 rounded-lg text-sm whitespace-nowrap transition-colors text-white/90 bg-white/10 hover:bg-white/20 focus-ring"
        >
            <Download className="w-4 h-4 xl:hidden" aria-hidden="true" />
            <span aria-hidden="true" className="absolute top-1 right-1 w-2 h-2 rounded-full bg-nav-warning ring-2 ring-[color:var(--color-nav-bg)] xl:static xl:ring-0" />
            <span className="hidden xl:inline" aria-hidden="true">{label}</span>
        </button>
    );
}
