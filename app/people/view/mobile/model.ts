import type { FamilyType, Person, PersonDisplay, PersonWithRelations } from '@/lib/db/schema';
import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { sortableYear } from '@/lib/date-utils';
import { compareTimelineItems, hasDeathFact, shouldRenderColumnBirth, shouldRenderColumnDeath } from '../derive';
import { factPlaceEntry } from '@/lib/places/place-key';

/*
 * Pure derivations for the phone person page (#1046): what each pane lists and
 * what each tab counts. No React, no translations; the panes label the result.
 */

/** One row of the Events timeline, or the vitals strip's birth or death. */
export interface MobileFact {
    key: string;
    type: string;
    date: string | null;
    place: string | null;
    /** The place the fact points at (#1186): two places may share its name. */
    placeId: number | null;
    /** An event's description, or a death's cause. */
    detail: string | null;
    sortKey: number | null;
    factTable: FactTableValue;
    factId: number;
    /** Birth or death from the person's own columns (no Events row behind it). */
    vital: boolean;
}

function birthFact(p: PersonWithRelations): MobileFact {
    return {
        key: `birth-${p.Id}`, type: 'BIRT', date: p.BirthDate ?? null, place: p.BirthPlace ?? null, placeId: p.BirthPlaceId ?? null, detail: null,
        sortKey: sortableYear(p.BirthDate), factTable: FACT_TABLES.PERSON_BIRTH, factId: p.Id, vital: true,
    };
}

function deathFact(p: PersonWithRelations): MobileFact {
    return {
        key: `death-${p.Id}`, type: 'DEAT', date: p.DeathDate ?? null, place: p.DeathPlace ?? null, placeId: p.DeathPlaceId ?? null, detail: p.DeathCause ?? null,
        sortKey: sortableYear(p.DeathDate), factTable: FACT_TABLES.PERSON_DEATH, factId: p.Id, vital: true,
    };
}

/** The person's birth from their own columns, or null when none is recorded. */
export function vitalBirth(p: PersonWithRelations): MobileFact | null {
    return p.BirthDate || p.BirthPlace ? birthFact(p) : null;
}

/** The person's death from their own columns, or null when none is recorded. */
export function vitalDeath(p: PersonWithRelations): MobileFact | null {
    return hasDeathFact(p) ? deathFact(p) : null;
}

/** Birth, every life event and death, in the desktop timeline's order. */
export function timelineFacts(p: PersonWithRelations): MobileFact[] {
    const facts: MobileFact[] = [];
    if (shouldRenderColumnBirth(p)) facts.push(birthFact(p));
    for (const e of p.events ?? []) {
        facts.push({
            key: `event-${e.Id}`, type: e.Type, date: e.Date ?? null, place: e.Place ?? null, placeId: e.PlaceId ?? null, detail: e.Description ?? null,
            sortKey: sortableYear(e.Date), factTable: FACT_TABLES.EVENTS, factId: e.Id, vital: false,
        });
    }
    if (shouldRenderColumnDeath(p)) facts.push(deathFact(p));
    return facts.sort(compareTimelineItems);
}

export type Relation =
    | 'father' | 'mother' | 'parent'
    | 'husband' | 'wife' | 'partner'
    | 'son' | 'daughter' | 'child'
    | 'brother' | 'sister' | 'sibling';

const BY_SEX: Record<'parent' | 'partner' | 'child' | 'sibling', [Relation, Relation, Relation]> = {
    parent: ['father', 'mother', 'parent'],
    partner: ['husband', 'wife', 'partner'],
    child: ['son', 'daughter', 'child'],
    sibling: ['brother', 'sister', 'sibling'],
};

function relationOf(kind: keyof typeof BY_SEX, p: Pick<Person, 'Sex'>): Relation {
    const [m, f, x] = BY_SEX[kind];
    return p.Sex === 'M' ? m : p.Sex === 'F' ? f : x;
}

/** How a parent is linked when it isn't by birth (#982): "Stepfather", "Adoptive mother". */
export type ParentLink = 'adoption' | 'foster' | 'step' | 'guardian';

const PARENT_LINKS: Readonly<Record<string, ParentLink>> = { Adoption: 'adoption', Foster: 'foster', Step: 'step', Guardian: 'guardian' };

export interface FamilyMember {
    person: Person;
    relation: Relation;
    /** Parents only: the child's link to this parent, when it isn't birth or unknown. */
    parentLink?: ParentLink;
}

/** A relative as the relationship queries return them: with their portrait, when they have one. */
export type PortraitPerson = Person & Partial<Pick<PersonDisplay, 'EffectiveFirstName' | 'Nickname'>> & {
    PrimaryMediaId?: number | null;
    FocalX?: number | null;
    FocalY?: number | null;
    FocalRadius?: number | null;
};

/** A family the person belongs to, as the Family tab's family record row shows it (#1098). */
export interface FamilyCard {
    familyId: number;
    type: FamilyType | null;
    startDate: string | null;
    /** The partners' first names for the row's title; the person comes first in their own family. */
    names: string[];
    childCount: number;
    /** Up to three faces for the photo stack, front first: the partners, then the children with a portrait first. */
    stack: PortraitPerson[];
}

