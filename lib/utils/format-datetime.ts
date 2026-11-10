/**
 * Timestamp formatting (#699, audit decision 6). Timestamps are record
 * metadata (audit rows, case header and journal, activity feeds, backups),
 * not genealogical dates: they always render in the app's language and
 * time zone, never the browser's, and are never evidence-coloured.
 * Genealogical dates go through `formatDateForDisplay` (`lib/date-utils.ts`).
 */

export type TimestampStyle = 'datetime' | 'date' | 'time';

const STYLE_OPTIONS: Record<TimestampStyle, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'medium' },
};

/**
 * Parse a stored timestamp. SQLite/PGlite `CURRENT_TIMESTAMP` values have no
 * zone designator ("2026-09-21 14:51:23") but are UTC, so a zone-less
 * date-time is read as UTC rather than local time.
 */
export function parseTimestamp(value: Date | string): Date {
  if (typeof value !== 'string') return value;
  const hasTime = /\d[T ]\d/.test(value);
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/i.test(value);
  return new Date(hasTime && !hasZone ? `${value.replace(' ', 'T')}Z` : value);
}

/**
 * Format a timestamp in the given IANA time zone and locale. On an invalid
 * value or zone, falls back to the raw string (or the Date's ISO string).
 */
export function formatTimestamp(
  value: Date | string,
  timezone: string,
  locale: string,
  style: TimestampStyle = 'datetime',
): string {
  const d = parseTimestamp(value);
  try {
    return new Intl.DateTimeFormat(locale, { ...STYLE_OPTIONS[style], timeZone: timezone }).format(d);
  } catch {
    return typeof value === 'string' ? value : d.toISOString();
  }
}

type RelativeTranslator = (key: 'time_just_now' | 'time_minutes_ago' | 'time_hours_ago', values?: { count: number }) => string;

/**
 * Activity-feed time: relative under 24 hours ("just now", "5m ago", "3h ago"),
 * the absolute date after that. Future values (clock skew) read as "just now".
 */
export function formatActivityTime(
  value: Date | string,
  timezone: string,
  locale: string,
  t: RelativeTranslator,
  now: number = Date.now(),
): string {
  const diff = Math.max(0, now - parseTimestamp(value).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('time_just_now');
  if (mins < 60) return t('time_minutes_ago', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('time_hours_ago', { count: hrs });
  return formatTimestamp(value, timezone, locale, 'date');
}
