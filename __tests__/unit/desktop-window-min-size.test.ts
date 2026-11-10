import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_MIN_CONTENT, desktopMinLogicalSize, mediaQueryRemPx } from '@/lib/desktop';

const config = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));
const capability = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'capabilities', 'default.json'), 'utf8'));

describe('desktop window minimum size (#85)', () => {
  it('keeps the configured minimum above the 767px phone breakpoint', () => {
    const [main] = config.app.windows;
    expect(main.minWidth).toBe(DESKTOP_MIN_CONTENT.width);
    expect(main.minHeight).toBe(DESKTOP_MIN_CONTENT.height);
    expect(DESKTOP_MIN_CONTENT.width).toBeGreaterThan(767);
  });

  it('leaves the minimum alone when the page is not zoomed', () => {
    expect(desktopMinLogicalSize(1, 1)).toEqual({ width: 800, height: 600 });
    expect(desktopMinLogicalSize(2, 2)).toEqual({ width: 800, height: 600 });
    expect(desktopMinLogicalSize(1.25, 1.25)).toEqual({ width: 800, height: 600 });
  });

  it('scales the minimum by the webview zoom so the content stays 800 CSS px wide', () => {
    expect(desktopMinLogicalSize(1.25, 1)).toEqual({ width: 1000, height: 750 });
    expect(desktopMinLogicalSize(2.5, 2)).toEqual({ width: 1000, height: 750 });
    expect(desktopMinLogicalSize(1.5, 1)).toEqual({ width: 1200, height: 900 });
  });

  it('also scales by the media-query rem, which WebKitGTK zooms with the page', () => {
    // A 1.25 text scale on Linux: zoom 1.25, and 48rem is 960 CSS px.
    expect(desktopMinLogicalSize(1.25, 1, 20)).toEqual({ width: 1250, height: 938 });
    expect(desktopMinLogicalSize(1, 1, 16)).toEqual({ width: 800, height: 600 });
  });

  it('never drops below the configured minimum when the page is zoomed out', () => {
    expect(desktopMinLogicalSize(0.8, 1, 12.8)).toEqual({ width: 800, height: 600 });
  });

  it('grants the window permissions the fit needs', () => {
    expect(capability.permissions).toEqual(
      expect.arrayContaining(['core:window:allow-set-min-size', 'core:window:allow-set-size']),
    );
  });

  it('finds the media-query rem by bisecting min-width against the viewport', () => {
    const remPx = 20;
    vi.stubGlobal('window', {
      innerWidth: 1000,
      matchMedia: (query: string) => ({ matches: Number(/min-width: ([\d.]+)rem/.exec(query)?.[1]) * remPx <= 1000 }),
    });
    try {
      expect(mediaQueryRemPx()).toBeCloseTo(remPx, 6);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
