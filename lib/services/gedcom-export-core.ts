import { generateGedcomWithReport, assignMediaXrefs } from '@/lib/gedcom/generator';
import type {
    FamilyWithRelations,
    MediaImportItem,
    PersonWithRelations,
} from '@/lib/db/schema';
import type {
    GedcomExportExtras,
    GedcomExportMedia,
    GedcomExportMediaLink,
} from '@/lib/gedcom/generator';
import type { SidecarTagInput } from '@/lib/gedcom/media-sidecar';
import type {
    MediaExportPreflight,
    MediaOmissionReason,
} from '@/lib/data/types';

/** The hosted and local adapters provide this without importing storage APIs here. */
type MediaPhysicalAvailability = ReadonlyMap<number, boolean | { available: boolean }>;

/**
 * All data needed to render the shared GEDCOM portion of an export. The
 * adapter owns acquisition and byte packaging; this module only classifies
 * media, assembles records, and renders text.
 */
export type GedcomExportAssemblyInput = Omit<GedcomExportExtras, 'media' | 'mediaLinks'> & {
    people: PersonWithRelations[];
    families: FamilyWithRelations[];
    coords?: Map<string, { lat: number; lng: number }>;
    media: GedcomExportMedia[];
    mediaLinks: GedcomExportMediaLink[];
    mediaTags: SidecarTagInput[];
    mediaImportItems?: MediaImportItem[];
    mediaAvailability?: MediaPhysicalAvailability;
    includeMedia: boolean;
};

export interface GedcomExportAssembly {
    gedcom: string;
    media: GedcomExportMedia[];
    mediaLinks: GedcomExportMediaLink[];
    mediaTags: SidecarTagInput[];
    mediaIdToXref: Map<number, string>;
    preflight: MediaExportPreflight;
    omissionReport: MediaExportOmissionReport;
}

interface MediaExportOmissionReport {
    version: 1;
    omitted: {
        total: number;
        byReason: Record<MediaOmissionReason, number>;
    };
    /**
     * Media pointers kept in passthrough from before #979, left out because they
     * can't be matched to an image (ADR 0030). Re-importing the original file
     * attaches them properly. Not a reason to block the export.
     */
    staleMediaPointers: number;
}

const OMISSION_REASONS: readonly MediaOmissionReason[] = [
    'pending',
    'missing',
    'failed',
    'backing_missing',
    'legacy_materialization_unknown',
];

function emptyReasonCounts(): Record<MediaOmissionReason, number> {
    return {
        pending: 0,
        missing: 0,
        failed: 0,
        backing_missing: 0,
        legacy_materialization_unknown: 0,
    };
}

function isAvailable(
    availability: MediaPhysicalAvailability | undefined,
    mediaId: number,
): boolean {
    if (!availability || !availability.has(mediaId)) return true;
    const value = availability.get(mediaId);
    return typeof value === 'boolean' ? value : value?.available === true;
}

/** Enforce the schema's one-lineage-per-media invariant for export. */
function firstImportItemByMedia(items: readonly MediaImportItem[]): Map<number, MediaImportItem> {
    const byMedia = new Map<number, MediaImportItem>();
    for (const item of items) {
        if (byMedia.has(item.mediaId)) {
            throw new Error(`Duplicate media import lineage for media ${item.mediaId}`);
        }
        byMedia.set(item.mediaId, item);
    }
    return byMedia;
}

