import { isDatePhrase } from '@/lib/date-qualifiers';
import { dateInterval } from '@/lib/date-intervals';

/**
 * A stored date that is neither a date the checks can read nor a GEDCOM date
 * phrase. Phrases (`(…)`) are prose by design and don't count. Data checks list
 * these as `unreadable_date`; a GEDCOM import counts them in its summary (#39).
 */
export function isUnreadableDate(date: string | null | undefined): date is string {
    return Boolean(date?.trim()) && dateInterval(date as string) === null && !isDatePhrase(date as string);
}