interface PartnerGroup {
    familyId: number;
    partner: Person | null;
    marriageDate: string | null;
    children: Person[];
    card: FamilyCard;
}

export interface MobileFamily {
    parents: FamilyMember[];
    /** One card per family the person is a child of: birth, adoptive, foster or step. */
    parentFamilies: FamilyCard[];
    partners: PartnerGroup[];
    siblings: FamilyMember[];
}

const STACK_SIZE = 3;

/** The name a family row calls a partner by: a nickname whole, else the first given name ("Anders", not "Anders Johan"). */
function firstName(q: PortraitPerson): string {
    const nickname = (q.Nickname ?? '').trim();
    if (nickname) return nickname;
    return (q.EffectiveFirstName ?? q.FirstName ?? '').trim().split(/\s+/)[0] || '?';
}

function familyCard(
    family: { Id: number; Type?: FamilyType | null; MarriageDate: string | null },
    partners: (Person | null | undefined)[],
    children: Person[],
): FamilyCard {
    const known = partners.filter((q): q is PortraitPerson => q != null);
    const kids = children as PortraitPerson[];
    // Children with a photo go first, so the stack shows faces where the tree has them.
    const withPhoto = [...kids.filter((k) => k.PrimaryMediaId), ...kids.filter((k) => !k.PrimaryMediaId)];
    return {
        familyId: family.Id,
        type: family.Type ?? null,
        startDate: family.MarriageDate ?? null,
        names: known.map(firstName),
        childCount: children.length,
        stack: [...known, ...withPhoto].slice(0, STACK_SIZE),
    };
}

export function familyOf(person: PersonWithRelations, portrait?: Pick<PortraitPerson, 'PrimaryMediaId' | 'FocalX' | 'FocalY' | 'FocalRadius'>): MobileFamily {
    const p: PersonWithRelations & PortraitPerson = portrait ? { ...person, ...portrait } : person;
    const seen = new Set<number>();
    const once = (q: Person | null | undefined): q is Person => {
        if (!q || q.Id === p.Id || seen.has(q.Id)) return false;
        seen.add(q.Id);
        return true;
    };
    const parents: FamilyMember[] = [];
    for (const rel of p.parents ?? []) {
        for (const [q, link] of [[rel.father, rel.partner1Relationship], [rel.mother, rel.partner2Relationship]] as const) {
            if (!once(q)) continue;
            const parentLink = link && Object.hasOwn(PARENT_LINKS, link) ? PARENT_LINKS[link] : undefined;
            parents.push({ person: q, relation: relationOf('parent', q), ...(parentLink ? { parentLink } : {}) });
        }
    }
    const siblingPool = [...(p.siblings ?? []), ...(p.parents ?? []).flatMap((rel) => rel.siblings ?? [])];
    const siblings = siblingPool.filter(once).map((q) => ({ person: q, relation: relationOf('sibling', q) }));
    // The person is one of their parents' children too, in birth order with the rest.
    const parentFamilies = (p.parents ?? []).map((rel) => familyCard(
        rel.family,
        [rel.father, rel.mother],
        [p, ...(rel.siblings ?? []).filter((q) => q.Id !== p.Id)].sort((a, b) => (sortableYear(a.BirthDate) ?? Infinity) - (sortableYear(b.BirthDate) ?? Infinity)),
    ));
    const partners = (p.spouses ?? []).map((s) => {
        const partner = s.person && s.person.Id !== p.Id ? s.person : null;
        const children = (s.children ?? []).filter((c) => c.Id !== p.Id);
        return {
            familyId: s.family.Id,
            partner,
            marriageDate: s.family.MarriageDate ?? null,
            children,
            card: familyCard(s.family, [p, partner], children),
        };
    });
    return { parents, parentFamilies, partners, siblings };
}

/** Everyone on the Family tab, each once: partners and their children, then parents, then siblings. */
export function familyMembers(f: MobileFamily): FamilyMember[] {
    const out: FamilyMember[] = [];
    const seen = new Set<number>();
    const add = (m: FamilyMember) => { if (!seen.has(m.person.Id)) { seen.add(m.person.Id); out.push(m); } };
    for (const g of f.partners) if (g.partner) add({ person: g.partner, relation: relationOf('partner', g.partner) });
    for (const g of f.partners) for (const c of g.children) add({ person: c, relation: relationOf('child', c) });
    f.parents.forEach(add);
    f.siblings.forEach(add);
    return out;
}

/** "Halvorsen" kept whole; everything before it is the part the name bar may cut. */
export function nameBarParts(p: Pick<PersonWithRelations, 'FirstName' | 'LastName' | 'EffectiveFirstName' | 'Nickname'>): { given: string; surname: string } {
    const given = (p.Nickname ?? '').trim() || (p.EffectiveFirstName ?? p.FirstName ?? '').trim();
    return { given, surname: (p.LastName ?? '').trim() };
}

