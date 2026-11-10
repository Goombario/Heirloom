import { describe, it, expect } from 'vitest';
import {
    CHILD_RELATIONSHIP_TYPE_VALUES,
    CHILD_RELATIONSHIP_TO_FTM_VALUE,
    FTM_VALUE_TO_CHILD_RELATIONSHIP,
    childRelationshipsOf,
    isChildRelationshipType,
    parseChildRelationships,
    sharedChildRelationship,
} from '@/lib/child-relationship';

/**
 * A child's relationship to each partner (#982, ADR 0027). The columns are
 * unchecked TEXT, so these guards are what keep untrusted input (an API body, a
 * local-client call, an imported value) inside the set.
 */
describe('ChildRelationshipType', () => {
    it('accepts the six values', () => {
        expect([...CHILD_RELATIONSHIP_TYPE_VALUES].sort()).toEqual(['Adoption', 'Birth', 'Foster', 'Guardian', 'Step', 'Unknown']);
        for (const v of CHILD_RELATIONSHIP_TYPE_VALUES) expect(isChildRelationshipType(v)).toBe(true);
    });

    it('rejects non-string and unknown input', () => {
        expect(isChildRelationshipType(null)).toBe(false);
        expect(isChildRelationshipType(undefined)).toBe(false);
        expect(isChildRelationshipType(42)).toBe(false);
        expect(isChildRelationshipType('birth')).toBe(false); // case-sensitive column value
        expect(isChildRelationshipType('Sealed')).toBe(false);
        expect(isChildRelationshipType('')).toBe(false);
    });
});

describe('parseChildRelationships', () => {
    it('spreads one type over both partners', () => {
        expect(parseChildRelationships('Adoption')).toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
        expect(childRelationshipsOf()).toEqual({ partner1: 'Birth', partner2: 'Birth' });
    });

    it('takes a pair, and refuses one with a value outside the set', () => {
        expect(parseChildRelationships({ partner1: 'Birth', partner2: 'Step' })).toEqual({ partner1: 'Birth', partner2: 'Step' });
        expect(parseChildRelationships({ partner1: 'Birth', partner2: 'Sealed' })).toBeNull();
        expect(parseChildRelationships({ partner1: 'Birth' })).toBeNull();
        expect(parseChildRelationships(null)).toBeNull();
        expect(parseChildRelationships(['Birth', 'Step'])).toBeNull();
    });
});

describe('sharedChildRelationship', () => {
    const both = { partner1: true, partner2: true };
    it('is the one value when the partners agree, and null when they differ', () => {
        expect(sharedChildRelationship('Adoption', 'Adoption', both)).toBe('Adoption');
        expect(sharedChildRelationship('Birth', 'Step', both)).toBeNull();
    });

    it('counts only the slots that have a partner', () => {
        expect(sharedChildRelationship('Step', 'Birth', { partner1: true, partner2: false })).toBe('Step');
        expect(sharedChildRelationship('Birth', 'Foster', { partner1: false, partner2: true })).toBe('Foster');
        expect(sharedChildRelationship('Birth', 'Step', { partner1: false, partner2: false })).toBeNull();
    });
});

describe('FTM value maps', () => {
    it('round-trip every type', () => {
        for (const type of CHILD_RELATIONSHIP_TYPE_VALUES) {
            expect(FTM_VALUE_TO_CHILD_RELATIONSHIP[CHILD_RELATIONSHIP_TO_FTM_VALUE[type].toLowerCase()]).toBe(type);
        }
    });

    it('leave FTM values with no type unmapped', () => {
        for (const v of ['related', 'sealed', 'private']) expect(FTM_VALUE_TO_CHILD_RELATIONSHIP[v]).toBeUndefined();
    });
});
