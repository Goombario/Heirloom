/*
 * How the phone frames a portrait (#1051). One rule drives the crop screen, the 4:3
 * hero and their previews, so what you set is what the page shows.
 *
 * The portrait is this person's face tag on the photo (a square in the photo's pixels,
 * stored as percentages). In the 4:3 hero the face sits centred across and at 40%
 * down, and is drawn FACE_SHARE of the frame wide. Zoom has a floor: the photo always
 * covers the frame, so a large face tag never leaves bars; and a cap, so a tiny one
 * doesn't blow a scan up to its pixels. The photo's shared focal point is never
 * written (#1054 decision "Portrait").
 *
 * The crop stage is looser: the photo may leave black past its edge, as far as the face
 * circle reaching the edge, so a face at the edge of a photo can be centred in the
 * circle. The hero and previews still cover their frame and pull the photo back.
 */

/** The face's share of the hero's width, and where its centre sits down the frame. */
export const FACE_SHARE = 0.4;
const FACE_TOP = 0.4;
/** Most the crop zooms in past "the photo just covers the frame". */
export const MAX_ZOOM = 3;

export interface Size { w: number; h: number }
/** A point on the photo, as fractions of its width and height (0–1). */
export interface Point { x: number; y: number }
/** A face tag region, in percent of the photo (MediaTag's RegionX/Y/W/H). */
export interface Region { RegionX: number; RegionY: number; RegionW: number; RegionH: number }

/** Where the photo is drawn: its top-left offset and pixels per photo pixel. */
export interface Placement { left: number; top: number; scale: number }

