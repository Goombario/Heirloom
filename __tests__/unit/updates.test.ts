import { describe, it, expect, vi } from 'vitest';
import {
    checkIsDue, fetchLatestRelease, isNewer, knownLatest, markPrompted, notesFor, parseRelease, recordCheck,
    repoFromSourceUrl, setUpdateChecksEnabled, shouldPrompt, updateChecksEnabled,
} from '@/lib/updates';

// #24: finding a newer desktop release, and what the device remembers about it.
function memoryStore() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('desktop updates (#24)', () => {
    it('compares x.y.z releases, a pre-release being older than its release', () => {
        expect(isNewer('1.4.0', '1.3.2')).toBe(true);
        expect(isNewer('1.3.10', '1.3.9')).toBe(true);
        expect(isNewer('1.3.2', '1.3.2')).toBe(false);
        expect(isNewer('1.3.0', '1.4.0')).toBe(false);
        expect(isNewer('1.4.0', '1.4.0-rc.2')).toBe(true);
        expect(isNewer('garbage', '1.0.0')).toBe(false);
    });

    it('reads a published release and ignores drafts, pre-releases and odd links', () => {
        const ok = { tag_name: 'v1.4.0', html_url: 'https://github.com/o/r/releases/tag/v1.4.0', body: 'x' };
        expect(parseRelease(ok)).toEqual({ version: '1.4.0', url: ok.html_url, notes: [] });
        expect(parseRelease({ ...ok, prerelease: true })).toBeNull();
        expect(parseRelease({ ...ok, draft: true })).toBeNull();
        expect(parseRelease({ ...ok, html_url: 'https://evil.example/x' })).toBeNull();
        expect(parseRelease({ ...ok, tag_name: 'nightly' })).toBeNull();
        expect(parseRelease(null)).toBeNull();
    });

    it('takes three What\'s new items for the release from its changelog', () => {
        const log = [
            { version: '1.4.0', items: [{ en: 'A', fr: 'Af' }, { en: 'B' }, { en: ' ' }, { en: 'C' }, { en: 'D' }] },
            { version: '1.3.0', items: [{ en: 'old' }] },
        ];
        expect(notesFor(log, '1.4.0')).toEqual([{ en: 'A', fr: 'Af' }, { en: 'B' }, { en: 'C' }]);
        expect(notesFor(log, '9.9.9')).toEqual([]);
        expect(notesFor({}, '1.4.0')).toEqual([]);
    });

    it('asks GitHub without credentials and fetches the tag\'s changelog', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.includes('/releases/latest')) return new Response(JSON.stringify({ tag_name: 'v1.4.0', html_url: 'https://github.com/o/r/releases/tag/v1.4.0' }));
            return new Response(JSON.stringify([{ version: '1.4.0', items: [{ en: 'Zoom' }] }]));
        });
        const r = await fetchLatestRelease('o/r', fetchImpl as unknown as typeof fetch);
        expect(r?.notes).toEqual([{ en: 'Zoom' }]);
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/releases/latest');
        expect(fetchImpl.mock.calls[1][0]).toBe('https://raw.githubusercontent.com/o/r/v1.4.0/lib/whats-new/changelog.json');
        for (const call of fetchImpl.mock.calls) expect((call as unknown as [string, RequestInit])[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    });

    it('treats no release as nothing new and a failed request as an error', async () => {
        await expect(fetchLatestRelease('o/r', (async () => new Response('', { status: 404 })) as unknown as typeof fetch)).resolves.toBeNull();
        await expect(fetchLatestRelease('o/r', (async () => new Response('', { status: 500 })) as unknown as typeof fetch)).rejects.toThrow();
    });

    it('finds the repository from the source link', () => {
        expect(repoFromSourceUrl('https://github.com/Goombario/Heirloom')).toBe('Goombario/Heirloom');
        expect(repoFromSourceUrl('https://github.com/a/b.git')).toBe('a/b');
        expect(repoFromSourceUrl('https://gitlab.com/a/b')).toBeNull();
    });

    it('checks daily while on, and prompts once per version', () => {
        const s = memoryStore();
        const now = Date.UTC(2026, 10, 25);
        expect(updateChecksEnabled(s)).toBe(true);
        setUpdateChecksEnabled(s, false);
        expect(updateChecksEnabled(s)).toBe(false);
        setUpdateChecksEnabled(s, true);
        expect(checkIsDue(s, now)).toBe(true);
        const latest = { version: '1.4.0', url: 'https://github.com/o/r/releases/tag/v1.4.0', notes: [] };
        recordCheck(s, now, latest);
        expect(checkIsDue(s, now + 60_000)).toBe(false);
        expect(checkIsDue(s, now + 24 * 3600_000)).toBe(true);
        expect(knownLatest(s)).toEqual(latest);
        expect(shouldPrompt(s, '1.4.0')).toBe(true);
        markPrompted(s, '1.4.0');
        expect(shouldPrompt(s, '1.4.0')).toBe(false);
        expect(shouldPrompt(s, '1.5.0')).toBe(true);
        expect(checkIsDue(null, now)).toBe(true);
    });
});
