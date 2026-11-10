import { describe, it, expect } from 'vitest';
import { cropThumbWidth, CROP_SIZE } from '@/lib/media/face-crop';
import { THUMB_SIZES } from '@/lib/media-url';

/**
 * A face crop is not a CROP_SIZE-pixel slice of the thumbnail — it is a small
 * FRACTION of the image blown up to fill a CROP_SIZE box. The source width the
 * browser actually samples is therefore CROP_SIZE / regionFraction, which is
 * what these tests pin. Requesting a fixed 256 (the pre-fix behaviour) hands a
 * ~5%-wide face about 13 source pixels to fill 56 CSS px.
 */
describe('cropThumbWidth', () => {
  it('always returns a server-whitelisted thumb size', () => {
    for (const w of [0.5, 1, 4.5, 5.4, 13.7, 25, 50, 100, 140]) {
      expect(THUMB_SIZES).toContain(cropThumbWidth(w));
    }
  });

  it('gives a real face region enough source pixels, or asks for the most available', () => {
    // The real regions in test-data/ run 4.5%-13.7% wide. Each must either clear
    // CROP_SIZE source pixels across the region, or already be asking for the
    // largest whitelisted size — below ~5.5% the 1024 ceiling makes CROP_SIZE
    // physically unreachable (uploads are capped at 2048 too), and the only
    // correct behaviour there is to leave no resolution unrequested.
    const largest = THUMB_SIZES[THUMB_SIZES.length - 1];
    for (const regionW of [4.5, 5.1, 5.4, 13.7]) {
      const width = cropThumbWidth(regionW);
      const sourcePxAcrossRegion = width * (regionW / 100);
      expect(sourcePxAcrossRegion >= CROP_SIZE || width === largest).toBe(true);
    }
  });

  it.each([
    [56, 512],
    [88, 1024],
  ])('requests enough source resolution for a narrow face at %dpx', (renderedSize, expectedWidth) => {
    const width = cropThumbWidth(25, renderedSize);
    const sourcePxAcrossRegion = width * 0.25;

    expect(width).toBe(expectedWidth);
    expect(sourcePxAcrossRegion).toBeGreaterThanOrEqual(renderedSize);
  });

  it('lifts the worst real region from unreadable to a mild upscale', () => {
    // The narrowest face in test-data/ (R Johnson, 4.5%). Pre-fix it had ~11.5
    // source px to fill 56 CSS px — a 4.9x upscale, which is the blur reported
    // at the PR boundary. Post-fix it is ~46px, a 1.2x upscale.
    const before = 256 * 0.045;
    const after = cropThumbWidth(4.5) * 0.045;
    expect(before).toBeLessThan(CROP_SIZE / 3);
    expect(after).toBeGreaterThan(CROP_SIZE * 0.75);
  });

  it('a fixed 256px thumb would have failed that bar for a 5% face', () => {
    // Documents the defect this helper fixes rather than asserting new behaviour.
    expect(256 * 0.054).toBeLessThan(CROP_SIZE);
    expect(cropThumbWidth(5.4)).toBeGreaterThan(256);
  });

  it('does not over-fetch for a large region that needs no magnification', () => {
    // A face filling most of the frame is scaled ~1x, so the small thumb is fine.
    expect(cropThumbWidth(100)).toBeLessThanOrEqual(256);
  });

  it('scales monotonically — a smaller region never asks for a smaller source', () => {
    const sizes = [1, 2, 5, 10, 20, 40, 80, 100].map(w => cropThumbWidth(w));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    }
  });

  it('clamps degenerate and out-of-range regions instead of dividing by zero', () => {
    for (const bad of [0, -0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = cropThumbWidth(bad);
      expect(THUMB_SIZES).toContain(w);
    }
    // A zero/NaN region must not silently pick the SMALLEST thumb — that is the
    // blurry outcome. Degenerate input takes the safe, sharp end.
    expect(cropThumbWidth(0)).toBe(1024);
    expect(cropThumbWidth(Number.NaN)).toBe(1024);
  });
});
