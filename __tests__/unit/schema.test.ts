import { describe, it, expect } from 'vitest';
import { getEventDisplayType, EVENT_TYPES } from '@/lib/db/schema';

describe('getEventDisplayType', () => {
  it('maps known GEDCOM event types to display names', () => {
    expect(getEventDisplayType('BIRT')).toBe('Birth');
    expect(getEventDisplayType('DEAT')).toBe('Death');
    expect(getEventDisplayType('OCCU')).toBe('Occupation');
    expect(getEventDisplayType('EDUC')).toBe('Education');
    expect(getEventDisplayType('RESI')).toBe('Residence');
    expect(getEventDisplayType('BURI')).toBe('Burial');
    expect(getEventDisplayType('MARR')).toBe('MARR'); // MARR is not in the map, returns raw type
  });

  it('returns raw type for unknown event types', () => {
    expect(getEventDisplayType('CUSTOM')).toBe('CUSTOM');
    expect(getEventDisplayType('XYZ')).toBe('XYZ');
  });

  it('has all expected event types in the map', () => {
    const expectedTypes = [
      'BIRT', 'DEAT', 'OCCU', 'EDUC', 'RESI', 'BURI', 'CHR',
      'BAPM', 'ADOP', 'EVEN', 'GRAD', 'IMMI', 'NATU', 'CENS',
      'RETI', 'PROB', 'WILL',
    ];
    for (const type of expectedTypes) {
      expect(EVENT_TYPES).toHaveProperty(type);
    }
  });
});
