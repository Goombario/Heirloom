# 0051 — What's new shows each release once per user

**Date:** 2026-11-14 · **Context:** #35 · **Status:** Proposed · **Area:** releases / accounts

Releases reached people silently. The only record of what changed was the release PR, which users
never see.

## Decision

1. **One changelog, in the repo.** `lib/whats-new/changelog.json` holds one entry per release, newest
   first, each a list of short user-facing sentences (not PR titles). The release PR writes it. Each
   item needs English; French and Russian are optional and fall back to English, so a release isn't
   held up by translation. An entry with no items shows nothing.
2. **The last version seen lives on the user's row:** `"Users"."LastSeenVersion"` (schema v74). On
   the hosted server it follows the account across devices. A browser or desktop install keeps it on
   its one local user, with the rest of its data, so a restored backup brings it along.
3. **On load, a first run records and an update shows.** With no version recorded (a new user, a new
   install, or anyone before v74), the running version is recorded and nothing is shown. With an older
   one, the entries after it up to the running version are shown, every skipped release included, and
   the running version is recorded as the list opens, so a reload doesn't show it again.
4. **Releases are compared by x.y.z.** A pre-release counts as the release it leads to: `1.1.0-rc.1`
   shows the `1.1.0` entry, and `rc.2` or `1.1.0` doesn't show it again.
5. **About Heirloom reopens it**, listing every release up to the running one.
6. **Recording isn't a data write for the cache.** The data cache ignores the `account` client's
   writes, so the start-up check doesn't throw the warm cache away.

## Consequences

- Everyone's first load on the release that adds this records it silently; the list first appears
  on the release after.
- A downgrade records the older version, so updating again shows that release's entry again.
- The release workflow has a "write the What's new entry" step.
