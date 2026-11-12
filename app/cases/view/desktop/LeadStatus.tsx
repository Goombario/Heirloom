'use client';

import { useTranslations } from 'next-intl';
import { cx } from '@/app/components/ui';
import type { LeadStatus } from '@/lib/cases/lead-status';

/**
 * A lead's status as the rail's dot and the lead's chip (#58). Settled is the
 * success green; In progress and Waiting the orange warning tone (Waiting a dashed
 * ring); To search a hollow ring. Status is never told by colour alone: the word
 * always sits beside it.
 */
const DOT: Record<LeadStatus, string> = {
    settled: 'bg-success',
    in_progress: 'bg-warning-text',
    waiting: 'border-2 border-dashed border-warning-text',
    to_search: 'border-[1.5px] border-text-muted',
};

const CHIP: Record<LeadStatus, string> = {
    settled: 'bg-success-bg text-success',
    in_progress: 'bg-warning-bg text-warning-text',
    waiting: 'bg-warning-bg text-warning-text',
    to_search: 'bg-surface-2 text-text-secondary',
};

export function LeadStatusDot({ status, className }: { status: LeadStatus; className?: string }) {
    return <span aria-hidden="true" className={cx('inline-block w-[9px] h-[9px] rounded-full box-border shrink-0', DOT[status], className)} />;
}

export function LeadStatusChip({ status }: { status: LeadStatus }) {
    const t = useTranslations('caseResearch');
    return (
        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', CHIP[status])}>
            {t(`status_${status}`)}
        </span>
    );
}
