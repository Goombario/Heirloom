'use client';

import type { ReactNode } from 'react';
import { MapPin } from '@/lib/icons';
import { formatDateForDisplay, formatYearOrEmpty, parseDateComponents, sortableYear } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import GuardedLink from '@/app/components/GuardedLink';
import type { LedgerItem } from '@/app/components/ui';

/**
 * The ledger's date column (v1.1 locked boards): the year, then the day and month
 * under it. An exact "Mar 14, 1868" splits into "Mar 14" under "1868"; qualified and
 * year-only dates show their year alone; no date is "?".
 */
export function useLedgerDate(language: string) {
  const dateWords = useDateQualifierWords();
  return (date: string | null | undefined): Pick<LedgerItem, 'year' | 'day' | 'sortYear'> => {
    if (!date) return { year: '?', sortYear: null };
    const c = parseDateComponents(date);
    const year = formatYearOrEmpty(date) || '?';
    const day = c && c.precision !== 'year'
      ? formatDateForDisplay(date, language, dateWords).replace(String(c.year), '').replace(/[\s,]+$/, '').trim()
      : null;
    return { year, day, sortYear: sortableYear(date) };
  };
}

/**
 * The ledger's place lines, built in row order: a link to the place's page (which has
 * its map), or plain text when the row before named the same place, as on the board.
 */
export function ledgerPlaces() {
  let previous: string | null = null;
  return function placeLine(place: string | null | undefined, placeId: number | null | undefined): ReactNode {
    if (!place) return null;
    const repeat = place === previous;
    previous = place;
    if (repeat || placeId == null) return place;
    return (
      <GuardedLink href={`/places/view?id=${placeId}`} className="focus-ring rounded-sm">
        <MapPin width="12" height="12" aria-hidden="true" className="shrink-0" />
        <span className="min-w-0">{place}</span>
      </GuardedLink>
    );
  };
}
