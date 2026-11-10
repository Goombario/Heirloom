import { describe, it, expect } from 'vitest';
import enMessages from '@/messages/en.json';
import frMessages from '@/messages/fr.json';
import ruMessages from '@/messages/ru.json';
import { KNOWN_EVENT_TYPES, EVENT_VERB_TYPES, eventTypeLabel } from '@/lib/places/eventTypes';

const places = (enMessages as { places: Record<string, string> }).places;

/**
 * The two sets used to be copy-pasted constants in ExploreDetail and
 * PlaceDetailView, held together by a comment. Now that they have one home, this
 * pins them to the translation keys they gate — the failure mode either way is a
 * raw GEDCOM tag rendered to the user instead of a label.
 */
describe('places event-type sets', () => {
  it('every tally type has an event_* heading', () => {
    for (const type of KNOWN_EVENT_TYPES) {
      expect(places[`event_${type}`], `missing places.event_${type}`).toBeTruthy();
    }
  });

  it('every verb type has a place_fact_verb_* phrase', () => {
    for (const type of EVENT_VERB_TYPES) {
      expect(places[`place_fact_verb_${type}`], `missing places.place_fact_verb_${type}`).toBeTruthy();
    }
  });

  it('keeps the two sets distinct — verbs are a subset, minus the three that have their own keys', () => {
    // BIRT / MARR / DEAT are reasons in their own right (place_fact_birth,
    // _marriage, _death) and must never fall through to place_fact_event.
    for (const type of EVENT_VERB_TYPES) expect(KNOWN_EVENT_TYPES.has(type)).toBe(true);
    for (const type of ['BIRT', 'MARR', 'DEAT']) expect(EVENT_VERB_TYPES.has(type)).toBe(false);
  });

  it('falls back to the raw tag for a custom event type (#468)', () => {
    const t = (key: string) => `translated:${key}`;
    expect(eventTypeLabel('BIRT', t)).toBe('translated:event_BIRT');
    // GRAD is a known type now (#701); only an unnamed custom tag stays raw.
    expect(eventTypeLabel('GRAD', t)).toBe('translated:event_GRAD');
    expect(eventTypeLabel('_MILT', t)).toBe('_MILT');
  });

  it('has a tally heading in every catalog for every known type (#701)', () => {
    for (const messages of [enMessages, frMessages, ruMessages]) {
      const headings = (messages as { places: Record<string, string> }).places;
      for (const type of KNOWN_EVENT_TYPES) expect(headings[`event_${type}`], type).toBeTruthy();
    }
  });
});
