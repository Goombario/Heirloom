import { describe, it, expect } from 'vitest';
import { getInitials, initialsFromName } from '@/lib/utils/initials';

describe('getInitials (structured first/last)', () => {
    it('takes first + last initial', () => {
        expect(getInitials('Dorothy', 'Bramley')).toBe('DB');
    });
    it('first only → one initial', () => {
        expect(getInitials('Dorothy', null)).toBe('D');
    });
    it('both nullish → ?', () => {
        expect(getInitials(null, null)).toBe('?');
        expect(getInitials(undefined, undefined)).toBe('?');
    });
});

describe('initialsFromName (single combined name)', () => {
    it('takes first + last word initial', () => {
        expect(initialsFromName('Victoria Hanover')).toBe('VH');
    });
    it('single word → one initial', () => {
        expect(initialsFromName('Albert')).toBe('A');
    });
    it('empty / nullish → ?', () => {
        expect(initialsFromName('')).toBe('?');
        expect(initialsFromName(null)).toBe('?');
    });
    it('strips quotes and extra whitespace', () => {
        expect(initialsFromName('  "Eddie"  Windsor ')).toBe('EW');
    });
});
