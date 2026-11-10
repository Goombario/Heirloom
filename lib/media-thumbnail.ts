import { constants } from 'fs';
import { createHash } from 'crypto';
import { mkdir, readdir, unlink, link, lstat, open, realpath } from 'fs/promises';
import path from 'path';
import { getDataDir } from './data-dir';
import type { ThumbSize } from './media-url';
import { sharpForUntrustedInput, withSharpSlot } from './sharp-resource';
import { readHostedOriginal } from './media-original';

const PASSTHROUGH_TYPES = new Set(['image/svg+xml', 'image/gif']);

function thumbsDirFor(userId: number): string {
    return path.join(getDataDir(), 'uploads', userId.toString(), 'media', '.thumbs');
}

function thumbPathFor(userId: number, filename: string, size: number): string {
    const key = createHash('sha256').update(filename, 'utf8').digest('hex');
    return path.join(thumbsDirFor(userId), `${key}_${size}.jpg`);
}

function assertBasename(filename: string): void {
    if (!filename || path.basename(filename) !== filename || filename === '.' || filename === '..') {
        throw new Error('Invalid media filename');
    }
}

function legacyThumbPrefix(filename: string): string {
    return `${path.parse(filename).name}_`;
}

function isJpeg(buffer: Buffer): boolean {
    return buffer.length >= 4
        && buffer[0] === 0xff && buffer[1] === 0xd8
        && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

type ThumbnailDirectoryIdentity = {
    dev: number;
    ino: number;
    resolved: string;
};

function isPrivateDirectory(stats: { mode?: number }): boolean {
    // POSIX mode bits are not a reliable permission boundary on Windows.
    return process.platform === 'win32'
        ? true
        : typeof stats.mode === 'number' && (stats.mode & 0o022) === 0;
}

async function assertThumbsDirPath(dir: string): Promise<ThumbnailDirectoryIdentity | null> {
    try {
        const stats = await lstat(dir);
        if (stats.isSymbolicLink() || !stats.isDirectory() || !isPrivateDirectory(stats)) {
            throw new Error('Invalid thumbnail cache directory');
        }
        return { dev: stats.dev, ino: stats.ino, resolved: await realpath(dir) };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

async function assertThumbsDirUnchanged(
    dir: string,
    expected: ThumbnailDirectoryIdentity,
): Promise<void> {
    const current = await assertThumbsDirPath(dir);
    if (!current || !sameFile(expected, current) || current.resolved !== expected.resolved) {
        throw new Error('Thumbnail cache directory changed');
    }
}

function sameFile(a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean {
    return a.dev === b.dev && a.ino === b.ino;
}

type VerifiedRead = {
    buffer: Buffer<ArrayBuffer>;
    stat: { dev: number; ino: number; isFile(): boolean };
};

async function readVerifiedFile(filePath: string): Promise<VerifiedRead> {
    const before = await lstat(filePath);
    if (before.isSymbolicLink() || !before.isFile()) throw new Error('Invalid cache entry');
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const handle = await open(filePath, constants.O_RDONLY | noFollow);
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || !sameFile(before, opened)) throw new Error('Cache entry changed');
        return { buffer: await handle.readFile() as Buffer<ArrayBuffer>, stat: opened };
    } finally {
        await handle.close();
    }
}

async function readCachedThumbnail(userId: number, filename: string, size: number): Promise<Buffer<ArrayBuffer> | null> {
    const dir = thumbsDirFor(userId);
    const identity = await assertThumbsDirPath(dir);
    if (identity === null) return null;
    const target = thumbPathFor(userId, filename, size);
    let verified: VerifiedRead | null = null;
    try {
        verified = await readVerifiedFile(target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await assertThumbsDirUnchanged(dir, identity);
    if (!verified) return null;
    if (isJpeg(verified.buffer)) return verified.buffer;

    // A malformed regular hashed target is demonstrably invalid. Remove it
    // only while the pinned directory and target identity still match; never
    // repair or remove a symlink/non-regular entry.
    try {
        const current = await lstat(target);
        if (current.isFile() && !current.isSymbolicLink() && sameFile(verified.stat, current)) {
            await assertThumbsDirUnchanged(dir, identity);
            await unlink(target);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return null;
}

async function retireLegacyThumbnail(userId: number, filename: string, size: number): Promise<void> {
    const dir = thumbsDirFor(userId);
    const identity = await assertThumbsDirPath(dir);
    if (identity === null) return;
    const target = path.join(dir, `${path.parse(filename).name}_${size}.jpg`);
    try {
        await assertThumbsDirUnchanged(dir, identity);
        const entry = await lstat(target);
        if (entry.isSymbolicLink() || !entry.isFile()) return;
        await assertThumbsDirUnchanged(dir, identity);
        await unlink(target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

type ThumbnailPrimeArgs = {
    original: Buffer;
    userId: number;
    filename: string;
    size: ThumbSize;
    contentType: string;
};

/**
 * Publish a completed thumbnail without allowing a concurrent request to
 * replace the winner. Linking the completed temporary file is atomic and
 * fails with EEXIST when another request has already published the target.
 */
async function writeThumbnailIfAbsent(thumbPath: string, buffer: Buffer): Promise<'created' | 'exists'> {
    const dir = path.dirname(thumbPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const identity = await assertThumbsDirPath(dir);
    if (!identity) throw new Error('Invalid thumbnail cache directory');
    const tmpPath = `${thumbPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
        handle = await open(tmpPath, 'wx', 0o600);
        await handle.writeFile(buffer);
        const source = await handle.stat();
        await assertThumbsDirUnchanged(dir, identity);
        await link(tmpPath, thumbPath);
        const published = await lstat(thumbPath);
        await assertThumbsDirUnchanged(dir, identity);
        if (published.isSymbolicLink() || !published.isFile() || !sameFile(source, published)) {
            throw new Error('Invalid published thumbnail');
        }
        return 'created';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
        throw error;
    } finally {
        if (handle) await handle.close().catch(() => {});
        if (identity) {
            try {
                await assertThumbsDirUnchanged(dir, identity);
                await unlink(tmpPath);
            } catch (error) {
                // Never unlink by pathname through a cache directory that no
                // longer has the captured identity. The orphaned exact temp
                // path is safer than removing an attacker-selected entry.
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
                    && (error as Error).message !== 'Thumbnail cache directory changed') throw error;
            }
        }
    }
}

/** Proactively populate one hosted thumbnail cache tier after upload/import. */
export async function primeThumbnailCache(args: ThumbnailPrimeArgs): Promise<'created' | 'exists' | 'passthrough'> {
    const { original, userId, filename, size, contentType } = args;
    assertBasename(filename);
    if (!contentType.startsWith('image/') || PASSTHROUGH_TYPES.has(contentType)) return 'passthrough';

    const thumbPath = thumbPathFor(userId, filename, size);
    if (await readCachedThumbnail(userId, filename, size)) return 'exists';

    return withSharpSlot(async () => {
        if (await readCachedThumbnail(userId, filename, size)) return 'exists';

        const meta = await sharpForUntrustedInput(original).metadata();
        if (meta.width != null && meta.height != null && meta.width <= size && meta.height <= size) {
            return 'passthrough';
        }

        await retireLegacyThumbnail(userId, filename, size);
        const generated = await sharpForUntrustedInput(original)
            .rotate()
            .resize(size, size, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer();
        return writeThumbnailIfAbsent(thumbPath, generated as Buffer<ArrayBuffer>);
    });
}

/**
 * Returns a thumbnail buffer for the given media file, generating it on first
 * request and caching to disk under `data/uploads/{userId}/media/.thumbs/`.
 *
 * Passes the original through (no resize, original content type) when:
 *   - content type is not image/*
 *   - content type is SVG (vector — scales perfectly) or GIF (preserve animation)
 *   - original is already within the requested size in both dimensions
 */
type ThumbnailResult = { buffer: Buffer<ArrayBuffer>; contentType: string };

export async function getOrCreateThumbnail(args: {
    originalPath: string;
    userId: number;
    filename: string;
    size: number;
    contentType: string;
}): Promise<ThumbnailResult> {
    const { originalPath, userId, filename, size, contentType } = args;
    assertBasename(filename);

    if (!contentType.startsWith('image/') || PASSTHROUGH_TYPES.has(contentType)) {
        const buffer = await readHostedOriginal({
            mediaDir: path.dirname(originalPath), filename,
        });
        return { buffer, contentType };
    }

    const thumbPath = thumbPathFor(userId, filename, size);

    {
        const buffer = await readCachedThumbnail(userId, filename, size);
        if (buffer) {
            return { buffer, contentType: 'image/jpeg' };
        }
    }

    return withSharpSlot(async () => {
        // Re-check after acquiring the slot: a concurrent request may have
        // produced the thumb while we were waiting.
        {
            const buffer = await readCachedThumbnail(userId, filename, size);
            if (buffer) {
                return { buffer, contentType: 'image/jpeg' };
            }
        }

        const original = await readHostedOriginal({
            mediaDir: path.dirname(originalPath), filename,
        });
        const meta = await sharpForUntrustedInput(original).metadata();

        if (meta.width != null && meta.height != null && meta.width <= size && meta.height <= size) {
            return { buffer: original, contentType };
        }

        await retireLegacyThumbnail(userId, filename, size);
        const generated = await sharpForUntrustedInput(original)
            .rotate()
            .resize(size, size, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer();
        // sharp's Buffer is generic; narrow to NonSharedBuffer (Buffer<ArrayBuffer>).
        // toBuffer() always allocates a fresh, non-shared backing store.
        const buffer = generated as Buffer<ArrayBuffer>;

        await writeThumbnailIfAbsent(thumbPath, buffer);

        return { buffer, contentType: 'image/jpeg' };
    });
}

/**
 * Remove the original file and any cached thumbnails for the given media.
 * Best-effort: missing files (ENOENT) and other errors are swallowed so a
 * cleanup failure never blocks deletion of the DB row.
 */
export async function cleanupMediaFiles(
    userId: number,
    filename: string,
): Promise<'storage_cleanup_failed' | null> {
    let cleanupFailed = false;
    // Same basename guard as the serving route: never let a stored FilePath
    // traverse out of the user's media directory (defense in depth — the API
    // no longer allows writing FilePath, but legacy rows are untrusted).
    filename = path.basename(filename);
    const originalPath = path.join(
        getDataDir(),
        'uploads',
        userId.toString(),
        'media',
        filename,
    );
    try {
        await unlink(originalPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            cleanupFailed = true;
            console.error('Failed to unlink original media file:', err);
        }
    }

    const dir = thumbsDirFor(userId);
    const hashedPrefix = `${createHash('sha256').update(filename, 'utf8').digest('hex')}_`;
    const legacyPrefix = legacyThumbPrefix(filename);
    try {
        const identity = await assertThumbsDirPath(dir);
        if (identity === null) return cleanupFailed ? 'storage_cleanup_failed' : null;
        const entries = await readdir(dir);
        for (const name of entries) {
            if (!(name.startsWith(hashedPrefix) || name.startsWith(legacyPrefix)) || !name.endsWith('.jpg')) continue;
            const entryPath = path.join(dir, name);
            try {
                await assertThumbsDirUnchanged(dir, identity);
                const entryStats = await lstat(entryPath);
                if (entryStats.isSymbolicLink() || !entryStats.isFile()) continue;
                await assertThumbsDirUnchanged(dir, identity);
                await unlink(entryPath);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    cleanupFailed = true;
                    console.error('Failed to unlink thumbnail:', err);
                    if (err instanceof Error && (
                        err.message === 'Thumbnail cache directory changed'
                        || err.message === 'Invalid thumbnail cache directory'
                    )) break;
                }
            }
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            cleanupFailed = true;
            console.error('Failed to enumerate thumbnails for cleanup:', err);
        }
    }

    return cleanupFailed ? 'storage_cleanup_failed' : null;
}

/**
 * Clean up many committed media files and count the ones that couldn't be
 * removed (an unlink failure or a throw), for a "N files couldn't be removed"
 * notice (#945). Never throws: the deletion that freed them already committed.
 */
export async function cleanupMediaFilesCounting(userId: number, filenames: string[]): Promise<number> {
    let failed = 0;
    for (const filename of filenames) {
        try {
            if (await cleanupMediaFiles(userId, filename) !== null) failed += 1;
        } catch (error) {
            console.error('Failed to clean up media files:', error);
            failed += 1;
        }
    }
    return failed;
}
