import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DbExecutor } from '../lib/db/init-schema';
import { linkFactPlaceTexts, type FactPlaceText } from '../lib/db/queries/place-links';

export const SYNTHETIC_GENERATOR_VERSION = 4;
export const SYNTHETIC_PEOPLE_COUNT = 120;
export const SYNTHETIC_MEDIA_COUNT = 30;

export type SyntheticFamilyType = 'Marriage' | 'Civil union' | 'Common-law' | 'Other' | 'Unknown';
export type SyntheticChildRelationship = 'Birth' | 'Adoption' | 'Foster';
export type SyntheticFaceStatus = 'pending' | 'confirmed' | 'dismissed';
export type SyntheticFaceMatchKind = 'exact' | 'ambiguous' | 'none';

export interface SyntheticPersonSpec {
  xref: string;
  firstName: string;
  lastName: string;
  sex: 'M' | 'F' | 'X';
  birthDate: string;
  birthPlace: string;
  deathDate: string | null;
  deathPlace: string | null;
  deathCause: string | null;
  isDeceased: 0 | 1 | null;
}

export interface SyntheticFamilySpec {
  key: string;
  partner1: string | null;
  partner2: string | null;
  type: SyntheticFamilyType;
  marriageDate: string;
  marriagePlace: string;
  children: string[];
}

export interface SyntheticChildLinkSpec {
  familyKey: string;
  childXref: string;
  relationshipType: SyntheticChildRelationship;
}

export interface SyntheticEventSpec {
  type: string;
  date: string;
  place: string;
  description: string;
  personXref?: string;
  familyKey?: string;
}

export interface SyntheticPlaceSpec {
  name: string;
  displayName: string;
  latitude: number | null;
  longitude: number | null;
  parentName: string | null;
  form: string;
}

export interface SyntheticNameVariantSpec {
  personXref: string;
  type: 'Alias' | 'Nickname';
  name: string;
  isPrimary: 0 | 1;
}

export interface SyntheticNoteSpec {
  ownerTable: 'People' | 'Families' | 'Events';
  ownerRef: string;
  text: string;
  ownerFact: string | null;
  isPrimary: 0 | 1;
}

export interface SyntheticTagSpec {
  personXref: string;
  regionX: number;
  regionY: number;
  regionW: number;
  regionH: number;
}

export interface SyntheticMediaSpec {
  key: string;
  title: string;
  tags: SyntheticTagSpec[];
  ownerTable: 'Families' | 'Events';
  ownerRef: string;
}

export interface SyntheticFaceCandidateSpec {
  mediaKey: string;
  regionX: number;
  regionY: number;
  regionW: number;
  regionH: number;
  sourceName: string | null;
  suggestedPersonXref: string | null;
  matchKind: SyntheticFaceMatchKind;
  status: SyntheticFaceStatus;
  dismissReason: 'not-a-face' | 'unidentified' | null;
  tagOrdinal: number | null;
}

export interface SyntheticRepositorySpec {
  key: string;
  name: string;
  address: string;
}

export interface SyntheticSourceSpec {
  key: string;
  title: string;
  type: 'Census' | 'Vital' | 'Church' | 'Newspaper' | 'Oral' | 'Document';
  author: string | null;
  repositoryKey: string | null;
  callNumber: string | null;
  contents: string | null;
}

/**
 * One citation. `factRef` is a person xref for the person-keyed tables, a family
 * key for `Families`, an event key (`E001`, by dataset order) for `Events`, the
 * person xref owning the variant for `NameVariant`, a case key (`C01`) for
 * `Cases`, and a case key plus journal index (`C01/0`) for `CaseComments`.
 */
export interface SyntheticCitationSpec {
  sourceKey: string;
  factTable: 'People' | 'PersonName' | 'PersonBirth' | 'PersonDeath' | 'NameVariant' | 'Events' | 'Families' | 'Cases' | 'CaseComments';
  factRef: string;
  page: string | null;
  quay: '0' | '1' | '2' | '3' | null;
  dataText: string | null;
  note: string | null;
}

export type SyntheticCaseStatus = 'in_progress' | 'on_hold' | 'closed';

/**
 * One journal entry. A researcher note has no kind; a `status` line's body is the
 * status it moved to (or `reopened`), and a `conclusion` follows a `closed` line,
 * as the app writes them. `day` counts from the case's opening date.
 */
export interface SyntheticCaseCommentSpec {
  body: string;
  kind: 'status' | 'conclusion' | null;
  day: number;
  mediaKey?: string;
}

export interface SyntheticCaseSpec {
  key: string;
  title: string;
  description: string | null;
  status: SyntheticCaseStatus;
  tags: string[];
  people: string[];
  media: string[];
  openedOn: string;
  comments: SyntheticCaseCommentSpec[];
}

export interface SyntheticDataset {
  people: SyntheticPersonSpec[];
  families: SyntheticFamilySpec[];
  childLinks: SyntheticChildLinkSpec[];
  events: SyntheticEventSpec[];
  places: SyntheticPlaceSpec[];
  nameVariants: SyntheticNameVariantSpec[];
  notes: SyntheticNoteSpec[];
  media: SyntheticMediaSpec[];
  faceCandidates: SyntheticFaceCandidateSpec[];
  repositories: SyntheticRepositorySpec[];
  sources: SyntheticSourceSpec[];
  citations: SyntheticCitationSpec[];
  cases: SyntheticCaseSpec[];
}

export interface SyntheticSeedOptions {
  userId: number;
  treeId: number;
  storage: 'local' | 'hosted';
  mediaDirectory?: string;
  onHostedFilesWritten?: (files: string[]) => void;
}

export interface SyntheticSeedResult {
  treeId: number;
  people: number;
  families: number;
  childLinks: number;
  events: number;
  places: number;
  media: number;
  tags: number;
  faceCandidates: number;
  sources: number;
  citations: number;
  cases: number;
  caseComments: number;
  casePeople: number;
  caseCitations: number;
  caseMedia: number;
  mediaBytes: number;
}

