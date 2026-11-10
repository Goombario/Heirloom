// media.json v2 and later carry only geometry and face-region metadata that GEDCOM
// has no standard for. Media identity is local to the current bundle and keyed by
// the same top-level `@O…@` xrefs as the GEDCOM records. v1 library metadata remains
// readable for compatibility, but is no longer emitted.
//
// The version also names the bundle's media layout: v3 (#937) is the flat
// `media/O<n>-name.jpg`, v2 a folder per photo (`media/O<n>/name.jpg`); the content
// is the same. Archive files are matched by their exact normalized path; v1 bundles
// may use unique basenames as a compatibility fallback (see media-match.ts).

import { MEDIA_BUNDLE_VERSION } from './media-archive-name';

interface LibraryMediaEntry {
    /** Basename of the media's FilePath, e.g. "case_169.jpg". */
    file: string;
    title: string | null;
    format: string | null;
    focalX: number | null;
    focalY: number | null;
    focalRadius: number | null;
}

interface MediaTagEntry {
    /** Basename of the tagged media's FilePath. */
    file: string;
    /** GEDCOM xref of the tagged person, e.g. "@I5@". */
    person: string;
    /** Face region as [x, y, w, h], each a percent of the image (0-100). */
    region: [number, number, number, number];
    /** This tagged photo is the person's avatar. */
    primary: boolean;
}

interface MediaSidecarV1 {
    version: number;
    libraryMedia: LibraryMediaEntry[];
    tags: MediaTagEntry[];
}

interface FocalGeometryEntry {
    media: string;
    x: number;
    y: number;
    radius: number;
}

interface MediaV2TagEntry {
    media: string;
    person: string;
    region: [number, number, number, number];
}

/** When a photo was taken (#802). Additive: written only when a photo has one. */
interface MediaDateEntry {
    media: string;
    date: string;
}

export interface MediaSidecarV2 {
    version: typeof MEDIA_BUNDLE_VERSION;
    focalGeometry: FocalGeometryEntry[];
    tags: MediaV2TagEntry[];
    dates?: MediaDateEntry[];
}

/** Parsed shape keeps v1 fields for the existing importer and exposes v2 data. */
export interface ParsedMediaSidecar extends Omit<MediaSidecarV1, 'version'> {
    version?: number;
    focalGeometry?: FocalGeometryEntry[];
    v2Tags?: MediaV2TagEntry[];
    dates?: MediaDateEntry[];
}

/** Input shape for library photos — structurally compatible with a `Media` row. */
export interface SidecarLibraryInput {
    Id?: number;
    FilePath: string | null;
    Title: string | null;
    Date?: string | null;
    Format: string | null;
    FocalX?: number | null;
    FocalY?: number | null;
    FocalRadius?: number | null;
}

/** Input shape for tags — structurally compatible with the getAllMediaTags row. */
export interface SidecarTagInput {
    /** The tagged media's FilePath (used for its basename). */
    FilePath: string | null;
    MediaId?: number;
    PersonId: number;
    RegionX: number;
    RegionY: number;
    RegionW: number;
    RegionH: number;
}

/**
 * Builds the media.json sidecar object for export. `dbIdToGedcomId` maps a person's
 * DB id to their GEDCOM xref (the same map the export route builds for cases). Library
 * photos without a file path, and tags whose person isn't in the map, are skipped.
 */
export function buildMediaSidecar(
    media: SidecarLibraryInput[],
    tags: SidecarTagInput[],
    mediaIdToXref: Map<number, string>,
    personIdToXref: Map<number, string>,
): MediaSidecarV2;
export function buildMediaSidecar(
    libraryMedia: SidecarLibraryInput[],
    tags: SidecarTagInput[],
    firstMap: Map<number, string>,
    personIdToXref: Map<number, string>,
): MediaSidecarV2 {
    const focalGeometry: FocalGeometryEntry[] = [];
    const dates: MediaDateEntry[] = [];
    for (const media of libraryMedia) {
        if (media.Id === undefined || !firstMap.has(media.Id)) continue;
        if (media.Date) dates.push({ media: firstMap.get(media.Id)!, date: media.Date });
        const x = media.FocalX ?? 50;
        const y = media.FocalY ?? 50;
        const radius = media.FocalRadius ?? 0;
        if (x === 50 && y === 50 && radius === 0) continue;
        focalGeometry.push({
            media: firstMap.get(media.Id)!,
            x,
            y,
            radius,
        });
    }
    const v2Tags: MediaV2TagEntry[] = [];
    for (const tag of tags) {
        if (tag.MediaId === undefined) continue;
        const mediaXref = firstMap.get(tag.MediaId);
        const personXref = personIdToXref.get(tag.PersonId);
        if (!mediaXref || !personXref) continue;
        v2Tags.push({
            media: mediaXref,
            person: personXref,
            region: [tag.RegionX, tag.RegionY, tag.RegionW, tag.RegionH],
        });
    }
    return { version: MEDIA_BUNDLE_VERSION, focalGeometry, tags: v2Tags, ...(dates.length > 0 ? { dates } : {}) };
}

