/** @vitest-environment happy-dom */
import { act, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/app/components/ThemeProvider';

/**
 * The dark palette is written once, under `html.dark` (#2). There used to be a
 * second copy in `@media (prefers-color-scheme: dark)` for "system", and the two
 * drifted. Now the layout's pre-paint script and ThemeProvider resolve "system"
 * to the class, so nothing in the stylesheet follows the OS directly.
 */
const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const LAYOUT = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

function mockOs(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mq = {
    matches: dark,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  window.matchMedia = globalThis.matchMedia;
  return (next: boolean) => { mq.matches = next; listeners.forEach((fn) => fn({ matches: next })); };
}

describe('the dark palette has one source (#2)', () => {
  afterEach(() => {
    document.documentElement.className = '';
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('declares no palette under a prefers-color-scheme query', () => {
    expect(CSS).not.toMatch(/@media\s*\(prefers-color-scheme/);
    expect(CSS).toContain('html.dark {');
  });

  it('resolves "system" before first paint', () => {
    expect(LAYOUT).toMatch(/t!=='light'&&window\.matchMedia\('\(prefers-color-scheme: dark\)'\)\.matches/);
  });

  it('marks the page dark on a dark OS when the theme is "system", and follows the OS', async () => {
    const osChanges = mockOs(true);
    render(<ThemeProvider><p>page</p></ThemeProvider>);
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    act(() => osChanges(false));
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('keeps a chosen light theme on a dark OS', async () => {
    mockOs(true);
    localStorage.setItem('theme', 'light');
    render(<ThemeProvider><p>page</p></ThemeProvider>);
    await vi.waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
