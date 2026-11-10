import { describe, it, expect } from 'vitest';
import { quayTone } from '@/app/components/citations/quayTone';

describe('quayTone', () => {
  it('maps each QUAY level to its Badge tone', () => {
    expect(quayTone('3')).toBe('green');
    expect(quayTone('2')).toBe('blue');
    expect(quayTone('1')).toBe('warning');
    expect(quayTone('0')).toBe('red');
  });
  it('maps unset / unknown to neutral', () => {
    expect(quayTone('')).toBe('neutral');
    expect(quayTone(null)).toBe('neutral');
    expect(quayTone(undefined)).toBe('neutral');
    expect(quayTone('9')).toBe('neutral');
  });
});
