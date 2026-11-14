import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
import { assignFamilyXrefs, assignPersonXrefs } from '@/lib/gedcom/generator';
import type {
    PersonWithRelations, Family, FamilyWithRelations, GedcomEvent,
} from '@/lib/db/schema';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import {
    getPeopleForExport,
    getFamiliesForExport,
    getFamilyChildLinksForExport,
    getFamilyChildrenForExport,
    getEventsForExport,
    getMediaForExport,
    getMediaImportItemsForExport,
    type ExportFamilyRow,
} from '@/lib/db/queries/gedcom-export';
import { exportCasesData } from '@/lib/db/queries/cases';
import { getAllMediaTags } from '@/lib/db/queries/media-tags';
import { getPlaceCoordsForUser } from '@/lib/services/places';
import { buildMediaSidecar } from '@/lib/gedcom/media-sidecar';
import { buildCasesSidecar } from '@/lib/gedcom/cases-sidecar';
import { getSources } from '@/lib/db/queries/sources';
import { getAllCitations } from '@/lib/db/queries/citations';
import { getAllNotes, getAllNoteLinks } from '@/lib/db/queries/notes';
import { getAllMediaLinks } from '@/lib/db/queries/media-links';
import { getRepositories } from '@/lib/db/queries/repositories';
import { getPlaceOtherNames, getPlaces } from '@/lib/db/queries/places';
import { getAllNameVariants } from '@/lib/db/queries/name-variants';
import { buildSourcesSidecar } from '@/lib/gedcom/sources-sidecar';
import { buildPlacesSidecar, collectFactPlaces } from '@/lib/gedcom/places-sidecar';
import { getDataDir } from '@/lib/data-dir';
import { assembleGedcomExport } from '@/lib/services/gedcom-export-core';
import type { MediaExportPreflight } from '@/lib/data/types';
import { normalizeArchivePath } from '@/lib/gedcom/media-match';
import { archiveMediaPath } from '@/lib/gedcom/media-archive-name';

export interface ExportGedcomParams {
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
    includeMedia: boolean;
    /** The preflight endpoint assembles classification but never packages bytes. */
    preflightOnly?: boolean;
    /** Only the exact value `omit-unresolved` permits omission of media rows. */
    mediaPolicy?: string;
}

/** A plain `.ged` body, or a zip bundle (media + JSON sidecars). The route maps
 *  each to the right Content-Type / filename. */
export type ExportGedcomResult =
    | { kind: 'preflight'; preflight: MediaExportPreflight }
    | { kind: 'blocked'; preflight: MediaExportPreflight }
    | { kind: 'ged'; content: string; preflight: MediaExportPreflight }
    | { kind: 'zip'; buffer: Buffer; preflight: MediaExportPreflight };

/** Push `value` onto the array stored at `key`, creating it on first use. */
function bucket<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
}

/**
 * GET /api/export/gedcom business logic. Resolves the export tree scope, reads
 * the whole tree in a fixed number of batched queries (no per-person N+1),
 * assembles the relation graph in memory, and renders the GEDCOM (plus the
 * media/cases/sources sidecar zip when `includeMedia`).
 *
 * Throws `AccessError` (→ 403) from `resolveTreeScope` for a tree the caller
 * can't read; everything else is a read, so no transaction is involved.
 */
