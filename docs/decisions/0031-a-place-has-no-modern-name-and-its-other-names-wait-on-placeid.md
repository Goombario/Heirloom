# 0031 — A place has no modern-name field, and its other names wait on `PlaceId`

**Date:** 2026-10-22 · **Context:** #177, #1167, ADR 0017 · **Status:** Accepted · **Area:** places / gedcom

This answers the question ADR 0017 left open: *is there a user-authored name for a place,
distinct from both the string on the fact and the geocoder's match, and where would it go
in GEDCOM?*

## Decision

1. **No modern-name field.** "Geocoded as" (`Places.DisplayName`) already is the modern
   name: geocoding a historical name ("Königsberg") returns the present-day place
   ("Kaliningrad, Kaliningrad Oblast, Russia"). A hand-typed modern name would compete
   with it, which is the confusion ADR 0017 exists to prevent. A wrong modern name is
   corrected by re-matching, as ADR 0017 already says.
2. **Alternate names are not built on the current model.** They become part of `PlaceId`
   normalization (#1167): a place with several names, each with optional language and
   date range, and a fact that keeps its as-recorded string while pointing at the place.
3. **The disabled Alternate-names group is removed** from the place edit form, and so are
   the always-empty "Aliases" row on the place detail rail and "Aliases" column in the
   places table. They existed to hold the question open, and it is now answered.

## Why aliases wait on `PlaceId`

Today a place's identity *is* its name: facts store a string and `Places` rows are found
by that string. So an alias that also appears on a fact is not an alias, it is a second
place. The useful version, "Lemberg, Lwów, Lviv and Львів are one place", needs the place
to have an identity separate from any of its names. That is exactly #1167.

What could be built today is a search label only. Merge (which folds one spelling into
another) and place notes already cover most of that, and #1167 would have to migrate it.

## GEDCOM

The `.ged` was never going to carry these names to another program:

- **5.5.1** has no place record. `PLAC.FONE`/`ROMN` are phonetic and romanized
  spellings, not aliases. ADR 0012 accepted losing them on import.
- **GEDCOM 7** `PLAC.TRAN` (with a required `LANG`) is a translation of one `PLAC`
  occurrence, repeated per fact, with no date range. It cannot say "Lemberg until 1918".
- **GEDCOM-L `_LOC`** (a place record with dated names) fits the model but was never
  standardized and is poorly supported outside a few programs (Gramps reports most `_LOC`
  places as import errors).

Other tools match this. Gramps keeps dated, language-tagged alternative place names but
does not put them in its GEDCOM. FamilySearch, Ancestry and MyHeritage keep the place as
typed and link it to their own standardized-place database. Alternate names live inside
each tool.

So when #1167 builds alternate names:

- **Export:** the `.ged` keeps writing each fact's as-recorded string as `PLAC`. The list
  of names goes into the `places.json` sidecar (ADR 0014) as an additive field (ADR 0009).
  Neither `TRAN` nor `_LOC` is written.
- **Import:** unchanged. Mapping an imported `PLAC.ROMN`/`FONE` to an alternate name is
  allowed as a follow-up, but is not required.

## Rejected alternatives

- **App-only alias table now, keyed by place name.** Workable and lossless through the
  sidecar, but it builds a model #1167 replaces, and its only payoff is search.
- **A typed modern-name field.** This is the "Modern name" mislabel ADR 0017 removed,
  rebuilt on purpose.
- **Emit `_LOC` or GEDCOM 7 `TRAN`.** `_LOC` ties exports to an unstandardized dialect. A
  `TRAN` in a 5.5.1 file is invalid, and even in 7 it cannot carry historical names.
- **Keep #177 open as deferred.** The question would stay unanswered and the disabled
  stub would stay in the UI. The decision costs nothing to record now.
