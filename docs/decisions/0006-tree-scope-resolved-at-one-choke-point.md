# 0006 — Tree scope is resolved at exactly one choke point

**Date:** 2026-07-16 (PR #275, multi-tree; recorded 2026-08-01)
**Status:** Accepted
**Area:** architecture

## Context

Adding multiple trees per account meant every read and write needed scoping to a tree, while
a large body of existing deep links carried `?ownerId=` and had to keep working. Resolving
"which tree am I acting on, and may I?" independently in each route would have produced dozens
of subtly different answers — the classic shape of an authorization bug.

## Decision

**One function resolves scope: `resolveTreeScope()` in `lib/db/queries/trees.ts`.**

Every API route parses both `?treeId=` (primary) and `?ownerId=` (legacy compat) with
`parseIdParam`, passes both into its service, and the service calls:

```ts
const scope = await resolveTreeScope(
  { treeId: requestedTreeId, ownerId: requestedOwnerId },
  currentUserId
);
```

It returns `{ treeId, ownerId, permission }` or throws `AccessError` (→ 403 via
`handleApiError`). `scope.ownerId` is the **tree's owning user**, not the caller.

Business logic then filters by `scope.treeId`; INSERTs write both the legacy owner column and
`"TreeId"`. Write checks use `scope.permission` — `view` blocks writes, `contribute` blocks
deletes.

## Rejected alternatives

- **Resolve scope in each route handler.** Every new route becomes a chance to forget the
  permission check, and the legacy `?ownerId=` bridge would be reimplemented inconsistently.
- **Drop `?ownerId=` and migrate all links.** Breaks existing bookmarks and shared-tree URLs
  with no way to detect the breakage server-side.
- **Middleware/proxy-level resolution.** The proxy does not know which entity a route touches,
  and `DESKTOP_MODE` bypasses it entirely — scope would silently vanish in the desktop build.

## Consequences

- A new route is correct by construction if it follows the standard 5-step pattern in
  `CLAUDE.md`. If it does not call `resolveTreeScope`, it is wrong.
- An account always keeps **≥ 1 tree** (default = lowest `Id`, lazily created by
  `resolveDefaultTree`), so scope resolution can never legitimately return nothing.
- ⚠️ `MediaLink.OwnerId` and `NoteLink.OwnerId` are **entity ids, not user ids**. They look
  like the legacy owner column and are not. Never "fix" them to carry `scope.ownerId`.
- Tree deletion is guarded (`X-Confirm-Delete-Tree` header + type-the-name UI) because a
  deleted tree is **not** restorable from the audit log.
