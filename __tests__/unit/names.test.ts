import { describe, it, expect } from 'vitest';
import { displayFirstName, displayGivenNames, displayFullName } from '@/lib/utils/names';

describe('displayFirstName', () => {
    it('uses the effective (primary) first name when present', () => {
        expect(displayFirstName({ FirstName: 'Edmund', EffectiveFirstName: 'Ned' })).toBe('Ned');
    });

    it('falls back to FirstName when no effective name', () => {
        expect(displayFirstName({ FirstName: 'Edmund' })).toBe('Edmund');
        expect(displayFirstName({ FirstName: 'Edmund', EffectiveFirstName: null })).toBe('Edmund');
    });

    it('returns empty string when nothing is set', () => {
        expect(displayFirstName({})).toBe('');
        expect(displayFirstName({ FirstName: null })).toBe('');
    });
});

describe('displayFullName', () => {
    it('combines the effective first name with the last name', () => {
        expect(displayFullName({ FirstName: 'Edmund', EffectiveFirstName: 'Ned', LastName: 'Ashby' })).toBe('Ned Ashby');
    });

    it('uses FirstName when no primary variant', () => {
        expect(displayFullName({ FirstName: 'Edmund', LastName: 'Ashby' })).toBe('Edmund Ashby');
    });

    it('trims when a part is missing', () => {
        expect(displayFullName({ FirstName: 'Edmund' })).toBe('Edmund');
        expect(displayFullName({ LastName: 'Ashby' })).toBe('Ashby');
        expect(displayFullName({})).toBe('');
    });

    it('integrates the preferred nickname into the given names', () => {
        expect(displayFullName({ FirstName: 'Edmund Ashby David', Nickname: 'Ned', LastName: 'Thornbury' }))
            .toBe('Edmund “Ned” Ashby David Thornbury');
    });

    it('integrates the nickname even with no middle names', () => {
        expect(displayFullName({ FirstName: 'Edmund', Nickname: 'Ned', LastName: 'Thornbury' }))
            .toBe('Edmund “Ned” Thornbury');
    });

    it('ignores the effective first name when a nickname is set (uses raw FirstName)', () => {
        // When the primary variant is the nickname, EffectiveFirstName is the nickname alone.
        expect(displayFullName({ FirstName: 'Edmund Ashby David', EffectiveFirstName: 'Ned', Nickname: 'Ned', LastName: 'Thornbury' }))
            .toBe('Edmund “Ned” Ashby David Thornbury');
    });
});

describe('displayGivenNames', () => {
    it('returns the effective first name when there is no nickname', () => {
        expect(displayGivenNames({ FirstName: 'Edmund', EffectiveFirstName: 'Ned' })).toBe('Ned');
        expect(displayGivenNames({ FirstName: 'Edmund' })).toBe('Edmund');
    });

    it('integrates the nickname after the first given name (surname-first list use)', () => {
        expect(displayGivenNames({ FirstName: 'Edmund Ashby David', Nickname: 'Ned' }))
            .toBe('Edmund “Ned” Ashby David');
    });

    it('handles a nickname with an empty first name', () => {
        expect(displayGivenNames({ FirstName: '', Nickname: 'Ned' })).toBe('“Ned”');
    });
});