function classifyMedia(
    media: readonly GedcomExportMedia[],
    items: readonly MediaImportItem[],
    availability: MediaPhysicalAvailability | undefined,
): { preflight: MediaExportPreflight; omittedIds: Set<number> } {
    const counts = emptyReasonCounts();
    const omittedIds = new Set<number>();
    const itemByMedia = firstImportItemByMedia(items);

    // The loop is intentionally over media rows: one media row is
    // omitted/countable only once in the user-facing preflight.
    for (const item of media) {
        const importItem = itemByMedia.get(item.Id);
        let reason: MediaOmissionReason | undefined;
        if (importItem?.failureCode === 'legacy_materialization_unknown') {
            reason = 'legacy_materialization_unknown';
        } else if (importItem?.status === 'failed') {
            reason = 'failed';
        } else if (item.FilePath == null && item.SourceFile) {
            // A reference whose file was never supplied (pending or missing)
            // exports as the FILE text it arrived with, so nothing is omitted
            // (#958). Bytes that arrived and failed still count as omitted.
            continue;
        } else if (importItem?.status === 'pending') {
            reason = 'pending';
        } else if (importItem?.status === 'missing') {
            reason = 'missing';
        } else if (!importItem && item.FilePath == null && !isAvailable(availability, item.Id)) {
            // A pre-v36 placeholder has no truthful import/archive identity.
            reason = 'legacy_materialization_unknown';
        } else if (!isAvailable(availability, item.Id)) {
            reason = 'backing_missing';
        }

        if (reason) {
            counts[reason] += 1;
            omittedIds.add(item.Id);
        }
    }

    // Keep this construction explicit so adding a reason cannot accidentally
    // expose identifiers or other private export data in the report.
    const byReason = Object.fromEntries(
        OMISSION_REASONS.map((reason) => [reason, counts[reason]]),
    ) as Record<MediaOmissionReason, number>;
    const omittedTotal = Object.values(byReason).reduce((sum, value) => sum + value, 0);
    return {
        preflight: { canExport: omittedTotal === 0, omittedTotal, byReason },
        omittedIds,
    };
}

/** Remove any preserved multimedia subtree when the artifact has no bytes. */
function stripMultimediaSubtrees(gedcom: string): string {
    const lines = gedcom.split('\n');
    const kept: string[] = [];
    let skippedAtLevel: number | null = null;
    for (const line of lines) {
        const levelMatch = line.match(/^(\d+)\s+/);
        const level = levelMatch ? Number(levelMatch[1]) : null;
        if (skippedAtLevel != null) {
            if (level == null || level > skippedAtLevel) continue;
            skippedAtLevel = null;
        }
        if (level != null && /^\d+\s+(?:@[^ ]+\s+)?OBJE(?:\s|$)/.test(line)) {
            skippedAtLevel = level;
            continue;
        }
        kept.push(line);
    }
    return kept.join('\n');
}

/**
 * Shared, browser-safe GEDCOM assembly. No filesystem, archive, or Node-only
 * byte API is used here; adapters provide physical availability and
 * package only the returned included media rows.
 */
export function assembleGedcomExport(input: GedcomExportAssemblyInput): GedcomExportAssembly {
    const { media: allMedia, mediaLinks: allLinks, mediaTags: allTags, mediaImportItems = [], mediaAvailability, includeMedia, ...extras } = input;
    const { preflight, omittedIds } = classifyMedia(allMedia, mediaImportItems, mediaAvailability);

    // Sort before xref assignment. The generator's xrefs are document-local;
    // no basename, path, hash, title, or stored xref is consulted.
    const includedMedia = includeMedia
        ? [...allMedia].filter((item) => !omittedIds.has(item.Id)).sort((a, b) => a.Id - b.Id)
        : [];
    const includedIds = new Set(includedMedia.map((item) => item.Id));
    const includedLinks = includeMedia
        ? allLinks.filter((link) => includedIds.has(link.MediaId))
        : [];
    const includedTags = includeMedia
        ? allTags.filter((tag) => tag.MediaId != null && includedIds.has(tag.MediaId))
        : [];
    const mediaIdToXref = assignMediaXrefs(includedMedia);

    const { gedcom: renderedGedcom, staleMediaPointers } = generateGedcomWithReport(
        input.people,
        input.families,
        input.coords,
        includeMedia
            ? { ...extras, media: includedMedia, mediaLinks: includedLinks }
            : extras,
    );
    const gedcom = includeMedia ? renderedGedcom : stripMultimediaSubtrees(renderedGedcom);

    const omissionReport: MediaExportOmissionReport = {
        version: 1,
        omitted: {
            total: preflight.omittedTotal,
            byReason: { ...preflight.byReason },
        },
        staleMediaPointers,
    };

    return {
        gedcom,
        media: includedMedia,
        mediaLinks: includedLinks,
        mediaTags: includedTags,
        mediaIdToXref,
        preflight,
        omissionReport,
    };
}
