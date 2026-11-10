/** The default hosted per-tree media quota. */
export const DEFAULT_TREE_QUOTA_BYTES = 100 * 1024 * 1024;

/**
 * Resolve the quota at call time so deployment configuration and tests are not
 * captured when the module is imported. Desktop mode has no invented quota:
 * the browser/device storage layer is authoritative there.
 */
export function getTreeMediaQuotaBytes(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  if (env.DESKTOP_MODE === 'true') return null;

  const raw = env.MEDIA_TREE_QUOTA_BYTES;
  if (!raw) return DEFAULT_TREE_QUOTA_BYTES;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TREE_QUOTA_BYTES;
}

/** Stable server-side wording for quota-limit upload errors. */
export function formatBytes(bytes: number): string {
  const round = (value: number) => (Number.isInteger(value) ? value : Number(value.toFixed(1)));
  if (bytes >= 1024 * 1024 * 1024) return `${round(bytes / (1024 * 1024 * 1024))}GB`;
  if (bytes >= 1024 * 1024) return `${round(bytes / (1024 * 1024))}MB`;
  if (bytes >= 1024) return `${round(bytes / 1024)}KB`;
  return `${bytes} bytes`;
}
