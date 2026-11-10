import { describe, it, expect } from 'vitest';
import { mediaBasename, externalReferenceBasename, isExternalMediaReference, findMissingMedia, expectedMediaBasenames, matchArchiveMedia, findMissingMediaRefs, matchArchiveMediaExact, normalizeArchiveManifest, resolveInitialArchivePath } from '@/lib/gedcom/media-match';

const entry = (archivePath: string, value: string) => ({ archivePath, file: value });

describe('matchArchiveMedia', () => {
    it('prefers an exact normalized archive path', () => {
        const entries = [entry('media/O1/photo.jpg', 'first'), entry('media/O2/photo.jpg', 'second')];
        expect(matchArchiveMedia({ archivePath: './media/O2/photo.jpg', originalFilename: 'photo.jpg' }, entries)).toBe('second');
    });

    it('uses a unique-basename fallback for an old bundle entry', () => {
        expect(matchArchiveMedia({ archivePath: 'media/O1/photo.jpg', originalFilename: 'photo.jpg' }, [entry('photo.jpg', 'legacy')])).toBe('legacy');
    });

    it('refuses an ambiguous basename fallback', () => {
        const entries = [entry('media/O1/photo.jpg', 'first'), entry('media/O2/photo.jpg', 'second')];
        expect(matchArchiveMedia({ archivePath: 'media/O3/photo.jpg', originalFilename: 'photo.jpg' }, entries)).toBeNull();
    });

    it('keeps equal basenames distinct when archive paths differ', () => {
        const entries = [entry('media/O1/photo.jpg', 'first'), entry('media/O2/photo.jpg', 'second')];
        expect(matchArchiveMedia({ archivePath: 'media/O1/photo.jpg', originalFilename: 'photo.jpg' }, entries)).toBe('first');
        expect(matchArchiveMedia({ archivePath: 'media/O2/photo.jpg', originalFilename: 'photo.jpg' }, entries)).toBe('second');
    });

    it('rejects every path containing a parent segment', () => {
        expect(matchArchiveMedia({ archivePath: 'media/../photo.jpg', originalFilename: 'photo.jpg' }, [entry('photo.jpg', 'unsafe')])).toBeNull();
        expect(matchArchiveMedia({ archivePath: 'media/O1/..\\photo.jpg', originalFilename: 'photo.jpg' }, [entry('photo.jpg', 'unsafe')])).toBeNull();
    });
});

describe('durable archive identity', () => {
    it('normalizes a manifest and rejects empty, unsafe, and normalized-duplicate entries', () => {
        expect(normalizeArchiveManifest(['./media/O1/photo.jpg', 'media\\O2\\scan.pdf']))
            .toEqual(['media/O1/photo.jpg', 'media/O2/scan.pdf']);
        expect(() => normalizeArchiveManifest([''])).toThrow();
        expect(() => normalizeArchiveManifest(['media/../photo.jpg'])).toThrow();
        expect(() => normalizeArchiveManifest(['media/O1/photo.jpg', 'media\\O1\\photo.jpg'])).toThrow();
    });

    it('selects an exact initial path before considering legacy basename compatibility', () => {
        expect(resolveInitialArchivePath(
            { archivePath: 'media/O1/photo.jpg', originalFilename: 'photo.jpg' },
            ['photo.jpg', 'media/O1/photo.jpg'],
            { allowLegacyV1: true },
        )).toBe('media/O1/photo.jpg');
    });

    it('selects a unique manifest basename only for legacy first intake', () => {
        const expected = { archivePath: 'media/O1/photo.jpg', originalFilename: 'photo.jpg' };
        expect(resolveInitialArchivePath(expected, ['photo.jpg'], { allowLegacyV1: true })).toBe('photo.jpg');
        expect(resolveInitialArchivePath(expected, ['photo.jpg'], { allowLegacyV1: false })).toBe('media/O1/photo.jpg');
        expect(resolveInitialArchivePath(expected, ['one/photo.jpg', 'two/photo.jpg'], { allowLegacyV1: true }))
            .toBe('media/O1/photo.jpg');
    });

    it('matches a case-only difference when one entry fits, preferring the exact case (#1005)', () => {
        const expected = { archivePath: 'photos/Ann.PNG', originalFilename: 'Ann.PNG' };
        expect(resolveInitialArchivePath(expected, ['Photos/ann.png'], { allowLegacyV1: false })).toBe('Photos/ann.png');
        expect(resolveInitialArchivePath(expected, ['Photos/ann.png', 'photos/ANN.png'], { allowLegacyV1: false })).toBe('photos/Ann.PNG');
        expect(resolveInitialArchivePath({ archivePath: 'ann.png', originalFilename: 'Ann.png' }, ['Lee Media/ann.png'], { allowLegacyV1: true }))
            .toBe('Lee Media/ann.png');
        expect(resolveInitialArchivePath({ archivePath: 'ann.png', originalFilename: 'ann.png' }, ['a/Ann.png', 'b/ann.png'], { allowLegacyV1: true }))
            .toBe('b/ann.png');
    });

    it('uses exact normalized retry matching and never falls back by basename', () => {
        const entries = [entry('media/O1/photo.jpg', 'first'), entry('photo.jpg', 'legacy')];
        expect(matchArchiveMediaExact({ archivePath: 'media\\O1\\photo.jpg' }, entries)).toBe('first');
        expect(matchArchiveMediaExact({ archivePath: 'media/O2/photo.jpg' }, entries)).toBeNull();
    });
});

