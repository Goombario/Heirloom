import { describe, it, expect } from 'vitest';
import { timeZoneName, timeZoneOffset } from '@/lib/utils/timezones';

describe('timeZoneOffset', () => {
    it('follows daylight saving instead of a fixed standard offset (#704)', () => {
        expect(timeZoneOffset('America/Toronto', new Date('2026-09-21T12:00:00Z'))).toBe('UTC−4');
        expect(timeZoneOffset('America/Toronto', new Date('2026-01-21T12:00:00Z'))).toBe('UTC−5');
    });
    it('keeps half-hour offsets and zero', () => {
        expect(timeZoneOffset('Asia/Kolkata')).toBe('UTC+5:30');
        expect(timeZoneOffset('UTC')).toBe('UTC+0');
    });
    it('falls back to UTC+0 for an unknown zone', () => {
        expect(timeZoneOffset('Not/AZone')).toBe('UTC+0');
    });
});

describe('timeZoneName', () => {
    it('is localized', () => {
        const at = new Date('2026-09-21T12:00:00Z');
        expect(timeZoneName('Europe/Paris', 'en', at)).toBe('Central European Time');
        expect(timeZoneName('Europe/Paris', 'fr', at)).not.toBe('Central European Time');
    });
    it('returns the zone id when Intl cannot name it', () => {
        expect(timeZoneName('Not/AZone', 'en')).toBe('Not/AZone');
    });
});
