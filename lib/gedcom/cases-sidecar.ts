// cases.json sidecar — research cases have no GEDCOM home, so the whole case rides
// here. People, sources and photos are referenced by the same xrefs the .ged uses
// ("@I5@", "@S1@", "@O3@"); media xrefs come from the export's media assembly, so
// a photo left out of the bundle is left out of its case too.
//
// Additive per ADR 0009: a field added after version 1 is written only when it has
// a value, a reader that predates it ignores it, and import reads a missing one as
// null. Case photos and journal photos (#1068) and every Citation field on case and
// journal citations (#1035) arrived this way, and so did a struck-out note's
// StruckAt / StruckReason (#1251), so `version` stays 1. The research workspace
// (#58, ADR 0045) adds a case's scope and outcome, its leads, requests and findings
// with their claims, and each journal entry's filing; within a case they refer to
// one another by their index in the case's `leads`, `requests` and `findings`.

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
  /** Indexes into the case's `leads`; the finding or request the entry tells of (#58). */
  leads?: number[];
  finding?: number;
  request?: number;
}

/** A lead (#58). `people` are person xrefs. */
interface CasesSidecarLead {
  Question: string;
  FromYear?: number;
  ToYear?: number;
  CreatedAt: string;
  SettledAt?: string;
  DroppedAt?: string;
  people?: string[];
}

interface CasesSidecarRequest {
  AskedFor: string;
  lead?: number;
  Holder?: string;
  SentBy?: string;
  SentOn?: string;
  Reference?: string;
  RemindOn?: string;
  State: string;
  RepliedAt?: string;
  ReplyNote?: string;
  CreatedAt: string;
}

interface CasesSidecarClaim {
  What: string;
  /** The person's xref, when they are in the tree. */
  person?: string;
  PersonName?: string;
  Says?: string;
  Date?: string;
  Place?: string;
  Evidence?: string;
  Decision: string;
  DecidedAt?: string;
  AppliedAt?: string;
}

interface CasesSidecarFinding {
  Kind: string;
  leads?: number[];
  request?: number;
  /** The record's image or PDF by media xref. */
  media?: string;
  SourceNature?: string;
  Information?: string;
  Searched?: string;
  Site?: string;
  Note?: string;
  CreatedAt: string;
  citation?: CasesSidecarCitation;
  claims?: CasesSidecarClaim[];
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
  FromYear?: number;
  ToYear?: number;
  Place?: string;
  QuestionKind?: string;
  Outcome?: string;
  ClosedAt?: string;
  leads?: CasesSidecarLead[];
  requests?: CasesSidecarRequest[];
  findings?: CasesSidecarFinding[];
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

/** Copies the fields of `from` that have a value: an additive field is written only when set (ADR 0009). */
function present<T extends object>(from: Record<string, unknown>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(from)) if (value !== null && value !== undefined && value !== '') out[key] = value;
  return out as Partial<T>;
}

function indexOf(ids: number[]): (id: number | null | undefined) => number | undefined {
  const map = new Map(ids.map((id, i) => [id, i]));
  return (id) => (id == null ? undefined : map.get(id));
}

