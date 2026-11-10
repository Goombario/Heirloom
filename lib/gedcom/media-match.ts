/**
 * Helpers for matching the media files a GEDCOM import references against the
 * files actually available in the uploaded zip.
 *
 * A GEDCOM zip import is two-phase: the server parses the `.ged` (+ `media.json`)
 * and creates placeholder `Media` rows with `FilePath = NULL`, then the browser
 * uploads each file to fill those rows in. If a referenced file is missing from
 * the zip, its row stays null forever and serves a 404 — and in `overwrite` mode
 * the old, working media has already been deleted. These helpers let the client
 * detect that situation *before* the destructive step instead of silently
 * dropping the file.
 */

/** Returns the final path segment, treating both `/` and `\` as separators. */
export function mediaBasename(filePath: string): string {
    const segments = filePath.split(/[/\\]/);
    return segments[segments.length - 1];
}

/** Normalize a bundle path, rejecting traversal rather than resolving it. */
export function normalizeArchivePath(filePath: string): string | null {
    if (typeof filePath !== 'string' || !filePath.trim()) return null;
    const normalized = filePath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..')) return null;
    const result = segments.filter((segment) => segment !== '' && segment !== '.').join('/');
    return result || null;
}

/**
 * A FILE that points outside any bundle: a URL, or an absolute or UNC path that a
 * desktop app wrote (`C:\FTM\…\photo.jpg`, `/Users/…`). It is a reference to keep,
 * never a path to open or resolve (#958).
 */
export function isExternalMediaReference(filePath: string): boolean {
    const path = filePath.trim();
    return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]/.test(path);
}

/**
 * The file name an external reference may match in a bundle (the legacy-v1
 * basename rule), or null when it names no file, as with a folder path.
 */
export function externalReferenceBasename(filePath: string): string | null {
    let path = filePath.trim();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)) {
        path = path.replace(/[?#].*$/, '');
        try { path = decodeURIComponent(path); } catch { /* keep the encoded name */ }
    }
    const name = mediaBasename(path).trim();
    return name && name !== '.' && name !== '..' ? name : null;
}

/** Normalize and validate every archive entry before an import can mutate data. */
export function normalizeArchiveManifest(manifest: string[]): string[] {
    if (!Array.isArray(manifest)) throw new Error('archiveManifest must be an array');
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const entry of manifest) {
        const path = normalizeArchivePath(entry);
        if (!path) throw new Error('archiveManifest contains an empty or unsafe path');
        if (seen.has(path)) throw new Error(`archiveManifest contains duplicate path: ${path}`);
        seen.add(path);
        normalized.push(path);
    }
    return normalized;
}

/** A media file entry extracted from the current import bundle. */
export interface ArchiveMediaEntry<T> {
    archivePath: string;
    file: T;
}

export interface ExpectedMediaRef {
    archivePath: string;
    originalFilename: string;
    /** The import's own rule for matching this file by name alone, so the overwrite check agrees with it (#1005). */
    basenameFallback?: boolean;
}

/** The one entry that `matches` picks out, or null when none or several do. */
function uniqueEntry(entries: string[], matches: (entry: string) => boolean): string | null {
    let found: string | null = null;
    for (const entry of entries) {
        if (!matches(entry)) continue;
        if (found !== null) return null;
        found = entry;
    }
    return found;
}

/**
 * Resolve the exact path persisted for an item during its first intake. A Windows
 * app writes FILE in whatever case it was given, while the zip keeps the disk's,
 * so a case-only difference still matches when one entry fits (#1005).
 */
export function resolveInitialArchivePath(
    expected: ExpectedMediaRef,
    manifest: string[],
    options: { allowLegacyV1: boolean },
): string {
    const expectedPath = normalizeArchivePath(expected.archivePath);
    if (!expectedPath) throw new Error('Expected media archive path is unsafe');
    const entries = normalizeArchiveManifest(manifest);
    if (entries.includes(expectedPath)) return expectedPath;
    const folded = expectedPath.toLowerCase();
    const caseMatch = uniqueEntry(entries, (entry) => entry.toLowerCase() === folded);
    if (caseMatch) return caseMatch;
    if (options.allowLegacyV1) {
        const basename = mediaBasename(expected.originalFilename);
        const foldedName = basename.toLowerCase();
        const byName = uniqueEntry(entries, (entry) => mediaBasename(entry) === basename)
            ?? uniqueEntry(entries, (entry) => mediaBasename(entry).toLowerCase() === foldedName);
        if (byName) return byName;
    }
    return expectedPath;
}