function isPercent(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isFocalRadius(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 500;
}

function isFaceRegion(value: unknown): value is [number, number, number, number] {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(isPercent)) return false;
    const [x, y, width, height] = value;
    return width > 0 && height > 0 && x + width <= 100 && y + height <= 100;
}

/**
 * Parses and validates a media.json sidecar string for import. Throws on invalid JSON
 * (so the route can return 400, matching the casesJson handling). Malformed individual
 * entries are dropped defensively rather than failing the whole import.
 */
export function parseMediaSidecar(raw: string): ParsedMediaSidecar {
    const data = JSON.parse(raw) as unknown; // throws on invalid JSON — caller returns 400
    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

    const libraryMedia: LibraryMediaEntry[] = [];
    if (Array.isArray(obj.libraryMedia)) {
        for (const item of obj.libraryMedia) {
            if (!item || typeof item !== 'object') continue;
            const r = item as Record<string, unknown>;
            if (typeof r.file !== 'string' || !r.file) continue;
            libraryMedia.push({
                file: r.file,
                title: typeof r.title === 'string' ? r.title : null,
                format: typeof r.format === 'string' ? r.format : null,
                focalX: typeof r.focalX === 'number' ? r.focalX : null,
                focalY: typeof r.focalY === 'number' ? r.focalY : null,
                focalRadius: typeof r.focalRadius === 'number' ? r.focalRadius : null,
            });
        }
    }

    const tags: MediaTagEntry[] = [];
    if (Array.isArray(obj.tags)) {
        for (const item of obj.tags) {
            if (!item || typeof item !== 'object') continue;
            const r = item as Record<string, unknown>;
            if (typeof r.file !== 'string' || !r.file) continue;
            if (typeof r.person !== 'string' || !r.person) continue;
            const region = r.region;
            if (!isFaceRegion(region)) continue;
            tags.push({
                file: r.file,
                person: r.person,
                region: [region[0], region[1], region[2], region[3]] as [number, number, number, number],
                primary: r.primary === true,
            });
        }
    }

    const focalGeometry: FocalGeometryEntry[] = [];
    if (typeof obj.version === 'number' && obj.version >= 2 && Array.isArray(obj.focalGeometry)) {
        for (const item of obj.focalGeometry) {
            if (!item || typeof item !== 'object') continue;
            const r = item as Record<string, unknown>;
            if (typeof r.media !== 'string' || !isPercent(r.x) || !isPercent(r.y) || !isFocalRadius(r.radius)) continue;
            focalGeometry.push({ media: r.media, x: r.x, y: r.y, radius: r.radius });
        }
    }
    const v2Tags: MediaV2TagEntry[] = [];
    if (typeof obj.version === 'number' && obj.version >= 2 && Array.isArray(obj.tags)) {
        for (const item of obj.tags) {
            if (!item || typeof item !== 'object') continue;
            const r = item as Record<string, unknown>;
            const region = r.region;
            if (typeof r.media !== 'string' || typeof r.person !== 'string' || !isFaceRegion(region)) continue;
            v2Tags.push({ media: r.media, person: r.person, region });
        }
    }

    // #802. Additive: an older bundle has no `dates`, and a malformed entry is skipped.
    // One date per media xref (the last wins), so the importer's writes are bounded by
    // the photos in the bundle, however long a crafted array is.
    const datesByMedia = new Map<string, string>();
    if (Array.isArray(obj.dates)) {
        for (const item of obj.dates) {
            if (!item || typeof item !== 'object') continue;
            const r = item as Record<string, unknown>;
            if (typeof r.media !== 'string' || typeof r.date !== 'string') continue;
            const date = r.date.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
            if (date && date.length <= 100) datesByMedia.set(r.media, date);
        }
    }
    const dates: MediaDateEntry[] = [...datesByMedia].map(([media, date]) => ({ media, date }));
    return { libraryMedia, tags, ...(typeof obj.version === 'number' ? { version: obj.version } : {}), ...(focalGeometry.length > 0 ? { focalGeometry } : {}), ...(v2Tags.length > 0 ? { v2Tags } : {}), ...(dates.length > 0 ? { dates } : {}) };
}
