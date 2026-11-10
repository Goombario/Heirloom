import type { TreeLifespan } from '@/app/components/tree/types';
import type { Person, PersonWithRelations } from '@/lib/db/schema';
import { displayFullName } from '@/lib/utils/names';
import { sortableYear } from '@/lib/date-utils';
import { FACT_TABLES } from '@/lib/db/fact-tables';

// The sex→avatar-class map is owned by the shared helper (single source for
// M/F/X/neutral). Re-exported here so the person-detail hero/summary keep their
// existing `./derive` import surface.
export { avatarClass } from '@/lib/utils/avatar';

export function fullName(p: Person | null, unknown = 'Unknown'): string {
    if (!p) return unknown;
    return displayFullName(p) || unknown;
}

export function eventIsBirth(type: string): boolean {
    return type === 'BIRT';
}

export function eventIsDeath(type: string): boolean {
    return type === 'DEAT' || type === 'BURI';
}

/** Minimal shape the intrinsic-vital guards need — a person's vital columns plus its events. */
type VitalGuardInput = {
    BirthDate?: string | null;
    BirthPlace?: string | null;
    DeathDate?: string | null;
    DeathPlace?: string | null;
    DeathCause?: string | null;
    IsDeceased?: number | null;
    events?: { Type: string }[] | null;
};

/**
 * A cause of death is a death fact in its own right — `generator.ts` emits a
 * `1 DEAT` block for a person carrying only a `DeathCause`. Every view-layer
 * predicate must agree, or the app denies the existence of a death its own
 * export contains (and offers "Add event → Death", which then overwrites it).
 */
function hasBirthFact(p: { BirthDate?: string | null; BirthPlace?: string | null }): boolean {
    return Boolean(p.BirthDate || p.BirthPlace);
}

export function hasDeathFact(p: {
    DeathDate?: string | null;
    DeathPlace?: string | null;
    DeathCause?: string | null;
    IsDeceased?: number | null;
}): boolean {
    return Boolean(p.DeathDate || p.DeathPlace || p.DeathCause || p.IsDeceased === 1);
}

/** Whether Add event should offer an intrinsic Birth/Death fact. */
export function canAddVitalEvent(p: VitalGuardInput, type: 'BIRT' | 'DEAT'): boolean {
    return type === 'BIRT' ? !hasBirthFact(p) : !hasDeathFact(p);
}

/**
 * Whether to render the intrinsic (column-derived) Birth row in the timeline.
 * True only when the person carries a birth column value AND no real `BIRT`
 * Events row exists — otherwise the column + event would double-render the fact.
 */
export function shouldRenderColumnBirth(p: VitalGuardInput): boolean {
    if (!hasBirthFact(p)) return false;
    return !(p.events ?? []).some((e) => e.Type === 'BIRT');
}

/**
 * Whether to render the intrinsic (column-derived) Death row in the timeline.
 * True only when the person carries a death column value AND no real `DEAT`
 * Events row exists (mirrors {@link shouldRenderColumnBirth}).
 */
export function shouldRenderColumnDeath(p: VitalGuardInput): boolean {
    if (!hasDeathFact(p)) return false;
    return !(p.events ?? []).some((e) => e.Type === 'DEAT');
}

export function countTotalFacts(p: PersonWithRelations): number {
    let n = 0;
    if (hasBirthFact(p)) n++;
    if (hasDeathFact(p)) n++;
    n += p.events?.length ?? 0;
    return n;
}

/**
 * Of the citable facts (birth, death, each life event), how many have at least
 * one citation. Mirrors the SQL "SourcedFacts" computation used by the people
 * list so the "X/Y sourced" chip means the same thing on both surfaces.
 */
export function countSourcedFacts(
    p: PersonWithRelations,
    citationMap: Record<string, readonly unknown[]>,
): number {
    const hasCite = (table: string, id: number) => (citationMap[`${table}:${id}`]?.length ?? 0) > 0;
    let n = 0;
    if (hasBirthFact(p) && hasCite(FACT_TABLES.PERSON_BIRTH, p.Id)) n++;
    if (hasDeathFact(p) && hasCite(FACT_TABLES.PERSON_DEATH, p.Id)) n++;
    for (const ev of p.events ?? []) {
        if (hasCite(FACT_TABLES.EVENTS, ev.Id)) n++;
    }
    return n;
}