const FIRST_NAMES = ['Aster', 'Briar', 'Cedar', 'Dahlia', 'Ember', 'Flint', 'Garnet', 'Hazel', 'Indigo', 'Juniper', 'Kestrel', 'Lumen'];
const LAST_NAMES = ['Arbor', 'Bracken', 'Cairn', 'Dovetail', 'Evers', 'Fable', 'Grove', 'Harbor', 'Ives', 'Kite'];
const PLACES = [
  { name: 'Northstar, Lumen, Asteria', displayName: 'Northstar, Lumen, Asteria', latitude: 43.7, longitude: -79.4, parentName: 'Lumen, Asteria', form: 'City' },
  { name: 'Lumen, Asteria', displayName: 'Lumen, Asteria', latitude: 43.6, longitude: -79.5, parentName: 'Asteria', form: 'Province' },
  { name: 'Asteria', displayName: 'Asteria', latitude: 44, longitude: -79, parentName: null, form: 'Country' },
  { name: 'Sunvale, Asteria', displayName: 'Sunvale, Asteria', latitude: 44.4, longitude: -78.7, parentName: 'Asteria', form: 'City' },
  { name: 'Moonridge, Asteria', displayName: 'Moonridge, Asteria', latitude: 45.1, longitude: -77.8, parentName: 'Asteria', form: 'City' },
  { name: 'Cedar Hollow, Asteria', displayName: 'Cedar Hollow, Asteria', latitude: 42.9, longitude: -80.1, parentName: 'Asteria', form: 'Town' },
];

function xref(index: number): string {
  return `@I${String(index).padStart(3, '0')}@`;
}

function personName(index: number): { firstName: string; lastName: string } {
  if (index === 117 || index === 118) return { firstName: 'Morgan', lastName: 'Vale' };
  return { firstName: FIRST_NAMES[(index - 1) % FIRST_NAMES.length], lastName: LAST_NAMES[Math.floor((index - 1) / FIRST_NAMES.length) % LAST_NAMES.length] };
}

function buildPeople(): SyntheticPersonSpec[] {
  return Array.from({ length: SYNTHETIC_PEOPLE_COUNT }, (_, offset) => {
    const index = offset + 1;
    const name = personName(index);
    const generation = index <= 16 ? 0 : index <= 40 ? 1 : index <= 88 ? 2 : 3;
    const birthYear = 1888 + generation * 28 + (index % 9);
    const deceased = index % 7 !== 0;
    return {
      xref: xref(index),
      ...name,
      sex: index % 3 === 0 ? 'X' : index % 2 === 0 ? 'F' : 'M',
      birthDate: `${birthYear}-${String((index % 12) + 1).padStart(2, '0')}-15`,
      birthPlace: PLACES[index % PLACES.length].name,
      deathDate: deceased ? `${birthYear + 71}-${String((index % 12) + 1).padStart(2, '0')}-20` : null,
      deathPlace: deceased ? PLACES[(index + 2) % PLACES.length].name : null,
      deathCause: deceased && index % 5 === 0 ? 'Asterian winter fever' : null,
      isDeceased: index % 11 === 0 ? null : deceased ? 1 : 0,
    };
  });
}

function buildFamilies(): SyntheticFamilySpec[] {
  const specs: Array<[string, string | null, string | null, SyntheticFamilyType, number[], SyntheticChildRelationship]> = [
    ['F001', '@I001@', '@I002@', 'Marriage', [17, 18, 19, 20], 'Birth'],
    ['F002', '@I003@', '@I004@', 'Civil union', [21, 22, 23, 24], 'Birth'],
    ['F003', '@I005@', '@I006@', 'Common-law', [25, 26, 27, 28, 33, 34], 'Birth'],
    ['F004', '@I007@', '@I008@', 'Other', [29, 30, 31, 32], 'Birth'],
    ['F005', '@I009@', '@I010@', 'Unknown', [33, 34], 'Adoption'],
    ['F006', '@I011@', '@I012@', 'Marriage', [35, 36], 'Foster'],
    ['F007', '@I013@', '@I014@', 'Marriage', [37, 38], 'Birth'],
    ['F008', '@I013@', '@I015@', 'Common-law', [39, 40], 'Birth'],
  ];
  const later: Array<[string, string, string, SyntheticFamilyType, number[]]> = [
    ['F009', '@I017@', '@I021@', 'Marriage', [41, 42, 43, 44]],
    ['F010', '@I019@', '@I023@', 'Civil union', [45, 46, 47, 48]],
    ['F011', '@I025@', '@I029@', 'Common-law', [49, 50, 51, 52]],
    ['F012', '@I027@', '@I031@', 'Other', [53, 54, 55, 56]],
    ['F013', '@I033@', '@I035@', 'Marriage', [57, 58, 59, 60]],
    ['F014', '@I037@', '@I039@', 'Common-law', [61, 62, 63, 64]],
    ['F015', '@I041@', '@I045@', 'Marriage', [65, 66, 67, 68]],
    ['F016', '@I043@', '@I047@', 'Civil union', [69, 70, 71, 72]],
    ['F017', '@I049@', '@I053@', 'Common-law', [73, 74, 75, 76]],
    ['F018', '@I051@', '@I055@', 'Other', [77, 78, 79, 80]],
    ['F019', '@I057@', '@I061@', 'Unknown', [81, 82, 83, 84]],
    ['F020', '@I059@', '@I063@', 'Marriage', [85, 86, 87, 88]],
    ['F021', '@I065@', '@I069@', 'Common-law', [89, 90, 91, 92]],
    ['F022', '@I067@', '@I071@', 'Civil union', [93, 94, 95, 96]],
    ['F023', '@I073@', '@I077@', 'Other', [97, 98, 99, 100]],
    ['F024', '@I075@', '@I079@', 'Unknown', [101, 102, 103, 104]],
  ];
  const families = specs.map(([key, partner1, partner2, type, children, relationshipType]) => ({
    key, partner1, partner2, type, children: children.map(xref), marriageDate: `19${String(20 + Number(key.slice(1))).padStart(2, '0')}-06-12`, marriagePlace: PLACES[Number(key.slice(1)) % PLACES.length].name,
    relationshipType,
  }));
  families.push(...later.map(([key, partner1, partner2, type, children]) => ({
    key, partner1, partner2, type, children: children.map(xref), marriageDate: `19${String(40 + Number(key.slice(1))).padStart(2, '0')}-06-12`, marriagePlace: PLACES[Number(key.slice(1)) % PLACES.length].name,
    relationshipType: 'Birth' as const,
  })));
  families.push({ key: 'F025', partner1: '@I109@', partner2: null, type: 'Other', children: ['@I110@'], marriageDate: '2010-06-12', marriagePlace: PLACES[1].name, relationshipType: 'Birth' });
  return families.map(({ relationshipType: _relationshipType, ...family }) => family);
}

