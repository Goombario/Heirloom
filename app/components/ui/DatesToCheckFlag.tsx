'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from '@/lib/icons';
import { cx } from './cx';

/** The round "!" that leads a Data checks flag or mark. Decorative: the words carry it. */
export function WarningDot() {
    return (
        <span aria-hidden="true" className="inline-grid place-items-center w-[18px] h-[18px] shrink-0 rounded-full bg-warning-text text-warning-bg text-xs font-bold leading-none">!</span>
    );
}

/**
 * The shared "dates to check" flag (#833, #835): a static warning pill with the
 * count, then an ink "Review ›" link to the Data checks page. The pill isn't
 * clickable, because navigation in this app is an ink link. On a dark island
 * (the family hero) it takes the island's dark warning pair in both themes.
 */
export function DatesToCheckFlag({ count, href, className }: { count: number; href: string; className?: string }) {
    const t = useTranslations('dataChecks');
    if (count <= 0) return null;
    return (
        <span className={cx('inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5', className)}>
            <span className="inline-flex items-center gap-1.5 min-h-6 rounded-full border border-warning-border bg-warning-bg text-warning-text py-px pl-[3px] pr-2.5 text-meta font-semibold whitespace-nowrap">
                <WarningDot />
                {t('flag_count', { count })}
            </span>
            <ReviewLink href={href} label={t('flag_review_label', { count })} />
        </span>
    );
}

/**
 * The ink "Review ›" link that leaves a count for the page that lists it: the
 * flag's, and the import report's duplicates line (#843). `label` names what's
 * reviewed, since "Review" alone is ambiguous out of context.
 */
export function ReviewLink({ href, label }: { href: string; label: string }) {
    const t = useTranslations('dataChecks');
    return (
        <Link href={href} aria-label={label}
            className="inline-flex items-center gap-0.5 min-h-6 text-sm text-link hover:underline whitespace-nowrap">
            {t('flag_review')}
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
    );
}