/**
 * Direct children only. The loaded person carries one generation (`children` is a
 * flat `Person[]`), so this cannot see grandchildren — it is the immediate seed
 * for the Descendants button until the real subtree arrives. A person with no
 * children has no descendants either, so it is exact at zero, which is what
 * decides whether the button renders at all.
 */
export function countDescendants(p: PersonWithRelations): number {
    let count = 0;
    for (const s of p.spouses ?? []) {
        count += s.children?.length ?? 0;
    }
    return count;
}

/** The fields of a timeline row that decide its position. `sortKey` is the row's
 *  sortable year (see `sortableYear`), or null when it has none. */
export interface TimelineSortable {
    type: string;
    sortKey: number | null;
}

/**
 * Timeline order: an undated event has no position among the dated ones, so it
 * sinks to the bottom rather than sitting at year 0 ahead of every real date.
 *
 * Birth and Death are exempt because they bound the life whether or not a date was
 * recorded — the intrinsic Birth row renders for a person with only a BirthPlace,
 * and burying that below the death reads as nonsense. An undated birth therefore
 * leads, an undated death trails the dated rows, and only undated ordinary events
 * fall to the very end.
 */
export function compareTimelineItems(a: TimelineSortable, b: TimelineSortable): number {
    const bucket = (i: TimelineSortable): number => {
        if (i.sortKey !== null) return 1;
        if (i.type === 'BIRT') return 0;
        if (i.type === 'DEAT') return 2;
        return 3;
    };
    const ba = bucket(a), bb = bucket(b);
    if (ba !== bb) return ba - bb;
    return (a.sortKey ?? 0) - (b.sortKey ?? 0);
}

/** A node in the descendants tree returned by `client.tree.get({ mode: 'descendants' })`. */
export interface DescendantsTreeNode {
    id: number;
    name: string;
    lifespan?: TreeLifespan;
    children?: DescendantsTreeNode[];
}

/**
 * Every descendant beneath a node, all generations. `seen` guards against a
 * malformed tree pointing back at an ancestor, which would otherwise recurse
 * until the page hangs.
 */
export function countTreeDescendants(node: DescendantsTreeNode, seen: Set<number> = new Set()): number {
    if (seen.has(node.id)) return 0;
    seen.add(node.id);
    let n = 0;
    for (const c of node.children ?? []) {
        if (seen.has(c.id)) continue;
        n += 1 + countTreeDescendants(c, seen);
    }
    return n;
}

/** The most recent place across death, events, and birth, or null. Undated
 *  candidates sort last rather than at year zero. */
export function computeLastEventPlace(p: PersonWithRelations): { place: string; placeId: number | null } | null {
    const candidates: { year: number | null; place: string; placeId: number | null }[] = [];
    if (p.DeathPlace) candidates.push({ year: sortableYear(p.DeathDate), place: p.DeathPlace, placeId: p.DeathPlaceId ?? null });
    for (const ev of p.events ?? []) {
        if (ev.Place) candidates.push({ year: sortableYear(ev.Date), place: ev.Place, placeId: ev.PlaceId ?? null });
    }
    if (p.BirthPlace) candidates.push({ year: sortableYear(p.BirthDate), place: p.BirthPlace, placeId: p.BirthPlaceId ?? null });
    candidates.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
    const last = candidates[0];
    return last ? { place: last.place, placeId: last.placeId } : null;
}

/** Split a first-name string into its first word and the remainder (for nickname insertion). */
export function splitFirstName(firstName: string | null): { firstWord: string; rest: string } {
    const parts = (firstName ?? '').trim().split(/\s+/).filter(Boolean);
    return { firstWord: parts[0] ?? '', rest: parts.slice(1).join(' ') };
}

export function personRoleLabel(p: PersonWithRelations, t: (k: string) => string): string {
    const hasPartner = (p.spouses?.length ?? 0) > 0 || (p.familiesAsSpouse?.length ?? 0) > 0;
    const childCount = p.spouses?.reduce((sum, s) => sum + (s.children?.length ?? 0), 0) ?? 0;
    const isParent = childCount > 0;
    if (hasPartner && isParent) {
        return p.Sex === 'F' ? t('role_spouse_mother') : p.Sex === 'M' ? t('role_spouse_father') : t('role_spouse_parent');
    }
    if (hasPartner) return t('role_spouse');
    if (isParent) return p.Sex === 'F' ? t('role_mother') : p.Sex === 'M' ? t('role_father') : t('role_parent');
    return t('role_person');
}
