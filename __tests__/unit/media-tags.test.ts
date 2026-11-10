import { describe, it, expect } from 'vitest';
import { regionToFocal, clampPercent } from '@/lib/db/queries/media-tags';

describe('media-tags helpers', () => {
  describe('regionToFocal', () => {
    it('returns the exact centre of a region', () => {
      // A 20%-wide, 30%-tall box at (10, 20): centre is (10+10, 20+15) = (20, 35).
      const focal = regionToFocal({ RegionX: 10, RegionY: 20, RegionW: 20, RegionH: 30 });
      expect(focal.focalX).toBe(20);
      expect(focal.focalY).toBe(35);
    });

    it('approximates radius from the larger box edge', () => {
      const wide = regionToFocal({ RegionX: 0, RegionY: 0, RegionW: 40, RegionH: 10 });
      expect(wide.focalRadius).toBe(40);

      const tall = regionToFocal({ RegionX: 0, RegionY: 0, RegionW: 10, RegionH: 40 });
      expect(tall.focalRadius).toBe(40);
    });

    it('handles a square region', () => {
      const focal = regionToFocal({ RegionX: 25, RegionY: 25, RegionW: 50, RegionH: 50 });
      expect(focal).toEqual({ focalX: 50, focalY: 50, focalRadius: 50 });
    });
  });

  describe('clampPercent', () => {
    it('passes through in-range values', () => {
      expect(clampPercent(0)).toBe(0);
      expect(clampPercent(42.5)).toBe(42.5);
      expect(clampPercent(100)).toBe(100);
    });

    it('clamps values below 0 up to 0', () => {
      expect(clampPercent(-1)).toBe(0);
      expect(clampPercent(-9999)).toBe(0);
    });

    it('clamps values above 100 down to 100', () => {
      expect(clampPercent(101)).toBe(100);
      expect(clampPercent(5000)).toBe(100);
    });

    it('coerces numeric strings', () => {
      expect(clampPercent('37')).toBe(37);
      expect(clampPercent('150')).toBe(100);
    });

    it('yields NaN for non-numeric input (rejected downstream as invalid)', () => {
      expect(Number.isNaN(clampPercent('not-a-number'))).toBe(true);
    });
  });
});
