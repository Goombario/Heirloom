/**
 * The file name a photo gets inside an export bundle (#802, MD-2): its title,
 * slugged, with the stored file's extension, so a photo is
 * `grandmother-anna-1921.jpg` rather than `case_1719…jpg`. Letters in any script
 * are kept, so a Russian title stays readable. Falls back to the stored name
 * when there's no usable title. `archiveMediaPath` adds the xref prefix.
 */
export function archiveMediaFilename(media: { Title?: string | null; FilePath: string }): string {
    const stored = media.FilePath.split(/[\\/]/).pop() || media.FilePath;
    const dot = stored.lastIndexOf('.');
    const ext = dot > 0 ? stored.slice(dot).toLowerCase() : '';
    // A title that is just the uploaded file's name ("family-1900.jpg") loses its extension.
    const title = (media.Title ?? '').normalize('NFC').replace(/\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp|svg|pdf)$/i, '');
    const slug = title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/, '');
    // A Windows device name ("Con", "com1") can't be extracted as a file there.
    if (!slug || WINDOWS_RESERVED.test(slug)) return stored;
    return `${slug}${ext}`;
}

/**
 * A photo's path inside an export bundle. Bundle v3 (#937) keeps every photo in
 * one `media/` folder, its name prefixed with its GEDCOM xref
 * (`media/O3-grandmother-anna-1921.jpg`), so two photos with the same title never
 * collide and the FILE line still matches its zip entry exactly. v2 bundles used a
 * folder per photo (`media/O3/…`) and v1 bare names; both still import
 * (`lib/gedcom/media-match.ts`). The GEDCOM FILE line and both zip writers call
 * this, so the three stay in step. A photo with no xref goes under `media/library/`.
 */
export function archiveMediaPath(xref: string | null | undefined, media: { Title?: string | null; FilePath: string }): string {
    const name = archiveMediaFilename(media);
    const bare = xref?.replace(/^@|@$/g, '');
    return bare ? `media/${bare}-${name}` : `media/library/${name}`;
}

/** The `media.json` version, which also marks the bundle's media layout (#937). */
export const MEDIA_BUNDLE_VERSION = 3;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
