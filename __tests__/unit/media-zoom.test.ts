/** Lightbox zoom maths (#252). */
import { describe, expect, it } from 'vitest';
import { FIT, actualSizeScale, clampPan, isZoomed, maxScale, panBy, wheelFactor, zoomAt, zoomPercent } from '@/lib/media/zoom';

const box = { stageW: 800, stageH: 600, imgW: 800, imgH: 400 };

describe('lightbox zoom maths', () => {
  it('keeps the point under the pointer still while zooming', () => {
    const focus = { x: 200, y: 100 };
    const z = zoomAt(FIT, 2, focus, box, 8);
    // At fit the fitted point under the pointer is the focus itself; after zooming,
    // translate + scale · point must land on the focus again.
    expect(z.scale).toBe(2);
    expect(z.x + z.scale * focus.x).toBeCloseTo(focus.x, 5);
    expect(z.y + z.scale * focus.y).toBeCloseTo(focus.y, 5);
  });

  it('never goes below fit or above the maximum', () => {
    expect(zoomAt({ scale: 2, x: 50, y: 0 }, 0.5, { x: 0, y: 0 }, box, 8)).toEqual(FIT);
    expect(zoomAt(FIT, 40, { x: 0, y: 0 }, box, 8).scale).toBe(8);
  });

  it('stops panning at the photo edges and centres a side smaller than the stage', () => {
    const z = clampPan({ scale: 2, x: 10_000, y: 10_000 }, box);
    expect(z.x).toBe(400); // (2·800 − 800) / 2
    expect(z.y).toBe(100); // (2·400 − 600) / 2
    expect(clampPan({ scale: 1.2, x: 0, y: 90 }, box).y).toBe(0); // 480 tall fits in 600
  });

  it('does not pan at fit', () => {
    expect(panBy(FIT, 30, 30, box)).toEqual(FIT);
    expect(panBy({ scale: 2, x: 0, y: 0 }, 30, -20, box)).toEqual({ scale: 2, x: 30, y: -20 });
  });

  it('measures actual size from the image pixels and caps the zoom from it', () => {
    expect(actualSizeScale(4000, 800)).toBe(5);
    expect(actualSizeScale(400, 800)).toBe(1);
    expect(actualSizeScale(0, 800)).toBe(1);
    expect(maxScale(1)).toBe(4);
    expect(maxScale(5)).toBe(10);
    expect(zoomPercent(1, 1.25)).toBe(80);
    expect(zoomPercent(1.25, 1.25)).toBe(100);
  });

  it('zooms in for a wheel turned up and out for one turned down', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    // A trackpad pinch sends small deltas, so it is scaled up.
    expect(wheelFactor(-10, 0, true)).toBeCloseTo(wheelFactor(-50, 0, false), 5);
    expect(isZoomed(FIT)).toBe(false);
  });
});