function buildChildLinks(families: SyntheticFamilySpec[]): SyntheticChildLinkSpec[] {
  const links = families.flatMap(family => family.children.map(childXref => ({ familyKey: family.key, childXref, relationshipType: 'Birth' as SyntheticChildRelationship })));
  for (const link of links) {
    const family = families.find(candidate => candidate.key === link.familyKey);
    if (family?.key === 'F005' || family?.key === 'F006') link.relationshipType = family.key === 'F005' ? 'Adoption' : 'Foster';
  }
  return links;
}

// Age at which each life event happens. A person's birth and death are People
// columns, never Events rows (the app's own write paths hold that invariant; see
// app/components/person-form/vitalEvent.ts), so the cycle has no BIRT or DEAT.
const EVENT_AGE: Record<string, number> = {
  CHR: 0, BAPM: 0, ADOP: 2, CENS: 12, EDUC: 18, GRAD: 22, OCCU: 25, IMMI: 28, EVEN: 30, NATU: 33, RESI: 40, RETI: 65, WILL: 66,
};
const DEATH_EVENTS = new Set(['BURI', 'PROB']);

function personEvent(person: SyntheticPersonSpec, cycledType: string, index: number): SyntheticEventSpec {
  const [birthYear, birthMonth] = person.birthDate.split('-');
  const deathYear = person.deathDate ? Number(person.deathDate.slice(0, 4)) : null;
  // A living person cannot carry a death-type event.
  const type = DEATH_EVENTS.has(cycledType) && !person.deathDate ? 'RESI' : cycledType;
  const description = `Synthetic ${type} event ${String(index + 1).padStart(3, '0')}`;
  if (type === 'BURI' || type === 'PROB') {
    const [year, month] = person.deathDate!.split('-');
    const date = type === 'BURI' ? `${year}-${month}-27` : `${Number(year) + 1}-${month}-10`;
    return { type, date, place: person.deathPlace!, description, personXref: person.xref };
  }
  const year = Math.min(Number(birthYear) + EVENT_AGE[type], deathYear ?? 2024);
  const day = EVENT_AGE[type] === 0 ? '28' : '10';
  const date = `${year}-${birthMonth}-${day}`;
  // The year cap can still land after the death date within the death year.
  const dated = person.deathDate && date > person.deathDate ? person.deathDate : date;
  return { type, date: dated, place: PLACES[index % PLACES.length].name, description, personXref: person.xref };
}

function buildEvents(people: SyntheticPersonSpec[], families: SyntheticFamilySpec[]): SyntheticEventSpec[] {
  const types = ['OCCU', 'EDUC', 'RESI', 'BURI', 'CHR', 'BAPM', 'ADOP', 'EVEN', 'GRAD', 'IMMI', 'NATU', 'CENS', 'RETI', 'PROB', 'WILL'];
  const events: SyntheticEventSpec[] = people.map((person, index) => personEvent(person, types[index % types.length], index));
  events.push(...families.slice(0, 8).map((family, index) => ({ type: 'EVEN', date: `19${String(20 + index).padStart(2, '0')}-06-12`, place: family.marriagePlace, description: `Synthetic family milestone ${family.key}`, familyKey: family.key })));
  return events;
}

function buildMedia(people: SyntheticPersonSpec[]): SyntheticMediaSpec[] {
  return Array.from({ length: SYNTHETIC_MEDIA_COUNT }, (_, mediaIndex) => {
    const tags = people.slice(mediaIndex * 4, mediaIndex * 4 + 4).map((person, slot) => ({
      personXref: person.xref, regionX: 5 + slot * 23, regionY: 12 + (mediaIndex % 2) * 38, regionW: 18, regionH: 24,
    }));
    const ownerIndex = mediaIndex % 8;
    return { key: `M${String(mediaIndex + 1).padStart(3, '0')}`, title: `Synthetic gathering ${String(mediaIndex + 1).padStart(2, '0')}`, tags, ownerTable: mediaIndex % 3 === 0 ? 'Families' : 'Events', ownerRef: mediaIndex % 3 === 0 ? `F${String(ownerIndex + 1).padStart(3, '0')}` : `E${String(ownerIndex + 1).padStart(3, '0')}` };
  });
}

