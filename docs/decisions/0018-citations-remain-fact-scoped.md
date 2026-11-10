# 0018 — Citations remain fact-scoped; owner-wide views are projections

> **Superseded by [0020](0020-sources-cited-is-a-footnote-list.md)** (the Sources cited assertion rows and the owner-wide drawer; fact-scoped citations and the single editor stand)

**Date:** 2026-09-10
**Status:** Accepted
**Area:** citations / people / families

## Context

Issue #424 joined three visible problems: filled source pins did not identify the clicked evidence, the Sources cited rail counted raw rows without naming the supported assertions, and the existing citation editor looked like a second evidence drawer might be needed. Family detail also loaded only the partnership citation, hiding imported citations attached to persisted family events.

The database already stores the required relationship as `Citation(FactTable, FactId, SourceId)` and stores locator, certainty, and transcription on that citation. Adding a second assertion record would duplicate this identity and create migration and synchronization failure modes.

## Decision

Citations remain attached to exactly one persisted fact. Person-wide and family-wide citation experiences are read projections over those fact-scoped rows:

- A filled pin previews the particular citation that was clicked; an empty pin opens Add for that fact.
- `CitationDrawer` is the single source-citation workspace. The photo-lightbox `EvidencePanel` remains a separate photo-metadata surface.
- The Sources cited ledger groups by source, then lists distinct `fact label — displayed value` assertions. Repeated citation rows for the same source/fact count once but remain individually editable.
- A person projection includes person-keyed facts, person events, and name variants. A family projection includes the family row and persisted family events only. Derived relatives' rows and inferred display rows are excluded.
- Missing display metadata falls back to `FactTable #FactId`; a projection must never silently hide stored evidence.

## Rejected alternatives

- **A second evidence drawer:** rejected because the existing citation workspace already owns source selection and citation editing. Two editors would drift in permissions and evidence-field support.
- **A new Assertion table:** rejected because `(FactTable, FactId)` already identifies the assertion. A new table would duplicate identities without adding required behavior.
- **Raw citation counts in Sources cited:** rejected because duplicates made the number look like supported-fact coverage while concealing which facts were supported.
- **Treating the family row as the whole family scope:** rejected because GEDCOM family-event citations are stored on `Events`; loading only `Families` makes valid evidence invisible.

## Consequences

Every new citation-capable fact needs a localized display descriptor to participate cleanly in owner-wide views. The fallback preserves access until that descriptor exists. Hosted and local data clients must keep person, family, and one-fact read contracts in parity. Mutation permissions remain on the existing citation services; owner-wide projection does not broaden write access.
