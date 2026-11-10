# 0022 — Rows a delete strands are kept, and user-visible counts skip them

**Date:** 2026-10-02 (#881, tracking #870)
**Status:** Accepted
**Area:** data-integrity

## Context

A person or family delete leaves its FK-less dependents in place: events, citations,
`FamilyPerson` child links, partner slots, and note and media links
(`lib/db/queries/person-dependents.ts`). That's deliberate. An audit revert brings the owner
back with its original id, and those rows reattach to it with nothing else to restore.

The 2026-09 data audit found that nothing ever removes them, and that counts included them. After
one person was deleted from `synthetic.hlbak`, the dashboard still showed 128 events. A source's
citation count still included the person's citation, while its cited-by sample (joined to
`People`) showed fewer people than the count claimed.

The alternative was to purge stranded rows once the delete's audit entry can no longer be
reverted. That needs a reliable "no longer revertable" signal and a purge trigger, and a purge
bug destroys data.

## Decision

- **Stranded rows are kept indefinitely.** No purge job; revert keeps working for as long as the
  audit entry exists.
- **Every count shown to the user goes through a live owner.** `lib/db/queries/live-owner.ts`
  holds the predicates (`liveEventSql`, `liveCitationSql`, `liveChildLinkSql`). They cover the
  dashboard's event and child counts, source citation counts and "recently cited", family child
  counts, and the places list, top places and place detail's event tallies. A count drops on a
  plain delete and comes back on revert.
- **Destructive and integrity paths still see every row.** The overwrite gate
  (`getTreeCountsService`) counts raw rows, because those are what an overwrite deletes. Place
  rename rewrites stranded events too, so a later revert finds them under the new name. The
  invariant sweep (`scripts/audit/invariant-sweep.ts`) reports strands separately from
  violations.

## Consequences

- A new count over `Events`, `Citation` or `FamilyPerson` that a user sees must use the
  predicates. `live-owner-counts.pglite.test.ts` covers delete and revert for the existing ones.
- Stranded rows grow with deletes. They're small, and a tree's overwrite import or delete clears
  them.
- If a purge is wanted later, it needs its own decision with a defined revert horizon. That
  decision would supersede this one.
