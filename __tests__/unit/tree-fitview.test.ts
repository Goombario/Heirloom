import { describe, it, expect } from 'vitest';
import { naturalFitZoom, fitsWhole, READABLE_ZOOM } from '@/lib/tree/fitView';

describe('tree auto-fit (#193, FL-1)', () => {
  const PAD = 0.2;
  const MAX = 2;
  const DESKTOP = [1600, 1000] as const;
  const MOBILE = [390, 844] as const;

  it('opens at a readable ~70% zoom when the tree cannot fit whole', () => {
    expect(READABLE_ZOOM).toBeGreaterThanOrEqual(0.6);
    expect(READABLE_ZOOM).toBeLessThanOrEqual(0.8);
  });

  it('a four-generation tree that would fit only at ~29% anchors instead of shrinking', () => {
    // The UX sweep fixture: fitted whole, it opened at 29% with 5px names.
    const fourGen = { minX: 0, maxX: 3000, minY: 0, maxY: 900 };
    expect(naturalFitZoom(fourGen, 1440, 800, PAD, MAX)).toBeLessThan(0.35);
    expect(fitsWhole(fourGen, 1440, 800, PAD, MAX)).toBe(false);
  });

  it('a deep tree gets the same decision on desktop and mobile (no split-floor inversion)', () => {
    // An 11-generation pedigree: the old split floor (0.3 desktop / 0.2 mobile)
    // anchored it on desktop yet fit it whole on a phone.
    const deep = { minX: 0, maxX: 1000, minY: 0, maxY: 2860 };
    expect(fitsWhole(deep, ...MOBILE, PAD, MAX)).toBe(fitsWhole(deep, ...DESKTOP, PAD, MAX));
    expect(naturalFitZoom(deep, ...DESKTOP, PAD, MAX))
      .toBeGreaterThanOrEqual(naturalFitZoom(deep, ...MOBILE, PAD, MAX));
  });

  it('a small tree still fits whole, at the max zoom cap', () => {
    const small = { minX: 0, maxX: 200, minY: 0, maxY: 150 };
    expect(fitsWhole(small, ...DESKTOP, PAD, MAX)).toBe(true);
    expect(naturalFitZoom(small, ...DESKTOP, PAD, MAX)).toBe(MAX);
  });

  it('a degenerate single-node span does not divide by zero', () => {
    const dot = { minX: 100, maxX: 100, minY: 100, maxY: 100 };
    expect(naturalFitZoom(dot, ...DESKTOP, PAD, MAX)).toBe(MAX);
  });
});
