import JSZip from 'jszip';
import { assignFamilyXrefs, assignPersonXrefs } from '@/lib/gedcom/generator';
import type { Family, FamilyWithRelations, GedcomEvent, Media, PersonWithRelations } from '@/lib/db/schema';
import {
  getPeopleForExport,
  getFamiliesForExport,
  getFamilyChildLinksForExport,
  getFamilyChildrenForExport,
  getEventsForExport,
  getMediaForExport,
  getMediaBlobsForExport,
  getMediaImportItemsForExport,
  type ExportFamilyRow,
} from '@/lib/db/queries/gedcom-export';
import { exportCasesData } from '@/lib/db/queries/cases';
import { getAllMediaTags } from '@/lib/db/queries/media-tags';
import { getPlaceCoordsForUser } from '@/lib/services/places';
import { buildMediaSidecar } from '@/lib/gedcom/media-sidecar';
import { buildSourcesSidecar } from '@/lib/gedcom/sources-sidecar';
import { buildCasesSidecar } from '@/lib/gedcom/cases-sidecar';
import { buildPlacesSidecar, collectFactPlaces } from '@/lib/gedcom/places-sidecar';
import { getSources } from '@/lib/db/queries/sources';
import { getAllCitations } from '@/lib/db/queries/citations';
import { getAllNotes, getAllNoteLinks } from '@/lib/db/queries/notes';
import { getAllMediaLinks } from '@/lib/db/queries/media-links';
import { getRepositories } from '@/lib/db/queries/repositories';
import { getPlaceOtherNames, getPlaces } from '@/lib/db/queries/places';
import { getAllNameVariants } from '@/lib/db/queries/name-variants';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { assembleGedcomExport } from '@/lib/services/gedcom-export-core';
import type { ExportArtifact, MediaExportPreflight } from '../types';
import { archiveMediaPath } from '@/lib/gedcom/media-archive-name';

export type LocalGedcomExportResult =
  | { kind: 'preflight'; preflight: MediaExportPreflight }
  | { kind: 'blocked'; preflight: MediaExportPreflight }
  | { kind: 'ged'; content: string; preflight: MediaExportPreflight }
  | { kind: 'zip'; blob: Blob; preflight: MediaExportPreflight };

function bucket<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function localFilename(media: Media): string {
  const format = (media.Format ?? 'BIN').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin';
  return `media.${format}`;
}

/**
 * Collect and package one tree using only browser-safe APIs. The SQL query
 * helpers are all TreeId-scoped; MediaBlob is read by MediaId so local rows
 * with a null hosted FilePath remain exportable when their bytes exist.
 */
