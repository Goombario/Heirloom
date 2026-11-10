# 0017 — Place name vocabulary: "Place name" and "Geocoded as", never anything else

**Date:** 2026-08-10 · **Context:** #447, #393, #177 · **Landed with:** PR `feat/places-edit-rework`

## Decision

Two columns on `Places` hold something a person would call "the name of the place".
They get one label each, everywhere, forever:

| Column | Label — always | Never |
|---|---|---|
| `Places.Name` | **Place name** | "Display name", "Canonical" |
| `Places.DisplayName` | **Geocoded as** | "Modern name", "Display name" — *despite the column's spelling* |

The `places.canonical` translation key has been deleted rather than re-pointed, so
reaching for the old label now fails loudly instead of quietly resurfacing.

## Why this needed writing down

The form has been mislabelled **twice**, both times for the same reason: the two
columns have colliding plain-English names, and whoever is holding one of them at the
time reaches for the obvious word.

1. `DisplayName` shipped labelled **"Modern name"** — which invited users to type a
   modern name into it. It is not user text.
2. `Name` shipped labelled **"Canonical"** — jargon that describes neither what the
   field is nor what editing it does (it renames the place, or merges it into another).
3. #447 then asked for `Name` to be relabelled **"Display name"** — which is the
   *spelling of the other column*, on the same form, four fields away. Following that
   request literally would have been the third mislabel, and the worst one.

So #447's relabel ask was **overridden**: `Name` is "Place name", not "Display name".

## What `DisplayName` actually is

`DisplayName` is **geocoder provenance**: the geocoder's own canonical name for the
result that was matched — "London, England, United Kingdom" for a place the user calls
"London". It is written only by a geocode resolution, alongside the coordinates and
(where the write path carries them) `OsmType` / `OsmId`.

It is therefore **not user-editable free text**, and a read-only field on the edit form
is correct rather than an omission. Correcting a *wrong* match is not typing over the
name — it is a **re-match**: search again, pick the right result, and rewrite the name,
the coordinates and the OSM ids **together**, because a place where those three
disagree is a place whose provenance is a lie.

Two prior bugs, both fixed, neither to be reintroduced:

- `DisplayName` was mislabelled "Modern name" (above).
- **Remove Pin silently nulled `DisplayName`.** The guard that came out of that fix is
  the `COALESCE(EXCLUDED."DisplayName", "Places"."DisplayName")` in both upsert paths:
  an incoming NULL must never erase a known match. Note what that COALESCE does *not*
  do — a **non-NULL** incoming value still wins, which is exactly what makes re-match
  possible without touching the service.

## Consequences for the write path (as built)

Re-match is **one** write: the existing single-row `geocodeUpsert`, carrying name,
coordinates, `DisplayName`, `OsmType`, `OsmId` and `pinSuppressed: false`. It is the only
path that carries the OSM ids, and the triple has to move together.

It deliberately does **not** also run `geocodeUpsertHierarchy`, even though that is what
`LocationField`'s picker uses. `chainFromCandidate` appends a level named
`city, county, state, country`, so re-matching a place recorded under a short name
("Canterbury") would mint a *second*, fact-less gazetteer row ("Canterbury, Kent, England,
United Kingdom") and reparent the real one under it. Re-matching corrects **this place's**
pin; building jurisdiction ancestry is a different job and must not happen as a silent
side effect of it. (The same shape exists in `LocationField`, where it is masked because
the field value is usually already the full comma string.)

Two consequences that had to be fixed to make that single write hold:

- **Anything that writes a place must echo the provenance it is not changing.** The
  single-row upsert assigns `OsmType` / `OsmId` with a bare `= EXCLUDED`, so a
  coordinates-only Save that omitted them NULLed the ids the row already had — including
  the ones a re-match had just written. `getPlaceDetailService` therefore returns
  `osmType` / `osmId`, and the edit form sends them back. This is the *same* failure the
  DisplayName COALESCE was added to prevent, one column over.
- **`OsmId` is a BIGINT**, so `pg` hands it back as a string. It is coerced to a number in
  the service, where the declared type is.

Known gap, deliberately not closed here: the hierarchy write carries no OSM ids at all, so
ancestor levels it creates have `DisplayName` without them. That predates this work;
closing it means changing `HierarchyLevelInput` and its route.

## What this keeps open

There is a real, unanswered question underneath all of this: **is there a
user-authored name for a place, distinct from both the string on the fact and the
geocoder's match — and where would it go in GEDCOM?** That is #177 Phase B, and it is
still open.

The point of fixing the vocabulary *now* is that Phase B must be answered
deliberately, not settled by accident because a field label implied an answer. "Geocoded
as" cannot be mistaken for a user-authored modern name; "Display name" on either column
could be, and was.

The Alternate-names group on the edit form is therefore present, labelled for what it
will hold, and clearly disabled — not removed. Removing it would lose the question.

## Also settled here: one geocode-state symbol set (#266)

Related, and recorded because it has the same failure mode — one meaning drawn two ways:

- **map pin** = the place has its own coordinates
- **dashed diamond** = no own pin; inherited from an ancestor
- **hollow ring** = no pin at all

Shape carries the meaning, colour only reinforces it (red-green colour-vision deficiency
must be covered; colour alone is never a cue). `app/places/PinMark.tsx` is the one implementation, and
`PinLegend` is the in-app key.

A mark is only drawn by a surface that can actually distinguish all three states. The
list rows and the two detail headers know whether a place has its **own** coordinates and
nothing about an ancestor's, so they draw the own-pin mark or **no mark at all** — never
the hollow ring, which specifically claims "no pin anywhere" and would be false for an
inherited pin. The words beside it ("Not geocoded") carry the negative case. Only the
drill and the tree, which hold the parented hierarchy, draw all three. Before this, the detail headers drew a **map pin for both
"geocoded" and "not geocoded"** and left the badge tone to tell them apart, and
`LocationField` drew "own pin" as a filled dot — a shape the Places surfaces do not use.
Both now draw from the single set.

Place **cards** show no geocode mark at all. That is consistent, not an omission: the
amber badge on a card is a record count, and giving it a pin would be the same mistake
in a new place.
