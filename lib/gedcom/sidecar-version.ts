import type { GedcomImportWarning } from '@/lib/data/types';

// Every sidecar in the export bundle (cases.json / media.json / sources.json)
// carries a `version`. Per ADR 0009 sidecars are ADDITIVE-ONLY: new fields are
// added as optional and readers stay tolerant field-by-field parsers, so
// `version` is never a parse switch — nothing branches on it to decide HOW to
// read a bundle, and adding a field does not bump it.
//
// Its one job is this guard. A bundle written by a NEWER build is the single
// case where the tolerant parsers can silently drop data they were never taught
// about, and before this the field was written by all three sidecars and read by
// none of them — so that case was invisible.
//
// It WARNS and does not reject: a newer bundle still imports best-effort, which
// is the existing behaviour and better than refusing the import outright.

export const SIDECAR_VERSION = 2;

/**
 * Returns a warning when `parsed` declares a version newer than this build
 * reads, otherwise null. Tolerant by design — a missing, non-numeric or older
 * version is not a problem worth telling the user about.
 */
export function sidecarVersionWarning(sidecarName: string, parsed: unknown): Extract<GedcomImportWarning, { code: 'sidecar_version_newer' }> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const declared = (parsed as Record<string, unknown>).version;
  if (typeof declared !== 'number' || !Number.isFinite(declared)) return null;
  if (declared <= SIDECAR_VERSION) return null;
  return {
    code: 'sidecar_version_newer',
    values: { sidecarName, declared, supported: SIDECAR_VERSION },
  };
}
