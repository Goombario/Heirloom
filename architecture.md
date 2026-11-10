# Architecture

## Tech Stack
- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript** (strict)
- **PostgreSQL** via `pg` pool (`DATABASE_URL` env var)
- **Tailwind CSS 4** with CSS variables theme system (light/dark)
- **D3.js** for tree layout calculation, **React Flow** for rendering
- **NextAuth.js v5** with Google OAuth + JWT sessions
- **Vitest** for testing

## Directory Structure

```
app/
  api/                    # REST API route handlers (29 routes)
    people/               # CRUD + search
    families/             # CRUD + search + children management
    events/               # CRUD
    media/                # Upload, serve files, metadata CRUD
    tree/                 # Tree data builder
    sharing/              # Tree sharing management
    audit/                # Audit log + revert
    import/, export/      # GEDCOM import/export
    relationship/         # Create/delete relationships
    stats/                # Dashboard counts
    reset/                # Delete all user data
    auth/[...nextauth]/   # NextAuth handlers
    users/me/             # Current user info
  components/
    tree/                 # Tree visualization components
      TreeVisualization.tsx   # React Flow container
      PersonNode.tsx          # 180x220px person card node
      PersonSidebar.tsx       # Person detail/edit panel
      useTreeLayout.ts        # D3 hierarchy layout hook
      useTreeExport.ts        # JPEG export hook
      types.ts                # TreeNode, FlowNodeData, etc.
    AuthProvider.tsx       # NextAuth SessionProvider
    ThemeProvider.tsx       # Light/dark/system theme context
    Navbar.tsx             # Navigation bar
    GlobalSearch.tsx        # Ctrl+K search modal
    UserMenu.tsx           # Profile dropdown
    DateInput.tsx          # Flexible date input (partial dates)
    ShareTreeButton.tsx    # Share dialog
    SharedTreeBanner.tsx   # Active shared tree indicator
    SharedWithMeList.tsx   # Shared trees list
  contexts/
    TreeContext.tsx         # activeTreeId, activePermission, currentUserId
  hooks/
    useDesktopMode.ts      # Desktop mode detection
  people/                  # Person pages (list, detail, edit)
  families/                # Family pages (list, detail, edit)
  tree/                    # Tree visualization page
  audit/                   # Audit log page
  import-export/           # GEDCOM import/export page
  relationship/            # Relationship management page
  auth/                    # Sign-in, error pages
  layout.tsx               # Root layout: Auth > Theme > Tree > Navbar > GlobalSearch
  page.tsx                 # Dashboard
  globals.css              # Tailwind + CSS variables theme

lib/
  auth/
    auth.ts                # NextAuth instance
    get-user-from-request.ts  # Extract user from request (supports desktop mode)
  db/
    connection.ts          # PostgreSQL pool (query, getClient)
    schema.ts              # TypeScript interfaces for all entities
    init-schema.ts         # CREATE TABLE IF NOT EXISTS (24 tables)
    queries/               # SQL data-access layer (one file per entity)
      people.ts            # getAllPeople, getPersonById, getPersonWithRelations, create/update/delete/search
      families.ts          # Family CRUD + relationship resolution
      events.ts            # Event CRUD
      media.ts             # Media CRUD + setPrimaryMedia
      sharing.ts           # validateTreeAccess, getSharingPermission, tree sharing CRUD
      audit.ts             # Audit log queries
      audit-capture.ts     # auditCreate, auditUpdate, auditDelete
      # ...plus cases, citations, notes, places, repositories, sources, media-links, etc.
  services/                # Permission + validation layer wrapping queries/ (see Layered Architecture)
    families.ts            # resolves the caller's permission, throws AccessError on view-only, then calls queries/
    cases.ts, citations.ts, events.ts, media.ts, audit.ts, gedcom.ts, people.ts, ...
  gedcom/
    parser.ts              # GEDCOM 5.5.1 parser
    generator.ts           # GEDCOM 5.5.1 generator
    sources-sidecar.ts     # sources.json sidecar (NameVariants + repo mirror)
  validation.ts            # validateStringField, ValidationError, escapeHtml, validatePerson
  date-utils.ts            # Partial date support, flexible parsing, formatting
  rate-limit.ts            # In-memory sliding window rate limiter
  data-dir.ts              # DATA_DIR env var or ./data fallback

scripts/
  init-db.ts               # Schema initialization (npm run db:init)
  assign-existing-data.ts  # Assign orphaned records to user

__tests__/
  unit/                    # Pure function tests (no DB)
  integration/             # API route handler tests (PostgreSQL required)
  setup/
    mock-auth.ts           # Global getUserFromRequest mock

proxy.ts                   # Request interception (NOT middleware.ts)
auth.config.ts             # NextAuth config (Google OAuth, JWT)
Dockerfile                 # 3-stage build (deps > builder > runner)
```