function workspaceSidecar(c: CaseExportRecord, maps: CasesSidecarMaps) {
  const ws = c.workspace;
  if (!ws) return { leadIndex: indexOf([]), requestIndex: indexOf([]), findingIndex: indexOf([]), fields: {} };
  const leadIndex = indexOf(ws.leads.map((l) => l.Id));
  const requestIndex = indexOf(ws.requests.map((r) => r.Id));
  const findingIndex = indexOf(ws.findings.map((f) => f.Id));
  const leadList = (ids: number[]) => ids.map(leadIndex).filter((i): i is number => i !== undefined);
  const leads = ws.leads.map((l): CasesSidecarLead => {
    const people = l.personDbIds.map((id) => maps.personIdToXref.get(id)).filter((x): x is string => x !== undefined);
    return {
      Question: l.Question, CreatedAt: l.CreatedAt,
      ...present<CasesSidecarLead>({ FromYear: l.FromYear, ToYear: l.ToYear, SettledAt: l.SettledAt, DroppedAt: l.DroppedAt }),
      ...(people.length > 0 ? { people } : {}),
    };
  });
  const requests = ws.requests.map((r): CasesSidecarRequest => ({
    AskedFor: r.AskedFor, State: r.State, CreatedAt: r.CreatedAt,
    ...present<CasesSidecarRequest>({
      lead: leadIndex(r.LeadId), Holder: r.Holder, SentBy: r.SentBy, SentOn: r.SentOn, Reference: r.Reference,
      RemindOn: r.RemindOn, RepliedAt: r.RepliedAt, ReplyNote: r.ReplyNote,
    }),
  }));
  const findings = ws.findings.map((f): CasesSidecarFinding => {
    const filed = leadList(f.leadIds);
    const citation = f.citationRaw ? sidecarCitation(f.citationRaw, maps.sourceIdToXref) : null;
    const claims = f.claims.map((cl): CasesSidecarClaim => ({
      What: cl.What, Decision: cl.Decision,
      ...present<CasesSidecarClaim>({
        person: cl.PersonId == null ? undefined : maps.personIdToXref.get(cl.PersonId),
        PersonName: cl.PersonName, Says: cl.Says, Date: cl.Date, Place: cl.Place, Evidence: cl.Evidence,
        DecidedAt: cl.DecidedAt, AppliedAt: cl.AppliedAt,
      }),
    }));
    return {
      Kind: f.Kind, CreatedAt: f.CreatedAt,
      ...(filed.length > 0 ? { leads: filed } : {}),
      ...present<CasesSidecarFinding>({
        request: requestIndex(f.RequestId),
        media: f.MediaId == null ? undefined : maps.mediaIdToXref.get(f.MediaId),
        SourceNature: f.SourceNature, Information: f.Information, Searched: f.Searched, Site: f.Site, Note: f.Note,
      }),
      ...(citation ? { citation } : {}),
      ...(claims.length > 0 ? { claims } : {}),
    };
  });
  return {
    leadIndex, requestIndex, findingIndex,
    fields: {
      ...(leads.length > 0 ? { leads } : {}),
      ...(requests.length > 0 ? { requests } : {}),
      ...(findings.length > 0 ? { findings } : {}),
    },
  };
}

