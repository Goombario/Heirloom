'use client';

import { useTranslations } from 'next-intl';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import type { RecentPerson } from '@/lib/data/types';
import { formatAction } from './formatAction';

/** A person's last change as "Birth date updated" and "2 hours ago", for both homes. */
export function useChangeParts() {
    const t = useTranslations('home');
    const tAudit = useTranslations('audit');
    const { activityTime } = useTimestamp();
    return (change: RecentPerson['lastChange']) => {
        // The change words are made for mid-sentence ("added to tree"); this line starts with them.
        const words = formatAction(change, t, tAudit);
        return { change: words.charAt(0).toLocaleUpperCase() + words.slice(1), time: activityTime(change.CreatedAt) };
    };
}

/** "Birth date updated · 2 hours ago": the change and its time as one line. */
export function useChangeLine() {
    const t = useTranslations('home');
    const parts = useChangeParts();
    return (change: RecentPerson['lastChange']) => t('mobile_change_when', parts(change));
}
