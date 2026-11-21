/** What the order reads: PGlite hands back "CreatedAt" as a Date, HTTP as a string. */
interface Added { Id: number; CreatedAt?: string | Date | null }

/** A row's upload time in ms, or null when it predates the column (#25). */
function addedAt(media: Added): number | null {
  const raw = media.CreatedAt;
  if (raw == null) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "Recently added" order (#25): newest upload first, rows with no recorded time
 * (added before v75) after every timed row, and the higher Id first on a tie, so
 * the order never depends on the input order.
 */
export function compareRecentlyAdded(left: Added, right: Added): number {
  const a = addedAt(left);
  const b = addedAt(right);
  if (a !== b) {
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  }
  return right.Id - left.Id;
}
