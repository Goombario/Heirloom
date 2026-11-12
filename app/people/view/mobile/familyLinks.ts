import type { FamilyType, Person, PersonWithRelations } from '@/lib/db/schema';
import type { ChildRelationshipInput, ChildRelationshipType } from '@/lib/data/types';
import { sortableYear } from '@/lib/date-utils';
import { familyOf, familyMembers } from './model';

/*
 * Pure planning for Add family on the phone (#1050): who to suggest, which families a
 * new relative can join, and the writes that link them. No React; the sheet labels it.
 */

export type FamilyRole = 'parent' | 'partner' | 'child' | 'sibling';

export const FAMILY_ROLES: readonly FamilyRole[] = ['parent', 'partner', 'child', 'sibling'];

/** The child types a person picks for their own child; Guardian and Unknown are
 *  set from the family page (#982). */
export const CHILD_TYPES: readonly ChildRelationshipType[] = ['Birth', 'Adoption', 'Foster', 'Step'];

/** The partnership types the family editor offers, in its order. */
export const PARTNERSHIP_TYPES: readonly { v: FamilyType; key: 'marriage' | 'civil_union' | 'common_law' | 'other' | 'unknown' }[] = [
    { v: 'Marriage', key: 'marriage' },
    { v: 'Civil union', key: 'civil_union' },
    { v: 'Common-law', key: 'common_law' },
    { v: 'Other', key: 'other' },
    { v: 'Unknown', key: 'unknown' },
];

/** A candidate's birth year minus this person's, for each role: the plausible window and its likeliest gap. */
const WINDOW: Record<FamilyRole, { min: number; max: number; ideal: number }> = {
    parent: { min: -70, max: -14, ideal: -28 },
    child: { min: 14, max: 70, ideal: 28 },
    partner: { min: -25, max: 25, ideal: 0 },
    sibling: { min: -25, max: 25, ideal: 0 },
};

/** The birth years a relative of this role plausibly has, or null when this person has no birth year. */
export function birthWindow(role: FamilyRole, birthDate: string | null | undefined): { from: number; to: number } | null {
    const year = sortableYear(birthDate);
    if (year == null) return null;
    return { from: year + WINDOW[role].min, to: year + WINDOW[role].max };
}

/** This person and everyone already on their Family tab: none of them is suggested or offered. */
export function linkedIds(p: PersonWithRelations): number[] {
    return [p.Id, ...familyMembers(familyOf(p)).map((m) => m.person.Id)];
}

