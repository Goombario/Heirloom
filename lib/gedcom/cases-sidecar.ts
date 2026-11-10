// cases.json sidecar — research cases have no GEDCOM home, so the whole case rides
// here. People, sources and photos are referenced by the same xrefs the .ged uses
// ("@I5@", "@S1@", "@O3@"); media xrefs come from the export's media assembly, so
// a photo left out of the bundle is left out of its case too.
//
// Additive per ADR 0009: a field added after version 1 is written only when it has
// a value, a reader that predates it ignores it, and import reads a missing one as
// null. Case photos and journal photos (#1068) and every Citation field on case and
// journal citations (#1035) arrived this way, and so did a struck-out note's
// StruckAt / StruckReason (#1251), so `version` stays 1.

import type { CaseCitationRaw, CaseExportRecord } from '@/lib/db/queries/cases';
import { isQuayValue } from '@/lib/citations/quay';

/** A case or journal citation, its source keyed by xref. Fields past `note` are optional. */
interface CasesSidecarCitation {
  source: string;
  page: string | null;
  note: string | null;
  quay?: string;
  dataText?: string;
  dataDate?: string;
  even?: string;
  role?: string;
  url?: string;
}

interface CasesSidecarComment {
  Body: string;
  CreatedAt: string;
  Kind?: string;
  /** The entry's photo by media xref. */
  media?: string;
  citation?: CasesSidecarCitation;
  /** A note struck out as no longer accurate (#1251): when, and the optional reason. */
  StruckAt?: string;
  StruckReason?: string;
}

interface CasesSidecarCase {
  Title: string;
  Description: string | null;
  Status: string;
  Tags: string[];
  CreatedAt: string;
  UpdatedAt: string;
  comments: CasesSidecarComment[];
  linkedPersonGedcomIds: string[];
  sourceCitations: CasesSidecarCitation[];
  /** The case's attached photos by media xref. */
  media?: string[];
}

interface CasesSidecar {
  version: 1;
  cases: CasesSidecarCase[];
}

interface CasesSidecarMaps {
  personIdToXref: Map<number, string>;
  sourceIdToXref: Map<number, string>;
  mediaIdToXref: Map<number, string>;
}

function sidecarCitation(raw: CaseCitationRaw, sourceIdToXref: Map<number, string>): CasesSidecarCitation | null {
  const source = sourceIdToXref.get(raw.SourceId);
  if (source === undefined) return null;
  const citation: CasesSidecarCitation = { source, page: raw.Page, note: raw.Note };
  if (raw.Quay !== null) citation.quay = raw.Quay;
  if (raw.DataText !== null) citation.dataText = raw.DataText;
  if (raw.DataDate !== null) citation.dataDate = raw.DataDate;
  if (raw.Even !== null) citation.even = raw.Even;
  if (raw.Role !== null) citation.role = raw.Role;
  if (raw.Url !== null) citation.url = raw.Url;
  return citation;
}

/** Builds cases.json for export. Hosted and local exports both call this, so they can't drift. */
export function buildCasesSidecar(cases: CaseExportRecord[], maps: CasesSidecarMaps): CasesSidecar {
  return {
    version: 1,
    cases: cases.map((c) => {
      const media = c.mediaDbIds
        .map((id) => maps.mediaIdToXref.get(id))
        .filter((xref): xref is string => xref !== undefined);
      return {
        Title: c.Title,
        Description: c.Description,
        Status: c.Status,
        Tags: c.Tags,
        CreatedAt: c.CreatedAt,
        UpdatedAt: c.UpdatedAt,
        comments: c.comments.map(({ mediaDbId, citationRaw, ...comment }) => {
          const out: CasesSidecarComment = { ...comment };
          const mediaXref = mediaDbId === undefined ? undefined : maps.mediaIdToXref.get(mediaDbId);
          if (mediaXref) out.media = mediaXref;
          const citation = citationRaw ? sidecarCitation(citationRaw, maps.sourceIdToXref) : null;
          if (citation) out.citation = citation;
          return out;
        }),
        linkedPersonGedcomIds: c.linkedPersonDbIds
          .map((id) => maps.personIdToXref.get(id))
          .filter((xref): xref is string => xref !== undefined),
        sourceCitations: c.sourceCitationsRaw
          .map((raw) => sidecarCitation(raw, maps.sourceIdToXref))
          .filter((citation): citation is CasesSidecarCitation => citation !== null),
        ...(media.length > 0 ? { media } : {}),
      };
    }),
  };
}

/** The evidence fields a sidecar citation carries past source, page and note, each null when absent or malformed. */
interface CasesSidecarEvidence {
  quay: string | null;
  dataText: string | null;
  dataDate: string | null;
  even: string | null;
  role: string | null;
  url: string | null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value !== '' ? value.slice(0, max) : null;
}

/**
 * Reads a cases.json citation's evidence fields for import. Tolerant like the
 * other sidecar parsers: a bundle from before #1035 has none of them, and a
 * malformed one (an unknown certainty, a multi-line link) is dropped, not fatal.
 */
export function casesSidecarEvidence(citation: unknown): CasesSidecarEvidence {
  const r = citation && typeof citation === 'object' ? (citation as Record<string, unknown>) : {};
  const url = text(r.url, 4096);
  return {
    quay: isQuayValue(r.quay) ? r.quay : null,
    dataText: text(r.dataText, 20000),
    dataDate: text(r.dataDate, 500),
    even: text(r.even, 500),
    role: text(r.role, 500),
    url: url !== null && !/[\x00-\x1f\x7f\x85\u2028\u2029]/.test(url) ? url.trim() || null : null,
  };
}
