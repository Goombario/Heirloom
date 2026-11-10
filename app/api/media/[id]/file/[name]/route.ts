/**
 * GET /api/media/[id]/file/[name] - the same file as /api/media/[id]/file.
 *
 * The browser's PDF viewer titles a document by the last segment of its URL and
 * ignores Content-Disposition, so the media viewer frames a PDF under its title
 * (`/file/Baptism%20record.pdf`). The name is cosmetic: the id alone picks the
 * file, with the same auth and tree checks (#1215).
 */
export { GET } from '../route';