function buildCandidates(people: SyntheticPersonSpec[]): SyntheticFaceCandidateSpec[] {
  const name = (index: number) => `${people[index - 1].firstName} ${people[index - 1].lastName}`;
  return [
    { mediaKey: 'M001', regionX: 5, regionY: 12, regionW: 18, regionH: 24, sourceName: name(1), suggestedPersonXref: '@I001@', matchKind: 'exact', status: 'pending', dismissReason: null, tagOrdinal: null },
    { mediaKey: 'M002', regionX: 28, regionY: 12, regionW: 18, regionH: 24, sourceName: 'Morgan Vale', suggestedPersonXref: null, matchKind: 'ambiguous', status: 'pending', dismissReason: null, tagOrdinal: null },
    { mediaKey: 'M003', regionX: 51, regionY: 12, regionW: 18, regionH: 24, sourceName: 'Unlisted Synthetic Person', suggestedPersonXref: null, matchKind: 'none', status: 'pending', dismissReason: null, tagOrdinal: null },
    { mediaKey: 'M004', regionX: 5, regionY: 50, regionW: 18, regionH: 24, sourceName: name(13), suggestedPersonXref: '@I013@', matchKind: 'exact', status: 'confirmed', dismissReason: null, tagOrdinal: 0 },
    { mediaKey: 'M005', regionX: 28, regionY: 50, regionW: 18, regionH: 24, sourceName: 'Not a person', suggestedPersonXref: null, matchKind: 'none', status: 'dismissed', dismissReason: 'not-a-face', tagOrdinal: null },
    { mediaKey: 'M006', regionX: 51, regionY: 50, regionW: 18, regionH: 24, sourceName: null, suggestedPersonXref: null, matchKind: 'none', status: 'dismissed', dismissReason: 'unidentified', tagOrdinal: null },
  ];
}

const REPOSITORIES: SyntheticRepositorySpec[] = [
  { key: 'R1', name: 'Asteria Provincial Archives', address: '1 Archive Row, Lumen, Asteria' },
];

// S7 is cited by nothing, so the Library shows an uncited source.
const SOURCES: SyntheticSourceSpec[] = [
  { key: 'S1', title: 'Asteria civil registry: births', type: 'Vital', author: 'Asteria Registrar General', repositoryKey: 'R1', callNumber: 'ACR-B', contents: null },
  { key: 'S2', title: 'Asteria civil registry: deaths', type: 'Vital', author: 'Asteria Registrar General', repositoryKey: 'R1', callNumber: 'ACR-D', contents: null },
  { key: 'S3', title: '1911 census of Lumen', type: 'Census', author: 'Asteria Census Office', repositoryKey: 'R1', callNumber: 'CEN-1911-L', contents: null },
  { key: 'S4', title: 'Sunvale parish register', type: 'Church', author: 'St. Wren, Sunvale', repositoryKey: null, callNumber: null, contents: null },
  { key: 'S5', title: 'The Northstar Gazette', type: 'Newspaper', author: null, repositoryKey: null, callNumber: null, contents: null },
  { key: 'S6', title: 'Interview with Morgan Vale', type: 'Oral', author: 'Morgan Vale', repositoryKey: null, callNumber: null, contents: 'Recollections of the Arbor family, recorded in 1978.' },
  { key: 'S7', title: 'Bundle of family letters', type: 'Document', author: null, repositoryKey: null, callNumber: null, contents: null },
];

/**
 * Citations spread over every fact kind the person and family pages cite. The
 * first 40 people carry a registry birth, and the deceased among them a registry
 * death; person 1 is the dense case (three citations on the birth, plus name,
 * whole-person and event citations), and F001 has two family citations.
 */
function buildCitations(people: SyntheticPersonSpec[], events: SyntheticEventSpec[]): SyntheticCitationSpec[] {
  const cite = (sourceKey: string, factTable: SyntheticCitationSpec['factTable'], factRef: string, page: string | null, quay: SyntheticCitationSpec['quay'], dataText: string | null = null, note: string | null = null): SyntheticCitationSpec =>
    ({ sourceKey, factTable, factRef, page, quay, dataText, note });
  const eventKey = (index: number) => `E${String(index + 1).padStart(3, '0')}`;
  const citations: SyntheticCitationSpec[] = [];
  for (const [index, person] of people.slice(0, 40).entries()) {
    citations.push(cite('S1', 'PersonBirth', person.xref, `Vol. ${person.birthDate.slice(0, 4)}, entry ${index + 1}`, '3'));
    if (person.deathDate && index % 2 === 0) citations.push(cite('S2', 'PersonDeath', person.xref, `Vol. ${person.deathDate.slice(0, 4)}, entry ${index + 1}`, index % 4 === 0 ? '3' : '2'));
  }
  const first = people[0].xref;
  citations.push(
    cite('S4', 'PersonBirth', first, 'Baptisms, folio 12', '2', `Baptised ${people[0].firstName}, born the fifteenth.`),
    cite('S6', 'PersonBirth', first, null, '1', null, 'Recalled from memory; the year is uncertain.'),
    cite('S3', 'PersonName', first, 'District 4, sheet 7, line 22', '2'),
    cite('S6', 'People', first, null, '1'),
    cite('S6', 'NameVariant', '@I010@', null, '1', 'Everyone called her Nomi.'),
    cite('S3', 'PersonBirth', people[1].xref, 'District 4, sheet 7, line 23', null),
  );
  for (const [index, event] of events.entries()) {
    if (event.type === 'CENS' || (event.type === 'OCCU' && index < 60)) citations.push(cite('S3', 'Events', eventKey(index), `District ${(index % 6) + 1}, sheet ${index + 1}`, '2'));
    if (event.type === 'IMMI' || event.type === 'NATU') citations.push(cite('S5', 'Events', eventKey(index), `p. ${(index % 8) + 1}`, '1'));
    if (event.type === 'EVEN' && event.personXref === undefined && event.familyKey === 'F001') citations.push(cite('S5', 'Events', eventKey(index), 'Social notes, p. 4', '1'));
  }
  for (const familyKey of ['F001', 'F002', 'F003', 'F004', 'F005', 'F006', 'F007', 'F008']) citations.push(cite('S4', 'Families', familyKey, `Marriages, folio ${Number(familyKey.slice(1)) * 3}`, '3'));
  citations.push(cite('S5', 'Families', 'F001', 'Announcements, p. 2', '2', `The marriage of ${people[0].firstName} ${people[0].lastName} and ${people[1].firstName} ${people[1].lastName} was celebrated at Sunvale.`));
  return citations;
}

