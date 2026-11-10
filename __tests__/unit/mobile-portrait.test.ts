import { describe, expect, it } from 'vitest';
import { FACE_SHARE, MAX_ZOOM, circleFocal, coverScale, cropFrom, dragCrop, placeCrop, placeStage, regionFor, zoomCrop } from '@/app/people/view/mobile/portrait';

// The phone portrait's framing (#1051): one rule for the crop, the 4:3 hero and the previews.
const photo = { w: 3000, h: 2000 };
const hero = { w: 390, h: 292.5 };

describe('portrait framing (#1051)', () => {
  it('never lets the photo leave bars in the hero, however it is dragged', () => {
    let crop = cropFrom(photo, null, { x: 0.5, y: 0.5 });
    crop = dragCrop(photo, hero, crop, 5000, 5000);
    const at = placeCrop(photo, hero, crop);
    expect(at.left).toBeLessThanOrEqual(0);
    expect(at.top).toBeLessThanOrEqual(0);
    expect(at.left + photo.w * at.scale).toBeGreaterThanOrEqual(hero.w - 1e-6);
    expect(at.top + photo.h * at.scale).toBeGreaterThanOrEqual(hero.h - 1e-6);
    expect(at.scale).toBeCloseTo(coverScale(photo, hero));
  });

  it('saves the circle as a face tag that reopens to the same crop', () => {
    const crop = zoomCrop(photo, hero, { face: { x: 0.62, y: 0.35 }, zoom: 1 }, 2);
    const region = regionFor(photo, crop);
    // A square in the photo's pixels: equal widths once scaled back.
    expect((region.RegionW / 100) * photo.w).toBeCloseTo((region.RegionH / 100) * photo.h, 0);
    const again = cropFrom(photo, region, null);
    expect(again.zoom).toBeCloseTo(crop.zoom, 2);
    expect(again.face.x).toBeCloseTo(crop.face.x, 2);
    expect(again.face.y).toBeCloseTo(crop.face.y, 2);
  });

  it('draws the face a fixed share of the hero, within the zoom floor and cap', () => {
    const crop = cropFrom(photo, { RegionX: 30, RegionY: 10, RegionW: 20, RegionH: 30 }, null);
    const at = placeCrop(photo, hero, crop);
    expect(0.2 * photo.w * at.scale).toBeCloseTo(hero.w * FACE_SHARE, 0);
    expect(cropFrom(photo, { RegionX: 0, RegionY: 0, RegionW: 100, RegionH: 100 }, null).zoom).toBe(1);
    expect(cropFrom(photo, { RegionX: 50, RegionY: 50, RegionW: 0.5, RegionH: 0.5 }, null).zoom).toBe(MAX_ZOOM);
  });

  it('keeps the saved region inside the photo at an edge', () => {
    const crop = dragCrop(photo, hero, { face: { x: 0.5, y: 0.4 }, zoom: MAX_ZOOM }, -9000, -9000);
    const r = regionFor(photo, crop);
    expect(r.RegionX).toBeGreaterThanOrEqual(0);
    expect(r.RegionY).toBeGreaterThanOrEqual(0);
    expect(r.RegionX + r.RegionW).toBeLessThanOrEqual(100);
    expect(r.RegionY + r.RegionH).toBeLessThanOrEqual(100);
  });

  it('keeps the photo point under the fingers still while pinching', () => {
    const crop = { face: { x: 0.5, y: 0.45 }, zoom: 1.5 };
    const anchor = { x: 250, y: 120 };
    const at = placeStage(photo, hero, crop);
    const under = { x: (anchor.x - at.left) / (photo.w * at.scale), y: (anchor.y - at.top) / (photo.h * at.scale) };
    const zoomed = zoomCrop(photo, hero, crop, 2.2, anchor);
    const after = placeStage(photo, hero, zoomed);
    expect(zoomed.zoom).toBeCloseTo(2.2);
    expect(after.left + under.x * photo.w * after.scale).toBeCloseTo(anchor.x, 3);
    expect(after.top + under.y * photo.h * after.scale).toBeCloseTo(anchor.y, 3);
    expect(zoomCrop(photo, hero, crop, 99, anchor).zoom).toBe(MAX_ZOOM);
  });

  it('lets the stage centre a face at the photo\'s edge, stopping where the circle meets it', () => {
    // Dragged as far right and down as it goes: the circle's left and top reach the photo's edge.
    const crop = dragCrop(photo, hero, { face: { x: 0.5, y: 0.5 }, zoom: 1 }, 9000, 9000);
    const at = placeStage(photo, hero, crop);
    const r = (hero.w * FACE_SHARE) / 2;
    expect(at.left).toBeCloseTo(hero.w / 2 - r, 3);
    expect(at.top).toBeCloseTo(hero.h * 0.4 - r, 3);
    // Black shows past the edge on the stage, but the hero still covers its frame.
    expect(at.left).toBeGreaterThan(0);
    const page = placeCrop(photo, hero, crop);
    expect(page.left).toBeLessThanOrEqual(0);
    expect(page.top).toBeLessThanOrEqual(0);
    // The saved tag is the circle, flush with the photo's corner.
    const region = regionFor(photo, crop);
    expect(region.RegionX).toBeCloseTo(0, 1);
    expect(region.RegionY).toBeCloseTo(0, 1);
    expect(cropFrom(photo, region, null).face.x).toBeCloseTo(crop.face.x, 2);
  });

  it('gives the round thumbnail the same face', () => {
    expect(circleFocal({ RegionX: 40, RegionY: 20, RegionW: 10, RegionH: 15 })).toEqual({ focalX: 45, focalY: 27.5, focalRadius: 15 });
  });
});
