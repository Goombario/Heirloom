import { describe, it, expect } from 'vitest';
import { formatLifespan } from '@/app/components/ui/format';

describe('formatLifespan', () => {
  it('birth and death', () => {
    expect(formatLifespan({ birth: '1819', death: '1901' })).toBe('1819–1901');
  });
  it('living shows present', () => {
    expect(formatLifespan({ birth: '1985', living: true })).toBe('1985–present');
  });
  it('birth only, unknown living → just birth', () => {
    expect(formatLifespan({ birth: '1900' })).toBe('1900');
  });
  it('no dates → null', () => {
    expect(formatLifespan({})).toBeNull();
  });
});