export async function exportGedcomService(params: ExportGedcomParams): Promise<ExportGedcomResult> {
    const {
        requestedTreeId,
        requestedOwnerId,
        currentUserId,
        includeMedia,
        preflightOnly = false,
        mediaPolicy,
    } = params;

    // Export reads by ONE resolved tree: explicit treeId → legacy ownerId (that
    // user's default tree) → the caller's own default tree. Every read below is
    // TreeId-scoped, so a multi-tree account exports exactly the requested tree.
    const scope = await resolveTreeScope(
        { treeId: requestedTreeId, ownerId: requestedOwnerId },
        currentUserId
    );
    const exportTreeId = scope.treeId;

    // --- Batched reads (constant count, whole-tree) -------------------------
    const [
        rawPeople, rawFamilies, familyChildLinks, familyChildRows, allEvents, allMediaRows, mediaImportItems,
    ] = await Promise.all([
        getPeopleForExport(exportTreeId),
        getFamiliesForExport(exportTreeId),
        getFamilyChildLinksForExport(exportTreeId),
        getFamilyChildrenForExport(exportTreeId),
        getEventsForExport(exportTreeId),
        getMediaForExport(exportTreeId),
        getMediaImportItemsForExport(exportTreeId),
    ]);

    // --- Group relations in memory -----------------------------------------
    // Spouse families: iterate families in Id order so each person's list keeps
    // the old husband-first-then-wife concatenation deterministic. Grouped on the
    // legacy HusbandId/WifeId columns — the exact columns the old route queried —
    // falling back to Partner1Id/Partner2Id for a row that has only those (#69).
    const spouseFamiliesByHusband = new Map<number, ExportFamilyRow[]>();
    const spouseFamiliesByWife = new Map<number, ExportFamilyRow[]>();
    for (const f of rawFamilies) {
        const husbandId = f.HusbandId ?? f.Partner1Id;
        const wifeId = f.WifeId ?? f.Partner2Id;
        if (husbandId != null) bucket(spouseFamiliesByHusband, husbandId, f);
        if (wifeId != null) bucket(spouseFamiliesByWife, wifeId, f);
    }

    const familiesAsChildByPerson = new Map<number, Family[]>();
    for (const row of familyChildLinks) {
        const { ChildrenId, ...family } = row;
        bucket(familiesAsChildByPerson, ChildrenId, family as Family);
    }

    const personEventsByPerson = new Map<number, GedcomEvent[]>();
    const familyEventsByFamily = new Map<number, GedcomEvent[]>();
    for (const evt of allEvents) {
        if (evt.PersonId != null) bucket(personEventsByPerson, evt.PersonId, evt);
        if (evt.FamilyId != null) bucket(familyEventsByFamily, evt.FamilyId, evt);
    }

    const childrenByFamily = new Map<number, (typeof familyChildRows[number])[]>();
    for (const row of familyChildRows) {
        bucket(childrenByFamily, row.FamiliesAsChildId, row);
    }

    // Cast to PersonWithRelations as the old route did: the display-only fields
    // (EffectiveFirstName/Nickname) aren't selected here, and the generator reads
    // them defensively.
    const people = rawPeople.map((p) => ({
        ...p,
        familiesAsSpouse: [
            ...(spouseFamiliesByHusband.get(p.Id) ?? []),
            ...(spouseFamiliesByWife.get(p.Id) ?? []),
        ],
        familiesAsChild: familiesAsChildByPerson.get(p.Id) ?? [],
        events: (personEventsByPerson.get(p.Id) ?? []) as PersonWithRelations['events'],
        // Canonical ownership comes only from MediaLink. Legacy PersonId is
        // intentionally not bucketed here; unlinked rows remain ownerless top-level
        // multimedia records and pointed People links are rendered by the generator.
        media: [],
    })) as unknown as PersonWithRelations[];

    const families: FamilyWithRelations[] = rawFamilies.map((f) => ({
        ...f,
        children: (childrenByFamily.get(f.Id) ?? []).map(({ FamiliesAsChildId: _drop, ...child }) => child),
        events: familyEventsByFamily.get(f.Id) ?? [],
    }));

    // Cases ride the zip only (plain .ged has no place for them).
    const casesData = includeMedia ? await exportCasesData(exportTreeId) : [];

    // Gazetteer coordinates → PLAC.MAP in the GEDCOM.
    const coords = await getPlaceCoordsForUser(exportTreeId);

    // Sources, citations, name variants.
    const allSources = await getSources(exportTreeId);
    const allCitations = await getAllCitations(exportTreeId);
    const allNameVariants = await getAllNameVariants(exportTreeId);
    const sourceIdToXref = new Map<number, string>();
    allSources.forEach((s, i) => sourceIdToXref.set(s.Id, `@S${i + 1}@`));

    // First-class notes (Slice 1) — shared `0 @N@ NOTE` records.
    const allNotes = await getAllNotes(exportTreeId);
    const allNoteLinks = await getAllNoteLinks(exportTreeId);

    // First-class media links — all canonical owners render pointer OBJE links;
    // Media.PersonId is legacy compatibility data and is not consulted.
    const allMediaLinks = await getAllMediaLinks(exportTreeId);

    // Repository addresses (Slice 4) — emitted as REPO.ADDR on the shared records.
    // repoIdByName additionally lets the generator resolve NoteLink('Repository')
    // rows onto the REPO records it synthesises from source name strings (ADR 0012).
    const repoAddrByName = new Map<string, string>();
    const repoIdByName = new Map<string, number>();
    const repositoryDetails = new Map<string, { Address: string | null; RawGedcom?: string | null; AddressRawGedcom?: string | null }>();
    for (const r of await getRepositories(exportTreeId)) {
        if (r.Address) repoAddrByName.set(r.Name, r.Address);
        repoIdByName.set(r.Name, r.Id);
        repositoryDetails.set(r.Name, { Address: r.Address, RawGedcom: r.RawGedcom, AddressRawGedcom: r.AddressRawGedcom });
    }
    const exportSources = allSources.map(s => ({
        ...s,
        RepositoryAddress: s.RepositoryName ? (repoAddrByName.get(s.RepositoryName) ?? null) : null,
    }));

    // Place forms (Slice 5) — FORM under each PLAC. Also a name → id map so place
    // notes resolve to the right PLAC line.
    const placeForms = new Map<string, string>();
    const placeIdByName = new Map<string, number>();
    const allPlaces = await getPlaces(exportTreeId);
    // Keyed by `#<id>` too: a fact looks its place up by id, since two places may
    // share a name (#1186); the name keys serve a fact with no place id.
    for (const pl of allPlaces) {
        if (pl.Form) { placeForms.set(pl.Name, pl.Form); placeForms.set(`#${pl.Id}`, pl.Form); }
        placeIdByName.set(pl.Name, pl.Id);
        placeIdByName.set(`#${pl.Id}`, pl.Id);
    }

    // Only GEDCOM-fact citations ride in the .ged; Cases ride in sidecars. NameVariant
    // citations ride in both: under the variant's line (#963) and in sources.json.
    const GEDCOM_FACT_TABLES = new Set(['People', 'Families', 'FamilyMarriage', 'Events', 'PersonBirth', 'PersonDeath', 'PersonName', 'NameVariant']);
    // Hosted storage is an adapter concern. The core consumes only this
    // media-ID keyed availability map and never imports fs/path/Buffer.
    const uploadsDir = path.join(getDataDir(), 'uploads', scope.ownerId.toString(), 'media');
    const mediaAvailability = new Map<number, boolean>();
    const mediaPhysicalPathById = new Map<number, HostedMediaFile>();
    for (const media of allMediaRows) {
        const hostedFile = resolveHostedMediaFile(uploadsDir, media.FilePath);
        mediaAvailability.set(media.Id, hostedFile !== null);
        if (hostedFile) mediaPhysicalPathById.set(media.Id, hostedFile);
    }

    const tags = includeMedia ? await getAllMediaTags(exportTreeId) : [];
    const assembly = assembleGedcomExport({
        people,
        families,
        coords,
        sources: exportSources,
        citations: allCitations.filter(c => GEDCOM_FACT_TABLES.has(c.FactTable)),
        sourceIdToXref,
        // BackfilledFromPersonId rides along so the generator can recover legacy
        // "NICK: Bill" text from a backfilled note now that People."Notes" is gone.
        notes: allNotes.map(n => ({ Id: n.Id, Text: n.Text, BackfilledFromPersonId: n.BackfilledFromPersonId })),
        noteLinks: allNoteLinks,
        media: allMediaRows.map(m => ({
            Id: m.Id, Title: m.Title, Date: m.Date ?? null, FilePath: m.FilePath, SourceFile: m.SourceFile ?? null, Format: m.Format,
            FocalX: m.FocalX, FocalY: m.FocalY, FocalRadius: m.FocalRadius, FileRawGedcom: m.FileRawGedcom ?? null,
        })),
        mediaLinks: allMediaLinks,
        mediaTags: tags,
        mediaImportItems,
        mediaAvailability,
        includeMedia,
        placeForms,
        placeIdByName,
        repoIdByName,
        repositoryDetails,
        // NICK / _AKA are emitted from here now. The importer promotes those tags into
        // NameVariant rows rather than Notes text, so without this the tags would be
        // dropped on every round-trip.
        nameVariants: allNameVariants.map(nv => ({
            Id: nv.Id, PersonId: nv.PersonId, Type: nv.Type, Name: nv.Name,
        })),
    });

    if (preflightOnly) {
        return { kind: 'preflight', preflight: assembly.preflight };
    }
    if (includeMedia && !assembly.preflight.canExport && mediaPolicy !== 'omit-unresolved') {
        return { kind: 'blocked', preflight: assembly.preflight };
    }

    // UTF-8 BOM (Q8). HEAD.CHAR declares the encoding *inside* the file, after
    // the bytes a reader must already have decoded to find it. The BOM is legal,
    // optional per Unicode for UTF-8, and FamilySearch's own 5.5.1 product has
    // written one since 2000.
    //
    // Applied here rather than in the route because .ged bytes leave the app by
    // two paths — the bare response and the copy inside the media zip below —
    // and both must carry it.
    const gedcomOutput = '﻿' + assembly.gedcom;

    if (!includeMedia) {
        return { kind: 'ged', content: gedcomOutput, preflight: assembly.preflight };
    }

    // --- Zip bundle --------------------------------------------------------
    const archive = archiver('zip', { zlib: { level: 9 } });
    const archiveDate = new Date(0);
    const chunks: Buffer[] = [];
    const archivePromise = new Promise<Buffer>((resolve, reject) => {
        archive.on('data', (chunk: Buffer) => chunks.push(chunk));
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', (err: Error) => reject(err));
    });

    archive.append(gedcomOutput, { name: 'family_tree.ged', date: archiveDate });

    // DB person id → GEDCOM xref for the sidecar person pointers. MUST come from
    // the same assignment the generator uses — deriving it by array index here is
    // what desynced the sidecars from the .ged for any tree with stored GedcomIds.
    const dbIdToGedcomId = assignPersonXrefs(people);

    const casesJson = JSON.stringify(
        buildCasesSidecar(casesData, { personIdToXref: dbIdToGedcomId, sourceIdToXref, mediaIdToXref: assembly.mediaIdToXref }),
        null, 2,
    );
    archive.append(casesJson, { name: 'cases.json', date: archiveDate });

    const sourcesJson = JSON.stringify(
        buildSourcesSidecar(allSources, allCitations, allNameVariants, sourceIdToXref, dbIdToGedcomId),
        null, 2,
    );
    archive.append(sourcesJson, { name: 'sources.json', date: archiveDate });

    // The gazetteer. Unlike the other sidecars this one is PRIMARY for what it
    // carries — GEDCOM has no PLACE record, so an unreferenced row, the parent
    // hierarchy and the geocoder fields have no .ged representation at all (#402).
    const placesJson = JSON.stringify(buildPlacesSidecar(allPlaces, await getPlaceOtherNames(exportTreeId), collectFactPlaces(people, families, dbIdToGedcomId, assignFamilyXrefs(families))), null, 2);
    archive.append(placesJson, { name: 'places.json', date: archiveDate });

    // v2 media sidecar carries only geometry/tag metadata keyed by the same media
    // xrefs as the .ged. Library title/format/primary metadata is no longer copied
    // into the sidecar; v1 remains accepted by the importer.
    const mediaJson = JSON.stringify(
        buildMediaSidecar(assembly.media, assembly.mediaTags, assembly.mediaIdToXref, dbIdToGedcomId),
        null, 2,
    );
    archive.append(mediaJson, { name: 'media.json', date: archiveDate });

    if ((mediaPolicy === 'omit-unresolved' && assembly.preflight.omittedTotal > 0) || assembly.omissionReport.staleMediaPointers > 0) {
        archive.append(JSON.stringify(assembly.omissionReport, null, 2), {
            name: 'missing-media-report.json',
            date: archiveDate,
        });
    }

    // Files on disk live under the tree OWNER's uploads dir (relevant when a
    // shared tree is exported by someone other than its owner). Only rows that
    // survived the shared preflight can have a GEDCOM FILE pointer here.
    for (const media of assembly.media) {
        if (media.FilePath) {
            // Use the exact media-ID keyed decision that fed core preflight.
            const hostedFile = mediaPhysicalPathById.get(media.Id);
            if (hostedFile) {
                archive.file(hostedFile.absolutePath, {
                    name: archiveMediaPath(assembly.mediaIdToXref.get(media.Id), { Title: media.Title, FilePath: media.FilePath }),
                    date: archiveDate,
                });
            }
        }
    }

    archive.finalize();
    const zipBuffer = await archivePromise;
    return { kind: 'zip', buffer: zipBuffer, preflight: assembly.preflight };
}

