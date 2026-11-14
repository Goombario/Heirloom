import { describe, expect, it } from 'vitest';
import { CHANGELOG, entriesSince, entriesUpTo, itemText, whatsNewStep, type ChangelogEntry } from '@/lib/whats-new';
import { compareReleases, isAppVersion } from '@/lib/whats-new/version';

const entry = (version: string, n = 1): ChangelogEntry => ({
  version,
  items: Array.from({ length: n }, (_, i) => ({ en: `${version} item ${i + 1}` })),
});
const LOG = [entry('1.3.0'), entry('1.2.0'), entry('1.1.1', 0), entry('1.1.0'), entry('1.0.0')];

describe('app versions (#35)', () => {
  it('accepts package.json versions and nothing else', () => {
    for (const v of ['1.1.0', '0.23.2', '1.1.0-rc.3', '10.0.12']) expect(isAppVersion(v)).toBe(true);
    for (const v of ['', '1.1', 'v1.1.0', '1.1.0 ', '1.1.0-', '<b>1.1.0</b>', 11, null, 'x'.repeat(80)]) {
      expect(isAppVersion(v)).toBe(false);
    }
  });

  it('compares by x.y.z numerically, a pre-release counting as its release', () => {
    expect(compareReleases('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareReleases('1.1.0-rc.1', '1.1.0')).toBe(0);
    expect(compareReleases('1.0.9', '1.1.0-rc.1')).toBeLessThan(0);
  });
});

describe('entriesSince', () => {
  it('shows every release skipped, newest first, and none past the running one', () => {
    expect(entriesSince('1.1.0', '1.3.0', LOG).map((e) => e.version)).toEqual(['1.3.0', '1.2.0']);
    expect(entriesSince('1.0.0', '1.2.0', LOG).map((e) => e.version)).toEqual(['1.2.0', '1.1.0']);
  });

  it('leaves out an entry with no items', () => {
    expect(entriesSince('1.1.0', '1.1.1', LOG)).toEqual([]);
  });

  it("shows a release's entry on its first rc and not again on the next rc or the release", () => {
    expect(entriesSince('1.0.0', '1.1.0-rc.1', LOG).map((e) => e.version)).toEqual(['1.1.0']);
    expect(entriesSince('1.1.0-rc.1', '1.1.0-rc.2', LOG)).toEqual([]);
    expect(entriesSince('1.1.0-rc.2', '1.1.0', LOG)).toEqual([]);
  });

  it('shows nothing on a downgrade', () => {
    expect(entriesSince('1.3.0', '1.2.0', LOG)).toEqual([]);
  });
});

describe('whatsNewStep', () => {
  it('records silently on a first run', () => {
    expect(whatsNewStep(null, '1.1.0')).toEqual({ kind: 'record' });
  });

  it('does nothing when the version was already seen or the build has none', () => {
    expect(whatsNewStep('1.1.0', '1.1.0')).toEqual({ kind: 'none' });
    expect(whatsNewStep('1.0.0', '')).toEqual({ kind: 'none' });
  });

  it('shows after an update', () => {
    const step = whatsNewStep('0.0.1', '1.1.0');
    expect(step.kind).toBe('show');
  });
});

describe('entriesUpTo and itemText', () => {
  it('reopens every release up to the running one', () => {
    expect(entriesUpTo('1.2.0', LOG).map((e) => e.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
  });

  it("falls back to English when the reader's language has no text", () => {
    expect(itemText({ en: 'Hello', fr: 'Bonjour' }, 'fr')).toBe('Bonjour');
    expect(itemText({ en: 'Hello', fr: ' ' }, 'fr')).toBe('Hello');
    expect(itemText({ en: 'Hello' }, 'ru')).toBe('Hello');
  });
});

describe('changelog.json', () => {
  it('has one entry per release, newest first, each item with English text', () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const e of CHANGELOG) {
      expect(isAppVersion(e.version) && !e.version.includes('-')).toBe(true);
      for (const item of e.items) expect(item.en.trim()).not.toBe('');
    }
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compareReleases(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0);
    }
  });
});
