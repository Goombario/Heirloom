import changelog from './changelog.json';
import { compareReleases, isAppVersion } from './version';

/**
 * What's new (#35, ADR 0051). `changelog.json` is written in each release PR:
 * one entry per release, newest first, each item a short user-facing sentence.
 * English is required; `fr` and `ru` are optional and fall back to English.
 */
export interface ChangelogItem {
  en: string;
  fr?: string;
  ru?: string;
}

export interface ChangelogEntry {
  version: string;
  items: ChangelogItem[];
}

export const CHANGELOG: readonly ChangelogEntry[] = changelog;

/** An item in the reader's language, or in English when it has no translation. */
export function itemText(item: ChangelogItem, locale: string): string {
  const text = (item as unknown as Record<string, string | undefined>)[locale];
  return text?.trim() ? text : item.en;
}

/**
 * The entries a user who last saw `seen` gets on `current`: every release after
 * `seen`, up to and including `current`, newest first. Releases are compared by
 * x.y.z (see `compareReleases`). Entries with no items are left out, so a
 * release can ship an empty entry and show nothing.
 */
export function entriesSince(
  seen: string,
  current: string,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  if (!isAppVersion(seen) || !isAppVersion(current)) return [];
  return entries
    .filter((e) => e.items.length > 0
      && compareReleases(e.version, seen) > 0
      && compareReleases(e.version, current) <= 0)
    .sort((a, b) => compareReleases(b.version, a.version));
}

/** The entries the About page reopens: every release up to the running one. */
export function entriesUpTo(current: string, entries: readonly ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return entries
    .filter((e) => e.items.length > 0 && (!isAppVersion(current) || compareReleases(e.version, current) <= 0))
    .sort((a, b) => compareReleases(b.version, a.version));
}

export type WhatsNewStep =
  /** First run for this user or install: record the version, show nothing. */
  | { kind: 'record' }
  /** An update: show these entries (maybe none), then record the version. */
  | { kind: 'show'; entries: ChangelogEntry[] }
  /** Nothing to do. */
  | { kind: 'none' };

/** What to do on load, given the version last seen and the one running. */
export function whatsNewStep(seen: string | null, current: string): WhatsNewStep {
  if (!isAppVersion(current)) return { kind: 'none' };
  if (seen === current) return { kind: 'none' };
  if (seen === null || !isAppVersion(seen)) return { kind: 'record' };
  return { kind: 'show', entries: entriesSince(seen, current) };
}
