/** An app version as package.json writes it: x.y.z with an optional -prerelease. */
const APP_VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]{1,32})?$/;

export function isAppVersion(value: unknown): value is string {
  return typeof value === 'string' && APP_VERSION.test(value);
}

/**
 * Compare two versions by their x.y.z only. A pre-release counts as the release
 * it leads to, so 1.1.0-rc.1 shows the 1.1.0 entry and rc.2 or 1.1.0 don't show
 * it again. Returns a negative number, 0 or a positive number. An unparseable
 * version sorts first.
 */
export function compareReleases(a: string, b: string): number {
  const pa = APP_VERSION.exec(a);
  const pb = APP_VERSION.exec(b);
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}
