import { describe, it, expect } from 'vitest';
import { HOME_ITEM, isNavItemActive, permissionPillVariant } from '@/app/components/nav/navItems';

describe('permissionPillVariant', () => {
  it('owner is the "owner" pill variant', () => {
    expect(permissionPillVariant('owner')).toBe('owner');
  });
  it('shared permissions are the neutral variant', () => {
    expect(permissionPillVariant('edit')).toBe('shared');
    expect(permissionPillVariant('contribute')).toBe('shared');
    expect(permissionPillVariant('view')).toBe('shared');
  });
});

describe('HOME_ITEM', () => {
  it('is active on home only, not on every route', () => {
    expect(isNavItemActive(HOME_ITEM, '/')).toBe(true);
    expect(isNavItemActive(HOME_ITEM, '/people')).toBe(false);
  });
});
