/**
 * The single media allowlist: which files an upload may store.
 *
 * Previously copy-pasted between `lib/services/media-upload.ts` and
 * `lib/data/local/media.ts` — two copies of a security-relevant allowlist that
 * must not drift (#592). The hosted and local upload paths diverge in plenty of
 * deliberate ways (storage substrate, image processing, size caps); which file
 * types are accepted is not one of them. Browser-safe: no Node imports.
 *
 * Photos are images. Documents (#510) are PDFs only, and a PDF must also start
 * with the `%PDF-` signature, so a renamed file of another kind is refused.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
]);

const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['.pdf']);

/** Every extension an upload, import or recovery may store. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

export const PDF_CONTENT_TYPE = 'application/pdf';

/** Case-insensitive membership test for a `path.extname`-style extension. */
export function isAllowedImageExtension(ext: string): boolean {
    return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

/** The lower-case extension of a file name, with its dot, or '' when it has none. */
export function fileExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export type UploadKind = 'image' | 'pdf';

/**
 * What an upload is, judged by its name and declared type, or null when it is
 * not allowed. A PDF's declared type may be empty: some systems send none, and
 * its bytes are checked with `hasPdfSignature` before anything is stored.
 */
export function classifyUpload(name: string, type: string): UploadKind | null {
    const ext = fileExtension(name);
    if (IMAGE_EXTENSIONS.has(ext)) return type.startsWith('image/') ? 'image' : null;
    if (DOCUMENT_EXTENSIONS.has(ext)) return type === PDF_CONTENT_TYPE || type === '' ? 'pdf' : null;
    return null;
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** Whether these bytes start like a PDF file. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
    return bytes.length >= PDF_SIGNATURE.length && PDF_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

const GIF_SIGNATURES = ['GIF87a', 'GIF89a'];

/**
 * Whether the bytes of a file stored as it came (SVG and GIF skip the image
 * pipeline that would reject anything undecodable) look like that format
 * (#51, L-3). A GIF starts with its signature; an SVG is text that opens
 * with markup and has an `<svg` element in its first 4 KB. Defence in depth:
 * stored media is also served sandboxed.
 */
export function hasPassthroughImageSignature(ext: string, bytes: Uint8Array): boolean {
    const head = bytes.subarray(0, 4096);
    if (ext === '.gif') {
        const sig = String.fromCharCode(...head.subarray(0, 6));
        return GIF_SIGNATURES.includes(sig);
    }
    if (ext === '.svg') {
        if (head.includes(0)) return false;
        const text = new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/^\uFEFF/, '').trimStart();
        return text.startsWith('<') && /<svg[\s>/]/i.test(text);
    }
    return true;
}

/** Whether a stored media row is a PDF document rather than a photo. */
export function isPdfMedia(media: { ContentType?: string | null } | null | undefined): boolean {
    return media?.ContentType === PDF_CONTENT_TYPE;
}

/** The type a bundled file is handed to the importer with, from its extension. */
export function contentTypeForExtension(ext: string): string {
    switch (ext.toLowerCase()) {
        case '.jpg': case '.jpeg': return 'image/jpeg';
        case '.png': return 'image/png';
        case '.gif': return 'image/gif';
        case '.webp': return 'image/webp';
        case '.svg': return 'image/svg+xml';
        case '.bmp': return 'image/bmp';
        case '.tif': case '.tiff': return 'image/tiff';
        case '.pdf': return PDF_CONTENT_TYPE;
        default: return 'application/octet-stream';
    }
}
