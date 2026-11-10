# Library & Places

> Status: **Stub** — fill before Phase 12 begins.
>
> Covers: source taxonomy, repository model, place data model, library UI structure, place detail page.

---

## 1. Source Taxonomy

`Source.Type` enum:

| Type | Description | GEDCOM |
|---|---|---|
| Census | Government census records | SOUR/TYPE CENSUS |
| Vital | Birth, death, marriage registrations | SOUR/TYPE VITAL |
| Church | Parish records, baptisms, marriages, burials | SOUR/TYPE CHURCH |
| Newspaper | Newspaper articles, obituaries, announcements | SOUR/TYPE NEWSPAPER |
| **Oral** | Oral histories, family stories (merged from Story table) | ⚠️ `_TEXT` custom tag |
| Document | Wills, letters, deeds, passports, etc. | SOUR/TYPE DOCUMENT |
| Photo | Photographs (linked to Media records) | SOUR/TYPE PHOTO |
| Other | Catch-all | SOUR/TYPE OTHER |

Oral sources carry:
- `Source.Contents` — the story text body
- `Source.ToldBy` — narrator name

---

## 2. Repository Model

`Repository` table:

```
Repository
  Id       SERIAL PK
  Name     TEXT          -- e.g. "Library and Archives Canada"
  Address  TEXT          -- optional
  OwnerId  INT FK → User
```

Sources can reference a repository via `Source.RepositoryId` (FK, nullable).

GEDCOM: `REPO` records. Each source with a repository exports a `SOUR → REPO @R1@` link.

---

## 3. Library UI Structure
*Source: `reworks/cases.jsx:65-127`*

> Approved photo UI direction (2026-09-11): keep the persistent desktop filter
> rail and combine it with a floating selection dock. Mobile continues to use
> the filter sheet and safe-area bottom controls. See the
> [durable HTML reference](../mockups/citation-photo-approved-structures.html)
> and [implementation plan](../superpowers/plans/2026-09-11-citation-and-photo-ui-structures.md).

### Tabs

| Tab | Shows |
|---|---|
| Sources | All sources (filterable by type) |
| Documents | Sources with Type = Document |
| Photos | Sources with Type = Photo |
| Repositories | Repository list |
| Uncited | Sources that have zero citations |

### Left rail filters

- **Type filter** — one per Source.Type value; shows count in parentheses
- **Repository filter** — list of repository names; clicking filters to sources from that repo

### Source card

- Title (Fraunces 16/22)
- Type pill (amber if Oral, else neutral)
- Repository name · Call number
- Page reference (Citation.Page if shown from a reverse-cite context)
- Reverse-cite avatars — person avatars for everyone who cites this source, max 5 visible + "+N" overflow

### Reverse-cite

Clicking a person avatar on a source card: opens `AttachSourceSidebar` with the source pre-selected, showing that person's facts for additional citation. (See `docs/design/citations.md §4`)

---

## 4. Place Data Model

Current state: Places are **free-text strings** stored in People and GedcomEvent fields (`BirthPlace`, `DeathPlace`, `Place`).

The Library renders a normalized view by grouping identical strings. No geocoding, no coordinates, no Place records in the DB (yet).

### Place pages (Phase 12)

`GET /api/places` — group-by on all place fields; return name + people count + event count.

`/places/[name]` — slug-based (URL-encoded place string). Shows:
- All people born, died, or living in this place
- All events that reference this place
- Source count (how many sources reference this place — via citation join)

### Future (not in scope for Phase 12)

- Geocoding: normalize "Glasgow, Scotland" → `{lat: 55.86, lng: -4.25}` via a geocoding API
- `Place` table with `(Id, Name, Lat, Lng, CountryCode, DisplayName)` — normalized place records
- Place disambiguation (same name, different countries)
- Place merge/redirect flow

---

## 5. TODO (fill in before Phase 12)

- [ ] Decide: should the Uncited tab list sources with 0 citations, or facts with 0 citations? (Sources with no attachments, or people/events with no sources?)
- [ ] Repository detail page — list of sources from this repository? Or just shown in source cards?
- [ ] Photo sources vs. Media records — how are photos stored? Is a Photo source a Source row, a Media row, or both?
- [ ] Place normalization strategy — when (if ever) do we add the Place table?
- [ ] Library search — full-text search across source titles, repositories, contents (Oral)?
