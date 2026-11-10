/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { readStatusSymbols, writeStatusSymbols } from '@/lib/utils/status-symbols';

describe('status symbols preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-status-symbols');
  });

  it('is off by default', () => {
    expect(readStatusSymbols()).toBe(false);
  });

  it('persists and mirrors onto <html> so the CSS can show the symbols', () => {
    writeStatusSymbols(true);
    expect(readStatusSymbols()).toBe(true);
    expect(document.documentElement.getAttribute('data-status-symbols')).toBe('on');

    writeStatusSymbols(false);
    expect(readStatusSymbols()).toBe(false);
    expect(document.documentElement.hasAttribute('data-status-symbols')).toBe(false);
  });
});