describe('mediaBasename', () => {
    it('returns the filename from a posix path', () => {
        expect(mediaBasename('media/photo.jpg')).toBe('photo.jpg');
    });

    it('returns the filename from a windows path', () => {
        expect(mediaBasename('uploads\\1\\media\\photo.jpg')).toBe('photo.jpg');
    });

    it('returns the filename from a mixed separator path', () => {
        expect(mediaBasename('a/b\\c.jpg')).toBe('c.jpg');
    });

    it('returns a bare filename unchanged', () => {
        expect(mediaBasename('photo.jpg')).toBe('photo.jpg');
    });
});

describe('findMissingMedia', () => {
    it('returns expected files that are not available', () => {
        expect(findMissingMedia(['a.jpg', 'b.jpg'], ['a.jpg'])).toEqual(['b.jpg']);
    });

    it('returns empty when every expected file is available', () => {
        expect(findMissingMedia(['a.jpg', 'b.jpg'], ['a.jpg', 'b.jpg'])).toEqual([]);
    });

    it('compares by basename so pathful expected entries still match', () => {
        expect(findMissingMedia(['media/b.jpg'], ['b.jpg'])).toEqual([]);
    });

    it('reports each missing file once, preserving first-seen order', () => {
        expect(findMissingMedia(['b.jpg', 'b.jpg', 'a.jpg'], ['a.jpg'])).toEqual(['b.jpg']);
    });

    it('accepts any iterable of available names (e.g. a Map keys iterator)', () => {
        const available = new Map([['a.jpg', 1]]).keys();
        expect(findMissingMedia(['a.jpg', 'c.jpg'], available)).toEqual(['c.jpg']);
    });
});

describe('findMissingMediaRefs', () => {
    it('does not collapse same-basename entries with distinct archive identities', () => {
        const expected = [
            { archivePath: 'media/O1/photo.jpg', originalFilename: 'photo.jpg' },
            { archivePath: 'media/O2/photo.jpg', originalFilename: 'photo.jpg' },
        ];
        const available = [entry('media/O1/photo.jpg', 'first')];

        expect(findMissingMediaRefs(expected, available)).toEqual(['media/O2/photo.jpg']);
    });

    it('resolves a ref that carries the import rule exactly as the import does (#1005)', () => {
        const available = [entry('Lee Media/ann.png', 'ann'), entry('a/dup.png', 'a'), entry('b/dup.png', 'b')];
        expect(findMissingMediaRefs([
            { archivePath: 'ann.png', originalFilename: 'ann.png', basenameFallback: true },
            { archivePath: 'dup.png', originalFilename: 'dup.png', basenameFallback: true },
            { archivePath: 'Other/ann.png', originalFilename: 'ann.png', basenameFallback: false },
        ], available)).toEqual(['dup.png', 'Other/ann.png']);
    });
});

describe('expectedMediaBasenames', () => {
    it('collects basenames from person media file paths', () => {
        const personMedia = [{ FilePath: 'media/a.jpg' }, { FilePath: 'b.png' }];
        expect(expectedMediaBasenames(personMedia, [])).toEqual(['a.jpg', 'b.png']);
    });

    it('includes library files from the media.json sidecar', () => {
        expect(expectedMediaBasenames([], ['lib/c.jpg'])).toEqual(['c.jpg']);
    });

    it('skips person media with no file path', () => {
        const personMedia = [{ FilePath: null }, { FilePath: 'a.jpg' }];
        expect(expectedMediaBasenames(personMedia, [])).toEqual(['a.jpg']);
    });

    it('deduplicates across person media and library files', () => {
        const personMedia = [{ FilePath: 'a.jpg' }, { FilePath: 'media/a.jpg' }];
        expect(expectedMediaBasenames(personMedia, ['a.jpg'])).toEqual(['a.jpg']);
    });
});

describe('external media references (#958)', () => {
    it('recognizes URLs, drive, rooted and UNC paths, but not bundle paths', () => {
        for (const path of ['C:\\FTM\\a.jpg', 'd:/photos/a.jpg', '/Users/ada/a.jpg', '\\\\server\\share\\a.jpg', 'http://x.org/a.jpg', 'file:///C:/a.jpg']) {
            expect(isExternalMediaReference(path)).toBe(true);
        }
        for (const path of ['a.jpg', 'media/O1/a.jpg', '../a.jpg', 'C:a.jpg']) {
            expect(isExternalMediaReference(path)).toBe(false);
        }
    });

    it('names only the file, decoding a URL and dropping its query', () => {
        expect(externalReferenceBasename('C:\\FTM\\Tree Media\\a.jpg')).toBe('a.jpg');
        expect(externalReferenceBasename('https://x.org/scans/a%20b.jpg?w=2#top')).toBe('a b.jpg');
        expect(externalReferenceBasename('c:\\users\\ada\\Photos\\')).toBeNull();
        expect(externalReferenceBasename('C:\\photos\\..')).toBeNull();
        expect(externalReferenceBasename('http://x.org/%E0%A4%A')).toBe('%E0%A4%A');
    });
});
