/**
 * The two GEDCOM event-type sets the Places surfaces gate their translations on.
 *
 * They are NOT the same set and must not be merged: `KNOWN_EVENT_TYPES` is the
 * plural tally headings ("Residences"), `EVENT_VERB_TYPES` is the verb phrases
 * ("Resided here 1920"). Birth, marriage and death are absent from the verb set
 * on purpose — those reasons come from `place_fact_birth` / `_marriage` /
 * `_death`, which are their own keys, not `place_fact_event`.
 *
 * Previously `KNOWN_EVENT_TYPES` was duplicated verbatim in ExploreDetail and
 * PlaceDetailView with a "mirrors the other one" comment holding them together;
 * a type added to one would have rendered a raw tag on the other.
 */

/** Event types with a dedicated `places.event_*` tally heading. */
export const KNOWN_EVENT_TYPES = new Set([
  'BIRT', 'BAPM', 'CHR', 'MARR', 'DEAT', 'BURI',
  'EMIG', 'IMMI', 'CENS', 'RESI', 'OCCU', 'EDUC',
  // Every other type the app can record (#701): person events from EVENT_TYPES,
  // family events from FAMILY_EVENT_TYPES. A tag only reaches the raw fallback
  // now if it is a custom GEDCOM tag the app has no name for.
  'ADOP', 'EVEN', 'GRAD', 'NATU', 'PROB', 'RETI', 'WILL',
  'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIV', 'DIVF', 'ANUL', 'SEPA',
]);

/** Event types with a dedicated `places.place_fact_verb_*` reason phrase. */
export const EVENT_VERB_TYPES = new Set([
  'RESI', 'OCCU', 'EDUC', 'CENS', 'EMIG', 'IMMI', 'BAPM', 'CHR', 'BURI',
]);

/**
 * The tally label for one event type: the translated heading when we have one,
 * otherwise the raw GEDCOM tag. Only a custom tag (`_MILT`) the app has no name
 * for renders raw, rather than as a missing-key crash.
 */
export function eventTypeLabel(type: string, t: (key: string) => string): string {
  return KNOWN_EVENT_TYPES.has(type) ? t(`event_${type}`) : type;
}
