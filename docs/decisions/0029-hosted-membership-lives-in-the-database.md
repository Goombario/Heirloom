# 0029 — Hosted membership lives in the database, separate from tree sharing

**Date:** 2026-10-22 (#656)
**Status:** Accepted
**Area:** auth / architecture

Written before the build, at the maintainer's request, because it changes the schema and the
auth boundary. It records only what was decided on #656 (design session and locked mockup,
2026-10-18). If the build finds a wrong premise, a new record corrects it.

## Context

Who may sign in to a hosted instance is decided by `AUTH_ALLOWED_EMAILS`, a comma-separated
deployment variable (`lib/auth/allowed-emails.ts`). Adding or removing a person means a redeploy,
and only someone with access to the hosting dashboard can do it. Hosted production fails closed
when the variable is missing or empty (`lib/config-guard.ts`); development stays open.

The check runs in two places. The edge-safe `signIn` and `authorized` callbacks in
`auth.config.ts` refuse an address that isn't listed, and `getUserFromRequest` re-checks it on
every API call so removing an address also stops a 30-day JWT session. Both can read an
environment variable without a database, which is why `auth.config.ts` can be shared with the
edge proxy (`proxy.ts`).

A database-backed list can't be read on the edge, so moving membership into the database moves
the enforcing check too.

## Decision

- **One instance-level table of members, separate from `TreeSharing`.** A row holds the
  normalized (trimmed, lower-cased) email, the linked `Users` row once the person has signed in,
  the role, the status, who invited them, and timestamps. Membership grants access to the
  instance only. It never grants access to a tree; tree ownership and per-tree sharing are
  unchanged.
- **Roles are `admin` and `member`, nothing else.** An admin manages membership. Being an admin
  gives no access to anyone's trees.
- **Status is `invited`, `active` or `revoked`.** An invitation becomes active the first time
  that address signs in with Google and Google reports the email as verified. From then on the
  row is bound to that `Users` row, and the person is matched by their Google account, not their
  email. Revoking keeps the row (so Restore access works) and deletes nothing else: trees,
  shares and the person's `Users` row stay. Cancelling an invitation that was never used
  deletes it.
- **The membership check runs on the Node path, on every API request.** `getUserFromRequest`
  looks up the member row and returns no user unless it is active, so a revoke takes effect on
  the next request, whatever the session's age. There is no cache. The Node NextAuth instance
  (`lib/auth/auth.ts`) refuses sign-in for an address with no invited or active row. The edge
  proxy keeps checking only that a session exists; it never reads the database.
- **Bootstrap and recovery both come from `AUTH_BOOTSTRAP_EMAIL`.** At startup, when no active
  or invited admin exists, that address is made an admin: an existing row is promoted and
  restored, otherwise an invited admin row is created. When an admin exists, the variable does
  nothing.
- **The last admin can't be demoted or revoked.** The page dims those choices and says why, and
  the service refuses them too, inside the same transaction that counts admins.
- **`AUTH_ALLOWED_EMAILS` seeds members once, then retires.** On the first startup with the
  table, every listed address that has no row becomes a `member`: `active` when a `Users` row
  with that email exists, otherwise `invited`. After that the variable is ignored, and startup
  logs a warning while it is still set.
- **Hosted production fails closed.** With no admin and no `AUTH_BOOTSTRAP_EMAIL`, every
  sign-in is refused and startup logs an error, as it does today for an empty allowlist.
  Outside hosted production, an instance with no members and no bootstrap email stays open, as
  development is today.
- **A separate admin log.** Invitations, cancellations, role changes, revocations and restores
  are written to their own table, with who did it and when, and shown on the Admin log tab. They
  are not tree audit entries, they can't be undone from a toast, and only admins can read them.
- **Hosted only.** `DESKTOP_MODE`, Tauri and the static build never create or read the table and
  have no Members page.
- **The page is `/members`, admin only.** It is reached from the avatar menu on desktop and the
  side menu on a phone, as in the locked mockup on #656. Every members API route re-checks that
  the caller is an active admin; hiding the menu item is not the control.

## Rejected alternatives

- **Keeping `AUTH_ALLOWED_EMAILS` as the list and editing it from the app.** The app can't
  change its own deployment variables without holding hosting credentials, and a redeploy per
  invitation is the problem #656 exists to fix.
- **Keeping it as a permanent second way in.** Two sources of truth make revocation unreliable:
  a person removed in the app would still get in through the variable. `AUTH_BOOTSTRAP_EMAIL`
  covers the one case the variable was still needed for, recovering an instance with no admin.
- **Checking membership on the edge, or putting the role in the JWT.** The edge proxy must stay
  free of `pg` (#12), and a claim in a 30-day token outlives a revoke.
- **Recovery by editing the database by hand.** It needs database access the maintainer
  shouldn't need for a routine mistake, and it's easy to get wrong.
- **Letting an invitation also share a tree.** It mixes two permissions with different owners:
  an admin runs the instance, a tree's owner decides who sees it. The Share tree dialog offers
  "Invite them too" instead.
- **More roles (for example a read-only member).** Read-only access is already a tree-sharing
  tier (`view`). A second ladder at the instance level would duplicate it.
- **Writing membership changes to the tree audit log.** They don't belong to a tree, and that
  log's undo would let a revert silently restore someone's access.

## Consequences

- `getUserFromRequest` gains a database read on every hosted API call. It is a single indexed
  lookup, and it is what makes revoke immediate.
- A revoked person whose session is still valid can load the app shell, because the edge proxy
  only checks for a session, but every API call refuses them.
- Every write to the member table goes through a service that writes the admin log in the same
  transaction, and every change to `role` or `status` re-checks the last-admin rule there. A
  direct update elsewhere would bypass both.
- Matching an invitation by email happens once. After that a person keeps access if they change
  their Google address, and a new Google account with the same address doesn't inherit it.
- Sharing a tree still needs the recipient's `Users` row. The dialog warns when that person
  isn't an active member, because the share won't work until they are.
- The integration suites must cover a revoked member with a live session, the last-admin
  refusal, bootstrap on an empty instance, and the one-time seed. The PR needs the focused
  security review `CLAUDE.md` asks for on auth changes.
