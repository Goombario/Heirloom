import type { ChangelogEntry, ChangelogItem } from '@/lib/whats-new';
import { compareReleases, isAppVersion } from '@/lib/whats-new/version';

/**
 * Desktop updates (#24): finding a newer release on GitHub, and what this
 * device remembers about it. Pure apart from `fetchLatestRelease` and the
 * storage helpers, which take their storage and fetch as arguments.
 *
 * The app reads the repository's latest release (a pre-release is never
 * "latest"), at most once a day and only while Check for updates is on. Nothing
 * about the user or their trees is sent.
 */

export interface LatestRelease {
    /** "1.4.0", without the tag's `v`. */
    version: string;
    /** The release page. */
    url: string;
    /** That release's What's new items, from its own changelog (empty when it couldn't be read). */
    notes: ChangelogItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `latest` is a newer release than `current` (x.y.z; a pre-release of the same version is older). */
export function isNewer(latest: string, current: string): boolean {
    if (!isAppVersion(latest) || !isAppVersion(current)) return false;
    const c = compareReleases(latest, current);
    return c > 0 || (c === 0 && current.includes('-') && !latest.includes('-'));
}

/** A release from the GitHub API's `releases/latest` answer, or null when it isn't one. */
export function parseRelease(json: unknown): LatestRelease | null {
    if (!json || typeof json !== 'object') return null;
    const r = json as { tag_name?: unknown; html_url?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown };
    if (r.draft === true || r.prerelease === true) return null;
    if (typeof r.tag_name !== 'string' || !isAppVersion(r.tag_name.replace(/^v/, ''))) return null;
    if (typeof r.html_url !== 'string' || !/^https:\/\/github\.com\//.test(r.html_url)) return null;
    return {
        version: r.tag_name.replace(/^v/, ''),
        url: r.html_url,
        notes: [],
    };
}

/** "owner/repo" from the source link (`https://github.com/Goombario/Heirloom`), or null. */
export function repoFromSourceUrl(url: string): string | null {
    const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
    return m ? `${m[1]}/${m[2]}` : null;
}

/** Reads the latest release. Throws on a network or HTTP failure. */
export async function fetchLatestRelease(repo: string, fetchImpl: typeof fetch = fetch): Promise<LatestRelease | null> {
    // No cookies or referrer: the request says nothing about who is asking.
    const quiet: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer' };
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { ...quiet, headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = parseRelease(await res.json());
    if (!release) return null;
    // What's new for that release, in every language: the changelog at its tag.
    try {
        const log = await fetchImpl(`https://raw.githubusercontent.com/${repo}/v${release.version}/lib/whats-new/changelog.json`, quiet);
        if (log.ok) release.notes = notesFor(await log.json(), release.version);
    } catch { /* the dialog shows the release without its lines */ }
    return release;
}

/** A release's changelog items from a `changelog.json`, at most three. */
export function notesFor(changelog: unknown, version: string, max = 3): ChangelogItem[] {
    if (!Array.isArray(changelog)) return [];
    const entry = changelog.find((e) => e && typeof e === 'object' && (e as ChangelogEntry).version === version) as ChangelogEntry | undefined;
    if (!entry || !Array.isArray(entry.items)) return [];
    return entry.items
        .filter((i) => i && typeof i.en === 'string' && i.en.trim())
        .slice(0, max)
        .map((i) => ({ en: i.en, ...(typeof i.fr === 'string' ? { fr: i.fr } : {}), ...(typeof i.ru === 'string' ? { ru: i.ru } : {}) }));
}

// ---- What this device remembers ----

const KEYS = {
    enabled: 'heirloom.updates.check',
    lastCheck: 'heirloom.updates.lastCheck',
    latest: 'heirloom.updates.latest',
    prompted: 'heirloom.updates.prompted',
} as const;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function read(store: Store | null, key: string): string | null {
    try { return store?.getItem(key) ?? null; } catch { return null; }
}
function write(store: Store | null, key: string, value: string | null): void {
    try {
        if (value === null) store?.removeItem(key); else store?.setItem(key, value);
    } catch { /* storage refused: the app just checks again next time */ }
}

/** Check for updates: on unless turned off in Options. */
export function updateChecksEnabled(store: Store | null): boolean {
    return read(store, KEYS.enabled) !== 'off';
}
export function setUpdateChecksEnabled(store: Store | null, on: boolean): void {
    write(store, KEYS.enabled, on ? null : 'off');
}

/** True when the last check was a day ago or more (or never). */
export function checkIsDue(store: Store | null, now: number): boolean {
    const last = Number(read(store, KEYS.lastCheck));
    return !Number.isFinite(last) || last <= 0 || now - last >= DAY_MS || last > now;
}

/** Records a check, and the newest release it found (so the chip shows between checks). */
export function recordCheck(store: Store | null, now: number, latest: LatestRelease | null): void {
    write(store, KEYS.lastCheck, String(now));
    write(store, KEYS.latest, latest ? JSON.stringify(latest) : null);
}

/** The newest release the last check found. */
export function knownLatest(store: Store | null): LatestRelease | null {
    try {
        const raw = read(store, KEYS.latest);
        if (!raw) return null;
        const v = JSON.parse(raw) as LatestRelease;
        return typeof v?.version === 'string' && typeof v?.url === 'string' && Array.isArray(v?.notes) ? v : null;
    } catch {
        return null;
    }
}

/** The dialog opens by itself once per version; after that the chip and Options offer it. */
export function shouldPrompt(store: Store | null, version: string): boolean {
    return read(store, KEYS.prompted) !== version;
}
export function markPrompted(store: Store | null, version: string): void {
    write(store, KEYS.prompted, version);
}
