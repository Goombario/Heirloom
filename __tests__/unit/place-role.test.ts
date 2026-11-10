import { describe, it, expect } from 'vitest';
import { placeRoleKey } from '@/lib/places/placeRole';

describe('placeRoleKey', () => {
  it('maps the three DB roles', () => {
    expect(placeRoleKey('born & died')).toBe('born_died_here');
    expect(placeRoleKey('born')).toBe('born_here');
    expect(placeRoleKey('died')).toBe('died_here');
  });
  it('returns null for an unknown role', () => {
    expect(placeRoleKey('')).toBeNull();
    expect(placeRoleKey('visited')).toBeNull();
  });
});
