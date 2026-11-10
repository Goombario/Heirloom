# 0041 — A tree can be shared before the person has an account

**Date:** 2026-10-30 · **Context:** #1228, #1208, ADR 0029 · **Status:** Accepted · **Area:** auth / sharing

ADR 0029 kept membership and tree sharing apart, and noted that a share still needed the
recipient's `Users` row. The Share tree panel nonetheless told the owner "you can still share,
and it'll work once an admin invites them", and pressing Invite for an address that had never
signed in failed with "User not found". The #1208 smoke test found it. The maintainer chose to
keep the promise rather than refuse the share.

## Decision

1. **Sharing with an address that has no account stores a pending share.** `"PendingShares"`
   holds the tree, the owner, the normalised address and the permission, one row per tree and
   address (schema v66). It grants nothing by itself: `resolveTreeScope` never reads it.
2. **The first verified sign-in with that address applies it.** The Node jwt callback, after
   provisioning the user, moves every pending share for the address into `"TreeSharing"` in one
   `DELETE … RETURNING` / `INSERT` statement, then the rows are gone. It skips Google accounts
   whose `email_verified` claim is not true. A failure never blocks sign-in: the token is
   marked and each later request retries until it works.
   If the owner shares at the moment the person's first sign-in runs, the share request
   looks for the account again after storing the pending share and applies it itself.
3. **The owner manages a pending share like a real one.** The panel lists it with "Waiting for
   their first sign-in", and its role can be changed or removed (`/api/sharing/pending/[id]`).
4. **Sharing matches existing users by address case-insensitively**, so a differently-typed
   address of an existing user gets a real share, never a pending one that can't apply. Two
   accounts whose addresses differ only in case are refused rather than guessed between.
   An existing `"Users"` row is trusted as the address's owner, as it was before: the
   membership rules admitted the sign-in that created it.
5. **Still separate from membership.** A pending share doesn't invite anyone; an admin still
   has to. Cancelling or revoking a membership leaves the owner's pending shares alone.

## Why

- **It's the order families do it in.** An owner shares the tree with a relative and an admin
  invites them, in either order, without anyone having to come back after the first sign-in.
- **A separate table keeps the access path unchanged.** Every permission check keys on
  `"TreeSharing"."SharedWithId"`; a nullable `SharedWithId` with an email column would have put
  a row that grants nothing next to rows that grant access, and every reader would need to
  tell them apart.
- **Only a verified address can claim a share,** because the share was given to the address,
  not to whoever holds a Google account that claims it.

## Rejected

- **Refusing up front** (Invite disabled until the person has signed in once): smaller, but the
  owner would have to remember to come back.
- **Letting an invitation also share a tree:** rejected in ADR 0029 for mixing an admin's and an
  owner's permissions; this record doesn't change that.

## Consequences

- A tree delete and Erase all data delete the tree's or owner's pending shares (the `"TreeId"`
  and `"OwnerId"` foreign keys cascade as well).
- Pending shares exist only on the hosted build. The table is in `initializeSchema`, so the
  static and desktop builds create it empty and never read it.
