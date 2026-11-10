import { archiveMediaFilename } from '@/lib/gedcom/media-archive-name';

/**
 * The Content-Disposition a served media file gets (#510): its title as the
 * file name, with the stored file's extension, so "Open in new tab" and
 * Download save `birth-register-1889.pdf` rather than the random stored name.
 * The plain `filename` keeps only safe ASCII; `filename*` carries the full
 * UTF-8 name for browsers that read it, so a Russian title survives.
 */
export function mediaContentDisposition(
    media: { Title?: string | null; FilePath: string },
    attachment: boolean,
): string {
    const name = archiveMediaFilename(media);
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : '';
    const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
    const ascii = `${/[A-Za-z0-9]/.test(stem) ? stem : 'media'}${ext}`;
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${attachment ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