/** Match an import item to a retry archive entry by exact normalized identity only. */
export function matchArchiveMediaExact<T>(
    item: { archivePath: string },
    entries: Iterable<ArchiveMediaEntry<T>>,
): T | null {
    const itemPath = normalizeArchivePath(item.archivePath);
    if (!itemPath) return null;
    let match: T | null = null;
    let ambiguous = false;
    for (const entry of entries) {
        const path = normalizeArchivePath(entry.archivePath);
        if (path !== itemPath) continue;
        if (match !== null) ambiguous = true;
        else match = entry.file;
    }
    return ambiguous ? null : match;
}

/**
 * Match one import placeholder to a file in this bundle. Exact normalized paths
 * are authoritative. Bare basenames are the v1 compatibility shape; they may
 * fall back only when unique. No pre-existing library row is consulted here.
 */
export function matchArchiveMedia<T>(
    ref: { archivePath: string; originalFilename: string },
    entries: Iterable<ArchiveMediaEntry<T>>,
): T | null {
    const refPath = normalizeArchivePath(ref.archivePath);
    if (!refPath) return null;

    const exact = new Map<string, ArchiveMediaEntry<T> | null>();
    const legacyByBasename = new Map<string, ArchiveMediaEntry<T> | null>();
    for (const entry of entries) {
        const path = normalizeArchivePath(entry.archivePath);
        if (!path) continue;
        if (exact.has(path)) exact.set(path, null);
        else exact.set(path, entry);
        // v1 bundles used either a bare filename or `media/<basename>`; xref-keyed
        // v2 paths are `media/O<n>/<basename>` and never fall back. A flat v3 path
        // (`media/O<n>-<name>`, #937) has the v1 shape, but its exact match comes
        // first and its xref prefix keeps its basename unique, so the fallback
        // cannot pick another photo. The importer passes its own rule instead,
        // from media.json's version, via `basenameFallback`.
        const isLegacyPath = !path.includes('/') || (path.startsWith('media/') && path.split('/').length === 2);
        if (isLegacyPath) {
            const base = mediaBasename(path);
            if (legacyByBasename.has(base)) legacyByBasename.set(base, null);
            else legacyByBasename.set(base, entry);
        }
    }

    const exactMatch = exact.get(refPath);
    if (exactMatch) return exactMatch.file;
    if (exact.has(refPath)) return null;

    const legacyMatch = legacyByBasename.get(mediaBasename(ref.originalFilename));
    return legacyMatch?.file ?? null;
}

/**
 * Builds the deduped basename list of every media file a GEDCOM import will
 * expect the client to upload: each person's media `FilePath` plus the library
 * photos carried in the `media.json` sidecar. Returned by the dry-run so the
 * client can warn about files missing from the zip before importing.
 */
export function expectedMediaBasenames(
    personMedia: Array<{ FilePath: string | null }>,
    libraryFiles: string[],
): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const add = (path: string | null) => {
        if (!path) return;
        const base = mediaBasename(path);
        if (seen.has(base)) return;
        seen.add(base);
        result.push(base);
    };
    for (const m of personMedia) add(m.FilePath);
    for (const f of libraryFiles) add(f);
    return result;
}

/**
 * Returns the `expected` filenames that have no match in `available`, comparing
 * by basename. Each missing file is reported once, in first-seen order.
 */
export function findMissingMedia(expected: string[], available: Iterable<string>): string[] {
    const availableBasenames = new Set<string>();
    for (const name of available) {
        availableBasenames.add(mediaBasename(name));
    }

    const missing: string[] = [];
    const seen = new Set<string>();
    for (const name of expected) {
        const base = mediaBasename(name);
        if (availableBasenames.has(base) || seen.has(base)) continue;
        seen.add(base);
        missing.push(base);
    }
    return missing;
}

/** Compare collision-safe archive identities while retaining v1 basename fallback. */
export function findMissingMediaRefs(
    expected: ExpectedMediaRef[],
    available: Iterable<ArchiveMediaEntry<unknown>>,
): string[] {
    const entries = Array.from(available);
    const paths = entries.map((entry) => normalizeArchivePath(entry.archivePath)).filter((path): path is string => path !== null);
    const inBundle = new Set(paths);
    // A ref that carries the import's rule resolves exactly as the import will.
    const found = (ref: ExpectedMediaRef): boolean => {
        if (ref.basenameFallback === undefined) return matchArchiveMedia(ref, entries) !== null;
        try {
            return inBundle.has(resolveInitialArchivePath(ref, paths, { allowLegacyV1: ref.basenameFallback }));
        } catch {
            return false;
        }
    };
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const ref of expected) {
        const key = normalizeArchivePath(ref.archivePath) ?? ref.archivePath;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!found(ref)) missing.push(ref.archivePath);
    }
    return missing;
}
