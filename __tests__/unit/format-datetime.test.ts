import { describe, it, expect } from 'vitest';
import { formatActivityTime, formatTimestamp, parseTimestamp } from '@/lib/utils/format-datetime';

const t = (key: string, values?: { count: number }) => (values ? `${key}:${values.count}` : key);

describe('parseTimestamp', () => {
    it('reads a zone-less SQL timestamp as UTC', () => {
        expect(parseTimestamp('2026-09-21 14:51:23').toISOString()).toBe('2026-09-21T14:51:23.000Z');
    });
    it('keeps an explicit offset', () => {
        expect(parseTimestamp('2026-09-21T10:51:23-04:00').toISOString()).toBe('2026-09-21T14:51:23.000Z');
    });
});

describe('formatTimestamp', () => {
    it('uses the app time zone, not the browser zone', () => {
        expect(formatTimestamp('2026-09-21 14:51:23', 'America/Toronto', 'en', 'time')).toBe('10:51:23 AM');
    });
    it('uses the app language', () => {
        expect(formatTimestamp('2026-09-21 14:51:23', 'UTC', 'ru', 'date')).toMatch(/сент/);
    });
    it('falls back to the raw value on an invalid zone', () => {
        expect(formatTimestamp('2026-09-21 14:51:23', 'Not/AZone', 'en')).toBe('2026-09-21 14:51:23');
    });
});

describe('formatActivityTime', () => {
    const now = Date.parse('2026-09-21T15:00:00Z');
    it('is relative under 24 hours', () => {
        expect(formatActivityTime('2026-09-21T14:59:40Z', 'UTC', 'en', t, now)).toBe('time_just_now');
        expect(formatActivityTime('2026-09-21T14:55:00Z', 'UTC', 'en', t, now)).toBe('time_minutes_ago:5');
        expect(formatActivityTime('2026-09-21T12:00:00Z', 'UTC', 'en', t, now)).toBe('time_hours_ago:3');
    });
    it('is the absolute date after 24 hours', () => {
        expect(formatActivityTime('2026-09-18T12:00:00Z', 'UTC', 'en', t, now)).toBe('Sep 18, 2026');
    });
    it('reads a future value as just now', () => {
        expect(formatActivityTime('2026-09-21T15:05:00Z', 'UTC', 'en', t, now)).toBe('time_just_now');
    });
});
