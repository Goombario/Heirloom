import { describe, it, expect } from 'vitest';
import { parseImageMetadata } from '@/lib/media/xmp-faces';
import { buildJpegWithXmp, mwgPacket } from '../fixtures/xmp/build-fixture';

/** A face in the top-left quadrant: centre (0.2, 0.1), size 0.2 x 0.1. */
const REGION = { name: 'Ada', x: 0.2, y: 0.1, w: 0.2, h: 0.1 };
// Top-left origin before rotation: x 0.1, y 0.05, w 0.2, h 0.1.

function facesFor(orientation: number) {
  return parseImageMetadata(buildJpegWithXmp(mwgPacket([REGION]), orientation)).faces[0];
}

describe('EXIF orientation correction', () => {
  it('leaves orientation 1 untouched', () => {
    const f = facesFor(1);
    expect(f.x).toBeCloseTo(10, 4);
    expect(f.y).toBeCloseTo(5, 4);
    expect(f.w).toBeCloseTo(20, 4);
    expect(f.h).toBeCloseTo(10, 4);
  });

  it('mirrors horizontally for orientation 2', () => {
    const f = facesFor(2);
    expect(f.x).toBeCloseTo(70, 4); // 100 - 10 - 20
    expect(f.y).toBeCloseTo(5, 4);
  });

  it('rotates 180 for orientation 3', () => {
    const f = facesFor(3);
    expect(f.x).toBeCloseTo(70, 4);
    expect(f.y).toBeCloseTo(85, 4); // 100 - 5 - 10
  });

  it('mirrors vertically for orientation 4', () => {
    const f = facesFor(4);
    expect(f.x).toBeCloseTo(10, 4);
    expect(f.y).toBeCloseTo(85, 4);
  });

  it('transposes for orientation 5, swapping width and height', () => {
    const f = facesFor(5);
    expect(f.x).toBeCloseTo(5, 4);
    expect(f.y).toBeCloseTo(10, 4);
    expect(f.w).toBeCloseTo(10, 4);
    expect(f.h).toBeCloseTo(20, 4);
  });

  it('rotates 90 clockwise for orientation 6', () => {
    const f = facesFor(6);
    expect(f.x).toBeCloseTo(85, 4); // 100 - 5 - 10
    expect(f.y).toBeCloseTo(10, 4);
    expect(f.w).toBeCloseTo(10, 4);
    expect(f.h).toBeCloseTo(20, 4);
  });

  it('applies the transverse transform for orientation 7', () => {
    const f = facesFor(7);
    expect(f.x).toBeCloseTo(85, 4);
    expect(f.y).toBeCloseTo(70, 4);
  });

  it('rotates 270 clockwise for orientation 8', () => {
    const f = facesFor(8);
    expect(f.x).toBeCloseTo(5, 4);
    expect(f.y).toBeCloseTo(70, 4);
  });

  it('keeps every rotated region inside the image', () => {
    for (let o = 1; o <= 8; o++) {
      const f = facesFor(o);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.w).toBeLessThanOrEqual(100.0001);
      expect(f.y + f.h).toBeLessThanOrEqual(100.0001);
    }
  });
});
