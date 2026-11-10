import { describe, it, expect } from 'vitest';
import { NotImplementedError } from '@/lib/data/errors';

describe('NotImplementedError', () => {
  it('has the right name and a default message', () => {
    const e = new NotImplementedError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NotImplementedError');
    expect(e.message).toMatch(/later phase/i);
  });

  it('accepts a custom message', () => {
    expect(new NotImplementedError('families.list').message).toBe('families.list');
  });
});