/* ── Event types (#1048) ──────────────────────────────────────────────────── */

/** The Add event chooser's first choices, likeliest first; recorded vitals drop out. */
const COMMON_EVENT_TYPES = ['BIRT', 'DEAT', 'BURI', 'BAPM', 'CENS', 'EMIG', 'IMMI', 'NATU', 'OCCU', 'RESI'];

/** "More types": every person event type, grouped. Keys are `mobileEvents.group_*`. */
export const EVENT_TYPE_GROUPS: { key: 'life' | 'faith' | 'work' | 'places' | 'legal'; types: string[] }[] = [
    { key: 'life', types: ['BIRT', 'ADOP', 'DEAT', 'BURI'] },
    { key: 'faith', types: ['BAPM', 'CHR'] },
    { key: 'work', types: ['OCCU', 'EDUC', 'GRAD', 'RETI'] },
    { key: 'places', types: ['RESI', 'CENS', 'EMIG', 'IMMI', 'NATU'] },
    { key: 'legal', types: ['WILL', 'PROB'] },
];

/** A person has one birth and one death (their own columns); every other type repeats. */
export function alreadyRecorded(p: PersonWithRelations, type: string): boolean {
    if (type === 'BIRT') return vitalBirth(p) != null;
    if (type === 'DEAT') return vitalDeath(p) != null;
    return false;
}

/** The chooser's first eight types for this person. */
export function commonEventTypes(p: PersonWithRelations): string[] {
    return COMMON_EVENT_TYPES.filter((type) => !alreadyRecorded(p, type)).slice(0, 8);
}

/** How many Events rows of a type the person has ("2 recorded"). */
export function recordedCount(p: PersonWithRelations, type: string): number {
    return (p.events ?? []).filter((e) => e.Type === type).length;
}

/**
 * A typed name in "More types": the known type it names (by code or by its shown
 * label, any case), else the trimmed name as a custom type. A custom type is stored
 * as the Events "Type" itself and exported as `1 EVEN` + `2 TYPE` (ADR 0012).
 */
export function resolveEventType(typed: string, labelOf: (type: string) => string): { type: string; custom: boolean } | null {
    const name = typed.trim().replace(/\s+/g, ' ');
    if (!name) return null;
    const lower = name.toLocaleLowerCase();
    const known = EVENT_TYPE_GROUPS.flatMap((g) => g.types).find((type) => type.toLowerCase() === lower || labelOf(type).toLocaleLowerCase() === lower);
    return known ? { type: known, custom: false } : { type: name, custom: true };
}

/** One place on the Journey page: consecutive facts in the same place share a stop. */
export interface JourneyPlace {
    place: string;
    /** Null when the place has no coordinates; it's listed under the map instead. */
    at: { lat: number; lng: number } | null;
    /** First and last year there, when known. */
    from: number | null;
    to: number | null;
    /** The event types there, in order, each once. */
    types: string[];
}

/**
 * The person's journey (#1052): every fact with a place, in timeline order, with
 * back-to-back facts in one place folded into a single stop.
 */
export function journeyOf(p: PersonWithRelations, coords: Record<string, { lat: number; lng: number }>): JourneyPlace[] {
    const out: JourneyPlace[] = [];
    for (const f of timelineFacts(p)) {
        const place = f.place?.trim();
        if (!place) continue;
        const last = out[out.length - 1];
        const year = f.sortKey;
        if (last && last.place === place) {
            if (!last.types.includes(f.type)) last.types.push(f.type);
            if (year != null) {
                last.from = last.from == null ? year : Math.min(last.from, year);
                last.to = last.to == null ? year : Math.max(last.to, year);
            }
            continue;
        }
        out.push({ place, at: factPlaceEntry(coords, f.place, f.placeId) ?? factPlaceEntry(coords, place, f.placeId) ?? null, from: year, to: year, types: [f.type] });
    }
    return out;
}

/**
 * Where each mapped stop sits on a small static map: x and y in 0–1, north up,
 * with a margin, keeping the places' shape (no tiles; the full page has the map).
 */
export function miniMapPoints(stops: { lat: number; lng: number }[], aspect = 4 / 3): { x: number; y: number }[] {
    if (stops.length === 0) return [];
    // Equirectangular, with longitude narrowed by the stops' middle latitude.
    const midLat = (Math.min(...stops.map((s) => s.lat)) + Math.max(...stops.map((s) => s.lat))) / 2;
    const k = Math.cos((midLat * Math.PI) / 180);
    const xs = stops.map((s) => s.lng * k), ys = stops.map((s) => -s.lat);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
    const margin = 0.18;
    const scale = Math.max(spanX / aspect, spanY, 1e-9);
    return stops.map((_, i) => ({
        x: 0.5 + ((xs[i] - minX - spanX / 2) / scale) * (1 - 2 * margin) / aspect,
        y: 0.5 + ((ys[i] - minY - spanY / 2) / scale) * (1 - 2 * margin),
    }));
}