## Layered Architecture

```
Browser --> API Routes (app/api/) --> Service Layer (lib/services/) --> Query Functions (lib/db/queries/) --> PostgreSQL
              validates HTTP input       resolves caller permission      encapsulates SQL                    PascalCase columns
              returns NextResponse       throws AccessError on view-only  returns Promise<T>                  positional params ($1)
              checks auth (getUser)      + input validation              filters by UserId                   double-quoted names
```

All entities route through `lib/services/*`, which resolves the caller's TREE
scope once and rejects unauthorized access before touching SQL.

### Where SQL lives (services vs. queries)

`lib/db/queries/*` owns all **reusable** SQL — one function per statement,
returning `Promise<T>`. Services compose those functions and hold the business
logic (permission gates, input validation, multi-step orchestration). Route
handlers never run SQL.

A service **may** run SQL directly, but **only inside a `getClient()`
transaction** (`BEGIN`/`COMMIT`/`ROLLBACK`) where the statements are inherently
single-use and must share one connection — e.g. `importGedcomService`'s bulk
insert or the transactional tree wipe. Outside a transaction a service goes
through a query function; a one-off `query()` in a service or route that is not
transaction-bound is drift — extract it into `lib/db/queries/`.

> Decision (2026-07-20, cleanup-audit item 14 / A1): this **blesses** the
> existing service-level transactional SQL rather than migrating it down into
> `lib/db/queries/`. The rule is the boundary going forward.

## Multi-Tree Scoping (API Route Standard Pattern)

