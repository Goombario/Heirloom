import { formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import type { FaceGroup } from '@/lib/data/types';
import type { FaceMatchKind, MediaFaceCandidate, PersonResult } from '@/lib/db/schema';
import type { FacePersonRef } from '@/lib/db/queries/media-faces';

/**
 * The Faces queue as decision rows (#1156). The server groups faces by the name
 * written in the photo; the page can split a group further, and holds the person
 * picked on each row until Tag. Splits and picks live only in the page: nothing is
 * written until Tag, Can't identify or Not a face.
 */
export interface FaceRow {
  /** Stable React key: the server group key, or `face:` / `split:` plus a face id. */
  key: string;
  group: FaceGroup;
  candidates: MediaFaceCandidate[];
  /** The state shown on the row. An ambiguous name with no person count reads as 'none'. */
  kind: FaceMatchKind;
  /** Who Tag confirms these faces as. Null until a person is known or picked. */
  person: FacePersonRef | null;
  /** The people a shared name could be, while none is picked yet. */
  sharedBy: FacePersonRef[];
  /** "Face 1 of 2 named …" after Choose for each face. */
  perFace: { index: number; of: number } | null;
  /** "Split off: not {name}" after Not {person} on one face. */
  splitFrom: string | null;
  /** True when the row came from a shared name; Confirm all never includes it. */
  shared: boolean;
}

export interface FaceRowSplits {
  /** Faces moved to their own row, with the person they are not. */
  notPerson: ReadonlyMap<number, string>;
  /** Shared-name groups split into one row per face. */
  perFace: ReadonlySet<string>;
}

export const NO_SPLITS: FaceRowSplits = { notPerson: new Map(), perFace: new Set() };

/** An ambiguous name with no person count left is treated as having no match. */
function faceGroupKind(group: FaceGroup): FaceMatchKind {
  return group.matchKind === 'ambiguous' && group.ambiguousPersonCount == null ? 'none' : group.matchKind;
}

export function buildFaceRows(
  groups: FaceGroup[],
  splits: FaceRowSplits,
  picks: ReadonlyMap<string, FacePersonRef>,
): FaceRow[] {
  const rows: FaceRow[] = [];
  for (const group of groups) {
    const kind = faceGroupKind(group);
    const shared = kind === 'ambiguous';
    const matched = kind === 'exact' || kind === 'variant' || kind === 'chosen';
    const base = {
      group,
      kind,
      person: matched ? group.suggestedPerson : null,
      sharedBy: shared ? group.ambiguousCandidates : [],
      perFace: null,
      splitFrom: null,
      shared,
    };
    const staying = group.candidates.filter(c => !splits.notPerson.has(c.Id));
    if (staying.length > 1 && shared && splits.perFace.has(group.groupKey)) {
      staying.forEach((c, i) => rows.push({ ...base, key: `face:${c.Id}`, candidates: [c], perFace: { index: i + 1, of: staying.length } }));
    } else if (staying.length > 0) {
      rows.push({ ...base, key: group.groupKey, candidates: staying });
    }
    for (const c of group.candidates) {
      const notName = splits.notPerson.get(c.Id);
      if (notName == null) continue;
      rows.push({ ...base, key: `split:${c.Id}`, candidates: [c], kind: 'none', person: null, sharedBy: [], splitFrom: notName, shared: false });
    }
  }
  return rows.map(row => {
    const pick = picks.get(row.key);
    if (!pick) return row;
    // Picking the person the name already matched keeps its state; anyone else is "You chose".
    const same = row.person?.id === pick.id && (row.kind === 'exact' || row.kind === 'variant');
    return { ...row, person: pick, kind: same ? row.kind : 'chosen', sharedBy: [] };
  });
}

/** Rows Confirm all tags: a known person, never a shared name. */
export function isConfirmAllRow(row: FaceRow): boolean {
  return row.person != null && !row.shared;
}

export function photoYear(candidate: MediaFaceCandidate): number | null {
  return sortableYear(candidate.MediaDate);
}

function birthYearOf(person: FacePersonRef): number | null {
  return sortableYear(person.birthYear);
}

export function photoCount(candidates: MediaFaceCandidate[]): number {
  return new Set(candidates.map(c => c.MediaId)).size;
}

/** Whether a shared-name candidate could be in this face's photo: not born after it. */
export function fitsPhoto(person: FacePersonRef, year: number | null): boolean {
  const born = birthYearOf(person);
  return year == null || born == null || born <= year;
}

export type SharedNameNote =
  | { kind: 'span'; from: number; to: number; name: string; born: number }
  | { kind: 'likely'; year: number; out: string; likely: string };

/**
 * The amber note on a shared name (#1156). On a group: when the photos start
 * before one candidate's birth, the faces may show different people. On a
 * per-face row: when only one candidate was born by the photo's year, that one is
 * likely. Nothing is picked for the user either way.
 */
export function sharedNameNote(row: FaceRow): SharedNameNote | null {
  if (row.sharedBy.length < 2) return null;
  const years = row.candidates.map(photoYear).filter((y): y is number => y != null);
  if (years.length === 0) return null;
  if (row.perFace) {
    const year = years[0];
    const fits = row.sharedBy.filter(p => fitsPhoto(p, year));
    const out = row.sharedBy.find(p => !fitsPhoto(p, year));
    return fits.length === 1 && out ? { kind: 'likely', year, out: out.name, likely: fits[0].name } : null;
  }
  if (row.candidates.length < 2) return null;
  const from = Math.min(...years);
  const to = Math.max(...years);
  const late = row.sharedBy.find(p => !fitsPhoto(p, from));
  const born = late ? birthYearOf(late) : null;
  return late && born != null ? { kind: 'span', from, to, name: late.name, born } : null;
}

/** A person picked from search, in the shape the rows carry. */
export function faceRefFromResult(p: PersonResult): FacePersonRef {
  return {
    id: p.Id,
    name: displayFullName(p),
    birthYear: formatYearOrEmpty(p.BirthDate) || null,
    deathYear: formatYearOrEmpty(p.DeathDate) || null,
    sex: p.Sex,
    mediaId: p.PrimaryMediaId ?? null,
    focalX: p.FocalX ?? null,
    focalY: p.FocalY ?? null,
    focalRadius: p.FocalRadius ?? null,
  };
}

/** The reverse, for the phone picker sheet's Suggested list. */
export function resultFromFaceRef(p: FacePersonRef): PersonResult {
  return {
    Id: p.id,
    FirstName: p.name,
    LastName: null,
    Sex: p.sex,
    BirthDate: p.birthYear,
    DeathDate: p.deathYear,
    PrimaryMediaId: p.mediaId ?? undefined,
    FocalX: p.focalX ?? undefined,
    FocalY: p.focalY ?? undefined,
    FocalRadius: p.focalRadius,
  };
}
