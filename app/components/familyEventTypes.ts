import { getEventDisplayType } from '@/lib/db/schema';
import type { useTranslations } from 'next-intl';

/**
 * Family life-cycle event types (GEDCOM FAMILY_EVENT_STRUCTURE), kept **separate**
 * from the shared `EVENT_TYPES` map so they never leak into the person add-event
 * dropdown (`PERSON_DEFAULTS` is derived from `EVENT_TYPES`). Marriage (`MARR`) is
 * the family's start anchor — edited on the family form, not an addable event.
 * `ftypeKey` resolves against the `eventEdit` i18n namespace.
 */
export const FAMILY_EVENT_TYPES: { value: string; ftypeKey: string }[] = [
    { value: 'ENGA', ftypeKey: 'ftype_engagement' },
    { value: 'MARB', ftypeKey: 'ftype_banns' },
    { value: 'MARC', ftypeKey: 'ftype_contract' },
    { value: 'MARL', ftypeKey: 'ftype_license' },
    { value: 'MARS', ftypeKey: 'ftype_settlement' },
    { value: 'DIV', ftypeKey: 'ftype_divorce' },
    { value: 'DIVF', ftypeKey: 'ftype_divorce_filed' },
    { value: 'ANUL', ftypeKey: 'ftype_annulment' },
    { value: 'SEPA', ftypeKey: 'ftype_separation' },
    { value: 'CENS', ftypeKey: 'ftype_census' },
    { value: 'RESI', ftypeKey: 'ftype_residence' },
    { value: 'EVEN', ftypeKey: 'ftype_event' },
];

type Translator = ReturnType<typeof useTranslations>;

/** Localized label for a family event type; falls back to the generic display type. */
export function familyEventLabel(type: string, t: Translator): string {
    const spec = FAMILY_EVENT_TYPES.find((x) => x.value === type);
    return spec ? t(spec.ftypeKey as Parameters<Translator>[0]) : getEventDisplayType(type);
}
