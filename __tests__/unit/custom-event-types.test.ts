import { describe, it, expect } from 'vitest';
import { customEventTypes, isCustomEventType } from '@/lib/events/custom-types';
import { EVENT_TYPES } from '@/lib/db/schema';
import { FAMILY_EVENT_TYPES } from '@/app/components/familyEventTypes';

describe('custom event types (#162)', () => {
  it('treats every tag the app records as standard', () => {
    for (const type of [...Object.keys(EVENT_TYPES), ...FAMILY_EVENT_TYPES.map((f) => f.value), 'MARR']) {
      expect(isCustomEventType(type), type).toBe(false);
    }
    expect(isCustomEventType('Military service')).toBe(true);
  });

  it('keeps only custom labels, most used first, then by name', () => {
    expect(customEventTypes([
      { type: 'OCCU', count: 9 },
      { type: 'Medal of Military Merit', count: 1 },
      { type: 'Military service', count: 4 },
      { type: 'Confirmation', count: 1 },
      { type: '  ', count: 3 },
    ])).toEqual([
      { type: 'Military service', count: 4 },
      { type: 'Confirmation', count: 1 },
      { type: 'Medal of Military Merit', count: 1 },
    ]);
  });
});
