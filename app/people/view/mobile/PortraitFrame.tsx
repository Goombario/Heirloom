'use client';

import React, { useState } from 'react';
import { useMediaUrl } from '@/lib/media/useMediaUrl';
import { focalThumbWidth, withThumbWidth } from '@/lib/media-url';
import { placeCrop, placeStage, type Crop, type Point, type Size } from './portrait';

/** The photo to frame: a media row, or a picked file not uploaded yet (Take a photo, Upload). */
export type PortraitPhoto = { mediaId: number } | { fileUrl: string };

interface FrameProps {
    photo: PortraitPhoto;
    treeId: number | null;
    frame: Size;
    /** The crop, or how to make one once the photo's size is known. */
    crop: Crop | ((size: Size) => Crop);
    alt: string;
    /** Where the face sits in the frame (default: centred, 40% down). */
    faceAt?: Point;
    eager?: boolean;
    /** The crop stage: the face stays under the circle, with black past the photo's edge. */
    stage?: boolean;
    /** The photo's own size, once it has loaded. */
    onSize?: (size: Size) => void;
}

/**
 * A photo framed by a crop (portrait.ts): the 4:3 hero, the crop stage and its
 * previews. It fills its parent, which sets the size and clips.
 */
export function PortraitFrame(props: FrameProps) {
    // Keyed by photo: a different photo starts blank rather than showing the last one
    // under the new crop.
    return 'mediaId' in props.photo
        ? <MediaFrame key={props.photo.mediaId} {...props} mediaId={props.photo.mediaId} />
        : <FramedImg key={props.photo.fileUrl} {...props} url={props.photo.fileUrl} />;
}

function MediaFrame({ mediaId, ...props }: FrameProps & { mediaId: number }) {
    const width = focalThumbWidth(props.frame.w * (typeof props.crop === 'function' ? 1 : props.crop.zoom));
    const { src } = useMediaUrl(mediaId, { treeId: props.treeId, width });
    // Zooming changes the width asked for, and a local photo's URL is briefly null while
    // the next size is read; keep the last one until then.
    const url = src ? withThumbWidth(src, width) : null;
    const [held, setHeld] = useState(url);
    if (url && url !== held) setHeld(url);
    const show = url ?? held;
    return show ? <FramedImg {...props} url={show} /> : null;
}

/**
 * The photo on show, and the next copy loading behind it. Zooming in asks for a
 * sharper copy; it takes over once it has loaded and decoded, so the frame never goes
 * blank in between (it used to flash black). The placement doesn't depend on which
 * copy is up: only the photo's shape matters, not its pixel count.
 */
function FramedImg({ url, frame, crop, alt, faceAt, eager, stage, onSize }: FrameProps & { url: string }) {
    const [shown, setShown] = useState<{ url: string; size: Size } | null>(null);
    const c = shown && (typeof crop === 'function' ? crop(shown.size) : crop);
    const at = shown && c && frame.w > 0 ? (stage ? placeStage(shown.size, frame, c) : placeCrop(shown.size, frame, c, faceAt)) : null;
    const urls = shown && shown.url !== url ? [shown.url, url] : [url];
    return urls.map((u) => {
        const up = at && shown && u === shown.url;
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                key={u}
                src={u}
                alt={up || !shown ? alt : ''}
                aria-hidden={up || !shown ? undefined : true}
                draggable={false}
                loading={eager || shown ? 'eager' : 'lazy'}
                decoding="async"
                onLoad={(e) => {
                    const el = e.currentTarget;
                    const next = { w: el.naturalWidth, h: el.naturalHeight };
                    if (!next.w || !next.h || u !== url) return;
                    // Swap only once it can paint, or the swap itself shows a blank frame.
                    void el.decode().catch(() => undefined).then(() => {
                        setShown((cur) => (cur?.url === u ? cur : { url: u, size: next }));
                        onSize?.(next);
                    });
                }}
                className="absolute left-0 top-0 max-w-none select-none pointer-events-none"
                style={up
                    ? { width: shown.size.w, height: shown.size.h, transformOrigin: '0 0', transform: `translate(${at.left}px, ${at.top}px) scale(${at.scale})`, willChange: 'transform' }
                    : { width: '100%', height: '100%', objectFit: 'cover', opacity: 0 }}
            />
        );
    });
}
