'use client';

import { useTranslations } from 'next-intl';
import { cx } from '@/app/components/ui/cx';

const STATUS_CLASS: Record<string, string> = {
    in_progress: 'text-success',
    on_hold: 'text-text-muted',
    closed: 'text-text-muted',
};

/**
 * A case's status: a dot and a word, no box (#767, CL-2). The same treatment on
 * Home, the Cases list and the case header, so a status never reads like the quiet
 * grey topic tags beside it. Green for in progress; on hold and closed are neutral.
 */
export function CaseStatus({ status, className }: { status: string; className?: string }) {
    const t = useTranslations('cases');
    const known = status in STATUS_CLASS;
    return (
        <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', STATUS_CLASS[status] ?? 'text-text-muted', className)}>
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
            {known ? t(`status_${status}`) : status}
        </span>
    );
}
