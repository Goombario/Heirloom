import { describe, it, expect } from 'vitest';
import { nameInitials } from '@/app/library/source-modal/parts';

// Characterization test — lock the cited-by avatar initials logic.

describe('nameInitials', () => {
  it('takes first + last initial, uppercased', () => {
    expect(nameInitials('ada lovelace')).toBe('AL');
    expect(nameInitials('Charles Babbage Jr')).toBe('CJ');
  });
  it('handles a single name', () => {
    expect(nameInitials('Ada')).toBe('A');
  });
  it('falls back to ? when empty', () => {
    expect(nameInitials('')).toBe('?');
    expect(nameInitials('   ')).toBe('?');
  });
});
