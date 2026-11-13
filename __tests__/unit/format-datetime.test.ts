import { describe, it, expect } from 'vitest';
import { formatActivityTime, formatDayTime, formatTimestamp, parseTimestamp } from '@/lib/utils/format-datetime';

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

describe('formatDayTime', () => {
    const now = Date.parse('2026-09-21T15:00:00Z');
    const td = (key: string, values: { time: string }) => `${key}:${values.time}`;
    it('names today and yesterday in the time zone', () => {
        expect(formatDayTime('2026-09-21T14:02:00Z', 'UTC', 'en-GB', td, now)).toBe('time_today_at:14:02');
        expect(formatDayTime('2026-09-20T21:48:00Z', 'UTC', 'en-GB', td, now)).toBe('time_yesterday_at:21:48');
        // 02:00 UTC on the 21st is still the 20th in Toronto.
        expect(formatDayTime('2026-09-21T02:00:00Z', 'America/Toronto', 'en-GB', td, now)).toBe('time_yesterday_at:22:00');
    });
    it('is the short date before that, with the year only when it differs', () => {
        expect(formatDayTime('2026-09-03T09:12:00Z', 'UTC', 'en-GB', td, now)).toBe('3 Sept 09:12');
        expect(formatDayTime('2025-09-03T09:12:00Z', 'UTC', 'en-GB', td, now)).toBe('3 Sept 2025 09:12');
    });
});