const note = (day: number, body: string, mediaKey?: string): SyntheticCaseCommentSpec => ({ body, kind: null, day, ...(mediaKey ? { mediaKey } : {}) });
const status = (day: number, body: 'in_progress' | 'on_hold' | 'closed' | 'reopened'): SyntheticCaseCommentSpec => ({ body, kind: 'status', day });
const conclusion = (day: number, body: string): SyntheticCaseCommentSpec => ({ body, kind: 'conclusion', day });

/**
 * Research cases (#913): every status, a closed case with a conclusion, a
 * reopened one, long, accented and Cyrillic titles, cases with and without tags,
 * people and evidence, a person (I001) on two cases, and journal entries of every
 * kind spread over most of a year. Case citations are in buildCaseCitations.
 */
const CASES: SyntheticCaseSpec[] = [
  {
    key: 'C01', title: 'Parents of Aster Arbor', description: 'No baptism names the parents. Work from the 1911 census household outwards.',
    status: 'in_progress', tags: ['parentage', 'Arbor'], people: ['@I001@'], media: ['M001', 'M002'], openedOn: '2026-01-05',
    comments: [note(0, 'Opened from the birth registry entry.'), note(9, 'Gathering photo 1 shows Aster beside two older adults.', 'M001'), note(30, 'The census household lists a widowed lodger; follow up.')],
  },
  {
    key: 'C02', title: 'Reconcile the conflicting birth years recorded for Briar Arbor across the civil registry, the 1911 census of Lumen and the Sunvale parish register',
    description: 'Three sources give three different years. Decide which one the tree should show and record why.',
    status: 'in_progress', tags: ['dates', 'conflict', 'census'], people: ['@I002@', '@I001@'], media: [], openedOn: '2026-01-20',
    comments: [note(0, 'The registry and the census disagree by two years.'), status(12, 'on_hold'), status(40, 'in_progress'), note(41, 'The census enumerator rounded ages; the registry wins.')],
  },
  {
    key: 'C03', title: 'Les deux Morgan Vale : même personne ?', description: 'Deux Morgan Vale nés à peu près la même année. Fusionner, ou garder séparés ?',
    status: 'on_hold', tags: [], people: ['@I117@', '@I118@'], media: [], openedOn: '2026-02-02',
    comments: [note(0, 'Même nom, même décennie, lieux différents.'), status(6, 'on_hold')],
  },
  {
    key: 'C04', title: 'Письма из Санвейла', description: 'Связка писем без подписи. Кто их написал?',
    status: 'in_progress', tags: ['letters'], people: [], media: ['M007'], openedOn: '2026-02-14',
    comments: [note(0, 'Почерк похож на записи в приходской книге.')],
  },
  {
    key: 'C05', title: 'Was Hazel Arbor born in Sunvale?', description: null,
    status: 'closed', tags: ['birth', 'Sunvale'], people: ['@I008@'], media: [], openedOn: '2026-03-01',
    comments: [note(0, 'Family story says Sunvale; the registry says otherwise.'), status(21, 'closed'), conclusion(21, 'Born in Moonridge. The Sunvale story comes from the baptism, a month later.')],
  },
  {
    key: 'C06', title: 'Immigration of the Bracken family', description: 'When did the Brackens arrive, and did they come together?',
    status: 'closed', tags: ['immigration', 'Bracken'], people: ['@I013@', '@I014@', '@I015@'], media: ['M004'], openedOn: '2026-03-10',
    comments: [note(0, 'Start from the Gazette shipping notices.'), status(15, 'on_hold'), status(60, 'in_progress'), note(61, 'Naturalisation papers name the ship.', 'M004'), status(75, 'closed'), conclusion(75, 'They arrived together in one crossing; the later date is the naturalisation.')],
  },
  {
    key: 'C07', title: '1911 census household of Lumen, district 4', description: 'Everyone enumerated in the household, and how each is related to the head.',
    status: 'in_progress', tags: ['census'], people: ['@I017@', '@I018@', '@I019@', '@I020@'], media: [], openedOn: '2026-04-02',
    comments: [note(0, 'Transcribed the household from sheet 7.'), note(18, 'Line 24 is a boarder, not a son.')],
  },
  {
    key: 'C08', title: 'Nomi: nickname or second given name?', description: null,
    status: 'on_hold', tags: ['names'], people: ['@I010@'], media: [], openedOn: '2026-05-11',
    comments: [note(0, 'Only the interview uses Nomi.'), status(3, 'on_hold')],
  },
  {
    key: 'C09', title: 'Death place of Cedar Arbor', description: 'The registry and the burial disagree.',
    status: 'in_progress', tags: ['death', 'Arbor'], people: ['@I003@'], media: [], openedOn: '2026-06-01',
    comments: [note(0, 'Registry says Northstar.'), status(10, 'closed'), conclusion(10, 'Northstar, per the registry.'), status(95, 'reopened'), note(96, 'A burial record in Cedar Hollow turned up.')],
  },
  {
    key: 'C10', title: 'Unknown sitters in gathering photo 5', description: 'Two faces the face review could not match.',
    status: 'in_progress', tags: ['photos', 'faces'], people: [], media: ['M005', 'M006'], openedOn: '2026-07-15',
    comments: [note(0, 'The left sitter wears the Sunvale choir badge.', 'M005')],
  },
];

/**
 * Evidence on cases and journal entries. S1 (cited by 40+ births) and S3 are cited
 * on both facts and cases, so a source page shows Used in research next to a long
 * fact list (#911). S7 stays uncited.
 */
