import { describe, expect, it } from 'vitest';
import { formatMediaBytes } from '@/lib/media/format-bytes';

describe('formatMediaBytes', () => {
  it('uses one decimal below ten units and whole units thereafter', () => {
    expect(formatMediaBytes(8.4 * 1024 * 1024, 'en')).toBe('8.4\u00a0MB');
    expect(formatMediaBytes(82 * 1024 * 1024, 'en')).toBe('82\u00a0MB');
  });

  it('scales from bytes through gigabytes', () => {
    expect(formatMediaBytes(512, 'en')).toBe('512\u00a0B');
    expect(formatMediaBytes(1536, 'en')).toBe('1.5\u00a0KB');
    expect(formatMediaBytes(2 * 1024 ** 3, 'en')).toBe('2\u00a0GB');
  });

  it('normalizes invalid and negative values to zero bytes', () => {
    expect(formatMediaBytes(Number.NaN, 'en')).toBe('0\u00a0B');
    expect(formatMediaBytes(-1, 'en')).toBe('0\u00a0B');
  });
});
