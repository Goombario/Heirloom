import type { PersonResult } from '@/lib/db/schema';
import type { ChildRelationshipType } from '@/lib/child-relationship';
import { sortableYear } from '@/lib/date-utils';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';

/*
 * Pure pieces of the phone New family form (#1066): who the form holds before
 * anything is saved, and the suggestions it offers. No React, no translations.
 */

/** A partner or child on the form: someone in the tree, or a person to create on Save. */
export interface Staged {
    /** Stable for the form's life: `p12` for an existing person, `n3` for a new one. */
    key: string;
    picked: PickedPerson;
}

/** A child on the form, with their relationship to each partner by the partner's key (#982). */
export interface StagedChild extends Staged {
    links: Record<string, ChildRelationshipType>;
}

/** The fields a row draws: a person's name, sex, dates and portrait. */
export interface StagedFace {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    DeathDate: string | null;
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
}

let nextNew = 0;

export function stage(picked: PickedPerson): Staged {
    return { key: picked.kind === 'existing' ? `p${picked.person.Id}` : `n${++nextNew}`, picked };
}

export function faceOf(s: Staged): StagedFace {
    if (s.picked.kind === 'existing') return s.picked.person;
    const d = s.picked.draft;
    return { Id: 0, FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate, DeathDate: null };
}

export const existingId = (s: Staged): number | null => (s.picked.kind === 'existing' ? s.picked.person.Id : null);

/** The ids already on the form, which the pickers leave out. */
export function takenIds(partners: Staged[], children: Staged[]): number[] {
    return [...partners, ...children].map(existingId).filter((id): id is number => id != null);
}

/** Children in birth order; undated ones keep their order at the end. */
export function inBirthOrder<T extends Staged>(children: T[]): T[] {
    return children
        .map((c, i) => ({ c, i, y: sortableYear(faceOf(c).BirthDate) }))
        .sort((a, b) => (a.y ?? Infinity) - (b.y ?? Infinity) || a.i - b.i)
        .map(({ c }) => c);
}

/** A tree's people as the list returns them: enough to suggest from. */
export interface PoolPerson extends PersonResult {
    DeathPlace?: string | null;
    ParentFamilyId?: number | null;
    FatherName?: string | null;
    MotherName?: string | null;
    /** Families this person is a partner in. */
    PartnershipCount?: number;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase();

/**
 * When the partners' children were likely born: 16 to 50 years after the partners'
 * births (from the younger partner's +16 to the elder's +50). Null with no birth year.
 */
export function childWindow(partners: StagedFace[]): { from: number; to: number } | null {
    const years = partners.map((p) => sortableYear(p.BirthDate)).filter((y): y is number => y != null);
    if (years.length === 0) return null;
    const from = Math.max(...years) + 16;
    const to = Math.min(...years) + 50;
    return from <= to ? { from, to } : null;
}

/**
 * Likely children (#1066): people with no parents yet who share a partner's surname
 * and were born in the partners' child window, eldest first.
 */
export function likelyChildren<T extends PoolPerson>(partners: StagedFace[], pool: T[], exclude: number[], limit = 6): T[] {
    const window = childWindow(partners);
    const surnames = new Set(partners.map((p) => norm(p.LastName)).filter(Boolean));
    if (!window || surnames.size === 0) return [];
    const skip = new Set(exclude);
    return pool
        .filter((p) => !skip.has(p.Id) && p.ParentFamilyId == null && !p.FatherName && !p.MotherName && surnames.has(norm(p.LastName)))
        .filter((p) => {
            const y = sortableYear(p.BirthDate);
            return y != null && y >= window.from && y <= window.to;
        })
        .sort((a, b) => (sortableYear(a.BirthDate) ?? 0) - (sortableYear(b.BirthDate) ?? 0))
        .slice(0, limit);
}

/** How far apart a suggested partner's birth may be. */
export const PARTNER_SPREAD = 12;

/**
 * Partner suggestions once one partner is on the form: people with no partner yet,
 * born within 12 years of them, closest first.
 */
export function partnerSuggestions<T extends PoolPerson>(other: StagedFace, pool: T[], exclude: number[], limit = 8): T[] {
    const base = sortableYear(other.BirthDate);
    if (base == null) return [];
    const skip = new Set(exclude);
    return pool
        .filter((p) => !skip.has(p.Id) && (p.PartnershipCount ?? 0) === 0)
        .map((p) => ({ p, d: Math.abs((sortableYear(p.BirthDate) ?? Infinity) - base) }))
        .filter(({ d }) => d <= PARTNER_SPREAD)
        .sort((a, b) => a.d - b.d)
        .slice(0, limit)
        .map(({ p }) => p);
}

/** The family these two partners already share, if any (the amber warning). */
export function sharedFamily<F extends { Id: number; Partner1Id: number | null; Partner2Id: number | null }>(families: F[], a: number, b: number): F | null {
    return families.find((f) => (f.Partner1Id === a && f.Partner2Id === b) || (f.Partner1Id === b && f.Partner2Id === a)) ?? null;
}

/** The earliest recorded death among the partners in the tree; it ends the family. */
export function firstDeath(partners: Staged[], pool: PoolPerson[]): StagedFace | null {
    const dead = partners
        .map((s) => (s.picked.kind === 'existing' ? s.picked.person : null))
        .filter((p): p is PersonResult => p != null)
        .filter((p) => p.DeathDate || pool.find((x) => x.Id === p.Id)?.DeathPlace);
    if (dead.length === 0) return null;
    return [...dead].sort((a, b) => (sortableYear(a.DeathDate) ?? Infinity) - (sortableYear(b.DeathDate) ?? Infinity))[0];
}

/**
 * The relationships a child is saved with: one per partner slot (#982). With one
 * partner, that partner's choice goes to both slots, as the family page writes it.
 */
export function slotLinks(child: StagedChild, partners: Staged[]): { partner1: ChildRelationshipType; partner2: ChildRelationshipType } {
    const of = (s: Staged | undefined) => (s ? child.links[s.key] ?? 'Birth' : 'Birth');
    if (partners.length < 2) {
        const one = of(partners[0]);
        return { partner1: one, partner2: one };
    }
    return { partner1: of(partners[0]), partner2: of(partners[1]) };
}