function buildCaseCitations(): SyntheticCitationSpec[] {
  const cite = (sourceKey: string, factTable: 'Cases' | 'CaseComments', factRef: string, page: string | null, note: string | null = null): SyntheticCitationSpec =>
    ({ sourceKey, factTable, factRef, page, quay: null, dataText: null, note });
  return [
    cite('S1', 'Cases', 'C01', 'Vol. 1889, entry 1'),
    cite('S6', 'Cases', 'C01', null, 'Morgan remembers the parents as farmers.'),
    cite('S1', 'Cases', 'C02', null),
    cite('S3', 'Cases', 'C02', 'District 4, sheet 7, line 23'),
    cite('S4', 'Cases', 'C02', 'Baptisms, folio 12', 'Gives the baptism, not the birth.'),
    cite('S3', 'CaseComments', 'C02/3', 'District 4, sheet 7, line 23'),
    cite('S6', 'Cases', 'C03', null),
    cite('S5', 'Cases', 'C04', 'p. 3'),
    cite('S1', 'Cases', 'C05', 'Vol. 1897, entry 8'),
    cite('S4', 'Cases', 'C05', 'Baptisms, folio 31'),
    cite('S5', 'Cases', 'C06', 'Shipping notices, p. 6'),
    cite('S5', 'CaseComments', 'C06/3', 'p. 7', 'The ship is named here.'),
    cite('S3', 'Cases', 'C07', 'District 4, sheet 7'),
    cite('S1', 'Cases', 'C07', null),
    cite('S3', 'CaseComments', 'C07/1', 'District 4, sheet 7, line 24'),
    cite('S6', 'Cases', 'C08', null, 'Nomi is used throughout the interview.'),
    cite('S2', 'Cases', 'C09', 'Vol. 1962, entry 3'),
  ];
}

export function buildSyntheticDataset(): SyntheticDataset {
  const people = buildPeople();
  const families = buildFamilies();
  const events = buildEvents(people, families);
  return {
    people, families, childLinks: buildChildLinks(families), events, places: PLACES,
    nameVariants: [{ personXref: '@I010@', type: 'Nickname', name: 'Nomi', isPrimary: 1 }, { personXref: '@I020@', type: 'Alias', name: 'Briar Evers', isPrimary: 0 }],
    notes: [{ ownerTable: 'People', ownerRef: '@I001@', text: 'Synthetic note attached to a person.', ownerFact: null, isPrimary: 1 }, { ownerTable: 'Families', ownerRef: 'F001', text: 'Synthetic family note with no private provenance.', ownerFact: 'Marriage', isPrimary: 1 }],
    media: buildMedia(people), faceCandidates: buildCandidates(people),
    repositories: REPOSITORIES, sources: SOURCES, citations: [...buildCitations(people, events), ...buildCaseCitations()],
    cases: CASES,
  };
}

/** Case row counts the seed writes and `verify` checks (#913). */
export function syntheticCaseCounts(dataset: SyntheticDataset): Pick<SyntheticSeedResult, 'cases' | 'caseComments' | 'casePeople' | 'caseCitations' | 'caseMedia'> {
  return {
    cases: dataset.cases.length,
    caseComments: dataset.cases.reduce((sum, spec) => sum + spec.comments.length, 0),
    casePeople: dataset.cases.reduce((sum, spec) => sum + spec.people.length, 0),
    caseCitations: dataset.citations.filter(citation => citation.factTable === 'Cases' || citation.factTable === 'CaseComments').length,
    caseMedia: dataset.cases.reduce((sum, spec) => sum + spec.media.length, 0),
  };
}