/** Builds cases.json for export. Hosted and local exports both call this, so they can't drift. */
export function buildCasesSidecar(cases: CaseExportRecord[], maps: CasesSidecarMaps): CasesSidecar {
  return {
    version: 1,
    cases: cases.map((c) => {
      const media = c.mediaDbIds
        .map((id) => maps.mediaIdToXref.get(id))
        .filter((xref): xref is string => xref !== undefined);
      const ws = workspaceSidecar(c, maps);
      return {
        Title: c.Title,
        Description: c.Description,
        Status: c.Status,
        Tags: c.Tags,
        CreatedAt: c.CreatedAt,
        UpdatedAt: c.UpdatedAt,
        comments: c.comments.map(({ mediaDbId, citationRaw, leadDbIds, findingDbId, requestDbId, ...comment }) => {
          const out: CasesSidecarComment = { ...comment };
          const leads = (leadDbIds ?? []).map(ws.leadIndex).filter((i): i is number => i !== undefined);
          if (leads.length > 0) out.leads = leads;
          const finding = ws.findingIndex(findingDbId);
          if (finding !== undefined) out.finding = finding;
          const request = ws.requestIndex(requestDbId);
          if (request !== undefined) out.request = request;
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
        ...present<CasesSidecarCase>({
          FromYear: c.FromYear, ToYear: c.ToYear, Place: c.Place, QuestionKind: c.QuestionKind,
          Outcome: c.Outcome, ClosedAt: c.ClosedAt,
        }),
        ...ws.fields,
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
  // NUL can't go in a Postgres text column; it is dropped so it can't fail the import.
  const s = typeof value === 'string' ? value.replace(/\u0000/g, '') : '';
  return s !== '' ? s.slice(0, max) : null;
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

// ─── Import: the research workspace (#58, ADR 0045 §9) ─────────────────────────

/** A sidecar workspace read for import. Entries keep their index; a malformed one is null, so references still line up. */
export interface ParsedCaseWorkspace {
  leads: Array<{
    Question: string; FromYear: number | null; ToYear: number | null;
    CreatedAt: string | null; SettledAt: string | null; DroppedAt: string | null; people: string[];
  } | null>;
  requests: Array<{
    lead: number | null; AskedFor: string; Holder: string | null; SentBy: string | null; SentOn: string | null;
    Reference: string | null; RemindOn: string | null; State: string; RepliedAt: string | null; ReplyNote: string | null;
    CreatedAt: string | null;
  } | null>;
  findings: Array<{
    Kind: 'record' | 'nothing'; leads: number[]; request: number | null; media: string | null;
    SourceNature: string | null; Information: string | null; Searched: string | null; Site: string | null; Note: string | null;
    CreatedAt: string | null;
    citation: { source: string; page: string | null; note: string | null; evidence: CasesSidecarEvidence } | null;
    claims: Array<{
      What: string; person: string | null; PersonName: string | null; Says: string | null; Date: string | null;
      Place: string | null; Evidence: string | null; Decision: string; DecidedAt: string | null; AppliedAt: string | null;
    }>;
  } | null>;
}

/** A case's scope and outcome read for import, each null when absent or malformed. */
export interface ParsedCaseScope {
  FromYear: number | null; ToYear: number | null; Place: string | null; QuestionKind: string | null;
  Outcome: string | null; ClosedAt: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown, max = 5000): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function year(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9999 ? value : null;
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  const year = date.getUTCFullYear();
  // Years Postgres stores and a researcher means; anything else is dropped.
  return Number.isFinite(date.getTime()) && year >= 1000 && year <= 9999 ? date.toISOString() : null;
}

function day(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Round-trip it, so an impossible date (Feb 31) is dropped rather than failing the import in SQL.
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function oneOf(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

function index(value: unknown, length: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length ? value : null;
}

function years(fromValue: unknown, toValue: unknown): { FromYear: number | null; ToYear: number | null } {
  const FromYear = year(fromValue);
  const ToYear = year(toValue);
  // A range the wrong way round keeps neither end, as the database would refuse it.
  return FromYear != null && ToYear != null && FromYear > ToYear ? { FromYear: null, ToYear: null } : { FromYear, ToYear };
}

/** Reads a sidecar case's scope and outcome. */
export function parseCaseScope(c: unknown): ParsedCaseScope {
  const r = record(c) ?? {};
  return {
    ...years(r.FromYear, r.ToYear),
    Place: text(r.Place, 500),
    QuestionKind: typeof r.QuestionKind === 'string' && /^[a-z_]{1,40}$/.test(r.QuestionKind) ? r.QuestionKind : null,
    Outcome: oneOf(r.Outcome, ['answered', 'ruled_out', 'unresolved']),
    ClosedAt: instant(r.ClosedAt),
  };
}

/** Reads a sidecar case's leads, requests and findings. Tolerant: what is malformed is dropped, never fatal. */
export function parseCaseWorkspace(c: unknown): ParsedCaseWorkspace {
  const r = record(c) ?? {};
  const rawLeads = list(r.leads, 500);
  const rawRequests = list(r.requests, 2000);
  const leads: ParsedCaseWorkspace['leads'] = rawLeads.map((value) => {
    const l = record(value);
    const question = l ? text(l.Question, 500)?.trim() : null;
    if (!l || !question) return null;
    return {
      Question: question, ...years(l.FromYear, l.ToYear),
      CreatedAt: instant(l.CreatedAt), SettledAt: instant(l.SettledAt), DroppedAt: instant(l.DroppedAt),
      people: list(l.people, 500).filter((x): x is string => typeof x === 'string'),
    };
  });
  const requests: ParsedCaseWorkspace['requests'] = rawRequests.map((value) => {
    const q = record(value);
    const askedFor = q ? text(q.AskedFor, 500)?.trim() : null;
    if (!q || !askedFor) return null;
    return {
      lead: index(q.lead, leads.length), AskedFor: askedFor, Holder: text(q.Holder, 500),
      SentBy: oneOf(q.SentBy, ['online', 'email', 'post', 'in_person']), SentOn: day(q.SentOn),
      Reference: text(q.Reference, 500), RemindOn: day(q.RemindOn),
      State: oneOf(q.State, ['waiting', 'received', 'nothing']) ?? 'waiting',
      RepliedAt: instant(q.RepliedAt), ReplyNote: text(q.ReplyNote, 10000), CreatedAt: instant(q.CreatedAt),
    };
  });
  const findings: ParsedCaseWorkspace['findings'] = list(r.findings, 5000).map((value) => {
    const f = record(value);
    const kind = f ? oneOf(f.Kind, ['record', 'nothing']) as 'record' | 'nothing' | null : null;
    if (!f || !kind) return null;
    const searched = text(f.Searched, 500);
    if (kind === 'nothing' && !searched) return null;
    const cit = record(f.citation);
    const citation = kind === 'record' && cit && typeof cit.source === 'string'
      ? { source: cit.source, page: text(cit.page, 500), note: text(cit.note, 5000), evidence: casesSidecarEvidence(cit) }
      : null;
    return {
      Kind: kind,
      leads: [...new Set(list(f.leads, 500).map((i) => index(i, leads.length)).filter((i): i is number => i !== null))],
      request: index(f.request, requests.length),
      media: kind === 'record' && typeof f.media === 'string' ? f.media : null,
      SourceNature: kind === 'record' ? oneOf(f.SourceNature, ['original', 'derivative', 'authored']) : null,
      Information: kind === 'record' ? oneOf(f.Information, ['primary', 'secondary', 'unknown']) : null,
      Searched: searched, Site: text(f.Site, 500), Note: text(f.Note, 10000), CreatedAt: instant(f.CreatedAt),
      citation,
      claims: kind !== 'record' ? [] : list(f.claims, 500).flatMap((cv) => {
        const cl = record(cv);
        const what = cl ? text(cl.What, 100)?.trim() : null;
        if (!cl || !what) return [];
        return [{
          What: what, person: typeof cl.person === 'string' ? cl.person : null, PersonName: text(cl.PersonName, 500),
          Says: text(cl.Says, 10000), Date: text(cl.Date, 100), Place: text(cl.Place, 500),
          Evidence: oneOf(cl.Evidence, ['direct', 'indirect', 'negative']),
          Decision: oneOf(cl.Decision, ['accepted', 'rejected', 'undecided']) ?? 'undecided',
          DecidedAt: instant(cl.DecidedAt), AppliedAt: instant(cl.AppliedAt),
        }];
      }),
    };
  });
  return { leads, requests, findings };
}

/** A sidecar journal entry's filing, finding and request, as indexes into the case's lists. */
export function parseCommentLinks(cmt: unknown, ws: ParsedCaseWorkspace): { leads: number[]; finding: number | null; request: number | null } {
  const r = record(cmt) ?? {};
  return {
    leads: [...new Set(list(r.leads, 500).map((i) => index(i, ws.leads.length)).filter((i): i is number => i !== null))],
    finding: index(r.finding, ws.findings.length),
    request: index(r.request, ws.requests.length),
  };
}
