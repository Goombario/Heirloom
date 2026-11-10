import { describe, it, expect } from 'vitest';
import { avatarClass } from '@/lib/utils/avatar';

describe('avatarClass', () => {
    it('maps M/F/X to their gradient classes', () => {
        expect(avatarClass('M')).toBe('avatar-male');
        expect(avatarClass('F')).toBe('avatar-female');
        expect(avatarClass('X')).toBe('avatar-nonbinary');
    });

    it('falls back to neutral for null, undefined, or unknown codes', () => {
        expect(avatarClass(null)).toBe('avatar-neutral');
        expect(avatarClass(undefined)).toBe('avatar-neutral');
        expect(avatarClass('')).toBe('avatar-neutral');
        expect(avatarClass('Z')).toBe('avatar-neutral');
    });
});
