/**
 * Photo zoom and pan in the lightbox (#252). Pure maths, so the stage stays a thin
 * event layer and the rules can be tested without a browser.
 *
 * The image is laid out at its fitted size and centred in the stage. Zoom is a CSS
 * transform `translate(x, y) scale(scale)` with the origin at the image's centre, so a
 * point `p` on the fitted image (measured from its centre) lands on screen at
 * `centre + (x, y) + scale · p`. Scale 1 is Fit.
 */

export interface Zoom { scale: number; x: number; y: number }

export interface ZoomBox {
    /** The stage (Embla viewport) size. */
    stageW: number; stageH: number;
    /** The fitted, untransformed image size. */
    imgW: number; imgH: number;
}

export const FIT: Zoom = { scale: 1, x: 0, y: 0 };

/** Button and key steps multiply or divide the scale by this. */
export const ZOOM_STEP = 1.5;

/** Below this the photo counts as at Fit (swipe, backdrop close and arrows work again). */
export function isZoomed(z: Zoom): boolean {
    return z.scale > 1.001;
}

/** The scale at which one image pixel is one screen pixel, never below Fit. */
export function actualSizeScale(naturalW: number, imgW: number): number {
    if (!(naturalW > 0) || !(imgW > 0)) return 1;
    return Math.max(1, naturalW / imgW);
}

/** How far in you can go: four times Fit, or twice actual size for a large scan. */
export function maxScale(oneToOne: number): number {
    return Math.max(4, oneToOne * 2);
}

/** Keeps the photo over the stage: no pan past an edge, and a dimension smaller than the stage stays centred. */
export function clampPan(z: Zoom, box: ZoomBox): Zoom {
    const limX = Math.max(0, (z.scale * box.imgW - box.stageW) / 2);
    const limY = Math.max(0, (z.scale * box.imgH - box.stageH) / 2);
    return { scale: z.scale, x: Math.min(limX, Math.max(-limX, z.x)), y: Math.min(limY, Math.max(-limY, z.y)) };
}

/**
 * Zooms to `nextScale` keeping the point under `focus` still. `focus` is measured from
 * the stage centre in screen pixels; pass {x: 0, y: 0} to zoom around the centre.
 */
export function zoomAt(z: Zoom, nextScale: number, focus: { x: number; y: number }, box: ZoomBox, max: number): Zoom {
    const scale = Math.min(max, Math.max(1, nextScale));
    if (scale <= 1.001) return FIT;
    const k = scale / z.scale;
    return clampPan({ scale, x: focus.x - k * (focus.x - z.x), y: focus.y - k * (focus.y - z.y) }, box);
}

/** Moves a zoomed photo by a screen delta, kept over the stage. */
export function panBy(z: Zoom, dx: number, dy: number, box: ZoomBox): Zoom {
    if (!isZoomed(z)) return z;
    return clampPan({ scale: z.scale, x: z.x + dx, y: z.y + dy }, box);
}

/** The wheel's zoom factor. A trackpad pinch arrives as a wheel event with ctrlKey and small deltas. */
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
    const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
    return Math.exp(-px * (pinch ? 0.01 : 0.002));
}

/** The percentage shown in the zoom control: the image's on-screen size against its own pixels. */
export function zoomPercent(scale: number, oneToOne: number): number {
    return Math.round((scale / oneToOne) * 100);
}