interface Candidate {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    BirthDate: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase();

/**
 * Suggestions before anything is typed, narrowed by surname and plausible dates.
 * Children and siblings share a surname (this person's, or a partner's for a child);
 * parents and partners often don't, so they narrow by dates alone. With no birth year
 * to go on, only a shared surname narrows, and a partner gets no suggestions.
 */
export function suggestRelatives<T extends Candidate>(
    role: FamilyRole,
    person: PersonWithRelations,
    pool: T[],
    limit = 8,
): { people: T[]; window: { from: number; to: number } | null; surname: string | null } {
    const window = birthWindow(role, person.BirthDate);
    const own = (person.LastName ?? '').trim();
    const partnerSurnames = role === 'child' ? (person.spouses ?? []).map((s) => s.person?.LastName) : [];
    const bySurname = role === 'child' || role === 'sibling' || (role === 'parent' && !window);
    const surnames = new Set([own, ...partnerSurnames].map(norm).filter(Boolean));
    if (bySurname && surnames.size === 0 && !window) return { people: [], window, surname: null };
    if (!bySurname && !window) return { people: [], window, surname: null };

    const skip = new Set(linkedIds(person));
    const base = sortableYear(person.BirthDate);
    const scored: { c: T; score: number }[] = [];
    for (const c of pool) {
        if (skip.has(c.Id)) continue;
        if (bySurname && surnames.size > 0 && !surnames.has(norm(c.LastName))) continue;
        const year = sortableYear(c.BirthDate);
        let score = 1000;
        if (window) {
            if (year == null || year < window.from || year > window.to) continue;
            score = Math.abs(year - (base as number) - WINDOW[role].ideal);
        }
        scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score
        || norm(a.c.LastName).localeCompare(norm(b.c.LastName))
        || norm(a.c.FirstName).localeCompare(norm(b.c.FirstName)));
    return {
        people: scored.slice(0, limit).map((s) => s.c),
        window,
        surname: bySurname && own ? own : null,
    };
}

/* ── Which family ─────────────────────────────────────────────────────────── */

type Slot = 'Partner1Id' | 'Partner2Id';

/** A parent family with a free partner slot: a new parent fills it. */
export interface ParentFamilyOption {
    familyId: number;
    slot: Slot;
    /** The parent already there, if any. */
    parent: Person | null;
    /** This person's link to that parent (#982). */
    relationshipType: string | null;
}

export function parentFamilyOptions(p: PersonWithRelations): ParentFamilyOption[] {
    return (p.parents ?? []).flatMap((rel) => {
        const f = rel.family;
        if (f.Partner1Id != null && f.Partner2Id != null) return [];
        return [{
            familyId: f.Id,
            slot: f.Partner1Id == null ? 'Partner1Id' : 'Partner2Id',
            parent: rel.father ?? rel.mother ?? null,
            relationshipType: (f.Partner1Id != null ? rel.partner1Relationship : rel.partner2Relationship) ?? null,
        }];
    });
}

/** A family this person is a partner in: a new child joins it. */
export interface ChildFamilyOption {
    familyId: number;
    /** This person's own slot in the family. */
    slot: Slot;
    partner: Person | null;
    marriageDate: string | null;
    childCount: number;
}

export function childFamilyOptions(p: PersonWithRelations): ChildFamilyOption[] {
    return familyOf(p).partners.map((g) => ({
        familyId: g.familyId,
        slot: p.spouses?.find((s) => s.family.Id === g.familyId)?.family.Partner2Id === p.Id ? 'Partner2Id' : 'Partner1Id',
        partner: g.partner, marriageDate: g.marriageDate, childCount: g.children.length,
    }));
}

/** One of this person's parent families: a new sibling joins it. */
export interface SiblingFamilyOption {
    familyId: number;
    parents: Person[];
    childCount: number;
}

export function siblingFamilyOptions(p: PersonWithRelations): SiblingFamilyOption[] {
    return (p.parents ?? []).map((rel) => ({
        familyId: rel.family.Id,
        parents: [rel.father, rel.mother].filter((x): x is Person => x != null),
        childCount: 1 + (rel.siblings ?? []).length,
    }));
}

/* ── The writes ───────────────────────────────────────────────────────────── */

/** The person being added: an id once they exist. */
export type Who = number | 'picked';

export type LinkStep =
    | { kind: 'create-family'; partners: [Who | null, Who | null]; type?: FamilyType; startDate?: string | null }
    /** The picked person fills a parent family's free partner slot. */
    | { kind: 'set-partner'; familyId: number; slot: Slot }
    /** `'new'` is the family the plan's create-family step made. */
    | { kind: 'add-child'; familyId: number | 'new'; child: Who; type: ChildRelationshipInput };

export interface LinkChoice {
    /** The family to join; null starts a new one. */
    familyId: number | null;
    /** Parent: the free slot in `familyId`. Child: this person's own slot there. */
    slot?: Slot;
    /** Child: how they're linked. */
    childType?: ChildRelationshipType;
    /** Partner: the partnership type and when it started. */
    familyType?: FamilyType;
    startDate?: string | null;
}

/** The writes that link the picked person to `personId` in this role, in order. */
export function linkPlan(role: FamilyRole, personId: number, choice: LinkChoice): LinkStep[] {
    switch (role) {
        case 'partner':
            return [{ kind: 'create-family', partners: [personId, 'picked'], type: choice.familyType ?? 'Marriage', startDate: choice.startDate ?? null }];
        case 'parent':
            return choice.familyId != null
                ? [{ kind: 'set-partner', familyId: choice.familyId, slot: choice.slot ?? 'Partner1Id' }]
                : [{ kind: 'create-family', partners: ['picked', null] }, { kind: 'add-child', familyId: 'new', child: personId, type: 'Birth' }];
        case 'child': {
            // A stepchild is this person's stepchild and, usually, their partner's
            // birth child, so Step is this person's slot only (#982). The other types
            // are both partners'. A new family puts this person in Partner1.
            const childType = choice.childType ?? 'Birth';
            const mine = choice.familyId != null ? choice.slot ?? 'Partner1Id' : 'Partner1Id';
            const type: ChildRelationshipInput = childType === 'Step'
                ? { partner1: mine === 'Partner1Id' ? 'Step' : 'Birth', partner2: mine === 'Partner2Id' ? 'Step' : 'Birth' }
                : childType;
            return choice.familyId != null
                ? [{ kind: 'add-child', familyId: choice.familyId, child: 'picked', type }]
                : [{ kind: 'create-family', partners: [personId, null] }, { kind: 'add-child', familyId: 'new', child: 'picked', type }];
        }
        case 'sibling':
            return choice.familyId != null
                ? [{ kind: 'add-child', familyId: choice.familyId, child: 'picked', type: 'Birth' }]
                : [
                    { kind: 'create-family', partners: [null, null] },
                    { kind: 'add-child', familyId: 'new', child: personId, type: 'Birth' },
                    { kind: 'add-child', familyId: 'new', child: 'picked', type: 'Birth' },
                ];
    }
}
