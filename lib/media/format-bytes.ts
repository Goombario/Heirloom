/** Formats stored media bytes with a compact, localized binary unit. */
export function formatMediaBytes(bytes: number, locale?: string): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = safeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex > 0 && value < 10 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);

  return `${formatted}\u00a0${units[unitIndex]}`;
}
