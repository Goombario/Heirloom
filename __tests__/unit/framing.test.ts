import { describe, it, expect } from 'vitest';
import { PORTRAIT_FRAMING, framePhoto } from '@/lib/media/framing';

const shares = PORTRAIT_FRAMING.desktop;

/** The tag box as drawn in the frame: centre and size in frame px. */
function drawn(at: { left: number; top: number; scale: number }, photo: { w: number; h: number }, tag: { x: number; y: number; w: number; h: number }) {
  return {
    cx: at.left + ((tag.x + tag.w / 2) / 100) * photo.w * at.scale,
    cy: at.top + ((tag.y + tag.h / 2) / 100) * photo.h * at.scale,
    w: (tag.w / 100) * photo.w * at.scale,
    h: (tag.h / 100) * photo.h * at.scale,
  };
}

describe('framePhoto', () => {
  // 900×1200 portrait photo with a 246×315 face tag centred at (450, 470).
  const photo = { w: 900, h: 1200 };
  const tag = { x: (450 - 123) / 900 * 100, y: (470 - 157.5) / 1200 * 100, w: 246 / 900 * 100, h: 315 / 1200 * 100 };
  const base = { photo, focalX: tag.x + tag.w / 2, focalY: tag.y + tag.h / 2, focalRadius: Math.max(tag.w, tag.h), regionW: tag.w, regionH: tag.h, shares };

  it('fits the whole tag at the configured share of a 4:3 frame, face above centre', () => {
    const frame = { w: 312, h: 232 };
    const at = framePhoto({ ...base, frame, circular: false });
    const d = drawn(at, photo, tag);
    expect(d.h / frame.h).toBeCloseTo(shares.rect, 5);
    expect(d.w).toBeLessThan(frame.w);
    expect(d.cx).toBeCloseTo(frame.w / 2, 5);
    expect(d.cy).toBeCloseTo(frame.h * PORTRAIT_FRAMING.faceTop, 5);
  });

  it('frames by the frame it is given, so a narrowed cover stays centred', () => {
    const frame = { w: 212, h: 157 };
    const at = framePhoto({ ...base, frame, circular: false });
    expect(drawn(at, photo, tag).cx).toBeCloseTo(106, 5);
  });

  it('fills the circle share with the tag\'s longer side', () => {
    const frame = { w: 40, h: 40 };
    const at = framePhoto({ ...base, frame, circular: true });
    const d = drawn(at, photo, tag);
    expect(Math.max(d.w, d.h) / 40).toBeCloseTo(shares.circle, 5);
    expect(d.cy).toBeCloseTo(20, 5);
  });

  it('reads a radius without a region as a square box', () => {
    const frame = { w: 40, h: 40 };
    const at = framePhoto({ ...base, regionW: null, regionH: null, frame, circular: true });
    // A radius alone is a square whose side is that percent of the photo's short side.
    const side = (Math.max(tag.w, tag.h) / 100) * 900;
    expect(side * at.scale / 40).toBeCloseTo(shares.circle, 5);
  });

  it('never zooms out past covering the frame', () => {
    const frame = { w: 312, h: 232 };
    const at = framePhoto({ ...base, focalRadius: 100, regionW: 100, regionH: 100, frame, circular: false });
    expect(photo.w * at.scale).toBeGreaterThanOrEqual(frame.w - 1e-9);
    expect(photo.h * at.scale).toBeGreaterThanOrEqual(frame.h - 1e-9);
  });

  it('slides the photo back at an edge instead of zooming in', () => {
    const wide = { w: 1600, h: 1000 };
    const edgeTag = { x: 0, y: 30, w: 6, h: 14 };
    const frame = { w: 312, h: 232 };
    const at = framePhoto({ photo: wide, frame, focalX: 3, focalY: 37, focalRadius: 14, regionW: edgeTag.w, regionH: edgeTag.h, circular: false, shares });
    expect(at.left).toBe(0);
    const d = drawn(at, wide, edgeTag);
    expect(d.h / frame.h).toBeCloseTo(shares.rect, 5);
    expect(d.cx).toBeLessThan(frame.w / 2);
  });
});