/** The crop's state: the photo point under the face circle, and zoom over the cover floor. */
export interface Crop { face: Point; zoom: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Smallest scale at which the photo covers the frame. */
export function coverScale(photo: Size, frame: Size): number {
    return Math.max(frame.w / photo.w, frame.h / photo.h);
}

/**
 * Places the photo so `face` sits at the frame's face spot, pulled back where that
 * would uncover an edge. `faceAt` is that spot as fractions of the frame.
 */
function place(photo: Size, frame: Size, face: Point, scale: number, faceAt: Point = { x: 0.5, y: FACE_TOP }): Placement {
    const w = photo.w * scale, h = photo.h * scale;
    return {
        left: clamp(frame.w * faceAt.x - face.x * w, frame.w - w, 0),
        top: clamp(frame.h * faceAt.y - face.y * h, frame.h - h, 0),
        scale,
    };
}

/**
 * The face point kept far enough in that the face circle stays on the photo: the crop
 * stage's only limit. At a scale where the circle is wider than the photo, the middle.
 */
function keepCircleOn(photo: Size, frame: Size, face: Point, scale: number): Point {
    const r = (frame.w * FACE_SHARE) / 2;
    const rx = Math.min(0.5, r / (photo.w * scale)), ry = Math.min(0.5, r / (photo.h * scale));
    return { x: clamp(face.x, rx, 1 - rx), y: clamp(face.y, ry, 1 - ry) };
}

/** Places the photo for the crop stage: `face` exactly at the face spot, black allowed past the edge. */
function placeLoose(photo: Size, frame: Size, face: Point, scale: number, faceAt: Point = { x: 0.5, y: FACE_TOP }): Placement {
    const f = keepCircleOn(photo, frame, face, scale);
    return { left: frame.w * faceAt.x - f.x * photo.w * scale, top: frame.h * faceAt.y - f.y * photo.h * scale, scale };
}

/** The photo point under the frame's face spot once placed (after any pull-back). */
function faceUnder(photo: Size, frame: Size, at: Placement, faceAt: Point = { x: 0.5, y: FACE_TOP }): Point {
    return {
        x: (frame.w * faceAt.x - at.left) / (photo.w * at.scale),
        y: (frame.h * faceAt.y - at.top) / (photo.h * at.scale),
    };
}

/** The face circle's diameter in photo pixels for a crop, in a frame of this size. */
function faceDiameter(photo: Size, frame: Size, zoom: number): number {
    return (frame.w * FACE_SHARE) / (coverScale(photo, frame) * zoom);
}

/** A crop that shows this region (or, without one, the photo's focal point at the cover floor). */
export function cropFrom(photo: Size, region: Region | null, focal: Point | null): Crop {
    if (region && region.RegionW > 0 && region.RegionH > 0) {
        const face = { x: (region.RegionX + region.RegionW / 2) / 100, y: (region.RegionY + region.RegionH / 2) / 100 };
        // The tag's longer side, in photo pixels, is the circle it was drawn as.
        const d = Math.max((region.RegionW / 100) * photo.w, (region.RegionH / 100) * photo.h);
        const unit: Size = { w: 4, h: 3 };
        const zoom = clamp((unit.w * FACE_SHARE) / (coverScale(photo, unit) * d), 1, MAX_ZOOM);
        return { face, zoom };
    }
    return { face: focal ?? { x: 0.5, y: FACE_TOP }, zoom: 1 };
}

/** Where to draw the photo for a crop in a frame that it must cover: the hero, a preview. */
export function placeCrop(photo: Size, frame: Size, crop: Crop, faceAt?: Point): Placement {
    return place(photo, frame, crop.face, coverScale(photo, frame) * crop.zoom, faceAt);
}

/** Where the crop stage draws the photo: the face under the circle, even near an edge. */
export function placeStage(photo: Size, frame: Size, crop: Crop): Placement {
    return placeLoose(photo, frame, crop.face, coverScale(photo, frame) * crop.zoom);
}

/** The face tag a crop saves: a square of the circle's size around the face, in percent. */
export function regionFor(photo: Size, crop: Crop): Region {
    const unit: Size = { w: 4, h: 3 };
    // Saved from where the stage's circle sits: on the face, even at the photo's edge.
    const face = keepCircleOn(photo, unit, crop.face, coverScale(photo, unit) * crop.zoom);
    const d = faceDiameter(photo, unit, crop.zoom);
    const w = (d / photo.w) * 100, h = (d / photo.h) * 100;
    const x = clamp(face.x * 100 - w / 2, 0, 100 - Math.min(w, 100));
    const y = clamp(face.y * 100 - h / 2, 0, 100 - Math.min(h, 100));
    return { RegionX: round(x), RegionY: round(y), RegionW: round(Math.min(w, 100)), RegionH: round(Math.min(h, 100)) };
}

/** Moves the crop by a drag of (dx, dy) screen pixels on a stage of this size. */
export function dragCrop(photo: Size, frame: Size, crop: Crop, dx: number, dy: number): Crop {
    const at = placeStage(photo, frame, crop);
    const moved = { ...at, left: at.left + dx, top: at.top + dy };
    // Stop where the circle reaches the photo's edge.
    return { ...crop, face: keepCircleOn(photo, frame, faceUnder(photo, frame, moved), at.scale) };
}

/**
 * Changes zoom, keeping the photo point under `anchor` (frame pixels: the fingers'
 * midpoint in a pinch, the tap in a double-tap) where it is. Without one, the face
 * spot stays put.
 */
export function zoomCrop(photo: Size, frame: Size, crop: Crop, zoom: number, anchor?: Point): Crop {
    const z = clamp(zoom, 1, MAX_ZOOM);
    const at = placeStage(photo, frame, crop);
    const a = anchor ?? { x: frame.w * 0.5, y: frame.h * FACE_TOP };
    const under = { x: (a.x - at.left) / (photo.w * at.scale), y: (a.y - at.top) / (photo.h * at.scale) };
    const scale = coverScale(photo, frame) * z;
    const moved = { left: a.x - under.x * photo.w * scale, top: a.y - under.y * photo.h * scale, scale };
    return { zoom: z, face: keepCircleOn(photo, frame, faceUnder(photo, frame, moved), scale) };
}

/** The circle crop for a round thumbnail: ProfileImage's focal props for this region. */
export function circleFocal(region: Region): { focalX: number; focalY: number; focalRadius: number } {
    return {
        focalX: region.RegionX + region.RegionW / 2,
        focalY: region.RegionY + region.RegionH / 2,
        focalRadius: Math.max(region.RegionW, region.RegionH),
    };
}

const round = (v: number) => Math.round(v * 100) / 100;
