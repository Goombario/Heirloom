import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for the profile-image cold-load white flash.
 *
 * `.hero-portrait-frame` always sits on the dark hero band. Its background is only
 * ever visible in the brief window before the portrait decodes on a cold/hard load
 * (the photo or monogram fully covers it otherwise). If that background is a light
 * colour, that window paints a white/cream box — the "white flash" reported on the
 * static build. This test pins the fill to the hero's dark empty-panel token so the
 * flash can't come back via a stray light literal.
 *
 * See project memory: project_profile_image_flash — the flash had to be reproduced
 * in-browser to find that the frame's `#F3ECDD` fill was the culprit.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector + ' {');
  expect(start, `${selector} rule not found in globals.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', start);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

describe('hero portrait frame background (cold-load flash guard)', () => {
  const body = ruleBody('.hero-portrait-frame');
  const bg = body.match(/background:\s*([^;]+);/)?.[1]?.trim() ?? '';

  it('declares a background', () => {
    expect(bg).not.toBe('');
  });

  it('uses the dark hero empty-panel token, not a light literal', () => {
    // Must reference the hero panel fill (dark, translucent-white over the dark hero).
    expect(bg).toContain('--hero-panel-bg');
  });

  it('is not the cream literal that caused the flash', () => {
    expect(bg.toUpperCase()).not.toContain('#F3ECDD');
    // No opaque light hex fill (short-hand for "would flash white on the dark hero").
    expect(/#(?:F|E|D)[0-9A-F]{5}/i.test(bg)).toBe(false);
  });
});