export interface HostedMediaFile {
    absolutePath: string;
    filename: string;
}

function samePath(left: string, right: string): boolean {
    const normalizedLeft = path.normalize(left);
    const normalizedRight = path.normalize(right);
    return process.platform === 'win32'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}

/**
 * Resolve one stored hosted path to a regular, non-symlink file beneath the
 * real uploads root. Unsafe or unavailable paths deliberately return null so
 * callers classify them as backing_missing without exposing storage details.
 */
export function resolveHostedMediaFile(
    uploadsDir: string,
    storedPath: string | null,
): HostedMediaFile | null {
    const normalized = storedPath ? normalizeArchivePath(storedPath) : null;
    if (!normalized) return null;

    try {
        const realUploadsRoot = fs.realpathSync(uploadsDir);
        const candidate = path.resolve(realUploadsRoot, normalized);
        const relative = path.relative(realUploadsRoot, candidate);
        if (
            relative === ''
            || relative.startsWith(`..${path.sep}`)
            || path.isAbsolute(relative)
        ) return null;

        const realCandidate = fs.realpathSync(candidate);
        // A changed path or any symlinked parent/final component is rejected,
        // even when the symlink happens to target a file inside this root.
        if (!samePath(realCandidate, candidate)) return null;
        if (!fs.lstatSync(candidate).isFile()) return null;

        const filename = normalized.split('/').pop();
        if (!filename) return null;
        return { absolutePath: realCandidate, filename };
    } catch {
        return null;
    }
}
