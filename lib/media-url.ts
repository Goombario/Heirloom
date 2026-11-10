/**
 * Builds `/api/media/{id}/file` URLs and snaps thumbnail sizes to the
 * server-side whitelist. The thumbnail endpoint at app/api/media/[id]/file
 * rejects any `w` value not in THUMB_SIZES with a 400.
 */

export const THUMB_SIZES = [64, 128, 256, 512, 1024, 2048] as const;
export type ThumbSize = (typeof THUMB_SIZES)[number];

export function snapThumbSize(target: number): ThumbSize {
    for (const size of THUMB_SIZES) {
        if (size >= target) return size;
    }
    return THUMB_SIZES[THUMB_SIZES.length - 1];
}

/**
 * The thumbnail width `ProfileImage` will request for a given container and
 * focal crop, snapped to the server whitelist.
 *
 * ~2x the container width to look sharp on retina. When a focal radius is set
 * the image is zoomed so only ~focalRadius% of its min-dimension maps onto the
 * container — visible resolution is thumbWidth x (focalRadius/100) — so the
 * target scales up to keep the focal region itself sharp.
 *
 * Exported (rather than inlined in ProfileImage) so a prefetcher can warm the
 * EXACT variant the component will later ask for. A warm at a different width is
 * a different cache key in both modes — a wasted fetch that still leaves the
 * real one cold.
 */
export function focalThumbWidth(
    containerWidth: number,
    focalRadius?: number | null,
    override?: number,
): ThumbSize {
    const zoomFactor =
        focalRadius != null && focalRadius > 0 && focalRadius < 100 ? 100 / focalRadius : 1;
    const target = override ?? Math.ceil(containerWidth * 2 * zoomFactor);
    return snapThumbSize(target);
}

export function isValidThumbSize(value: number): value is ThumbSize {
    return (THUMB_SIZES as readonly number[]).includes(value);
}

export function mediaFileUrl(
    mediaId: number,
    opts?: { treeId?: number | null; width?: number },
): string {
    const parts: string[] = [];
    if (opts?.treeId != null) parts.push(`treeId=${opts.treeId}`);
    if (opts?.width != null) parts.push(`w=${opts.width}`);
    const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
    return `/api/media/${mediaId}/file${qs}`;
}

/**
 * A hosted PDF's file URL with its title as the last segment. The browser's PDF
 * viewer shows that segment as the document's name (#1215). Any other URL (a
 * local build's blob: URL) comes back unchanged.
 */
export function namedPdfUrl(src: string, title: string): string {
    const match = /^(\/api\/media\/\d+\/file)(\?.*)?$/.exec(src);
    const stem = title.replace(/[\\/]+/g, '-').replace(/\.pdf$/i, '').trim();
    if (!match || !stem) return src;
    return `${match[1]}/${encodeURIComponent(`${stem}.pdf`)}${match[2] ?? ''}`;
}

/**
 * Append/replace `w` on an existing media URL while preserving other params.
 * Returns the original string unchanged for non-media URLs.
 */
export function withThumbWidth(src: string, width: number): string {
    if (!/\/api\/media\/\d+\/file(\?|$)/.test(src)) return src;
    const [pathname, search = ''] = src.split('?');
    const params = new URLSearchParams(search);
    params.set('w', String(width));
    return `${pathname}?${params.toString()}`;
}
