# 0050 — A place knows what kind of place the geocoder matched

**Date:** 2026-11-14 · **Context:** #45, ADR 0017 · **Status:** Proposed · **Area:** places

A place page can say what kind of place it is ("City", "County", "Cemetery"). Nobody types it.
GEDCOM's `PLAC.FORM` gives it for imported places, read at request time with nothing stored. Places
put on the map by the geocoder have no FORM, but Photon says what each match is, and the app threw
that away.

## Decision

1. **`"Places"."OsmKind"` (schema v73) keeps the match's OSM tag as `key/value`,** such as
   `place/city` or `landuse/cemetery`. It sits beside `OsmType` and `OsmId`, the rest of the match's
   provenance (ADR 0017). Only a value shaped like an OSM tag is stored.
2. **A match sets it, and matching again replaces it.** For the levels above the match (country,
   state, county, city), the field Photon put each one under gives its kind. Those levels fill it
   only where it is empty. A manual pin move leaves it alone, as it leaves `OsmType` and `OsmId`
   alone.
3. **The kind shown is FORM's word first, then the geocoder's.** FORM's word is shown as the
   exporting app wrote it. A geocoder tag is shown through a translated label (en, fr, ru), and a
   tag with no label is not shown, since a raw OSM tag means nothing to a reader. With neither,
   nothing is shown.
4. **It is part of a place edit's audit state,** so Undo of a match restores it with the pin.
5. **places.json carries it** as `osmKind`, written only when set (ADR 0009, additive). A merge
   fills it only where the place has none.

## Consequences

- Places matched before v73 show the FORM kind or nothing until they are matched again.
- An undo of a place edit recorded before v73 clears `OsmKind`, because that entry has no value
  for it.
