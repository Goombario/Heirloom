/**
 * Time-zone labels for the Options picker (#704). Names and offsets come from
 * `Intl`, so they are translated and follow daylight saving: Toronto reads
 * UTC−4 in September and UTC−5 in January, not a hard-coded standard offset.
 */

function zonePart(zone: string, locale: string, timeZoneName: Intl.DateTimeFormatOptions['timeZoneName'], at: Date): string | undefined {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
  } catch {
    return undefined;
  }
}

/** Localized generic zone name ("Eastern Time", "heure d’Europe centrale"). */
export function timeZoneName(zone: string, locale: string, at: Date = new Date()): string {
  return zonePart(zone, locale, 'longGeneric', at) ?? zonePart(zone, locale, 'long', at) ?? zone;
}

/** Current UTC offset as "UTC−4", "UTC+5:30" or "UTC+0" (true minus sign). */
export function timeZoneOffset(zone: string, at: Date = new Date()): string {
  const raw = zonePart(zone, 'en-US', 'longOffset', at); // "GMT-04:00", "GMT+05:30", "GMT"
  const m = raw?.match(/([+-])(\d{2}):(\d{2})/);
  if (!m) return 'UTC+0';
  const hours = String(Number(m[2]));
  const minutes = m[3] === '00' ? '' : `:${m[3]}`;
  return `UTC${m[1] === '-' ? '−' : '+'}${hours}${minutes}`;
}
