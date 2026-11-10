# 0036 — Two places may share a name

**Date:** 2026-10-25 · **Context:** #1186, ADR 0035 · **Status:** Accepted · **Area:** places / gedcom

"Paris" in France and "Paris" in Ontario are two places that records write the same way.
Until v63 the gazetteer was unique on `("TreeId", "Name")`, so the second one could only be
kept apart by spelling it differently ("Paris, Ontario"), which changes what the record says.
ADR 0035 made a fact's place reference the truth, so the name no longer has to identify the
place. The maintainer approved dropping the one-place-per-name rule.

## Decision

1. **v63 drops `idx_places_tree_name`.** A plain `idx_places_tree_name_lookup` on the same
   columns serves lookups, and its presence marks that v63 ran: the v20 block that merged
   same-name places on every boot runs only while it is absent, so it can no longer fold two
   Parises back into one. Other names (`PlaceName`) stay unique per tree and never equal a
   place's own name.
2. **A typed name links to the most-used place of that name.** The SQL function
   `"PlaceIdByName"(tree, name)` returns the place of that name with the most facts pointing
   at it (`"PlaceUseCount"`), the lowest id on a tie, and failing that the place the name is
   another name of. Linking, lookups by name, rename and merge by name, the importer and
   place notes all resolve a name through it. Choosing another place is the picker's job
   (#1186 part 2c), not the text's.
3. **Everything that can, addresses a place by id.** The place page, coordinates and pin
   lookups, the list's counts and grouping, the GEDCOM writer's `FORM` / `MAP` / `NOTE` under
   each `PLAC`, and the person and family maps all key by place id, and use the name only for
   a fact with no place.
4. **places.json keeps same-name places apart.** Each entry carries an export-local `key`
   (its position in the file, so a re-export is identical) and names its parent by
   `parentKey` as well as by name. A `facts` list names, for each fact whose place name more
   than one place has, the record's xref, the fact (birth, death, marriage or an event's type
   and date, with its index among the record's same events) and the place's key. After the
   import links facts by name, it points each listed fact at its place. Additive per ADR
   0009, so the sidecar version stays 1, and a bundle without these fields still reads by
   name.
5. **On import an entry matches an existing place of its name** by OSM id, then by
   coordinates, then the most-used one that is not somewhere else (coordinates more than
   half a degree away, or with no coordinates on one side a different OSM id), else it
   becomes a new place. A corrected pin or a fresh geocode therefore still matches. Overwrite empties the gazetteer first, so there
   every entry is a new place. The upserts that used `ON CONFLICT ("TreeId","Name")` now
   update the place a name means and insert only names no place has
   (`lib/db/queries/place-import.ts`). On merge, the facts map and the report below only
   touch records the import added; a record it matched keeps the places the tree gave it.
6. **The import report lists the guesses.** Facts of the imported records whose place name
   more than one place in the tree has, and that places.json did not place, were linked to
   the most-used one. The `places_shared_name` warning names those places and the people, so
   the user can move any that are wrong.

## Consequences

- With no unique index, two writers creating the same new name at once can make two rows.
  The place writers hold a per-name advisory lock, and the link pass inserts one row per name
  per statement, so this needs two concurrent first uses of a brand-new name. A duplicate
  that slips through is an ordinary same-name pair. Renaming one to the other's name is
  refused as "the same name", so folding them together waits on "Move records to another
  place" (#1186 part 2c).
- A `PLAC.MAP` from a plain .ged is not applied to a name two places share: it cannot say
  which of them it is for.
- Rows that only show a name (search suggestions, the list's label) show two "Paris" alike
  until the picker and list show what tells them apart.
- `suppressCoveredAncestors` and the descendant-pin rollup still compare names, so a pin
  shared between same-name places may be hidden when it should show.
- `PLAC.NOTE` has no place id in the .ged, so a note under a name two places share lands
  on the most-used of them on import (after the facts are linked), whichever place it was
  written under.
- Going back to a build from before v63 is destructive: its v20 block merges every
  same-name pair on boot and recreates the unique index.
- The forms still save a pin to the place the typed name means; saving it to the place a
  fact points at waits on the picker (#1186 part 2c).
