'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useLanguage } from '@/app/components/LanguageProvider';
import { EVENT_VERB_TYPES } from '@/lib/places/eventTypes';
import { familyEventLabel } from '@/app/components/familyEventTypes';

interface ReasonLink {
  kind: string;
  eventType: string | null;
  date: string | null;
  sex: string | null;
}

/**
 * Why a fact ties someone to a place: "Born here Aug 17, 1966", "Resided here 1920".
 * `withDate: false` leaves the date off ("Born here"), for a row that shows the year
 * on its own.
 */
export function usePlaceFactReason() {
  const t = useTranslations('places');
  const tEventTypes = useTranslations('eventTypes');
  const tEventEdit = useTranslations('eventEdit');
  const { language } = useLanguage();
  const dateWords = useDateQualifierWords();

  return useCallback((link: ReasonLink, { withDate = true }: { withDate?: boolean } = {}): string => {
    // The full app-standard date, not a bare year: the rows sit beside person
    // names, where "Married here Sep 18, 1940" is the same granularity the
    // person and family pages show.
    const date = withDate && link.date ? formatDateForDisplay(link.date, language, dateWords) : '';
    // `sex` drives an ICU select in every reason key: French and Russian inflect
    // these verbs, and Russian has entirely different words for a woman marrying.
    const sex = link.sex === 'F' ? 'F' : 'M';
    // A verb phrase ("Resided"), NOT the places.event_* tally headings, which are
    // plural nouns — those rendered "Residences here 1920".
    const eventType = link.eventType
      ? (EVENT_VERB_TYPES.has(link.eventType)
        ? t(`place_fact_verb_${link.eventType}`)
        // No verb phrase: the event's own name, never its GEDCOM tag (#701).
        : tEventTypes.has(link.eventType) ? tEventTypes(link.eventType) : familyEventLabel(link.eventType, tEventEdit))
      : '';
    // A missing date takes a variant key rather than an empty {date}, which would
    // leave a dangling "Born here " with trailing space.
    if (link.kind === 'event') {
      return date
        ? t('place_fact_event', { eventType, date, sex })
        : t('place_fact_event_undated', { eventType, sex });
    }
    const base = `place_fact_${link.kind}`;
    return date ? t(base, { date, sex }) : t(`${base}_undated`, { sex });
  }, [t, tEventTypes, tEventEdit, language, dateWords]);
}
