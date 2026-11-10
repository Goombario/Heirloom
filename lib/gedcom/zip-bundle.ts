import type JSZip from 'jszip';
import { normalizeArchiveManifest, normalizeArchivePath } from './media-match';
import { readEntryCapped } from '@/lib/zip-capped';
import { MAX_GEDCOM_BYTES } from '@/lib/import-limits';

/**
 * Where the parts of a GEDCOM export bundle sit inside an uploaded zip (#883).
 *
 * The export writes `family_tree.ged`, its JSON sidecars and `media/` at the zip
 * root. A user who unzips it and re-zips the folder with their OS gets the same
 * files one folder down, and a macOS zip adds `__MACOSX/._family_tree.ged`, an
 * AppleDouble file that also ends in `.ged`. The importer used to take the first
 * `.ged` at any depth but look for sidecars only at the root, so a re-zipped
 * export silently lost its cases, face tags, source extras and places.
 *
 * The `.ged`'s folder is therefore the bundle root: every entry is addressed by
 * its path relative to it, which is the identity media.json and the archive
 * manifest already use.
 */

/** The JSON sidecars an export bundle may carry beside its `.ged`. */
export const BUNDLE_SIDECARS = ['cases.json', 'media.json', 'sources.json', 'places.json'] as const;
type BundleSidecar = (typeof BUNDLE_SIDECARS)[number];

export interface GedcomZipLayout {
    /** The `.ged`'s entry name in the zip. */
    gedEntryName: string;
    /** Bundle path (relative to the `.ged`'s folder) → zip entry name. */
    entries: Map<string, string>;
}

export type GedcomZipLayoutError = 'no_ged' | 'multiple_ged' | 'unsafe_paths';
/**
 * Why a zip can't be imported: no `.ged` or several, a `.ged` or sidecar that
 * inflates past the cap (a zip bomb would otherwise exhaust the tab's memory,
 * #865), or entry names that are unsafe (`../`) or collide once normalized.
 */
export type GedcomZipError = GedcomZipLayoutError | 'too_large' | 'unsafe_paths';

/**
 * Largest photo the browser will inflate from a bundle. The `.ged` and its
 * sidecars use the server's GEDCOM cap instead (MAX_GEDCOM_BYTES, #1222), so a
 * zip can't carry a `.ged` the server would refuse.
 */
const DEFAULT_MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/**
 * macOS resource forks (anything under `__MACOSX/`) and dotfiles (`.DS_Store`,
 * `._x.ged`) are never bundle content. Only the file's own name is tested for a
 * leading dot, so a bundle zipped inside a dot-folder still imports.
 */
function isPlatformJunk(name: string): boolean {
    const segments = name.split('/');
    return segments.includes('__MACOSX') || (segments[segments.length - 1] ?? '').startsWith('.');
}

/**
 * Find the one `.ged` among the zip's file entry names and rebase the rest onto
 * its folder. Entries outside that folder are not part of the bundle.
 */
export function resolveGedcomZipLayout(fileNames: string[]): GedcomZipLayout | { error: GedcomZipLayoutError } {
    const files = fileNames
        .map((entryName) => ({ entryName, path: entryName.replace(/\\/g, '/') }))
        .filter(({ path }) => !isPlatformJunk(path));
    const geds = files.filter(({ path }) => path.toLowerCase().endsWith('.ged'));
    if (geds.length === 0) return { error: 'no_ged' };
    if (geds.length > 1) return { error: 'multiple_ged' };
    const gedPath = geds[0].path;
    const root = gedPath.slice(0, gedPath.lastIndexOf('/') + 1);
    const entries = new Map<string, string>();
    for (const { entryName, path } of files) {
        if (!path.startsWith(root)) continue;
        const bundlePath = path.slice(root.length);
        // Two entries reaching one path (`media\a.jpg` and `media/a.jpg`) would
        // leave one of them unread, and which one would be arbitrary.
        if (entries.has(bundlePath)) return { error: 'unsafe_paths' };
        entries.set(bundlePath, entryName);
    }
    return { gedEntryName: geds[0].entryName, entries };
}

/**
 * Each zip entry's path as the import recorded it: relative to the `.ged`'s folder
 * when the zip holds one, so photos in a zip whose `.ged` sits inside a folder still
 * match (#1006). A zip with no single `.ged`, such as a photos-only retry archive,
 * keeps its own paths. Entries outside the `.ged`'s folder aren't in the bundle.
 */
export function bundlePathsByEntry(fileNames: string[]): Map<string, string> {
    const layout = resolveGedcomZipLayout(fileNames);
    if ('error' in layout) {
        return new Map(fileNames.flatMap((name) => {
            const path = normalizeArchivePath(name);
            return path ? [[name, path] as [string, string]] : [];
        }));
    }
    return new Map(Array.from(layout.entries, ([bundlePath, entryName]) => [entryName, bundlePath]));
}

export interface OpenedGedcomZip {
    layout: GedcomZipLayout;
    /** Every bundle path, normalized and validated: the import's archive manifest. */
    manifest: string[];
    /** The `.ged` as raw bytes, so the importer's charset detection sees the original encoding (#875). */
    gedFile: File;
    /** Sidecar text by name, for the sidecars found beside the `.ged`. */
    sidecars: Partial<Record<BundleSidecar, string>>;
}

/**
 * Read one bundle file (a photo) under the same inflate cap as the `.ged`.
 * Returns null when it is too large.
 */
export async function readBundleFile(
    zip: JSZip,
    entryName: string,
    maxBytes: number = DEFAULT_MAX_ENTRY_BYTES,
): Promise<Uint8Array<ArrayBuffer> | null> {
    return readEntryCapped(zip.files[entryName], maxBytes);
}

/** Locate the bundle in a loaded zip and read its `.ged` and sidecars. */
export async function openGedcomZip(
    zip: JSZip,
    { maxEntryBytes = MAX_GEDCOM_BYTES }: { maxEntryBytes?: number } = {},
): Promise<OpenedGedcomZip | { error: GedcomZipError }> {
    const fileNames = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name);
    const layout = resolveGedcomZipLayout(fileNames);
    if ('error' in layout) return layout;
    let manifest: string[];
    try {
        manifest = normalizeArchiveManifest([...layout.entries.keys()]);
    } catch {
        return { error: 'unsafe_paths' };
    }
    const gedBytes = await readEntryCapped(zip.files[layout.gedEntryName], maxEntryBytes);
    if (!gedBytes) return { error: 'too_large' };
    const gedFile = new File([gedBytes], layout.gedEntryName.split('/').pop() || 'family_tree.ged', { type: 'text/plain' });
    const sidecars: OpenedGedcomZip['sidecars'] = {};
    for (const sidecar of BUNDLE_SIDECARS) {
        const entryName = layout.entries.get(sidecar);
        if (!entryName) continue;
        const bytes = await readEntryCapped(zip.files[entryName], maxEntryBytes);
        if (!bytes) return { error: 'too_large' };
        sidecars[sidecar] = new TextDecoder('utf-8').decode(bytes);
    }
    return { layout, manifest, gedFile, sidecars };
}