export async function createSyntheticImage(index: number, faceCount: number): Promise<Uint8Array> {
  const faces = Array.from({ length: faceCount }, (_, slot) => {
    const cx = 120 + slot * 190;
    const cy = 220 + (index % 2) * 40;
    const color = ['#7c3aed', '#0891b2', '#ca8a04', '#db2777'][slot % 4];
    return `<circle cx="${cx}" cy="${cy}" r="72" fill="${color}"/><circle cx="${cx - 24}" cy="${cy - 12}" r="8" fill="#fff"/><circle cx="${cx + 24}" cy="${cy - 12}" r="8" fill="#fff"/><path d="M${cx - 25} ${cy + 25} Q${cx} ${cy + 45} ${cx + 25} ${cy + 25}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#e0f2fe"/><rect x="0" y="390" width="900" height="210" fill="#bae6fd"/><text x="30" y="60" font-family="sans-serif" font-size="30" fill="#164e63">SYNTHETIC PHOTO ${String(index).padStart(2, '0')}</text>${faces}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

function imagePath(directory: string, treeId: number, key: string): string {
  return path.join(directory, `synthetic-${treeId}-${key.toLowerCase()}.png`);
}

async function insertRows(exec: DbExecutor, sql: string, rows: unknown[][]): Promise<unknown[]> {
  if (rows.length === 0) return [];
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const start = rowIndex * row.length;
    values.push(...row);
    return `(${row.map((_, columnIndex) => `$${start + columnIndex + 1}`).join(', ')})`;
  });
  const result = await exec.query(sql.replace('__VALUES__', tuples.join(', ')), values);
  return result.rows;
}

export async function seedSyntheticDataset(exec: DbExecutor, options: SyntheticSeedOptions): Promise<SyntheticSeedResult> {
  const dataset = buildSyntheticDataset();
  if (options.storage === 'hosted' && !options.mediaDirectory) throw new Error('Hosted synthetic seeding requires a media directory');
  if (options.storage === 'hosted') await mkdir(options.mediaDirectory!, { recursive: true });

  const peopleRows = await insertRows(exec, `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "Sex", "GedcomId", "BirthDate", "DeathDate", "DeathCause", "IsDeceased") VALUES __VALUES__ RETURNING "Id", "GedcomId"`, dataset.people.map(person => [options.userId, options.treeId, person.firstName, person.lastName, person.sex, person.xref, person.birthDate, person.deathDate, person.deathCause, person.isDeceased]));
  const peopleByXref = new Map((peopleRows as Array<{ Id: number; GedcomId: string }>).map(row => [row.GedcomId, row.Id]));
  const placeRows = await insertRows(exec, `INSERT INTO "Places" ("UserId", "TreeId", "Name", "DisplayName", "Latitude", "Longitude", "Form") VALUES __VALUES__ RETURNING "Id", "Name"`, dataset.places.map(place => [options.userId, options.treeId, place.name, place.displayName, place.latitude, place.longitude, place.form]));
  const placeByName = new Map((placeRows as Array<{ Id: number; Name: string }>).map(row => [row.Name, row.Id]));
  for (const place of dataset.places) if (place.parentName) await exec.query(`UPDATE "Places" SET "ParentId" = $1 WHERE "Id" = $2 AND "TreeId" = $3`, [placeByName.get(place.parentName), placeByName.get(place.name), options.treeId]);

  for (const variant of dataset.nameVariants) await exec.query(`INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name", "IsPrimary") VALUES ($1, $2, $3, $4, $5, $6)`, [options.userId, options.treeId, peopleByXref.get(variant.personXref), variant.type, variant.name, variant.isPrimary]);
  const familyRows = await insertRows(exec, `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id", "HusbandId", "WifeId", "MarriageDate", "Type") VALUES __VALUES__ RETURNING "Id"`, dataset.families.map(family => {
    // App writes mirror the partners into the legacy HusbandId/WifeId columns, so the seed does too (#69).
    const partner1 = family.partner1 ? peopleByXref.get(family.partner1) : null;
    const partner2 = family.partner2 ? peopleByXref.get(family.partner2) : null;
    return [options.userId, options.treeId, partner1, partner2, partner1, partner2, family.marriageDate, family.type];
  }));
  const familiesByKey = new Map(dataset.families.map((family, index) => [family.key, (familyRows[index] as { Id: number }).Id]));
  for (const link of dataset.childLinks) await exec.query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId", "Partner1Relationship", "Partner2Relationship") VALUES ($1, $2, $3, $3)`, [familiesByKey.get(link.familyKey), peopleByXref.get(link.childXref), link.relationshipType]);
  const eventRows = await insertRows(exec, `INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "Description", "PersonId", "FamilyId") VALUES __VALUES__ RETURNING "Id"`, dataset.events.map(event => [options.userId, options.treeId, event.type, event.date, event.description, event.personXref ? peopleByXref.get(event.personXref) : null, event.familyKey ? familiesByKey.get(event.familyKey) : null]));
  const eventKeys = new Map(dataset.events.map((event, index) => [`E${String(index + 1).padStart(3, '0')}`, (eventRows[index] as { Id: number }).Id]));
  // Facts hold their place by reference (ADR 0037): link each to the place its text names.
  const factPlaces: FactPlaceText[] = [
    ...dataset.people.flatMap((person) => {
      const recordId = peopleByXref.get(person.xref)!;
      return [{ field: 'BirthPlace' as const, recordId, text: person.birthPlace }, { field: 'DeathPlace' as const, recordId, text: person.deathPlace }];
    }),
    ...dataset.families.map((family) => ({ field: 'MarriagePlace' as const, recordId: familiesByKey.get(family.key)!, text: family.marriagePlace })),
    ...dataset.events.map((event, index) => ({ field: 'Place' as const, recordId: (eventRows[index] as { Id: number }).Id, text: event.place })),
  ];
  await linkFactPlaceTexts(exec, options.treeId, options.userId, factPlaces);

  const mediaIds = new Map<string, number>();
  const tagIds = new Map<string, number>();
  const writtenFiles: string[] = [];
  let mediaBytes = 0;
  try {
    for (let index = 0; index < dataset.media.length; index++) {
      const media = dataset.media[index];
      const bytes = await createSyntheticImage(index + 1, media.tags.length);
      mediaBytes += bytes.byteLength;
      const filePath = options.storage === 'hosted' ? imagePath(options.mediaDirectory!, options.treeId, media.key) : null;
      if (filePath) {
        await writeFile(filePath, bytes, { flag: 'wx' });
        writtenFiles.push(filePath);
        options.onHostedFilesWritten?.([filePath]);
      }
      const hash = createHash('sha256').update(bytes).digest('hex');
      const mediaRows = await insertRows(exec, `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash") VALUES __VALUES__ RETURNING "Id"`, [[options.userId, options.treeId, media.title, filePath ? path.basename(filePath) : null, 'png', 'image/png', bytes.byteLength, hash]]);
      const mediaId = (mediaRows[0] as { Id: number }).Id;
      mediaIds.set(media.key, mediaId);
      if (options.storage === 'local') await exec.query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)`, [mediaId, bytes]);
      for (let tagIndex = 0; tagIndex < media.tags.length; tagIndex++) {
        const tag = media.tags[tagIndex];
        const tagRows = await insertRows(exec, `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES __VALUES__ RETURNING "Id"`, [[mediaId, peopleByXref.get(tag.personXref), tag.regionX, tag.regionY, tag.regionW, tag.regionH]]);
        tagIds.set(`${media.key}:${tagIndex}`, (tagRows[0] as { Id: number }).Id);
      }
    }

  const primaryByPerson = new Set<string>();
  for (const media of dataset.media) {
    const mediaId = mediaIds.get(media.key)!;
    for (const tag of media.tags) {
      const primary = !primaryByPerson.has(tag.personXref);
      primaryByPerson.add(tag.personXref);
      await exec.query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, 'People', $2, $3)`, [mediaId, peopleByXref.get(tag.personXref), primary ? 1 : 0]);
    }
    await exec.query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, $2, $3, 0)`, [mediaId, media.ownerTable, media.ownerTable === 'Families' ? familiesByKey.get(media.ownerRef) : eventKeys.get(media.ownerRef)]);
  }
  for (const candidate of dataset.faceCandidates) await exec.query(`INSERT INTO "MediaFaceCandidate" ("MediaId", "TreeId", "RegionX", "RegionY", "RegionW", "RegionH", "SourceName", "SuggestedPersonId", "MatchKind", "Status", "ConfirmedTagId", "DismissReason") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [mediaIds.get(candidate.mediaKey), options.treeId, candidate.regionX, candidate.regionY, candidate.regionW, candidate.regionH, candidate.sourceName, candidate.suggestedPersonXref ? peopleByXref.get(candidate.suggestedPersonXref) : null, candidate.matchKind, candidate.status, candidate.tagOrdinal === null ? null : tagIds.get(`${candidate.mediaKey}:${candidate.tagOrdinal}`), candidate.dismissReason]);
  for (const note of dataset.notes) {
    const ownerId = note.ownerTable === 'People' ? peopleByXref.get(note.ownerRef) : familiesByKey.get(note.ownerRef) ?? eventKeys.get(note.ownerRef);
    const noteRows = await exec.query(`INSERT INTO "Note" ("OwnerId", "TreeId", "Text") VALUES ($1, $2, $3) RETURNING "Id"`, [options.userId, options.treeId, note.text]);
    await exec.query(`INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId", "OwnerFact", "IsPrimary") VALUES ($1, $2, $3, $4, $5)`, [(noteRows.rows[0] as { Id: number }).Id, note.ownerTable, ownerId, note.ownerFact, note.isPrimary]);
  }

  const repositoryIds = new Map<string, number>();
  for (const repository of dataset.repositories) {
    const rows = await insertRows(exec, `INSERT INTO "Repository" ("OwnerId", "TreeId", "Name", "Address") VALUES __VALUES__ RETURNING "Id"`, [[options.userId, options.treeId, repository.name, repository.address]]);
    repositoryIds.set(repository.key, (rows[0] as { Id: number }).Id);
  }
  const repositoryName = (key: string | null) => dataset.repositories.find(repository => repository.key === key)?.name ?? null;
  const sourceRows = await insertRows(exec, `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Type", "Author", "RepositoryId", "RepositoryName", "CallNumber", "Contents") VALUES __VALUES__ RETURNING "Id"`, dataset.sources.map(source => [options.userId, options.treeId, source.title, source.type, source.author, source.repositoryKey ? repositoryIds.get(source.repositoryKey) : null, repositoryName(source.repositoryKey), source.callNumber, source.contents]));
  const sourceIds = new Map(dataset.sources.map((source, index) => [source.key, (sourceRows[index] as { Id: number }).Id]));
  const caseIds = new Map<string, number>();
  const commentIds = new Map<string, number>();
  const at = (openedOn: string, day: number) => new Date(Date.parse(`${openedOn}T12:00:00Z`) + day * 86_400_000).toISOString();
  for (const spec of dataset.cases) {
    const lastDay = Math.max(0, ...spec.comments.map(comment => comment.day));
    const caseRows = await exec.query(`INSERT INTO "Cases" ("UserId", "TreeId", "Title", "Description", "Status", "Tags", "CreatedAt", "UpdatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "Id"`, [options.userId, options.treeId, spec.title, spec.description, spec.status, spec.tags, at(spec.openedOn, 0), at(spec.openedOn, lastDay)]);
    const caseId = (caseRows.rows[0] as { Id: number }).Id;
    caseIds.set(spec.key, caseId);
    for (const person of spec.people) await exec.query(`INSERT INTO "CasePerson" ("CaseId", "PersonId") VALUES ($1, $2)`, [caseId, peopleByXref.get(person)]);
    for (const media of spec.media) await exec.query(`INSERT INTO "CaseMedia" ("CaseId", "MediaId") VALUES ($1, $2)`, [caseId, mediaIds.get(media)]);
    for (const [index, comment] of spec.comments.entries()) {
      const commentRows = await exec.query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "Kind", "MediaId", "CreatedAt") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "Id"`, [caseId, options.userId, comment.body, comment.kind, comment.mediaKey ? mediaIds.get(comment.mediaKey) : null, at(spec.openedOn, comment.day)]);
      commentIds.set(`${spec.key}/${index}`, (commentRows.rows[0] as { Id: number }).Id);
    }
  }
  const variantIds = new Map(((await exec.query(`SELECT nv."Id", p."GedcomId" FROM "NameVariant" nv JOIN "People" p ON p."Id" = nv."PersonId" WHERE nv."TreeId" = $1`, [options.treeId])).rows as Array<{ Id: number; GedcomId: string }>).map(row => [row.GedcomId, row.Id]));
  const factId = (citation: SyntheticCitationSpec): number | undefined => {
    if (citation.factTable === 'Families') return familiesByKey.get(citation.factRef);
    if (citation.factTable === 'Events') return eventKeys.get(citation.factRef);
    if (citation.factTable === 'NameVariant') return variantIds.get(citation.factRef);
    if (citation.factTable === 'Cases') return caseIds.get(citation.factRef);
    if (citation.factTable === 'CaseComments') return commentIds.get(citation.factRef);
    return peopleByXref.get(citation.factRef);
  };
  await insertRows(exec, `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page", "Quay", "DataText", "Note") VALUES __VALUES__`, dataset.citations.map(citation => {
    const id = factId(citation);
    if (id === undefined) throw new Error(`Synthetic citation targets an unknown ${citation.factTable} fact ${citation.factRef}`);
    return [options.userId, options.treeId, citation.factTable, id, sourceIds.get(citation.sourceKey), citation.page, citation.quay, citation.dataText, citation.note];
  }));

  const result = { treeId: options.treeId, people: dataset.people.length, families: dataset.families.length, childLinks: dataset.childLinks.length, events: dataset.events.length, places: dataset.places.length, media: dataset.media.length, tags: dataset.media.reduce((sum, media) => sum + media.tags.length, 0), faceCandidates: dataset.faceCandidates.length, sources: dataset.sources.length, citations: dataset.citations.length, ...syntheticCaseCounts(dataset), mediaBytes };
  return result;
  } catch (error) {
    if (options.storage === 'local' || !options.onHostedFilesWritten) {
      await Promise.all(writtenFiles.map(file => unlink(file).catch(() => undefined)));
    }
    throw error;
  }
}