A user account can hold several separate **trees** (`Trees` table). Every
owner-bearing table carries a `TreeId` scope column; the legacy owner columns
(`UserId`/`OwnerId`) are still written (= the tree's owning user) but are no
longer scope predicates. The one choke point is `resolveTreeScope` in
`lib/db/queries/trees.ts`:

```typescript
export async function GET(request: NextRequest) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    try {
        const result = await listEntityService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),   // primary
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')), // legacy: that user's default tree
            currentUserId: user.id,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to fetch entities');
    }
}

// inside the service:
const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
// scope = { treeId, ownerId /* tree's owner */, permission }
// reads:  WHERE "TreeId" = scope.treeId
// writes: INSERT sets both the legacy owner column (scope.ownerId) AND "TreeId"
```

Tree lifecycle: default tree = the user's lowest `Trees.Id`, lazily created by
`resolveDefaultTree` ("My Tree"); an account always keeps ≥ 1 tree; tree CRUD
lives at `/api/trees` (+ `[id]`), and `DELETE` requires
`X-Confirm-Delete-Tree: CONFIRM_DELETE_TREE` because a deleted tree is NOT
restorable from the audit log (the transactional wipe in `deleteTreeData`
bypasses audit capture and removes the tree's audit rows). It returns
`{ cleanupWarningCount }`: media files left on disk after the commit (#945).

**Rate limiting** (in-memory, `lib/rate-limit.ts`): Seven buckets — media upload (1000/15min), GEDCOM import re-upload (`:import-upload`, 1000/15min), spreadsheet import (`:spreadsheet-import`, 5/15min), reset (2/hr), GEDCOM import (5/15min), GEDCOM export (10/15min), duplicate check (`:duplicates`, 300/15min). Every bucket is keyed on `user.id` *after* authentication and the whole module is stripped from the static/desktop build (which ships no `app/api`), so these are runaway-loop guards on a private instance rather than anti-abuse controls; the per-tree storage quota (507) is the ceiling that binds uploads. The cleanup sweep prunes against the longest window any caller has used, so short-window traffic cannot erode a long-window bucket's budget.

## Database Schema

`init-schema.ts` creates **24 tables**. The core entities:

| Table | Key Columns | Notes |
|-------|-------------|-------|
| Users | Email, GoogleId, Name | Auto-created on first login |
| People | FirstName, LastName, Sex, BirthDate, DeathDate, IsDeceased, Notes, GedcomId, UserId | Core entity. `SearchName` (and `NameVariant.SearchName`) is a generated column, `"SearchFold"` of the name (accents and ё removed, lower case); search folds its query with the same function (#792). `BirthRawGedcom` / `DeathRawGedcom` / `NameRawGedcom` keep GEDCOM passthrough re-emitted under `1 BIRT` / `1 DEAT` / the primary `1 NAME` (#423, #964). `BirthRecorded` = 1 marks an imported bare `1 BIRT`, exported as `1 BIRT Y` (#968) |
| Families | Partner1Id, Partner2Id, MarriageDate, MarriagePlaceId, UserId | Links two People (gender-neutral since Phase 9; legacy `HusbandId`/`WifeId` columns retained but unused). `MarriageRecorded` = 1 marks an imported bare `1 MARR`, exported as `1 MARR Y` (#965) |
| FamilyPerson | FamiliesAsChildId, ChildrenId, Partner1Relationship, Partner2Relationship | Junction: families to children. The child's relationship to each partner slot is Birth, Adoption, Foster, Step, Guardian or Unknown (ADR 0027). `FamcRawGedcom` / `ChilRawGedcom` keep the link's GEDCOM passthrough, re-emitted under its `FAMC` / `CHIL` (ADR 0023) |
| Events | Type, Date, PlaceId, Description, PersonId, FamilyId, UserId | GEDCOM event types |
| Media | FilePath, Format, ContentType, FocalX, FocalY, FocalRadius, UserId, TreeId | Tree-scoped media metadata; ownership and person-specific primary state live only in MediaLink (+ MediaBlob/MediaThumb for the static/PGlite build). `FileRawGedcom` keeps the FILE's unmodelled GEDCOM sub-lines, re-emitted under `1 FILE` (#976); `Citation.RawGedcom` does the same for a citation's OBJE and its other unmodelled children (#980), and `Citation.Part` re-exports a citation of a fact's DATE or PLAC under that line (#990) |
| Trees | OwnerId, Name | Multi-tree: one account, several separate trees; every owner-bearing table carries a `TreeId` scope column |
| TreeSharing | TreeId, OwnerId, SharedWithId, Permission (view/contribute/edit) | PER-TREE sharing (three tiers), unique on (TreeId, SharedWithId) |
| PendingShares | TreeId, OwnerId, Email, Permission | A share for an address with no account yet; moved into TreeSharing at that address's first verified sign-in (ADR 0041), unique on (TreeId, Email) |
| Places | Name, Latitude, Longitude, DisplayName, OsmId, ParentId, UserId, TreeId | Gazetteer. Two places may share a name; a typed name means the most-used place of it, `"PlaceIdByName"` (ADR 0036). Facts point at their place through `People.BirthPlaceId` / `DeathPlaceId`, `Families.MarriagePlaceId` and `Events.PlaceId` (ON DELETE SET NULL), and at the name they use through the matching `…PlaceNameId`. They keep no place text (v64, ADR 0037): readers build it with `factPlaceTextColumns` under the old names (`BirthPlace`, …), and saves match the text they are sent once, with `factPlaceRefs` (`lib/db/queries/place-links.ts`). "Move records to another place" (`POST /api/places/move`) re-points chosen facts by id, one revertable audit entry |
| PlaceName | PlaceId, Name, Language, FromDate, ToDate, TreeId | A place's other names ("Lemberg" until 1918), unique on (TreeId, Name) and never also a `Places.Name`; exported only in `places.json` (ADR 0031, 0033). The place page saves a place's whole list with `POST /api/places/names` (#1185, `lib/db/queries/place-names.ts`), one revertable audit entry; a removed or respelt name that facts use gives them a separate place of that name, so they keep their text. A rename or merge can keep the old name as another name (`keepOldName`) |
| AuditLog | Action, EntityType, EntityId, Changes, TreeOwnerId, UserId | Change tracking |

Additional tables: Sources, Citation, Repository, NameVariant, Note, NoteLink, MediaLink, MediaTag, MediaBlob, MediaThumb, and the Cases feature set (Cases, CasePerson, CaseMedia, CaseComments). Consult `lib/db/init-schema.ts` for the authoritative list.

**SQL conventions:** PascalCase with double quotes (`"People"`, `"FirstName"`), positional params (`$1, $2`), arrays via `= ANY($1)`.

## Authentication Flow

1. `proxy.ts` intercepts all requests, enforces auth on `/api/*` (bypass if `DESKTOP_MODE=true`)
2. The Node `signIn` callback calls `admitSignIn()` (`lib/auth/membership.ts`): an active `Members` row bound to the Google account, or an invitation for its verified email, admits; nothing else does. The edge proxy and `auth.config.ts` stay free of `pg` and make no membership decision
3. NextAuth uses JWT sessions (30-day expiry)
4. `getUserFromRequest()` extracts user, auto-creates Users table entry, then requires an active membership bound to both the user id and the Google id on every API request (no cache), so a revoke takes effect on the next request
5. Services resolve scope + permission via `resolveTreeScope` (see Multi-Tree Scoping above)

### Hosted membership (ADR 0029)

- Tables `Members`, `MemberLog` and `MembershipMeta` (`lib/db/init-membership.ts`) exist only on the hosted path: `connection.ts` creates them after `initializeSchema` unless `DESKTOP_MODE=true`, so they are not part of `SCHEMA_VERSION` and never reach static exports
- A row is `invited` (email only) or bound (`UserId` + `GoogleId`, `active` or `revoked`); roles are `admin` and `member`. Every change takes one advisory lock and re-checks that the caller is an active admin, and the last active admin cannot be demoted or revoked
- Startup reconciliation: `AUTH_ALLOWED_EMAILS` seeds members once (marker in `MembershipMeta`), and `AUTH_BOOTSTRAP_EMAIL` restores an admin whenever none is active or invited
- Sign-in is open only when there are no members, no bootstrap email and the app is not hosted production (dev/test)
- `/members` (admins only) lists members and the admin log via `/api/members*`; routes return 404 in desktop builds

## Multi-User Sharing (per tree)

- Every owner-bearing table carries a `TreeId` column for data isolation
- `TreeSharing(TreeId, SharedWithId)` grants one of three tiers on ONE tree: `view` (read-only), `contribute` (add/edit records but not delete), or `edit` (full write incl. delete)
- API routes accept `?treeId=X` (primary) or legacy `?ownerId=X` (resolves that user's default tree)
- Write operations return 403 when the tier is insufficient (e.g. `view` blocks all writes; `contribute` blocks deletes)
- `TreeContext` tracks `activeTreeId` (null = own default tree) and `activePermission`; the selection persists in localStorage and is validated on restore via `GET /api/trees/[id]`
- The share dialog shares the ACTIVE owned tree; the switcher lists own trees + one row per tree shared with the user

## Tree Visualization

```
Tree Page (app/tree/page.tsx)
  ├── Search bar (filters allPeople from tree data)
  ├── Mode toggle (descendants ↓ / ancestors ↑)
  ├── TreeVisualization (React Flow)
  │   ├── useTreeLayout (D3 hierarchy + tree layout)
  │   └── PersonNode (custom React Flow node, 180x220px)
  └── PersonSidebar (opens on node click, inline edit with save-on-blur)
```

- D3 `hierarchy()` + `tree()` calculate positions, React Flow renders
- Node widths account for spouse cards (PERSON_CARD_WIDTH + spouses * (width + gap))
- Two modes: descendants (downward) and ancestors (upward, Y inverted)

## Theme System

- CSS variables in `globals.css` with light/dark mode
- `ThemeProvider` context with localStorage persistence
- Gender colors: blue (M), pink (F), neutral
- Semantic tokens: primary, accent, surface, card, text, border, error, success, info

## Audit System

- **Capture** (`lib/db/queries/audit-capture.ts`): `auditCreate()`, `auditUpdate()`, `auditDelete()` — called automatically by query functions after writes
- **Query** (`lib/db/queries/audit.ts`): `getAuditLog()` (paginated, filterable by entityType), `revertAuditEntry()`, `revertAuditEntries()` (transactional batch revert)
- **Diff tracking**: `computeFieldDiff()` compares old/new records field-by-field, stores only changed fields
- **Entity labels**: `buildEntityLabel()` generates human-readable descriptions (e.g. "John Smith" for a person)
- **ENTITY_CONFIG**: Maps entity types to table names and allowed fields — must stay in sync with `ALLOWED_*_FIELDS` in query files
- **API**: `GET /api/audit?page=&pageSize=&entityType=&ownerId=`, `POST /api/audit/revert`

## Date Handling

- **Partial dates** supported: `"1945"`, `"1945-03"`, `"1945-03-15"` (stored as strings)
- `lib/date-utils.ts` exports `parseUserDateInput()` (accepts 6+ formats including GEDCOM), `formatDateForDisplay()`, `calculateAge()`
- `calculateAge()` returns: exact age, `~age` (tilde = year-only precision), `"Deceased"` (if IsDeceased=1 with no dates), or `null`
- `DateInput` component (`app/components/DateInput.tsx`) provides flexible date entry UI

## Event Types

16 GEDCOM event types defined in `lib/db/schema.ts`:
`BIRT`, `DEAT`, `OCCU`, `EDUC`, `RESI`, `BURI`, `CHR`, `BAPM`, `ADOP`, `EVEN`, `GRAD`, `IMMI`, `NATU`, `CENS`, `RETI`, `PROB`, `WILL`

Default type is `EVEN`. `getEventDisplayType()` maps codes to display names.

A person's birth and death live on the `People` row (`BirthDate`/`BirthPlaceId`, `DeathDate`/`DeathPlaceId`/`DeathCause`), cited as the `PersonBirth`/`PersonDeath` facts. The events API refuses to create a person `BIRT`/`DEAT` Events row, or to turn an event into one (`assertNotPersonVital`, #756); a legacy row can still be edited in place.

## GEDCOM Source/Citation Round-Trip

Sources and citations round-trip through GEDCOM export/import (hybrid: standard GEDCOM + zip-only sidecar).

- **Sources** export as standard `0 @Sn@ SOUR` records — `TITL`/`AUTH`/`PUBL` plus `TEXT` (transcription, from `Contents`), and Heirloom-only custom underscore tags `_URL` (from `Text`, the source's own website), `_TYPE`, `_NUM`. An oral source's teller is its `AUTH`; `_TOLDBY` from older exports is folded into the author on import (ADR 0038). Repositories export as deduped `0 @Rn@ REPO` records (deduped by name) referenced via `1 REPO @Rn@` + `2 CALN`. Source xrefs start at `@S1@` and increment sequentially. (The legacy `_STORY` custom record and its xref-offset scheme were removed when the `Stories`/`StoryPerson` tables were retired; any `_STORY` records in imported GEDCOM files are silently ignored.)
- **Citations** on People / PersonName / PersonBirth / PersonDeath / Events / Families / FamilyMarriage export as `SOUR` pointers under the cited fact (`2 SOUR @Sn@` / `3 PAGE` / `3 NOTE`; level 1 for whole-person/family). `FamilyMarriage` is the `1 MARR` / `2 SOUR` citation (#962); the family view shows it on the start row beside the whole-family citations. The parser attributes each pointer to the in-progress fact by level + context, so Events get the right `FactId` with no ordinal correlation. (This replaced the old lossy behavior that crammed inline `SOUR`/`PAGE` into an event's Description.)
- **`sources.json`** (zip export only, `lib/gedcom/sources-sidecar.ts`) carries the small remainder GEDCOM cannot anchor: structured `NameVariant` records + their citations (people referenced by `@In@` xref, sources by `@Sn@`), and a redundant repository-name/call-number mirror. On import the `.ged` is primary; the sidecar only fills fields the `.ged` lacked.
- **Structured Cases citations** (`FactTable='Cases'`) ride in `cases.json` `sourceCitations`; older bundles' free-text `citations` entries are imported into this same model for backward compatibility. A journal entry's citation (`FactTable='CaseComments'`) rides as that comment's `citation`. Both carry every Citation field (`quay`, `dataText`, `dataDate`, `even`, `role`, `url`, written only when set). A case's photos (`media`) and an entry's photo (comment `media`) ride by the bundle's `@O…@` media xrefs; import skips one whose media isn't in the bundle. A struck-out note carries `StruckAt` and `StruckReason` (#1251, ADR 0042). `lib/gedcom/cases-sidecar.ts` builds the sidecar for hosted and local exports.
- **Merge/dedup:** GEDCOM sources dedup by `LOWER("Title")` per tree (reuse, never overwrite); legacy cases.json free-text citations use `(LOWER("Title"), Text/URL)` so distinct URLs are preserved. Citations dedup by `(FactTable, FactId, SourceId, Page)` for standard records and include `Note` for legacy Cases rows; a merge match keeps what the row has and fills its empty evidence fields and link; overwrite mode deletes the owner's `Citation` + `Sources` first (also cleared on full reset). All import persistence runs inside `importGedcomService`'s `getClient()` transaction (PGlite-safe), so local-first mode is covered automatically.
## Media

- Images (jpg, jpeg, png, gif, webp, svg, bmp) and PDF documents (#510). One allowlist,
  `lib/media/allowed-extensions.ts`, serves the hosted upload, the local upload, GEDCOM zip
  import and recovery. A PDF is stored as uploaded, only after its bytes start with `%PDF-`;
  it skips compression, thumbnails, face capture and XMP, can't be a portrait or carry a
  face tag, and counts against the same per-file limit and tree quota as a photo.
- 10MB limit, MIME validation, rate limited (1000/15min)
- **Serving:** `/api/media/[id]/file` names the file after its title (`Content-Disposition`,
  ASCII `filename` plus UTF-8 `filename*`); `?download=1` makes it an attachment. Images get a
  sandboxed `default-src 'none'` CSP and `frame-ancestors 'none'`. A PDF gets only
  `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, because the media viewer frames
  it and the browser's PDF viewer won't run sandboxed; `next.config.ts` leaves this one route
  out of the app-wide frame and CSP headers. `?w=` thumbnails return 415 for a PDF.
- **Documents in the UI (#510, ADR 0039):** `MediaImg` takes the row's `contentType` and draws a
  PDF as `DocumentThumb`: its first page, rendered in the browser by pdf.js
  (`lib/media/pdf-preview.ts`, worker loaded from this origin, cached per session), or a plain
  document icon when pdf.js can't read it. The viewer frames the browser's own PDF viewer on
  desktop (`DocumentStage`) and shows the first page with Open PDF on a phone; the rail lists
  what the document is linked to (`GET /api/media/[id]/links`, `getMediaLinkOwners`). The
  static build's `_headers` and the Tauri CSP allow `frame-src blob:` for the local file URL.
- **Duplicate guard (#592):** `Media."ContentHash"` holds SHA-256 of the ORIGINAL uploaded
  bytes — never the compressed copy, since both upload paths re-encode and a sharp/libvips
  upgrade would silently change a post-compression hash. Nullable and non-UNIQUE on purpose:
  rows predating the guard cannot be backfilled (only the compressed copy survives) and must
  never match, and "include it anyway" stays a legal outcome. `POST /api/media/duplicates`
  answers a batch of hashes tree-scoped; `UploadModal` calls it before uploading and arrives
  with matches deselected. Advisory only — no code path blocks an upload, and a failed check
  leaves every photo selected. `lib/media/content-hash.ts` is shared by the hosted service
  and the local PGlite client so both builds record the same identity.
- Hosted bytes are stored under `data/uploads/{treeOwnerId}/media/`; local/static bytes live in `MediaBlob`.
- **Orphan sweep (#860):** files that no `Media."FilePath"` references (rows deleted outside the app, failed `cleanupMediaFiles`, a crash before commit) are removed by `scripts/sweep-orphan-media.mjs` — plain Node, copied into the runner image so it runs next to the volume (`railway ssh`, then `node scripts/sweep-orphan-media.mjs`). Dry run by default; `--apply` deletes. It matches against every tree's rows, skips files modified within 24 h, never follows symlinks, and refuses to apply when no row references anything (wrong database). Its thumbnail naming must track `lib/media-thumbnail.ts`; a unit test pins them together. The hosted server also runs it as a dry run five minutes after start and daily after that (`instrumentation.ts` → `lib/services/orphan-media-check.ts`, #946): it logs `orphan_media_check` counts and shows the latest result to admins above the Members admin log. Nothing scheduled ever passes `--apply`.
- **Local/browser capacity:** `navigator.storage.estimate()` is an advisory signal for available browser storage, not a universal exact quota. Local ingestion must not invent pixel or device-memory thresholds; insufficient finite estimates may stop processing, while unavailable/rejected estimates proceed. Recovery keeps decode failures as the stable `decode_failed` category. Any future measured memory guard requires separate evidence and design.
- **Resumable import lineage (schema v36):** `MediaImportItem` durably records the `ImportId` + document-local `DocumentMediaId`, tree/media ids, the normalized non-empty `ArchivePath`, original filename, `SkipFaceCapture`, and materialization state. Structural import creates `pending` rows before bytes are materialized; missing archive entries become `missing`, materialization/validation/storage errors become `failed`, and `ready` is committed atomically with the Media bytes and metadata. Non-ready rows are the recovery queue, and a ready row is idempotent on retry. A retry must present the exact stored archive identity after normalization (slash normalization, traversal rejection); it never matches by basename. Xrefs remain document-local, so imports do not infer identity across documents and there is no `GedcomMediaKey`.
- **Cross-backend export:** Hosted filesystem paths and local `MediaBlob` bytes are exposed through separate availability/packaging adapters. Both feed the same browser-safe `assembleGedcomExport` core, which classifies unresolved or physically unavailable media once per Media row and filters corresponding links/tags before assigning fresh document-local xrefs. Media export preflight blocks download when any such row exists; only the exact `mediaPolicy=omit-unresolved` override permits omission. An override emits no pointer to omitted media and may include `missing-media-report.json`, whose contents are aggregate counts by omission reason only (no ids, paths, names, or family data). A plain `.ged` export contains no multimedia records because it carries no media bytes.
- Served via authenticated `/api/media/[id]/file`
- **Canonical relationships:** `MediaLink(MediaId, OwnerTable, OwnerId, IsPrimary)` is the sole attachment/ownership and person-primary model. Approved owner tables are People, Families, Sources, and Events; every link is validated against the media tree. The partial unique index on People links permits at most one primary media row per person while allowing one shared media row to be primary for several people.
- **Face geometry:** `MediaTag` associates one person with one media row and stores only `RegionX/Y/W/H`; it does not carry primary state. Tag geometry overrides the media focal crop only in that person's primary presentation.
- **Focal points:** `FocalX`/`FocalY` fields (0-100, semantic default 50%) control image crop center; `FocalRadius` is optional. Missing axes are treated as centered.
- **GEDCOM bundles:** each media row exports once as a top-level `OBJE`; document-local pointers attach it to People, Families, Sources, and Events. Media files sit flat in the bundle's `media/` folder, named `O<n>-<title>.<ext>` after their xref (bundle v3, #937; `archiveMediaPath` in `lib/gedcom/media-archive-name.ts` builds the FILE line and both zip entries), and FILE paths are matched to zip entries exactly. `media.json` (version 3; v2 had the same content with a folder per photo, `media/O<n>/…`) carries only focal and face geometry keyed by the same document-local media xrefs. The importer still accepts v1 library/tag metadata and legacy inline `OBJE`/`_PRIM` input, without using xrefs, paths, names, basenames, hashes, or record order to infer identity across imports.

## Desktop Mode (hosted-server auth bypass)

`DESKTOP_MODE` is a **hosted-server** flag — it has nothing to do with the Tauri
desktop app. When `DESKTOP_MODE=true`:

- `proxy.ts` bypasses all auth checks immediately
- `getUserFromRequest()` auto-creates a desktop user (GoogleId: `"desktop-local"`, email: `"local@desktop"`) cached in memory
- Hides auth-related UI (sign-in, sharing, user menu)

> The Tauri desktop app does **not** use `DESKTOP_MODE`. It runs the static
> (local-first) build, which uses PGlite/IndexedDB and has no server-side auth at
> all. See [`docs/desktop-tauri.md`](docs/desktop-tauri.md).

## Security Headers

Configured in `next.config.ts`:
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

## Deployment

This project ships two independent build flavors from the same codebase:

### 1 — Hosted server (Railway / Docker)
Full Next.js server + PostgreSQL. Multi-user, OAuth, sharing.

- **Railway**: PostgreSQL plugin + persistent volume at `/data`, the app built from the `Dockerfile`. Setup is in `SELF_HOSTING.md`; the maintainer's own instance is configured and deployed outside this repository
- **Docker**: 3-stage Alpine build, standalone output, non-root user. The runner has no tsx or TypeScript sources; a maintenance script that must run in the container is plain `.mjs` and is copied in explicitly
- **CI** (`ci.yml`): GitHub Actions on every PR into `main`: lint, unit (two shards) and integration tests, Postgres and PGlite (parallel) > static build. Nothing deploys on merge
- **Branches and releases**: feature branches > `main`. A `v<version>` tag on `main` runs `desktop-build.yml` (desktop release). Nothing in this repository deploys a site; the maintainer's sites deploy released tags from outside it

### 2 — Static / local-first (Cloudflare + Tauri desktop)
`npm run build:static` produces an `out/` directory with PGlite/IndexedDB in place of PostgreSQL. No server required.

- **Local database** (`lib/db/connection.pglite.ts`): tabs share one PGlite worker by leader election; a call cut off by a leader change is re-run if it is a read, and otherwise fails with `DatabaseInterruptedError` (#1009). Each data-client write waits for a durable IndexedDB flush before it resolves (#1033); a loop of writes such as adding many photos runs through `withWriteBatch` (`lib/data/index.ts`) and waits for one flush at the end instead (#1259). The data lives in one of two IndexedDB data directories named by a localStorage pointer (`lib/db/data-dir.ts`); a restore loads into the other one and switches the pointer before deleting the old one (#951).

- **Cloudflare** (Workers Static Assets, built by Cloudflare from a git branch): serves the same `out/` as a web app. See `docs/cloudflare-pages-setup.md`.
- **Tauri desktop** (`desktop-build.yml`): wraps `out/` in a Tauri 2 WebView2 native Windows `.exe`. A `v<version>` tag → installer and Linux Flatpak attached to a GitHub Release. See [`docs/desktop-tauri.md`](docs/desktop-tauri.md).
