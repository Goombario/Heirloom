# 0007 — Places do not get media attachment

**Date:** 2026-07-06 (PR #228; recorded 2026-08-01)
**Status:** Accepted
**Area:** gedcom / media

## Context

The polymorphic `MediaLink(MediaId, OwnerTable, OwnerId)` table made it cheap to attach media
to any owner. The rollout added Families, Sources and Events. **Places** was the obvious next
owner and was in the original scope.

## Decision

**Drop Places as a media owner.** Validated against the in-repo 5.5.1 spec: `PLACE_STRUCTURE`
has no `OBJE` substructure (`GEDCOM Specs/extracted/ged551-2.txt`) — a place is only ever an
event substructure, never a record, so there is nowhere in a conformant file to put a photo
attached to a place.

Building the UI would have meant place media that **silently vanished on export**. Better to
not offer it than to offer it and lose it.

## Rejected alternatives

- **Attach anyway, accept the export loss.** Creates data the user believes is safe and is
  not. This is the failure mode the whole round-trip effort exists to prevent.
- **Invent a custom `_OBJE` under `PLAC`.** Legal tag-wise, but it would only round-trip
  through our own exporter, and it entrenches a non-standard shape for a feature nobody had
  asked for.
- **Attach media to the *event* whose place it is.** This is already possible and is the
  honest model — a photo is of an event at a place, or of a place as a subject in the media
  library. No new attachment point needed.

## Consequences

- `OwnerMediaCard` renders on People, Families, Sources and Events. **Not Places.**
- Cases keep their own `CaseMedia` junction and were deliberately not unified.
- If a places sidecar is ever added to the export bundle (see issue #402, gazetteer rows), the
  ground for this decision changes — place media could then round-trip losslessly. Revisit
  *only* alongside that decision, not on its own.
