'use client';

import { useLocale } from 'next-intl';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { formatDateForDisplay } from '@/lib/date-utils';

/** A photo's date (#802), formatted for the reader. Render it only when there is one. */
export function PhotoDateText({ date }: { date: string }) {
    const locale = useLocale();
    const words = useDateQualifierWords();
    return <>{formatDateForDisplay(date, locale, words)}</>;
}
