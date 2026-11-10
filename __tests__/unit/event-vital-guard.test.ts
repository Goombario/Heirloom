import { describe, expect, it } from 'vitest';
import { assertNotPersonVital } from '@/lib/services/events';

// #756: a person's birth and death live on the People row, not as Events rows.
describe('assertNotPersonVital', () => {
  it('refuses a person BIRT or DEAT, in any case', () => {
    expect(() => assertNotPersonVital('BIRT', 1)).toThrow();
    expect(() => assertNotPersonVital(' deat ', 1)).toThrow();
  });

  it('allows other person events and any family event', () => {
    expect(() => assertNotPersonVital('BAPM', 1)).not.toThrow();
    expect(() => assertNotPersonVital('BIRT', null)).not.toThrow();
  });

  it('still lets a legacy person BIRT row be edited in place', () => {
    expect(() => assertNotPersonVital('BIRT', 1, { Type: 'BIRT', PersonId: 1 })).not.toThrow();
    expect(() => assertNotPersonVital('DEAT', 1, { Type: 'BIRT', PersonId: 1 })).toThrow();
    expect(() => assertNotPersonVital('BIRT', 2, { Type: 'BIRT', PersonId: 1 })).toThrow();
  });
});
