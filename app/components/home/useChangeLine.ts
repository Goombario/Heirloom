'use client';

import { useTranslations } from 'next-intl';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { useAuditFieldFormat } from '@/app/audit/useAuditFieldFormat';
import type { RecentPerson } from '@/lib/data/types';
import { formatAction, type CurrentPerson } from './formatAction';

/** A person's last change as "Birth date changed to 12 Mar 1902" and "2 hours ago", for both homes. */
export function useChangeParts() {
    const t = useTranslations('home');
    const tAudit = useTranslations('audit');
    const { value } = useAuditFieldFormat();
    const { activityTime } = useTimestamp();
    return (change: RecentPerson['lastChange'], person?: CurrentPerson | null) => {
        // The change words are made for mid-sentence ("added to tree"); this line starts with them.
        const words = formatAction(change, t, tAudit, { value, person });
        return { change: words.charAt(0).toLocaleUpperCase() + words.slice(1), time: activityTime(change.CreatedAt) };
    };
}

/** "Birth date changed to 12 Mar 1902 · 2 hours ago": the change and its time as one line. */
export function useChangeLine() {
    const t = useTranslations('home');
    const parts = useChangeParts();
    return (change: RecentPerson['lastChange'], person?: CurrentPerson | null) => t('mobile_change_when', parts(change, person));
}