export async function exportGedcomLocalService(params: {
  requestedTreeId: number | null;
  currentUserId: number;
  includeMedia: boolean;
  preflightOnly?: boolean;
  mediaPolicy?: string;
}): Promise<LocalGedcomExportResult> {
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: null },
    params.currentUserId,
  );
  const treeId = scope.treeId;

  const [rawPeople, rawFamilies, familyChildLinks, familyChildRows, allEvents, allMediaRows, mediaImportItems] = await Promise.all([
    getPeopleForExport(treeId),
    getFamiliesForExport(treeId),
    getFamilyChildLinksForExport(treeId),
    getFamilyChildrenForExport(treeId),
    getEventsForExport(treeId),
    getMediaForExport(treeId),
    getMediaImportItemsForExport(treeId),
  ]);

  const spouseFamiliesByHusband = new Map<number, ExportFamilyRow[]>();
  const spouseFamiliesByWife = new Map<number, ExportFamilyRow[]>();
  // Legacy HusbandId/WifeId first, then Partner1Id/Partner2Id for a row that has only those (#69).
  for (const family of rawFamilies) {
    const husbandId = family.HusbandId ?? family.Partner1Id;
    const wifeId = family.WifeId ?? family.Partner2Id;
    if (husbandId != null) bucket(spouseFamiliesByHusband, husbandId, family);
    if (wifeId != null) bucket(spouseFamiliesByWife, wifeId, family);
  }
  const familiesAsChildByPerson = new Map<number, Family[]>();
  for (const row of familyChildLinks) {
    const { ChildrenId, ...family } = row;
    bucket(familiesAsChildByPerson, ChildrenId, family as Family);
  }
  const personEventsByPerson = new Map<number, GedcomEvent[]>();
  const familyEventsByFamily = new Map<number, GedcomEvent[]>();
  for (const event of allEvents) {
    if (event.PersonId != null) bucket(personEventsByPerson, event.PersonId, event);
    if (event.FamilyId != null) bucket(familyEventsByFamily, event.FamilyId, event);
  }
  const childrenByFamily = new Map<number, (typeof familyChildRows[number])[]>();
  for (const row of familyChildRows) bucket(childrenByFamily, row.FamiliesAsChildId, row);

  const people = rawPeople.map((person) => ({
    ...person,
    familiesAsSpouse: [
      ...(spouseFamiliesByHusband.get(person.Id) ?? []),
      ...(spouseFamiliesByWife.get(person.Id) ?? []),
    ],
    familiesAsChild: familiesAsChildByPerson.get(person.Id) ?? [],
    events: (personEventsByPerson.get(person.Id) ?? []) as PersonWithRelations['events'],
    media: [],
  })) as unknown as PersonWithRelations[];
  const families: FamilyWithRelations[] = rawFamilies.map((family) => ({
    ...family,
    children: (childrenByFamily.get(family.Id) ?? []).map(({ FamiliesAsChildId: _drop, ...child }) => child),
    events: familyEventsByFamily.get(family.Id) ?? [],
  }));

  const blobResult = await getMediaBlobsForExport(treeId);
  const mediaAvailability = new Map<number, boolean>();
  const mediaBytes = new Map<number, Uint8Array>();
  for (const row of blobResult) {
    const available = row.Data != null;
    mediaAvailability.set(row.Id, available);
    if (available) mediaBytes.set(row.Id, new Uint8Array(row.Data!));
  }

  // A local-only synthetic path is an exact MediaId mapping, not a basename
  // identity guess. It gives the generator a truthful FILE pointer for bytes
  // stored in MediaBlob while preserving null paths for unresolved rows.
  const media = allMediaRows.map((item) => (
    mediaAvailability.get(item.Id) === true ? { ...item, FilePath: localFilename(item) } : item
  ));
  const coords = await getPlaceCoordsForUser(treeId);
  const allSources = await getSources(treeId);
  const allCitations = await getAllCitations(treeId);
  const allNameVariants = await getAllNameVariants(treeId);
  const sourceIdToXref = new Map<number, string>();
  allSources.forEach((source, index) => sourceIdToXref.set(source.Id, `@S${index + 1}@`));
  const allNotes = await getAllNotes(treeId);
  const allNoteLinks = await getAllNoteLinks(treeId);
  const allMediaLinks = await getAllMediaLinks(treeId);
  const repoIdByName = new Map<string, number>();
  const repoAddrByName = new Map<string, string>();
  const repositoryDetails = new Map<string, { Address: string | null; RawGedcom?: string | null; AddressRawGedcom?: string | null }>();
  for (const repo of await getRepositories(treeId)) {
    repoIdByName.set(repo.Name, repo.Id);
    if (repo.Address) repoAddrByName.set(repo.Name, repo.Address);
    repositoryDetails.set(repo.Name, { Address: repo.Address, RawGedcom: repo.RawGedcom, AddressRawGedcom: repo.AddressRawGedcom });
  }
  const exportSources = allSources.map((source) => ({
    ...source,
    RepositoryAddress: source.RepositoryName ? (repoAddrByName.get(source.RepositoryName) ?? null) : null,
  }));
  const placeForms = new Map<string, string>();
  const placeIdByName = new Map<string, number>();
  const allPlaces = await getPlaces(treeId);
  // Keyed by `#<id>` too: a fact looks its place up by id, since two places may
  // share a name (#1186); the name keys serve a fact with no place id.
  for (const place of allPlaces) {
    if (place.Form) { placeForms.set(place.Name, place.Form); placeForms.set(`#${place.Id}`, place.Form); }
    placeIdByName.set(place.Name, place.Id);
    placeIdByName.set(`#${place.Id}`, place.Id);
  }
  const tags = params.includeMedia ? await getAllMediaTags(treeId) : [];
  const GEDCOM_FACT_TABLES = new Set(['People', 'Families', 'FamilyMarriage', 'Events', 'PersonBirth', 'PersonDeath', 'PersonName', 'NameVariant']);
  const assembly = assembleGedcomExport({
    people,
    families,
    coords,
    sources: exportSources,
    citations: allCitations.filter((citation) => GEDCOM_FACT_TABLES.has(citation.FactTable)),
    sourceIdToXref,
    notes: allNotes.map((note) => ({ Id: note.Id, Text: note.Text, BackfilledFromPersonId: note.BackfilledFromPersonId })),
    noteLinks: allNoteLinks,
    media: media.map((item) => ({
      Id: item.Id, Title: item.Title, Date: item.Date ?? null, FilePath: item.FilePath, SourceFile: item.SourceFile ?? null, Format: item.Format,
      FocalX: item.FocalX, FocalY: item.FocalY, FocalRadius: item.FocalRadius, FileRawGedcom: item.FileRawGedcom ?? null,
    })),
    mediaLinks: allMediaLinks,
    mediaTags: tags,
    mediaImportItems,
    mediaAvailability,
    includeMedia: params.includeMedia,
    placeForms,
    placeIdByName,
    repoIdByName,
    repositoryDetails,
    nameVariants: allNameVariants.map((variant) => ({
      Id: variant.Id, PersonId: variant.PersonId, Type: variant.Type, Name: variant.Name,
    })),
  });

  if (params.preflightOnly) return { kind: 'preflight', preflight: assembly.preflight };
  if (params.includeMedia && !assembly.preflight.canExport && params.mediaPolicy !== 'omit-unresolved') {
    return { kind: 'blocked', preflight: assembly.preflight };
  }

  const gedcom = `\uFEFF${assembly.gedcom}`;
  if (!params.includeMedia) return { kind: 'ged', content: gedcom, preflight: assembly.preflight };

  const casesData = await exportCasesData(treeId);
  const personIdToXref = assignPersonXrefs(people);
  const zip = new JSZip();
  const zipDate = new Date(0);
  const addText = (name: string, text: string) => zip.file(name, text, { date: zipDate });
  addText('family_tree.ged', gedcom);
  addText('cases.json', JSON.stringify(
    buildCasesSidecar(casesData, { personIdToXref, sourceIdToXref, mediaIdToXref: assembly.mediaIdToXref }),
    null, 2,
  ));
  addText('sources.json', JSON.stringify(buildSourcesSidecar(allSources, allCitations, allNameVariants, sourceIdToXref, personIdToXref), null, 2));
  addText('places.json', JSON.stringify(buildPlacesSidecar(allPlaces, await getPlaceOtherNames(treeId), collectFactPlaces(people, families, personIdToXref, assignFamilyXrefs(families))), null, 2));
  addText('media.json', JSON.stringify(buildMediaSidecar(assembly.media, assembly.mediaTags, assembly.mediaIdToXref, personIdToXref), null, 2));
  if ((params.mediaPolicy === 'omit-unresolved' && assembly.preflight.omittedTotal > 0) || assembly.omissionReport.staleMediaPointers > 0) {
    addText('missing-media-report.json', JSON.stringify(assembly.omissionReport, null, 2));
  }
  for (const item of assembly.media) {
    const bytes = mediaBytes.get(item.Id);
    const xref = assembly.mediaIdToXref.get(item.Id);
    if (!bytes || !xref || !item.FilePath) continue;
    zip.file(archiveMediaPath(xref, { Title: item.Title, FilePath: item.FilePath }), bytes, { date: zipDate });
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { kind: 'zip', blob, preflight: assembly.preflight };
}

export function localExportArtifact(result: Exclude<LocalGedcomExportResult, { kind: 'preflight' } | { kind: 'blocked' }>): ExportArtifact {
  if (result.kind === 'ged') return { blob: new Blob([result.content], { type: 'text/plain;charset=utf-8' }), filename: 'family_tree.ged' };
  return { blob: result.blob, filename: 'family_tree_export.zip' };
}
