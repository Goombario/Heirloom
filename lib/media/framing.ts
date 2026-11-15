/**
 * How a face-tagged photo is framed in every portrait, avatar and card
 * (`ProfileImage`). Edit the numbers in `PORTRAIT_FRAMING` to change how close
 * the app crops faces; every container follows.
 *
 * The rule: the face tag fits inside a share of the frame, its centre sits a
 * little above the middle, and the photo always covers the frame. When the face
 * is near the photo's edge the photo slides back to keep covering, so the face
 * moves off-centre rather than the crop zooming further in.
 *
 * The phone person hero and its crop sheet frame with their own rule
 * (`app/people/view/mobile/portrait.ts`, FACE_SHARE), which this matches closely.
 */

interface FramingShares {
    /** Share of a rectangle's limiting side the face tag fills (0–1). */
    rect: number;
    /** Share of a circle's diameter the face tag's longer side fills (0–1). */
    circle: number;
}

export const PORTRAIT_FRAMING = {
    /** Pages wider than the phone breakpoint (768px and up). */
    desktop: { rect: 0.55, circle: 0.72 } satisfies FramingShares,
    /** Phone pages (below 768px). */
    phone: { rect: 0.55, circle: 0.72 } satisfies FramingShares,
    /** Where the face centre sits down a rectangle, as a share of its height. Circles centre it. */
    faceTop: 0.45,
} as const;

interface FrameInput {
    /** The photo's pixel size (natural, or as drawn before scaling). */
    photo: { w: number; h: number };
    /** The frame's size in CSS px. */
    frame: { w: number; h: number };
    /** Face centre, as percent of the photo's width and height. */
    focalX: number;
    focalY: number;
    /**
     * The face's size. With `regionW`/`regionH` (the tag's percent of the photo's width
     * and height) the tag box is exact; otherwise `focalRadius` is read the stored way:
     * percent of half the photo's short side, as a square box of that diameter.
     */
    focalRadius: number;
    regionW?: number | null;
    regionH?: number | null;
    circular: boolean;
    shares: FramingShares;
}

/** Where to draw the photo: top-left offset in frame px, and frame px per photo px. */
interface FramePlacement { left: number; top: number; scale: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The face tag's box in photo pixels. */
function tagBox({ photo, focalRadius, regionW, regionH }: Pick<FrameInput, 'photo' | 'focalRadius' | 'regionW' | 'regionH'>): { w: number; h: number } {
    if (regionW != null && regionH != null && regionW > 0 && regionH > 0) {
        return { w: (regionW / 100) * photo.w, h: (regionH / 100) * photo.h };
    }
    const d = Math.max(1, (focalRadius / 100) * Math.min(photo.w, photo.h));
    return { w: d, h: d };
}

export function framePhoto(input: FrameInput): FramePlacement {
    const { photo, frame, circular, shares } = input;
    const tag = tagBox(input);
    const want = circular
        ? (shares.circle * Math.min(frame.w, frame.h)) / Math.max(tag.w, tag.h)
        : shares.rect * Math.min(frame.w / tag.w, frame.h / tag.h);
    const cover = Math.max(frame.w / photo.w, frame.h / photo.h);
    const scale = Math.max(want, cover);
    const w = photo.w * scale, h = photo.h * scale;
    const fx = clamp(input.focalX / 100, 0, 1), fy = clamp(input.focalY / 100, 0, 1);
    const faceAt = circular ? 0.5 : PORTRAIT_FRAMING.faceTop;
    return {
        left: clamp(frame.w * 0.5 - fx * w, frame.w - w, 0),
        top: clamp(frame.h * faceAt - fy * h, frame.h - h, 0),
        scale,
    };
}
