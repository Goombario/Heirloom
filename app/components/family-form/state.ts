import type { Person, PersonResult, Family, FamilyType } from '@/lib/db/schema';
import { displayFullName } from '@/lib/utils/names';
import { isChildRelationshipType, type ChildRelationshipType, type ChildRelationships } from '@/lib/child-relationship';

export interface FamilyFormState {
    Type: FamilyType;
    MarriageDate: string;
    MarriagePlace: string;
}

export const emptyForm: FamilyFormState = {
    Type: 'Marriage',
    MarriageDate: '',
    MarriagePlace: '',
};

export interface ChildRow {
    person: Person & { PrimaryMediaId?: number; FocalX?: number | null; FocalY?: number | null; FocalRadius?: number | null };
    /** The child's relationship to each partner slot (#982); a stored value may be outside the set. */
    partner1Relationship: string;
    partner2Relationship: string;
}

/** A row's relationships as the data layer takes them; a value outside the set reads as Birth. */
export function childRelationshipsOfRow(c: Pick<ChildRow, 'partner1Relationship' | 'partner2Relationship'>): ChildRelationships {
    const known = (v: string): ChildRelationshipType => (isChildRelationshipType(v) ? v : 'Birth');
    return { partner1: known(c.partner1Relationship), partner2: known(c.partner2Relationship) };
}

/** A loaded child row, from `families.get`'s children. */
export function childRowOf(p: ChildRow['person'] & { Partner1Relationship?: string | null; Partner2Relationship?: string | null }): ChildRow {
    return { person: p, partner1Relationship: p.Partner1Relationship ?? 'Birth', partner2Relationship: p.Partner2Relationship ?? 'Birth' };
}

export interface CitationRow {
    Id: number;
    SourceId: number;
    sourceTitle?: string | null;
    sourceType?: string | null;
}

export type AttachTarget = { factTable: string; factId: number; factLabel: string };

export interface FamilyBody {
    Partner1Id: number | null;
    Partner2Id: number | null;
    MarriageDate: string | null;
    MarriagePlace: string | null;
    Type: FamilyType;
}

/** Map a loaded Family record to the editable form state. */
export function familyToFormState(
    fam: Pick<Family, 'Type' | 'MarriageDate' | 'MarriagePlace'>,
): FamilyFormState {
    return {
        Type: (fam.Type as FamilyType) ?? 'Marriage',
        MarriageDate: fam.MarriageDate || '',
        MarriagePlace: fam.MarriagePlace || '',
    };
}

/** Build the create/update request body from the form + selected partners. */
export function buildFamilyBody(
    form: FamilyFormState,
    partner1Id: number | null,
    partner2Id: number | null,
): FamilyBody {
    return {
        Partner1Id: partner1Id,
        Partner2Id: partner2Id,
        MarriageDate: form.MarriageDate || null,
        MarriagePlace: form.MarriagePlace || null,
        Type: form.Type,
    };
}

export function partnerLabel(p: PersonResult | null): string {
    if (!p) return '';
    return displayFullName(p);
}

/** Header title: "A + B", a single name, or the fallback when neither partner is set. */
export function partnersTitle(
    partner1: PersonResult | null,
    partner2: PersonResult | null,
    fallback: string,
): string {
    const a = partnerLabel(partner1);
    const b = partnerLabel(partner2);
    if (!a && !b) return fallback;
    if (a && b) return `${a} + ${b}`;
    return a || b || '';
}
