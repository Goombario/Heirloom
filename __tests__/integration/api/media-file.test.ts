import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/media/[id]/file/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { NextRequest } from 'next/server';
import path from 'path';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const fsState = vi.hoisted(() => {
    const files = new Map<string, Buffer>();
    const directories = new Set<string>();
    const symlinks = new Set<string>();
    let directoryDev = 1;
    let directoryIno = 1;
    let bumpDirectoryOnOriginalOpen = false;
    const regularStats = (dev = 2, ino = 2) => ({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
        mode: 0o600,
        dev,
        ino,
    });
    const directoryStats = () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
        mode: 0o700,
        dev: 1,
        ino: 1,
    });
    return {
        files,
        directories,
        reset() {
            files.clear();
            directories.clear();
            symlinks.clear();
            directoryDev = 1;
            directoryIno = 1;
            bumpDirectoryOnOriginalOpen = false;
        },
        regularStats,
        directoryStats,
        directoryStatsCurrent() {
            return { ...directoryStats(), dev: directoryDev, ino: directoryIno };
        },
        symlinks,
        removeThumbs() {
            for (const filePath of files.keys()) {
                if (filePath.includes(`${path.sep}.thumbs${path.sep}`)) files.delete(filePath);
            }
        },
        bumpDirectory() { bumpDirectoryOnOriginalOpen = true; },
        consumeDirectoryBump() {
            if (!bumpDirectoryOnOriginalOpen) return false;
            directoryDev = 9;
            directoryIno = 9;
            bumpDirectoryOnOriginalOpen = false;
            return true;
        },
        originalPath() {
            return [...files.keys()].find((filePath) => !filePath.includes(`${path.sep}.thumbs${path.sep}`));
        },
    };
});

