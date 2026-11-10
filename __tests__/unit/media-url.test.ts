import { describe, it, expect } from 'vitest';
import {
    THUMB_SIZES,
    snapThumbSize,
    isValidThumbSize,
    namedPdfUrl,
    mediaFileUrl,
    withThumbWidth,
} from '@/lib/media-url';

describe('snapThumbSize', () => {
    it('snaps small values up to the smallest whitelisted size', () => {
        expect(snapThumbSize(1)).toBe(64);
        expect(snapThumbSize(32)).toBe(64);
        expect(snapThumbSize(64)).toBe(64);
    });

    it('snaps mid values up to the next whitelisted size', () => {
        expect(snapThumbSize(65)).toBe(128);
        expect(snapThumbSize(200)).toBe(256);
        expect(snapThumbSize(500)).toBe(512);
    });

    it('caps oversized values at the largest whitelisted size', () => {
        expect(snapThumbSize(1024)).toBe(1024);
        expect(snapThumbSize(1025)).toBe(2048);
        expect(snapThumbSize(99999)).toBe(2048);
    });
});

describe('isValidThumbSize', () => {
    it('accepts whitelisted sizes', () => {
        for (const size of THUMB_SIZES) {
            expect(isValidThumbSize(size)).toBe(true);
        }
    });

    it('rejects non-whitelisted sizes', () => {
        expect(isValidThumbSize(63)).toBe(false);
        expect(isValidThumbSize(100)).toBe(false);
        expect(isValidThumbSize(999)).toBe(false);
        expect(isValidThumbSize(0)).toBe(false);
        expect(isValidThumbSize(-128)).toBe(false);
    });
});

describe('mediaFileUrl', () => {
    it('returns plain path with no options', () => {
        expect(mediaFileUrl(5)).toBe('/api/media/5/file');
    });

    it('preserves stable param order (treeId before w)', () => {
        expect(mediaFileUrl(5, { treeId: 7, width: 256 })).toBe(
            '/api/media/5/file?treeId=7&w=256',
        );
    });

    it('omits treeId when null or undefined', () => {
        expect(mediaFileUrl(5, { treeId: null, width: 64 })).toBe('/api/media/5/file?w=64');
        expect(mediaFileUrl(5, { width: 64 })).toBe('/api/media/5/file?w=64');
    });

    it('omits width when undefined', () => {
        expect(mediaFileUrl(5, { treeId: 7 })).toBe('/api/media/5/file?treeId=7');
    });

    it('keeps treeId=0 (not nullish)', () => {
        expect(mediaFileUrl(5, { treeId: 0, width: 64 })).toBe(
            '/api/media/5/file?treeId=0&w=64',
        );
    });
});

describe('withThumbWidth', () => {
    it('adds w to a media URL with no query', () => {
        expect(withThumbWidth('/api/media/5/file', 128)).toBe('/api/media/5/file?w=128');
    });

    it('adds w to a media URL preserving existing params', () => {
        expect(withThumbWidth('/api/media/5/file?ownerId=7', 128)).toBe(
            '/api/media/5/file?ownerId=7&w=128',
        );
    });

    it('replaces an existing w param', () => {
        expect(withThumbWidth('/api/media/5/file?w=64', 256)).toBe('/api/media/5/file?w=256');
    });

    it('returns non-media URLs unchanged', () => {
        expect(withThumbWidth('/api/people/5', 128)).toBe('/api/people/5');
        expect(withThumbWidth('https://example.com/photo.jpg', 128)).toBe(
            'https://example.com/photo.jpg',
        );
        expect(withThumbWidth('', 128)).toBe('');
    });
});

describe('namedPdfUrl (#1215)', () => {
    it('puts the title last so the PDF viewer shows it, keeping the query', () => {
        expect(namedPdfUrl('/api/media/12/file?treeId=3', 'Baptism record')).toBe('/api/media/12/file/Baptism%20record.pdf?treeId=3');
        expect(namedPdfUrl('/api/media/12/file', 'Will.pdf')).toBe('/api/media/12/file/Will.pdf');
    });

    it('keeps the name one path segment', () => {
        expect(namedPdfUrl('/api/media/12/file', 'a/b\\c?')).toBe('/api/media/12/file/a-b-c%3F.pdf');
    });

    it('leaves blob URLs and untitled files alone', () => {
        expect(namedPdfUrl('blob:http://localhost/966f2643', 'Will')).toBe('blob:http://localhost/966f2643');
        expect(namedPdfUrl('/api/media/12/file', '  ')).toBe('/api/media/12/file');
    });
});
