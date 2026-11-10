import { describe, it, expect } from 'vitest';
import { shouldRenderColumnBirth, shouldRenderColumnDeath } from '@/app/people/view/derive';

const base = { BirthDate: '1901', BirthPlace: 'Boston', DeathDate: '1970', DeathPlace: 'Portland', events: [] };

describe('intrinsic vital rows', () => {
  it('renders the column birth row when no BIRT event exists', () => {
    expect(shouldRenderColumnBirth(base)).toBe(true);
  });
  it('suppresses the column birth row when a BIRT event exists (no double render)', () => {
    expect(shouldRenderColumnBirth({ ...base, events: [{ Type: 'BIRT' }] })).toBe(false);
  });
  it('suppresses the column death row when a DEAT event exists', () => {
    expect(shouldRenderColumnDeath({ ...base, events: [{ Type: 'DEAT' }] })).toBe(false);
  });
  it('renders a date-less death when IsDeceased is explicitly 1', () => {
    expect(shouldRenderColumnDeath({
      BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, DeathCause: null,
      IsDeceased: 1, events: [],
    })).toBe(true);
  });
  it('does not treat explicit living status as a death fact', () => {
    expect(shouldRenderColumnDeath({
      BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, DeathCause: null,
      IsDeceased: 0, events: [],
    })).toBe(false);
  });
});