vi.mock('fs/promises', () => ({
    mkdir: vi.fn(async (directory: string) => {
        fsState.directories.add(directory);
    }),
    writeFile: vi.fn(async (filePath: string, bytes: Buffer) => {
        fsState.files.set(filePath, Buffer.from(bytes));
    }),
    readFile: vi.fn(async (filePath: string) => fsState.files.get(filePath) ?? Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    unlink: vi.fn(async (filePath: string) => {
        fsState.files.delete(filePath);
    }),
    rename: vi.fn(async (from: string, to: string) => {
        const bytes = fsState.files.get(from);
        if (bytes) {
            fsState.files.set(to, bytes);
            fsState.files.delete(from);
        }
    }),
    readdir: vi.fn(async () => []),
    lstat: vi.fn(async (filePath: string) => {
        if (fsState.directories.has(filePath)) {
            return fsState.directoryStatsCurrent();
        }
        if (fsState.symlinks.has(filePath)) {
            return { ...fsState.regularStats(), isSymbolicLink: () => true, isFile: () => false };
        }
        if (fsState.files.has(filePath)) return fsState.regularStats();
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
    realpath: vi.fn(async (filePath: string) => {
        if (fsState.directories.has(filePath)) return filePath;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
    open: vi.fn(async (filePath: string, flags: number | string) => {
        if (flags === 'wx' || (typeof flags === 'number' && (flags & 0x40) !== 0)) {
            if (fsState.files.has(filePath)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
            fsState.files.set(filePath, Buffer.alloc(0));
        } else if (!fsState.files.has(filePath)) {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        if (typeof flags === 'number' && (flags & 0x40) === 0) fsState.consumeDirectoryBump();
        let readOffset = 0;
        return {
            writeFile: async (bytes: Buffer) => { fsState.files.set(filePath, Buffer.from(bytes)); },
            readFile: async () => fsState.files.get(filePath) ?? Buffer.alloc(0),
            read: async (buffer: Buffer, offset = 0, length = buffer.length, position: number | null = null) => {
                const bytes = fsState.files.get(filePath) ?? Buffer.alloc(0);
                const start = position ?? readOffset;
                const bytesRead = Math.min(length, Math.max(0, bytes.length - start));
                bytes.copy(buffer, offset, start, start + bytesRead);
                if (position === null) readOffset += bytesRead;
                return { bytesRead, buffer };
            },
            stat: async () => fsState.regularStats(2, 2),
            close: async () => undefined,
        };
    }),
    link: vi.fn(async (source: string, target: string) => {
        if (fsState.files.has(target)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        const bytes = fsState.files.get(source);
        if (!bytes) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        fsState.files.set(target, Buffer.from(bytes));
    }),
}));

vi.mock('sharp', () => {
    const mockSharp = vi.fn(() => ({
        rotate: vi.fn().mockReturnThis(),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        metadata: vi.fn().mockResolvedValue({ width: 2048, height: 2048 }),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
    }));
    return { default: mockSharp };
});

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/media/[id]/file', () => {
    afterEach(async () => {
        await cleanupTestData();
        fsState.reset();
        vi.clearAllMocks();
    });

    async function createPersonWithMedia(
        fileName = 'portrait.jpg',
        type = 'image/jpeg',
        bytes: Uint8Array = new Uint8Array(64),
    ): Promise<number> {
        const personRes = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: 'Photo', LastName: 'Subject' },
        }));
        const { person } = await parseResponse<{ person: { Id: number } }>(personRes);

        const formData = new FormData();
        formData.append('file', new File([bytes as BlobPart], fileName, { type }));
        formData.append('personId', String(person.Id));
        formData.append('title', 'Portrait');
        formData.append('isPrimary', 'false');
        const uploadRes = await UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
            method: 'POST',
            body: formData,
        }));
        const { media } = await parseResponse<{ media: { Id: number } }>(uploadRes);
        return media.Id;
    }

    it('returns Cache-Control: private, max-age=604800, immutable', async () => {
        const mediaId = await createPersonWithMedia();
        const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file`);
        const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });

        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('private, max-age=604800, immutable');
    });

    it('hardens served bytes against active SVG content (sandbox CSP + nosniff)', async () => {
        const mediaId = await createPersonWithMedia();
        const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file`);
        const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'");
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('Content-Disposition')).toBe(`inline; filename="portrait.jpg"; filename*=UTF-8''portrait.jpg`);
    });

    describe('PDF documents (#510)', () => {
        const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

        it('serves the stored bytes as application/pdf, frameable only by this app', async () => {
            const mediaId = await createPersonWithMedia('register.pdf', 'application/pdf', pdfBytes);
            const res = await GET(
                createRequest(`http://localhost:3000/api/media/${mediaId}/file`),
                { params: Promise.resolve({ id: String(mediaId) }) },
            );

            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('application/pdf');
            expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
            expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
            expect(res.headers.get('Content-Disposition')).toBe(`inline; filename="portrait.pdf"; filename*=UTF-8''portrait.pdf`);
            expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdfBytes);
        });

        it('offers it as an attachment with ?download=1', async () => {
            const mediaId = await createPersonWithMedia('register.pdf', 'application/pdf', pdfBytes);
            const res = await GET(
                createRequest(`http://localhost:3000/api/media/${mediaId}/file?download=1`),
                { params: Promise.resolve({ id: String(mediaId) }) },
            );

            expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="portrait\.pdf"/);
        });

        it('has no image thumbnail', async () => {
            const mediaId = await createPersonWithMedia('register.pdf', 'application/pdf', pdfBytes);
            const res = await GET(
                createRequest(`http://localhost:3000/api/media/${mediaId}/file?w=256`),
                { params: Promise.resolve({ id: String(mediaId) }) },
            );

            expect(res.status).toBe(415);
        });

        it('refuses an upload named .pdf whose bytes are not a PDF', async () => {
            const formData = new FormData();
            formData.append('file', new File(['<html><script>alert(1)</script>'], 'evil.pdf', { type: 'application/pdf' }));
            const res = await UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
                method: 'POST',
                body: formData,
            }));

            expect(res.status).toBe(400);
        });
    });

    it('returns 404 for non-existent media', async () => {
        const req = createRequest('http://localhost:3000/api/media/999999/file');
        const res = await GET(req, { params: Promise.resolve({ id: '999999' }) });
        expect(res.status).toBe(404);
    });

    it('returns 400 for invalid media id', async () => {
        const req = createRequest('http://localhost:3000/api/media/abc/file');
        const res = await GET(req, { params: Promise.resolve({ id: 'abc' }) });
        expect(res.status).toBe(400);
    });

    it('returns 401 when not authenticated', async () => {
        const { getUserFromRequest } = await import('@/lib/auth/get-user-from-request');
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

        const req = createRequest('http://localhost:3000/api/media/1/file');
        const res = await GET(req, { params: Promise.resolve({ id: '1' }) });
        expect(res.status).toBe(401);
    });

    it('returns 200 with image/jpeg when ?w is a whitelisted size', async () => {
        const mediaId = await createPersonWithMedia();
        const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file?w=128`);
        const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/jpeg');
        expect(res.headers.get('Cache-Control')).toBe('private, max-age=604800, immutable');
    });

    it('serves a regular original through the race-resistant reader', async () => {
        const mediaId = await createPersonWithMedia();
        const res = await GET(
            createRequest(`http://localhost:3000/api/media/${mediaId}/file`),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );

        expect(res.status).toBe(200);
    });

    it('rejects a final symlink for direct originals and passthrough thumbnails', async () => {
        const directId = await createPersonWithMedia('direct.svg', 'image/svg+xml');
        const directPath = fsState.originalPath();
        expect(directPath).toBeDefined();
        fsState.symlinks.add(directPath!);

        const direct = await GET(
            createRequest(`http://localhost:3000/api/media/${directId}/file`),
            { params: Promise.resolve({ id: String(directId) }) },
        );
        expect(direct.status).toBe(500);

        fsState.reset();
        const thumbId = await createPersonWithMedia('thumb.svg', 'image/svg+xml');
        const thumbPath = fsState.originalPath();
        expect(thumbPath).toBeDefined();
        fsState.symlinks.add(thumbPath!);
        const thumb = await GET(
            createRequest(`http://localhost:3000/api/media/${thumbId}/file?w=128`),
            { params: Promise.resolve({ id: String(thumbId) }) },
        );
        expect(thumb.status).toBe(500);

        fsState.reset();
        const rasterId = await createPersonWithMedia();
        fsState.removeThumbs();
        const rasterPath = fsState.originalPath();
        expect(rasterPath).toBeDefined();
        fsState.symlinks.add(rasterPath!);
        const raster = await GET(
            createRequest(`http://localhost:3000/api/media/${rasterId}/file?w=128`),
            { params: Promise.resolve({ id: String(rasterId) }) },
        );
        expect(raster.status).toBe(500);
    });

    it('rejects a parent-directory identity replacement during an original read', async () => {
        const mediaId = await createPersonWithMedia('race.svg', 'image/svg+xml');
        fsState.bumpDirectory();

        const res = await GET(
            createRequest(`http://localhost:3000/api/media/${mediaId}/file`),
            { params: Promise.resolve({ id: String(mediaId) }) },
        );
        expect(res.status).toBe(500);
    });

    it('returns 400 for a non-whitelisted ?w value', async () => {
        const mediaId = await createPersonWithMedia();
        const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file?w=999`);
        const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });
        expect(res.status).toBe(400);
    });

    it('returns 400 for a non-numeric ?w value', async () => {
        const mediaId = await createPersonWithMedia();
        const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file?w=abc`);
        const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });
        expect(res.status).toBe(400);
    });

    it('returns 400 for a width with a numeric suffix', async () => {
        const mediaId = await createPersonWithMedia();
        const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file?w=2048px`);
        const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });
        expect(res.status).toBe(400);
    });

    it('accepts every whitelisted ?w size', async () => {
        const mediaId = await createPersonWithMedia();
        for (const w of [64, 128, 256, 512, 1024, 2048]) {
            const req = createRequest(`http://localhost:3000/api/media/${mediaId}/file?w=${w}`);
            const res = await GET(req, { params: Promise.resolve({ id: String(mediaId) }) });
            expect(res.status, `w=${w}`).toBe(200);
        }
    });
});
