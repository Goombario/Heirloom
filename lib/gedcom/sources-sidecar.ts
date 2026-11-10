// sources.json sidecar — carries Source/Citation data the GEDCOM .ged cannot anchor:
//   - sources: a redundant mirror of each source's repository name + call number,
//     keyed by the same @Sn@ xref the .ged uses (the .ged is primary on import;
//     this only fills a field a .ged happens to lack).
//   - nameVariants: structured NameVariant records (which have no GEDCOM home) plus
//     their citations. People are referenced by GEDCOM xref (e.g. "@I5@"), sources
//     by "@Sn@". Mirrors the cases.json / media.json sidecar pattern.
//
// Citations on People / PersonName / PersonBirth / PersonDeath / Events / Families
// ride in the .ged as standard SOUR pointers, NOT here. Cases citations ride in
// cases.json. NameVariant citations are the one overlap: since #963 they also ride
// under the variant's .ged line, so a .ged alone keeps them. They stay here for
// readers that predate that, and the import dedupes a row the .ged line created.

const CURRENT_VERSION = 1;

/** Structurally compatible with a Sources row (only the fields we mirror). */
export interface SidecarSourceInput {
  Id: number;
  RepositoryName: string | null;
  CallNumber: string | null;
}

/** Structurally compatible with a NameVariant row. */
export interface SidecarNameVariantInput {
  Id: number;
  PersonId: number;
  Type: string | null;
  Name: string;
  /** 0/1 in the DB. Dropped by the bundle before #399, which silently renamed
   *  people on every round trip (effectiveFirstName keys display off it). */
  IsPrimary?: number | null;
  /** Part of the variant's identity tuple (ADR 0009), so it must round-trip
   *  even though no UI writes it yet. */
  FromDate?: string | null;
  ToDate?: string | null;
}

/** Structurally compatible with a Citation row. */
export interface SidecarCitationInput {
  FactTable: string;
  FactId: number;
  SourceId: number;
  Page: string | null;
  Note: string | null;
}

export interface SidecarSourceEntry {
  xref: string;
  repositoryName: string | null;
  callNumber: string | null;
}

export interface SidecarCitationEntry {
  source: string; // source xref
  page: string | null;
  note: string | null;
}

export interface SidecarNameVariantEntry {
  person: string; // person xref
  type: string | null;
  name: string;
  /** Added additively (ADR 0009) — absent in bundles written before #399, where
   *  the tolerant parser defaults it to false. */
  isPrimary: boolean;
  fromDate: string | null;
  toDate: string | null;
  citations: SidecarCitationEntry[];
}

export interface SourcesSidecar {
  version: number;
  sources: SidecarSourceEntry[];
  nameVariants: SidecarNameVariantEntry[];
}

/**
 * Builds the sources.json object for export. `sourceIdToXref` maps a Source.Id to
 * its @Sn@ xref (same map the .ged and cases.json use). `dbIdToGedcomId` maps a
 * Person.Id to its @In@ xref. Sources with no repository info are skipped; name
 * variants whose person isn't in the map are skipped.
 */
export function buildSourcesSidecar(
  sources: SidecarSourceInput[],
  citations: SidecarCitationInput[],
  nameVariants: SidecarNameVariantInput[],
  sourceIdToXref: Map<number, string>,
  dbIdToGedcomId: Map<number, string>,
): SourcesSidecar {
  const sourceEntries: SidecarSourceEntry[] = [];
  for (const s of sources) {
    if (!s.RepositoryName && !s.CallNumber) continue;
    const xref = sourceIdToXref.get(s.Id);
    if (!xref) continue;
    sourceEntries.push({ xref, repositoryName: s.RepositoryName ?? null, callNumber: s.CallNumber ?? null });
  }

  // Index NameVariant citations by FactId.
  const citationsByVariant = new Map<number, SidecarCitationEntry[]>();
  for (const c of citations) {
    if (c.FactTable !== 'NameVariant') continue;
    const sourceXref = sourceIdToXref.get(c.SourceId);
    if (!sourceXref) continue;
    const list = citationsByVariant.get(c.FactId) ?? [];
    list.push({ source: sourceXref, page: c.Page ?? null, note: c.Note ?? null });
    citationsByVariant.set(c.FactId, list);
  }

  const variantEntries: SidecarNameVariantEntry[] = [];
  for (const v of nameVariants) {
    const personXref = dbIdToGedcomId.get(v.PersonId);
    if (!personXref) continue;
    variantEntries.push({
      person: personXref,
      type: v.Type ?? null,
      name: v.Name,
      isPrimary: v.IsPrimary === 1,
      fromDate: v.FromDate ?? null,
      toDate: v.ToDate ?? null,
      citations: citationsByVariant.get(v.Id) ?? [],
    });
  }

  return { version: CURRENT_VERSION, sources: sourceEntries, nameVariants: variantEntries };
}

/**
 * Parses and validates a sources.json string for import. Throws on invalid JSON
 * (caller returns 400). Malformed individual entries are dropped defensively.
 */
export function parseSourcesSidecar(raw: string): { sources: SidecarSourceEntry[]; nameVariants: SidecarNameVariantEntry[] } {
  const data = JSON.parse(raw) as unknown; // throws on invalid JSON
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  const sources: SidecarSourceEntry[] = [];
  if (Array.isArray(obj.sources)) {
    for (const item of obj.sources) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.xref !== 'string' || !r.xref) continue;
      sources.push({
        xref: r.xref,
        repositoryName: typeof r.repositoryName === 'string' ? r.repositoryName : null,
        callNumber: typeof r.callNumber === 'string' ? r.callNumber : null,
      });
    }
  }

  const nameVariants: SidecarNameVariantEntry[] = [];
  if (Array.isArray(obj.nameVariants)) {
    for (const item of obj.nameVariants) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.person !== 'string' || !r.person) continue;
      if (typeof r.name !== 'string' || !r.name) continue;
      const citations: SidecarCitationEntry[] = [];
      if (Array.isArray(r.citations)) {
        for (const c of r.citations) {
          if (!c || typeof c !== 'object') continue;
          const cr = c as Record<string, unknown>;
          if (typeof cr.source !== 'string' || !cr.source) continue;
          citations.push({
            source: cr.source,
            page: typeof cr.page === 'string' ? cr.page : null,
            note: typeof cr.note === 'string' ? cr.note : null,
          });
        }
      }
      nameVariants.push({
        person: r.person,
        type: typeof r.type === 'string' ? r.type : null,
        name: r.name,
        // Additive fields (ADR 0009): absent in pre-#399 bundles, so default
        // rather than reject. `isPrimary` accepts the JSON boolean we write and
        // the 0/1 a hand-edited or DB-shaped bundle might carry.
        isPrimary: r.isPrimary === true || r.isPrimary === 1,
        fromDate: typeof r.fromDate === 'string' ? r.fromDate : null,
        toDate: typeof r.toDate === 'string' ? r.toDate : null,
        citations,
      });
    }
  }

  return { sources, nameVariants };
}
