# Heirloom Design System — in-app reference

This doc is the reference for the design system. The original design kit it was built from is not part of the repository.

## Voice
Warm, calm, scholarly. Second person ("your tree"), sentence case, em dashes & middots,
genealogy shorthand (b./d./m.). Citations everywhere. Emoji only on legacy utility screens.

## Visual one-liner
Stone surfaces, slate chrome (warm charcoal in dark mode) and slate-ink links, **copper for the main action, amber for
evidence only** ("ink acts, amber proves", #688; ink is slate since 2026-09-23), Fraunces for names, Inter
for UI, JetBrains Mono only for dates, times, IDs, key caps and citation chip numbers (#808, TY-1). Soft shadows, 12px cards, no gradients except gender
avatars and the dark hero.

## Tokens (defined in app/globals.css)
- **Color:** the three named hues each have one job (see the palette table below),
  plus `--surface/-2`, `--card/-alt`,
  `--border`, `--text/-2/-muted`, status `--success/-error/-warning/-info`, gender
  `--color-male/-female/-neutral` (+ `-dark`), `--hero-bg` / `--color-hero-tint` /
  `--color-hero-select` (see Dark islands), overlay chrome
  `--color-scrim` (black veil behind transient tree overlays) / `--color-glass-border`
  (frosted hairline on glass panels + the header map-preview frame), on-media
  `--color-on-media` (white foreground on photos / saturated avatar discs / solid
  evidence fills) / `--color-media-scrim` (the darker 0.6 legibility veil behind on-photo
  captions & controls — distinct from `--color-scrim`'s 0.35 page overlay), lightbox
  dark-island surfaces `--color-lightbox-panel/-stage-top/-stage-bottom/-scrim/-sheet` (see
  **Dark islands** below).

### Palette (Option B, #688)

Slate is chrome (warm charcoal in dark mode), copper is the main action, slate ink is navigation and focus, amber is evidence. Ratios are WCAG contrast, guarded by
`__tests__/unit/contrast-tokens.test.ts`.

| Role | Token (utility) | Light | Dark |
|---|---|---|---|
| Main-action fill — the **only** coloured fill on a screen | `--color-primary` (`bg-primary text-white`) | burnt copper `#9A4418` (white 6.5:1), hover `#7F3813` (8.5:1) | `#A9531F` (white 5.3:1), hover `#8C4418` (7.1:1) |
| Navigational links | `--color-link` (`text-link`) | slate `#475569` (7.6:1 on cards); underlined inside running text | `#A7B4C6` (7.2:1 on cards, 4.9:1 on card-alt); hero `#C3CEDC` |
| Focus ring | `--color-focus` | `#475569` | `#A7B4C6` (copper is only 2.9:1 on a dark card); hero `#C3CEDC` |
| Chrome / header | `--color-nav-bg` | slate `#475569` | warm charcoal `#2B2622` (white text 15:1; `color-scheme` follows the theme so native controls do too) |
| Evidence text (list/body dates, citation text) | `--color-date`, `--color-evidence` (`text-evidence`, `.date-mono`) | `#9A4C08` | `#E6B24A` |
| Hero dates (dark island, both themes) | `--color-date` inside `.dark-island` / `.hero-dark` | `#E9A94F` | `#E9A94F` |
| Citation chip fill / edge | `--color-evidence-soft` / `--color-evidence-border` | `#FCD9A8` / `#D9A15E` | `#3A2A0E` / `#8A6418` |
| Evidence tag fill (`Badge tone="evidence"`) | `--color-evidence-tag` / `--color-on-evidence-tag` | `#F3C27F` / `#5C2804` | `#7A5410` / `#FFF1C2` |
| Living-status mark (`StatusMark`) | `--color-status-living` / `-deceased` / `-unknown`, glyph `--color-on-status` | `#047857` / `#1C1917` / `#605A52`, glyph `#FFFFFF` | `#34D399` / `#78716C` / `#B8B2AA`, glyph `#FFFFFF` (only † carries one) |
| Faint evidence tint | `--color-evidence-bg` | `#FEF3C7` | `#451A03` |
| Warnings (`Badge tone="warning"`, `Banner tone="warning"`) | `--color-warning-text` / `--color-warning-bg` | orange `#9A3412` / `#FFEDD5` | `#FDBA74` / `#431407` |
| Warning edge (warning badge ring, "Check this date" mark, flagged timeline row) | `--color-warning-edge` | `#C2410C` | `#F97316` |
| Overdue-backup dot on the nav chip | `--color-nav-warning` | `#FDBA74` | `#FDBA74` |
| Drop-zone edge (Add media's dashed drop strip, #1204) | `--color-drop-edge` (`border-drop-edge`) | `#8C857C` (3.3:1 on card-alt) | `#9C958C` (3.5:1 on card-alt) |

Selected states use a **neutral** fill, not a colour: colour fill means the main action only.
A selected choice in a control (`SegmentedControl` segment, active `FilterChip`, a ticked
finder row) is the selected fill `bg-segment-on text-on-segment`, weight 600 (#691,
decision 5). In light mode it is the ink navy `#1F2B3D` of the v1.1 band (#55 C6); dark mode
keeps the ink fill (off-white on ink). Navy is a neutral, not a colour: it is the chrome's
ink, never a main action. It reads at ≥14:1 in both themes, guarded in `contrast-tokens.test.ts`.
Build mode switches and pickers from `SegmentedControl`, which also takes `icon`, `sub`,
per-option `disabled` and `orientation="vertical"`, instead of hand-rolling selected styles.
A selected row in a list or menu stays the quieter `bg-surface-2`.

### Dark islands (`.dark-island` / `.hero-dark`)

Some surfaces stay **dark in BOTH light and dark themes** on purpose — the person/family
detail hero (`.hero-dark`) and the photo lightbox. A neutral-dark surround makes a photo's
colour/contrast pop and cuts eye-strain (faded/sepia genealogy scans benefit most). These
are **not** wired to `prefers-color-scheme`.

`.dark-island` (in `@layer components`) is the shared, AA-tuned **white-on-dark FG token
scale** — it overrides `--color-text` (#fff), `--color-text-secondary/-muted`,
`--color-border`, `--color-date` and `--color-evidence` (light-on-dark hero amber #E9A94F),
`--color-card`,
`--color-surface-2` to values that clear WCAG AA on a dark surface. `.hero-dark` extends it
with the hero gradient/padding + its `--hero-*` placeholder scale; the lightbox
`EvidencePanel` adds `dark-island` for its panel text. Extenders supply only their own
surface background.

⚠️ Inside a dark island, reference the overridden `--color-*` name directly
(`var(--color-text-muted)`), **not** the `--text*` aliases — the aliases are substituted at
`:root` (light values) and inherit frozen, so they won't pick up the island's override.

⚠️ A native `<select>` on a dark island needs an **opaque** background — its option popup is
OS-drawn chrome that composites the translucent `--color-card` over the browser's own light
backdrop, giving white-on-near-white. `globals.css` fixes this with `.dark-island select` /
`.hero-dark select` rules (opaque bg + `color-scheme: dark`) that sit in **UNLAYERED** CSS,
immediately after the token block (its fill is `--color-hero-select`: `#172131` in light,
`#2A2320` in dark). That placement is load-bearing, not stylistic: Tailwind
v4's `@import "tailwindcss"` fixes the layer order to `theme, base, components, utilities`,
so `fieldClass()`'s own `bg-card`/`text-text` utilities beat anything in `@layer components`
no matter how specific the selector — only unlayered CSS, which outranks every layer, wins.
**Do not fold those rules into the adjacent `@layer components` block.** Nothing would catch
the regression: cascade layers aren't observable in happy-dom, and `contrast-tokens.test.ts`
doesn't cover `select`/`option`.

**Hero colour (#1246).** The hero gradient runs from `--color-hero-bg` mixed 70/30 with
`--color-hero-tint` (top-left) to `--color-hero-bg` mixed 90/10 with black. Light mode is
**ink navy** `#1F2B3D` with a slate-blue tint `#3E5677` (stops `#28384E` to `#1C2737`), so the
hero sits under the slate nav instead of clashing with it; `--shadow-hero` is cool to match.
Dark mode keeps the warm umber `#4a3d38`, the copper tint `#8a6034` and the warm shadow. The
island's text tokens are unchanged and clear AA on both light stops (white 11.9:1, island
amber 5.8:1, link 7.5:1 at worst; `contrast-tokens.test.ts`). Known gap, not a regression:
the gender avatar discs are 2.3 to 2.8:1 on the navy (1.9 to 2.3:1 on the old umber).

The lightbox background surfaces are dark **constants** (`--color-lightbox-panel` #16120f,
`-stage-top` #1a1512, `-stage-bottom` #0f0c0a, `-scrim` rgba(0,0,0,.5), `-sheet` #1d1815
— the mobile bottom sheet + tag chrome); the desktop
backdrop derives its 0.88-alpha scrim from the stage tokens via `color-mix(… , transparent)`.
- **Type scale:** 11/12/13/14/16/18/22/28/32/40px (#687): `text-xs` 11 (badge),
  `text-meta` 12 (row sub-lines, helper text, captions, bylines), `text-sm` 13 (ui),
  `text-base` 14 (body), `text-md` 16 (lead), `text-lg` 18, `text-xl` 22, `text-2xl` 28,
  `text-3xl` 32, `text-4xl` 40. Defined in `@theme`, so Tailwind's `text-*` utilities *are*
  the scale. Dates are `.date-mono` at 13 (12 in meta lines), weight 500 only. Labels, counts
  and captions stay Inter, with `tabular-nums` where digits align (#762). **System timestamps**
  (when a record was created or updated, case journal entries, the audit log's When column,
  backup times) are captions too: Inter with `tabular-nums`, never `.date-mono` or plain
  `font-mono`, so a line like "Opened Sep 12, 2026 · Updated Sep 27, 2026" reads in one voice
  (#917). Mono and amber stay reserved for genealogical dates. Citation chip numbers
  are the exception: `citeClass()` keeps them mono 11/600, read as key caps (#808, TY-1). `ds/no-arbitrary-font-size`
  blocks new `text-[Npx]` classes (existing ones are baselined in `eslint-suppressions.json`).
  Fonts: `--font-serif/-sans/-mono`.
- **Serif scope (#763):** Fraunces is for names as card titles, headings and the biography
  pull-quote. On the v1.1 desktop pages a person's name is also serif in rail rows and table
  name cells (`PersonIdentity nameStyle="serif"`, #55 C9); pickers, finders and chips stay Inter. Note bodies, controls (the tree switcher), pickers and chips are Inter. A
  section count "(2)" is Inter 12 muted after any heading (`SectionHeader`). In activity
  and audit rows only the record's name is 600 (`EntityLabelText`).
- **Heading ramp:** every heading is serif 600 except the sans eyebrow. Use the owner,
  not hand-typed sizes:

  | Recipe | Class | Size | Owner |
  |---|---|---|---|
  | Person portrait hero | `.title-hero` | 40 | Person hero only |
  | Record title | `.title-record` | 32 | `PageShell` `detail` (Family, Case, Place, Source heroes) |
  | Page title | `.title` | 28 | `PageShell` `list` (list and utility pages, a real `h1`) |
  | Dialog / form bar | `.title-dialog` | 22 | `DialogHeader`, `FormTopBarTitle` |
  | Section, workspace | `.section`, `.title-workspace` | 18 | `SectionHeader level="section"`, `PageShell` `workspace` |
  | Rail | `.rail-title` | 16 | `SectionHeader level="rail"` |
  | Eyebrow | `.eyebrow` | 11 caps, +0.08em, sans | `SectionHeader level="eyebrow"` |
  | Section label (v1.1 desktop) | `.eyebrow` + mono count | 11 caps, count beside it with no brackets ("LIFE EVENTS 8") | `SectionHeader level="label"` (h2; `as="h3"` in a rail) |

  Positive letter-spacing is only for uppercase eyebrows. Sentence text, helper text
  included, uses tracking 0 (TYPE-4).
- **Spacing:** `--space-1…8` (4/8/12/16/22/28/48, var()-only). Radii: `--radius-btn/card/panel/pill`
  (8/12/16/999px) live in `@theme` → use `rounded-btn`/`rounded-card`/`rounded-panel`/`rounded-pill`
  utilities. `--radius-sm/md` (4/6px) are var()-only (their names would shadow Tailwind's
  `rounded-sm/md`). Shadows: `--shadow-card`/`--shadow-card-hover`/`--shadow-hero`/`--shadow-nav(-scrolled)` are `@theme` utilities
  (`shadow-card`, `shadow-card-hover`, …); `--shadow-sm/md/lg` stay var()-only. Motion (#706): `--dur-fast` 120ms for hover and press, `--dur-base` 180ms for overlays entering, easing `--ease`. Tailwind `transition-*` utilities default to 120ms via `--default-transition-duration`, so a bare `transition-colors` is on the token. Every interactive element transitions; none snap.

### Token disposition (issue #80)

Every kit token is classified so none silently shadows a Tailwind utility:

| Tokens | Disposition |
|---|---|
| `--color-*` | `@theme` canonical (generate `bg-*`/`text-*`/`border-*`) |
| `--text-*` / `--leading-*` / `--tracking-*` | `@theme` **intentional override** of Tailwind's type scale (e.g. `text-base` = 14px) |
| `--radius-btn/card/panel/pill`, `--shadow-card/card-hover/hero/nav/nav-scrolled` | `@theme` canonical (non-colliding semantic names → real utilities) |
| `--radius-sm/md`, `--shadow-sm/md/lg` | `:root` **var()-only** — promoting them would shadow Tailwind's own `rounded-sm/md` / `shadow-sm/md/lg` |
| `--space-*`, `--ease`, `--dur-*`, `--weight-*` | `:root` var()-only |

**Rule for new tokens:** if a token name falls in a Tailwind namespace
(`--color/-font/-text/-leading/-tracking/-radius/-shadow/-ease`), either give it a
semantic name with no Tailwind default (promote to `@theme`) or keep it `:root` var()-only.
Never reuse a Tailwind default's name unless the override is deliberate and documented here.

## Rules
1. **Each hue has one job** (#688, revised by the audit §13 addendum, 2026-09-23):
   - **Slate** = chrome (the header; warm charcoal `#2B2622` in dark mode, #750). Never an action.
   - **Copper** = the main action. `bg-primary` is the main-action fill and the only coloured
     fill on a screen — exactly one per view; everything else is an outline or ghost. Copper
     is never text: it is too dark to read on a dark card.
   - **Ink** = navigation and focus. Navigational
     text links use `text-link` at **regular weight** with an underline on hover. Entity names
     in lists and tables (people, partners, children) stay body-text colour with a hover
     underline, so rows don't turn blue. Focus rings use `--color-focus`.
   - **Amber** = evidence only: dates read as facts, citation chips, complete sourcing
     (`--color-evidence*`, `--color-date`). Amber is never an action, link, selection, warning or emphasis colour
     (the `Button` `accent` variant is retired; the copper main action is a separate, redder
     token). Citation chips
     are the only clickable amber element. Dates render in JetBrains Mono — use the
     `.date-mono` class (renamed from the retired name-colliding `.text-date`, #331; it
     references `--font-jetbrains-mono` + `--color-date` directly). A date is **amber where it
     is a fact being read or checked** (life events, timelines, the person and family heroes
     and the phone name bar, vitals, citations, data checks, the tree sidebar's fields, photo
     dates, place records) and **muted where it only helps tell people apart** (relationship
     and family rows, lists and tables, pickers, search, face rows, tree cards, the
     descendants panel, the home resume card): add `.date-muted` (`--color-text-muted`, same
     mono and weight), or `tone="muted"` on `Lifespan` (#935, ADR 0034). The palette is
     fixed (no user picker).
   - Warnings are **orange** (`--color-warning-*`), so a warning never reads as "sourced".
     `--color-warning-bg` is only a text backing: it is ~1.03:1 on a dark card. Where a
     warning's shape must be seen, it gets a `--color-warning-edge` edge, at least 3:1 on
     card, card-alt and surface-2 in both themes (#899, #824). The warning badge is the one
     tag with an edge (a 1px ring on its pale fill, never a solid fill, so it can't read as
     the copper Save). The flagged timeline row keeps a faint tint and a 3px edge that carries
     the signal. Orange text is never the only marker: it is too close to evidence amber.
   - **Buttons** (#693, decision 4): always the `Button` primitive. Its sizes sit on
     control heights: sm 32, md 36 (`control-h` on a fine pointer) and lg 44 (touch).
     `Input`/`fieldClass` md 36 and sm 32 match, so a field, select and button in one row
     line up. Don't override a button's height or padding with `!px`/`!py` or inline styles.
     - **Create CTA:** use "Add" for records (person, partnership, source, repository,
       event, name) and "New" for workspaces (case, tree). Labels are sentence case, with
       lucide `Plus` passed through `icon` and never a typed "+". The page-level one is
       `variant="primary" size="md"` in the `PageShell` `actions` slot.
     - **One coloured fill per view:** secondary prompts (the backup nudge's
       "Back up now") are `outline`, and chrome states are shown with a dot, not a fill.
     - **Destructive:** the confirm that deletes uses `variant="danger"`. The way into it
       from an edit panel is `variant="danger-text"` (quiet red text, "Delete person…"),
       left in the action row, so the panel keeps Save as its one fill (#759); the lightbox
       and Options → Trees use the same quiet text (#770). Disabled is
       the shared dimmed state, with a `title` saying why. `block` replaces hand-rolled full-width bars,
       but a main action that waits on input (Preview import, Find relationship) is `md`, not
       `lg block`, so while disabled it stays quieter than the field that enables it (#770).
     - Native checkboxes, radios and ranges take `accent-color: var(--color-primary)`
       globally. Wrap a file input in an outline `Button`-styled label.
   - **Selects** (#770, CT-4): a form select is `SelectField` (the field chrome and
     heights of `Input`, the listbox look of `Select`, WAI-ARIA select-only combobox
     keys); a toolbar filter dropdown is `Select` (muted label + value). No native
     `<select>` outside the dark-island fallback rules in `globals.css`.
   - **Filter chips** (`FilterChip`, CT-2): one fixed 28px height on every list page; a
     touch sheet may raise it with `min-h-*`. An "Add …" chip passes lucide `Plus` through
     `icon`, never a typed "+". A filter toolbar has no visible "Filter" eyebrow.
   - **Tags** (`Badge`; audit §13 addendum, 2026-09-23) are small square tags (4px radius,
     ~20px, no hover), never placed in a row of controls, and **quiet**: a faint fill with
     no edge. The round shape belongs to clickable chips; `shape="pill"` is only for a
     dismissible filter token. Tag text is ≥4.5:1 on its own fill (`contrast-tokens.test.ts`);
     the earlier 2:1 shape-edge rule is retired.
     - **Tags are for states, not facts.** Sex and role are a muted text line
       (`Female · Mother`), never tags. Fewer tags per row is what lets them be quiet.
     - `neutral` (the default) and `new` use the quiet NEW fill. `outline` is plain muted
       text in the tag's slot, with no box (an inactive case, a separated family).
     - **Sourcing** on the person hero is a `SourcingMeter`: one evidence-amber segment per
       fact up to 8, then a continuous bar (96×8px), followed by its label ("2/4 facts
       sourced") and an optional ⓘ toggletip (`info`) saying what counts. The
       People and Families lists and the dashboard card show "X of Y" text instead ("3 of 4",
       or "3 of 4 facts sourced" where no column header names it), in evidence amber when
       complete and muted otherwise. Same rules as `countSourcedFacts`
       (birth, death, each event; sourced = cited at least once).
     - **Living status** is a `StatusMark`, not a tag: a small plain dot beside its word
       (green living, ink deceased, hollow ring unknown), or on an avatar's corner via
       `PersonAvatar status` with `statusLabel` when no word is visible (dashboard card).
       Not on the person-hero portrait: the corner fought its framed mat.
       Options → Accessibility → "Show status symbols" (off by default; `data-status-symbols`
       on `<html>`) enlarges the dot and adds `†` deceased (U+2020 in Inter) and `?` unknown
       (DIN 5008, ÖNORM A 1080, FamilySearch); living stays a plain dot. With symbols on,
       14px is the floor, or the dagger reads as a keyhole. Tree cards use `size="tree"`, a
       fixed 14px mark in every state (#736; anatomy in `tree-system.md`).
     - **Lifespans** render through `Lifespan`, in two formats only (#766, DV-1):
       `compact` "1889 – 1960" in lists, rails, chips and search, and `full`
       "b. Feb 15, 1889, Lumen — d. Feb 20, 1960, Sunvale" in heroes (person, family partner
       cards, the dashboard resume card). `tone` follows the amber rule above: `full` defaults
       to evidence amber and `compact` to muted, so a compact lifespan in a hero (the phone
       name bar) passes `tone="evidence"` and the resume card passes `tone="muted"` (#935, ADR
       0034; this reverses the earlier "amber in both, rails included", so #742's muted
       proposal stands for rows). A person with no death date
       reads "b. 1895" whether living or not (#861; "–living" and "Present" are never used),
       and someone marked deceased with no death date reads "1895 – ?". The compact dash has thin spaces (U+2009) on both sides in every
       compact lifespan, so a qualifier never runs into it ("1800 – <1812", not the arrow-like
       "1800–<1812"); the span is nowrap (#934). An age is not a lifespan:
       the person hero says "aged 71" once, and the portrait carries no date plate. Tables
       with separate Born and Died columns keep full dates, and tree cards keep their own
       canvas label.
     - **Statuses** are neutral or a status colour, never amber. For example, case
       `in_progress` is green and `closed` is neutral. A shared-tree banner is neutral.
       A case's status is always `CaseStatus` (#767, CL-2): a dot and a word, no box, on
       Home, the Cases list and the case header alike, so it never reads like the grey
       topic tags beside it. Choosing Closed asks "What did you conclude?" first
       (`CloseCaseDialog`, #801); the answer is the journal's final entry, marked
       Conclusion with a green rule. Status changes are one quiet `text-xs` line in the
       journal with a hollow dot, so they never read as the researcher's own notes.
     - **Citation chips** (`Cite`) keep the evidence fill with a hairline edge and a 1px
       key-cap shadow. They are the only clickable evidence element.
       A chip's number is a page-local footnote (1, 2, 3… by first appearance, from
       `numberSources`), shared with the page's Sources cited list; never a source ID.
       Sources cited is that footnote list: one row per source (its chip and title),
       linking to the source, with no fact rows and no "Manage all" action (ADR 0020, #780).
       On the v1.1 desktop person page each row adds one muted line: the source type and
       "Cited for" up to three facts, then "and N more" (ADR 0044); it stays one link.
       It shows only once the page cites something, tops the person and family rails
       (its list capped and scrolling), and at one column follows the timeline (#904).
       An editor's empty "+" on an unsourced fact always shows; a viewer's search pin and
       the "+" after a cited fact's chips reveal on row hover or focus, and the latter is
       desktop only (#896, #900).
2. **Never hardcode hex/Tailwind colors.** Use token-backed classes or `var()`.
3. **Use the primitives.** Import from `@/app/components/ui` (source of truth:
   `app/components/ui/*.tsx`):
   - **Core:** Button, Badge, StatusMark, SourcingMeter, Lifespan, Avatar, Cite, FilterChip, Input,
     Select, IconButton, Card, PersonCard, DataTable.
   - **List-page set (#175 Wave 1):** Pagination, EmptyState. Below md, list pages use the
     mobile list kit (#1058) and `CopperPill floating`; Fab, DetailField and ListSortBar were
     retired with the phone families list (#1064).
   - **Form set (#175 Wave 2):** FormTopBar, FormSection / FieldLabel (`FormField`), Banner.
     Banner tones are `error` / `warning` (both `role="alert"`), `success` and `info` (both
     `role="status"`). Reach for `info` — not `warning` — when nothing has gone wrong and
     nothing is required of the reader. Warnings are orange; amber stays reserved for evidence.
   - **Modal chrome (#175 Wave 4):** DialogHeader, DialogActions (+ Select audited there);
     **SegmentedControl** (Wave 5) and **Sheet** (Vaul bottom-sheet).
   - **Detail-surface set:** **PageShell (`detail`) / DetailHero / DetailRail / SectionHeader** (see the
     elevation-ladder note below).

   They own their styling as Tailwind utility strings — do NOT re-implement them or use the
   retiring bespoke classes (`.btn*`, `.card*`, `.badge-*`, `.section-card`) in new code. A
   lint guardrail warns on new bespoke-class usage (issue #80). The unlayered footgun set was
   dissolved in #331: `.pill`/`.input-field*`/`.link-view`/`.cite`/`.font-serif` were retired
   (usages moved to primitives, `fieldClass()`, `.serif`, or plain utilities and the rules
   deleted); `.text-date` was **renamed** to `.date-mono`; `.sidepanel`/`.note`/`.tab`/
   `.badge-info/-warning` were deleted (dead or single-use); and `.mono` was **layered** (it
   doesn't collide, so utilities can now override it). ✅ **Fonts footgun (#331 → fixed in #342):**
   next/font's `--font-fraunces`/`--font-inter`/`--font-jetbrains-mono` used to live on `<body>`,
   so the `@theme` aliases `--font-sans/-mono/-serif` computed empty at `:root` and the Tailwind
   `font-mono`/`font-serif` utilities rendered Inter, NOT their intended fonts. #342 moved the
   next/font variable classes to `<html>`; the vars now exist at `:root`, the aliases resolve, and
   `font-sans/-serif/-mono` correctly render Inter/Fraunces/JetBrains Mono. Still prefer the
   canonical `.serif`/`.mono`/`.date-mono` classes for serif/mono/date text so there's one blessed
   path (the guardrail keeps `font-serif` and the colour-only `text-date` out of new code).
   **Cyrillic serif (#703):** Fraunces has no Cyrillic, so the serif stack is
   `var(--font-fraunces), var(--font-literata)`: Literata draws only the glyphs Fraunces lacks.
   Fraunces runs with `adjustFontFallback: false`, because its metric fallback is an unranged
   `local()` face that would otherwise claim Cyrillic first. Write new serif stacks the same way.
   **The #175 endgame is settled: the ratchet stays on permanently and these classes persist**
   at the irreducible floor — a small residue (React-Flow canvas node-renderers + legitimately-
   inline cases) that can't be tokenized. There is **no** hard-error flip or final-sweep removal
   coming; treat them as permanently-frozen legacy aliases the ratchet keeps from growing.
   Two primitives are **app-level**, not under `ui/`, because they wrap app-specific pieces:
   **`PersonAvatar`** (`@/app/components/PersonAvatar`, wraps the focal-point `ProfileImage`) —
   the photo-or-initials avatar disc for list rows, cards, and person chips (#175 Wave 1) — and
   **`Timeline`** (`@/app/components/Timeline`), the medallion detail-page timeline.
4. **Citation/source chip is a fixed 18×18 square** (`citeClass()`'s default `square`
   mode in `ui/Cite` — the unlayered `.cite`/`.cite-square` classes are retired, #331) —
   a deliberate deviation from the kit's variable-width chip.
5. **Both themes.** Everything must read in light and dark; verify with Playwright.
6. **Colorblind-safe.** Pair color with shape/text (e.g. tree edge markers); never rely on
   red/green or blue/purple alone.
7. **Tablet (768–1023, #806).** The nav never drops to icons: from `md` to `lg` the labelled
   destinations take a second 40px row under the logo and controls (`--nav-h` grows to
   match, so sticky bars keep clearing it), and from `lg` they share one row. List tables hide
   their low-priority columns below `lg` (`hidden lg:table-cell`: Birthplace and Family role on
   People; Type and Place on Families) rather than squeezing names to one word per line, and
   they carry no fixed `min-w`. Below `lg`, `DataTable` headers may wrap to two lines and a
   cell's secondary note takes its own line, so neither sets the column's width. `scripts/page-shell-scan.mjs` checks both at 768.

## Detail-surface primitives & the 3-tier elevation ladder

Detail pages (person, family, places, …) are composed from five primitives (`PageShell` with `variant="detail"`, `DetailHero`, `DetailRail`, `DetailSection` and `SectionHeader`) so their polish is
inherited, not hand-rolled per surface. Each carries the props a real 3rd surface (places) needed,
so reach for these instead of re-deriving a shell/hero/rail:

- **`PageShell`** (#689) — every top-level route's shell and its single `<main>`: the
  parchment `--surface` background plus a content column per variant. There is no white
  header band.

  | Variant | Column | Title | Used by |
  |---|---|---|---|
  | `list` | 1240 with 28px gutters (the locked boards' column, shared with the top nav), centred | `title` prop → page title `h1` (`.title`, 28), with `subtitle` and an `actions` CTA slot top-right | People, Families, Library, Cases, Places, Audit, Options, utility pages |
  | `detail` | 1240 with 28px gutters, centred | the hero owns the record title (`.title-record`, 32; `.title-hero`, 40, on Person) | Person, Family, Case, Place, Source, and the add forms |
  | `workspace` | full width | the toolbar owns it (`.title-workspace`, 18), aligned with the header wordmark | Tree; any future full-screen canvas |

  `PAGE_COLUMN[variant]` exports the column classes so full-width chrome can align with the
  column: `FormTopBar column="detail"` puts the form title where the fields start, and the Tree
  toolbar uses `PAGE_COLUMN.workspace`. Library starts on `list`; moving it to `workspace` is a
  one-prop change. `PageShell` replaces the retired `DetailPage`.
  `surface="card"` swaps the parchment for an **open white page** (the desktop Library, #1152):
  no card around the body and no border around the table or grid, and the one raised object is
  the floating filter panel (`app/library/sections/LibraryPanel`: card-alt fill, `rounded-panel`,
  `--shadow-float`, sticky under the header). Its search is `Input tone="soft"`, a borderless
  field on the `--surface` fill.
  Phones (#807): `list` and `detail` share a 16px gutter (`detail` widens to 28 from `md`), and
  the Case page is the same `detail` page as on desktop, with its rail as an Evidence tab. Every
  add/edit form uses one phone chrome: `MobileFormHeader` (back chevron + serif title, in
  `topBar`) and `MobileFormFooter` (Cancel + Save, in `PageShell`'s `footer` slot), with the
  desktop `FormTopBar` hidden below `md` (`max-md:hidden`). A page with a floating action button
  pads its content column below `md` (`contentClassName="max-md:pb-24"`) so the last row
  clears it.
- **`DetailHero`** — the tier-1 hero region, in two recipes (#765, LY-4). A slot: the domain
  layout is passed in as children.
  - **Portrait hero** (`tone="dark"`): the gradient island (`.hero-dark`) for records with a
    face: Person and Family.
  - **Record hero** (`tone="light"`): a white `Card` header for records without a portrait:
    Case and Place, and the Source modal's header paints the same rhythm. Top to bottom: an
    optional eyebrow row (status or type, `mb-2`), the `.title-record` title, then muted
    metadata (`text-sm`). No breadcrumb: Place shows its enclosing places as a "Part of" line
    instead, and app-wide breadcrumbs are #732's call.

  Edit is **`HeroEditButton`** on both: an outline button reading "Edit", no icon, top-right
  (#694, LAY-3). The v1.1 desktop person page has no Edit button: Edit person,
  Descendants and Delete person sit in the band's one ⋯ menu (#49). On a dark island every outline is the same weight, drawn with
  `--color-control-border` (55% white).
- **`DetailRail`** — the right column, one recipe everywhere (Person, Family, Case, Place,
  Home; #764): shadowless hairline cards on the page background (via `.person-rail > .card`),
  each with its heading inside (`SectionHeader level="rail"`, through the card's `header`
  prop or as its first child). No grey `--surface-2` well: in dark mode a well reads darker
  than the page. The `unified` and `recessed` variants are gone.
- **`DetailSection`** — a main-column section on a detail page: one card with its
  `SectionHeader` inside, so the left column matches the rail. The panel inside keeps its own
  `.card`; `.detail-section > .card` folds it into the section card.
- **`SectionHeader`** — the "heading (count) … action" row + optional subtitle, `level`
  `section` (h2, serif 18), `rail` (h3, serif 16) or `eyebrow` (h3, sans 11 caps). Every
  rail card's header is `level="rail"`: title left, action right, and always a hairline
  under it (#694, LAY-4). Eyebrow labels use `.eyebrow`. The class was renamed from
  `.overline` because Tailwind's `overline` utility drew a stray rule over it. It is the
  only way to render these headings (#687).

### v1.1 desktop kit (#55)

The v1.1 desktop pages (person, family, home, places, Research case, the list and Tools
pages) are built from a second set of shared parts. They extend the primitives above. Every
part is shown, in each role and both themes, on the dev-only **`/dev/components`** page (404
in production builds, like `/a11y-harness`). The contrast and focus scans cover that page.
Phones don't use the kit: they keep `RecordBand` and their panes.

- **`CoverBand`** is the band at the top of a v1.1 page. It is a `.hero-dark` island, so its
  colours come only from the hero tokens (ink navy in light mode, umber in dark). It has an
  eyebrow, the page's `h1` and a meta line, in three variants:
  - `cover`: 144px. With `portrait`, a 4:3 portrait (320px, 220px below 1024) hangs over the
    band's lower edge, and `lead` sits beside it. Opening the lead text grows the page
    downward and never moves the portrait.
  - `short`: the list and Tools pages. It uses the same gradient as `cover`.
  - `flat`: no gradient. Only a place with no pin uses it.

  The optional **actions slot** sits top-right. It holds the ⋯ `RecordMenu` on Person, Family
  and Place, and "Answer and close" plus ⋯ on a Research case. Home, the list pages and the
  Tools pages leave it empty; their main button lives in the toolbar.
- **`LeadText`**: serif lead text clamped to three lines. **Read all ⌄** shows only when the
  text overflows and turns into Show less. The same label is used everywhere, including the
  tree panel's preferred note. An optional Edit link follows it.
- **`DetailBody`** holds the body under the band:
  - an optional sticky section index ("On this page"), shown from 1180px;
  - one main column, with sections separated by 40px of space and no dividers;
  - a right rail.

  From 768px the rail stays beside the main column, behind a vertical hairline (280px of
  content from 1024, 56px from the main column), so it never drops to the bottom. `divided`
  draws the edge-to-edge hairline that closes the top section (person, family, home). Main
  sections are open on the parchment: a panel's own `.card` loses its fill and border there.
  The section index is a list on a 1px left rule; the current entry darkens its stretch.
- **`CoverBand`** runs edge to edge under the top bar (no radius, no shadow); its contents sit
  on the page column. The person portrait hangs 104px over its foot with a parchment border.
  The place map cover bleeds the same way.
- **`DetailRail look="open"`** is the v1.1 rail: no cards and no bars, with sections separated
  by 36px of space only. Its headings are `SectionHeader level="label" as="h3"`. The
  default `cards` look stays for the pages that haven't moved yet.
- **`ActionLink`** applies the link glyph rule once:
  - `action` (›) acts on this page;
  - `leave` (↗) leaves the page or opens a full-screen view (the default with an `href`);
  - `expand` (⌄) expands in place, with `aria-expanded`.

  Header actions such as "Full history ↗" use it in `SectionHeader`'s `action` slot, never
  under the list.
- **`RecordMenu`** is the one ⋯ menu for a record. It is a `role="menu"` popover with
  `useMenuKeyboard`, portalled to `<body>` so that it is a white page menu even when opened
  from a band.
  - `tone="island"` on a band, `surface` elsewhere.
  - `reveal="hover"` hides the trigger until its row is hovered or focused (journal entries).
  - A disabled item stays visible with its reason under the label.
  - Viewers pass no items and get no ⋯ at all. Contributors' menus leave out deletes.
- **`OpenInTreeRow`**: "Open in tree · Starts from <first name> ↗", a bordered white row that
  opens `/tree?rootId=…`. It sits at the top of the person and family rails and in Home's
  pick-up card. It says "Starts from", not "Centred on", because the tree doesn't always put
  its root in the middle.
- **`IconTile`**: the outlined icon tile (a muted 1px edge, a secondary icon on the card
  fill). It replaces the grey `--surface-2` tile, which failed contrast. Open in tree, Quick
  add and the Tools menu use it.
- **`TileLink`**: an `IconTile` over a short label, the whole tile one link. Home's Quick add
  (New person, New family, New case) uses it.

- **Rows** (part 2 of #55):
  - **`PersonRow`** is `PersonIdentity` (which gained `role` and `nameStyle`) inside a link,
    with its hover actions beside the link, never inside it: Edit for contributors and
    editors, and unlink (`Link2Off`) for editors. The role tag ("foster child",
    "half-sibling", "stepson") is muted text after the years, not a badge. It is used for
    rail partners, children and siblings, Home's Recently edited, form child rows and finder
    results.
  - **`FamilyRecordRow`** is the phone's B2 family row, promoted to `ui/` and shared by the
    phone Family tab and the desktop rails. On desktop (`density="desktop"`) it has no ↗ and a
    hover unlink. Its title wraps rather than being cut off (#48).
  - **`SuggestionRow`** is a plus row that acts in one click and gives a one-line reason.
  - **`EmptySlot`** is the dashed "Partner unknown · Find or add someone" button. Its dashed
    edge is `--color-drop-edge`.
  - A **`Timeline` row with `href`** is a relative's event shown read-only (a child's birth on
    the family page). Its title links to the relative with ↗, and it takes no row actions.

- **Overlays** (part 3 of #55):
  - **`PersonFinder`** is the one way to pick a person. It is a popover (`role="dialog"`)
    anchored under the link or `EmptySlot` that opens it, on top of the page or dialog and
    never replacing what is under it. It has a search box (a combobox over a listbox with
    `aria-activedescendant`), then "Create “…” as a new person" first once something is
    typed, then matches. Before anyone types it lists `suggestions`, each with a reason.
    `excludeIds` leaves out people already in place. With `multiple`, rows take checkboxes and
    the footer adds them together ("Add 2 children"). Escape closes it without reaching an
    outer dialog and returns focus to the trigger; tabbing out closes it. The trigger is a
    render prop: spread its props onto an `ActionLink`, `EmptySlot` or button. Used by Find
    their parents, Find a partner, Add children, Add child, Partner unknown and Add family.
  - **`InlinePanel`** is the inline edit panel: it opens in place under its row, focuses its
    first field and ends in `EditorActions size="sm"`, with Delete as red text on the left
    for editors. Escape and navigation ask before dropping unsaved changes. The opener keeps
    `useEditorFocusReturn`. Event, name, note, biography, child relationship, Move and Edit
    family panels are built on it.
  - **`ParentRelationshipSelects`** is one select per partner in the stored vocabulary
    (ADR 0027). With one partner there is one select and it sets both slots.
  - **`useUndoRemoval`** is the one Undo: an unlink or removal shows a toast with Undo, which
    reverts the change's own audit entries. Pass several changes when one action made
    several; one Undo reverts them all. Desktop unlinks use it instead of a confirm dialog.

- **Dialogs and lists** (part 4 of #55):
  - **`FormDialog`** is the 640px form dialog over the page it was opened from: a title
    with ×, a scrolling body, and a footer bar with an optional left slot ("Save and add
    another") and the right slot (Cancel, then the one copper main action). Opening it
    focuses the first field. With `dirty`, ×, Cancel (the footer gets the guarded close),
    Escape, the backdrop and navigation all ask before dropping changes; `busy` blocks
    closing while saving. The quick-add forms, New lead, "Search the map again" and
    Import's preflight use it.
  - **`FormBlock`** is a form section: an eyebrow heading with an optional action on the
    right ("Cite ›"), separated by space, never boxed.
  - **`FieldColumns`** + **`FieldColumn`** put two facts side by side (Born | Died). An
    `inactive` column is a disabled fieldset whose fields take the surface fill, with its
    reason in the heading row in place of the action, so both columns stay level. The
    heading and reason are muted text, which still meets AA.
  - **`RecordBlock`** is a linked person in a form: a tinted block with the × right after
    the name, then that link's own fields (relationship selects, the marriage date).
  - **`WarningLine`** is the one-line form warning ("These two already have a family"). It
    uses the orange warning tokens with a left edge (C11), never amber.
  - **`ListToolbar`** is the list page toolbar: search (`/` focuses it), then chips with
    counts and selects, then the one copper main button on the right (C5).
  - **`TablePanel`** is the white panel that holds the `DataTable`, with the pager in its
    footer ("1–25 of 412" and ‹ ›), hidden on one page.

These primitives define the chrome of a **standalone entity-detail page**; they do not require
the domain content inside them to share a state model. A light `DetailHero`, for example, may slot
view, edit, or draft/autosave content while continuing to own the surface and elevation.
Responsive presentations may deliberately substitute another composition when the information
architecture changes rather than merely reflows — Cases uses a full-bleed pinned header and
Journal/Evidence tabs on mobile instead of shrinking its desktop hero + rail.

Embedded master-detail previews and workbenches are not standalone detail pages. In particular,
Places Explore keeps its map well plus one raised drill/preview panel: the drill controls the
selection, the preview is hidden in favour of full-page navigation on mobile, and the two panes
share a height contract. Do not nest `PageShell`, `DetailHero`, or `DetailRail` inside that panel
solely for visual consistency. Shared primitives remain appropriate for an individual element only
when its semantics and geometry match without changing that composed hierarchy.

**The 3-tier elevation ladder** — reach for these primitives instead of hand-writing shadows
or `--surface-2` on a new detail surface. No new tokens were minted; the values already exist:

| Tier | Surface | Value |
|---|---|---|
| 1 (highest) | `DetailHero` (`dark` island / `light` Card) | `--shadow-hero` / `--shadow-card` |
| 2 (mid) | `Card` content cards | `--shadow-card` |
| 3 (quietest) | `DetailRail` cards | shadowless hairline |

**Elevation rules** (#753, from the 2026-09-23 sweep §10). Every shadow is warm and comes
from a token; don't use Tailwind's grey `shadow-md/xl` on app surfaces.

| State | Token / rule | Used by |
|---|---|---|
| Card at rest | `--shadow-card` | content cards (tier 2) |
| Card pointed at | `--shadow-card-hover`, `translateY(-2px)`, neutral `--color-text-muted` edge; the same on keyboard focus (also focus on a wrapping link); no translate under reduced motion | `Card interactive` (`.card-interactive`) |
| Hero | `--shadow-hero` (toned down by half) | person/family hero, home welcome card |
| Header | `--shadow-nav` hairline at rest, `--shadow-nav-scrolled` once the document scrolls | `TopRail` |
| Main action | `.btn-glow`: a small copper glow and 1px hover lift, never on a disabled button | `Button` primary |
| Pressed | down 1px onto its own shadow, shadow removed | Cite chips |
| Rows | background tint only, no lift | `.row-lift`, table rows |
| Floating panel | `--shadow-float`, the only raised object on an open page | Library filter panel (#1152) |

Overlays (menus, popovers, modals) keep their own shadows. The timeline medallion, portrait
frame and photo-grid zoom are deliberate depth and stay.

Hero name/date typography is owned once in `app/people/view/heroParts.tsx` (`HeroName`) and the
family hero layout in `FamilyHeroContent`, so the real hero and the loading-paint hero can't
drift.

## Interaction states (definition of done for a surface)
Applies when a surface is **done / under review** — not during throwaway spikes. Every
interactive element ships its full set of states, not just the click:
1. **Hover** — a visible change (bg wash `var(--color-hover-surface)`, border/opacity, or
   an underline on links). List rows that map to a canvas (e.g. people row ↔ face box) **cross-highlight**.
2. **Focus** — one ring everywhere (#690): a 2px `--color-focus` outline at a 2px offset
   (`--focus-ring-width` / `--focus-ring-offset`). A base `:focus-visible` rule gives it to
   every focusable element; primitives and hand-rolled controls add the `focus-ring`
   utility. Use `focus-ring-inset` for full-width rows in a clipped (`overflow-hidden`)
   popover. Don't hand-roll `outline-none ring-2 ring-primary`. On the slate top nav the
   ring turns white, and inside its `role="menu"`/`role="dialog"` popovers it's ink again.
   Never `outline:none` without a replacement. `npm run test:focus:scan` checks this in
   the browser.
   - **Return focus:** when an overlay, inline panel or edit mode closes by keyboard or
     on completion, focus goes back to its trigger. `Modal`/`useFocusTrap` do this
     themselves. For a trigger that unmounts while its panel is open, use
     `useReturnFocus(open)` (`app/hooks/`). When the trigger is a row action that
     re-mounts (a timeline or children row swapped for its editor), use
     `useEditorFocusReturn(open, scope)`: call its `remember()` in the opener, and on
     close focus finds the Edit again by `data-focus-id` or accessible name, or falls
     back to the `tabIndex={-1}` section (#798). A pointer dismissal leaves focus where
     the pointer went.
   - **Inline editors (#798):** opening one focuses its first field
     (`useFocusFirstField`; `HeroEditorPanel` does it itself). Escape cancels through
     `escapeToCancel`, which leaves an Escape to an open list, menu or dialog inside the
     editor; a hero editor's Escape asks first when `dirty`. A popover dialog closes when
     Tab leaves its first or last control, returning focus to its trigger.
   - **Skip link:** `SkipLink` in the root layout is the first Tab stop on every page and
     targets `PageShell`'s `<main id="main-content" tabIndex={-1}>`. The focus scan
     checks it.
   - **Menus:** a popover of actions or choices is `role="menu"` with `menuitem` /
     `menuitemradio` children (`tabIndex={-1}`), and uses `useMenuKeyboard`
     (`app/components/ui/`) for arrows, Home/End, and Escape/Tab back to the trigger.
     The trigger gets `aria-haspopup="menu"` and `aria-expanded`.
3. **Cursor / affordance** — the pointer and a "this is clickable" cue (don't rely on
   color alone). A base rule gives every enabled `button`, `[role=button]`, `summary` and
   `label[for]` the pointer, and eases link and button colour changes on `--dur-fast`
   (#706). Don't set `cursor-text` on a button that opens an editor.
4. **Tooltip + label on icon-only controls** — both a `title` (hover tooltip) **and**
   `aria-label`. Visible-text buttons need neither extra.
5. **Disabled** — a real disabled state (dimmed + `disabled`/`aria-disabled`), not just inert.
6. **Touch** — **≥44px** hit target on mobile (the phone segmented control is the one
   exception; see Mobile).

Enforcement: this checklist + the code-review rubric (not a hook — hover/cursor/tooltip
aren't statically lintable). `eslint-plugin-jsx-a11y` covers the automatable slice
(aria/alt/role). Prototype freely; meet the checklist before calling a surface done.

## Editing patterns (#706, INT-5; #759, #760)
A detail page edits in exactly two ways: the record's **identity** in its hero, and its
**collections** (events, children, names, notes) row by row.

1. **Record identity** (`HeroEditorPanel`). The hero becomes an edit panel in place;
   the title stays where it is. Fields sit in `HeroEditorRow`s, choices are
   `SegmentedControl`s with Unknown first, and the action row is fixed: the delete
   as `danger-text` ("Delete person…", opening the confirm) on the left, a ghost
   **Cancel** and then **Save changes** (the panel's one coloured fill) on the right, which is
   `EditorActions` (#797) and ends every record editor, hero or inline. While it is
   open the page body carries `.edit-dimmed` plus `inert`, so Cancel plainly cancels
   only the hero. Family uses it; case, place and source move onto it when next
   reworked. The v1.1 desktop person page (#49) edits its identity in a `FormDialog`
   from the ⋯ menu instead: first and last name, sex and living status. Birth and
   death are edited on their timeline rows only, and the dialog shows them as
   read-only lines with "Edit in timeline ›" (this supersedes the #795 hero editor,
   which repeated them). With a death recorded, Living or Unknown asks first whether
   to delete it.
2. **Collections** (`RowActions`, `AddRow`, `.inline-panel`). Each row shows **Edit**
   and **Delete** (or **Remove**, when it only unlinks) on hover or focus, always on
   touch; the row carries `row-host` (a timeline row is already a host). Name each
   action for its row ("Edit Kid One", "Delete note: …"). The list ends with a
   trailing **Add …** row, and Add or Edit opens one `.inline-panel` in place: a
   card-alt panel with an inset bar, no dashed border and no eyebrow, ending in
   `EditorActions` at `sm`. One panel is open at a time. `compact` drops the visible
   labels in a narrow rail (notes). Below `md` the event editor opens in a `Sheet`
   instead (#797, M-2), with the date's Kind menu stacked above the date and the notes
   rail flattened (`.sheet-flat`) so no card nests inside the sheet. On the v1.1 desktop
   timelines (person and family) the row itself opens its editor (`LedgerItem.onOpen`:
   the whole row is the pointer target, the title the keyboard control) and Delete
   lives in the editor. The event panel is headed ("Add occupation", "Edit residence"),
   a new event starts on grouped type chips, and date and place sit side by side.
3. **One date** (`InlineDateEditor`, #832). Where the fix is only ever a date (the
   Data checks detail), the row becomes a date-only editor: the field labelled with
   whose date it is, `DateInput` with the date box focused, and Save and Cancel beside
   it that wrap below on a narrow pane. Enter saves the date as typed, without waiting
   for blur, and Escape cancels. It takes a one-line `hint` under the field (whether
   the date clears the problem). Its trigger is an always-visible outline **Edit date**
   with a pencil, not copper, since two can show at once. Below 480px of its container
   (`.dc-timeline`), it becomes a 44px pencil with the label visually hidden, keeping
   the full name ("Edit date: Mary Ellen died") and a `title`.
4. **Dates to check on a record page** (#833). A timeline row whose date a data check
   would have you fix (only that row, never the other dates involved or a derived row)
   gets the warning tint (`flagged`) and an always-visible **Check this date** mark
   on the title line (`mark`): a 26px, 8px-radius warning-outlined button, not a pill,
   named with the problem. It discloses a panel under the row (`callout`) with the
   kind, the problem, **Edit date** (the row's own editor) and an ink **Open in Data
   checks ›**; Escape closes it and returns focus to the mark. A record's count is the
   shared `DatesToCheckFlag`: a static warning pill, then an ink **Review ›** link.
   The pill is never the link. On the family hero it takes the island's dark warning
   pair in both themes. Confirmed unlikely checks get no mark.
5. **A list and its detail on phones** (#831). From 768 up the detail sits beside the list
   (the Places Explore layout). Below 768 the list is full width, and an entry opens its detail
   full screen with a "‹ Back to list" link at the top and a **Previous / Next** bar fixed to
   the bottom: 44px outline buttons either side of "N of M", clear of the safe area (the Faces
   toolbar's recipe). The detail pads its foot so the bar never covers its last control.

Outside a detail page:

| Pattern | Use it for | Examples |
|---|---|---|
| **Modal** | A short create or edit started from somewhere else, where the page must stay put | New tree, attach source, quick source edit, confirmations |
| **Separate route** | Long, multi-section forms | Person full edit, add person, add partnership |

- Records use an explicit **Save / Cancel**, and Escape cancels. Autosave is only for
  free text inside a workspace (case journal and notes). It reports "Saving…" and
  "Saved" once there is something to save, never a promise before (#801, CS-4).
- Leaving any of these returns focus to the control that opened it (see Interaction
  states → Focus).
- Source editing (a modal that then opens a page) is the known outlier. Move it onto one
  of these patterns when that surface is next reworked.
- Photos (#802): an upload ends in an optional **Describe these photos** step (title,
  date, people; Skip writes nothing). A date read from the photo's own metadata is only
  a suggestion, labelled as such, because a scan carries the day it was digitised.
- A family photo appears on a person's page only when that person is tagged in it or
  linked to it directly. Attaching a photo to a family doesn't copy it onto both
  partners' pages: a family attachment says the photo is about the family (a house,
  a marriage record), not that each partner is in it. Tagging faces is how a photo
  reaches a person, and the family gallery already gathers photos tagging two members.

## Mobile (below `md`) (#1056)
The phone style the redesigned mobile screens share (umbrella #1067, foundation #1060). It was
approved from a review page with live 390px specimens in both themes. Each screen's own
details live in its locked mockup; this section holds only what two or more screens share.
Desktop and tablet don't change. Pages not yet redesigned keep the phone chrome described
under `PageShell` above until their screen issue lands.

**Layout**
- No cards. A phone screen is one column of full-width sections on `--surface`, split by
  1px `--border` hairlines. Only sheets, the toast and confirms float.
- 16px gutter (`--space-4`, `PageShell`'s phone gutter). Strips (vitals, media grid, rows)
  bleed to both edges and pad themselves back to 16.
- A hero or dark band runs up under the status bar and pads by `--sat`. The last row and any
  floating pill clear `env(safe-area-inset-bottom)`.
- Section headings are the eyebrow (`SectionHeader level="eyebrow"`), with a count in mono
  beside it. No serif section titles inside a phone screen.

**Heroes** (the hero gradient, dark in both themes: `.hero-dark` / `.dark-island`)
- Person and family: a 4:3 photo hero with only the portrait, the name (serif 28) and one
  life line. A two-stop scrim darkens the top for the glass buttons and the bottom for the
  name. Without a portrait, the initials sit on the gender gradient.
- Home: a compact band (menu, "Heirloom", Tree and search on one row; eyebrow, tree name and
  counts below). Lists: one dark row (menu, the page name in serif 22, search) that never
  scrolls away.
- A slim bar fades in once the hero has scrolled under it: thumbnail, name by the cascade
  rule, years in amber mono, the same actions as plain icons. 180ms, none with reduced motion.
  In light mode it is solid slate 700 (`--color-slim-bar`, #1099), a step under the nav's
  slate; in dark mode it keeps the hero gradient. The home band and the list headers take
  the same `mp-slim-bar` fill. Safari 26 tints a tab's status bar from the fixed or sticky
  element under the top edge, so one fixed `.top-edge-tint` strip (12px, opacity 0.12,
  `--color-slim-bar-solid`, rendered once in the root layout) owns that edge on every phone
  screen with its own header: the bar stays one colour while heroes scroll, the slim bar
  fades and the page bounces.
- Dates on the island use the hero amber `#E9A94F`.
- Records without a photo (source, repository, case) use `RecordBand` (`app/components/mobile/RecordBand.tsx`, #1119): Back and the pencil as glass buttons, an eyebrow, the title in serif 24 and one line under it, slate in light mode like the slim bar, with the same slim bar once it scrolls away.
- Vitals strip (person, family): three cells under the hero. Years are mono 16 in amber; Age
  is mono 16 in the text colour. Tapping a cell opens its panel right under the strip, and
  tapping again closes it; one panel at a time. The open cell and its panel share the sunken
  `--surface-2` fill and a small caret flips. Panel rows are quiet (label left, value right,
  no chevrons, a pressed highlight only); date and place open the event sheet with that field
  focused. The Died panel ends with the living-status switcher.

**Controls.** Three kinds, plus small text links. No boxed buttons on a phone screen.
- **Glass buttons**, only on photos and dark bands: a 34px circle for an icon, a 34px pill
  for icon and word (Tree). Black 38% fill, `--color-glass-border` hairline. 44px hit area.
- **Full-width action rows** for every other action: a 34px icon tile, the label in ink 600,
  a chevron. A count or a consequence may sit under the label. They replace `RowActions` and
  boxed buttons below `md`.
- **One copper pill per screen, at most** (`Button variant="primary"`, pill shape): full width
  inside content, or floating bottom right on a list, hiding while you scroll down. It
  replaces the round `Fab`. A sheet's Save is its copper pill.
- **Text links** for small actions that belong to one group: "Cite ›" at the right of a group
  heading, "Remove" on a picked person. Ink, 13 medium (desktop links are regular), padded to
  a 44px hit. A chevron only when the link opens a sheet. Desktop's "+" after a fact becomes
  the word "Cite ›", which opens `CiteFactSheet`.
- **Citation chips** keep the desktop rule: page-local footnote numbers, never a count. On a
  form group they sit after the group title, never beside "Cite ›".
- **Selections** use the selected fill, as on desktop: `SegmentedControl` and `FilterChip`, an
  active chip with ✕. Chips are drawn at 34px with a 44px hit. A segmented control is 40px
  overall on phones (32px segments): its segments sit edge to edge and are wide, so it is the
  one exception to the 44px floor.
- **Red** is only for the delete confirm's pill and a Delete row's text.
- **Switches** (`SwitchRow`, #1122) are for a setting that takes effect at once (Options):
  the whole row toggles, ink fill when on. Checkboxes stay for picking several things before
  one action. A setting with a value is a row showing it (`MobileRow value`) that opens a
  small sheet of radio rows.

**Rows.** The end of a row says what a tap does.
- Content rows (an event, a name, a note, a pick in a sheet) have no end icon; they highlight
  with `--surface-2` while pressed, and for editors open their sheet.
- Chevron › for an action or next step that stays on the page (a sheet or panel). ↗ for
  leaving the page or opening the full-screen viewer. List pages are the exception: every row
  opens a page, so none carries ↗.
- A plus for a one-tap suggestion; checkboxes only when picking several before one bulk action.
- Each editable list ends in an "Add …" row (`AddRow`). Viewers don't see it.
- A second line only for a count, a consequence or a person's own facts. Person rows use a
  40px avatar in lists, 36 in sections, and the name in serif 16.

**Type.** The app scale only (no `text-[Npx]`). Eyebrow Inter 11 caps; names Fraunces 600 at
28 (hero), 22 (list header), 16 (rows and slim bar); body Inter 14; sub-lines and hints 12;
dates `.date-mono`, 12 in sub-lines and 16 in the vitals strip. Text fields are 16 so iOS
doesn't zoom on focus.
- **Cascade name rule** for the slim bar's one line: first and last name at 16; if that
  doesn't fit, the whole name at 13; if that still doesn't fit, 16 with the given name cut and
  the surname kept whole (built with the slim bar, #1046).

**Tabs.** Record pages use sticky underline tabs (Inter 13, the selected one ink 600 with a 2px
ink rule) that stick under the slim bar and scroll sideways if they don't fit. A count follows
in muted mono 11 at regular weight, even on the selected tab; a zero count is left out.
Once the hero has scrolled away, each tab opens where it was left (its top the first time)
and the tabs stay stuck; with the hero in view, switching leaves the page where it is.

**List pages** follow the locked people list (kit #1058): the one-row header; a filter field
("Filter by name or place") and chips that slide away on scroll down and return on a flick up,
staying while the field has focus; the count left and the current sort right, opening a Sort
by sheet with every desktop column and an order switch; dividers that follow the sort; pages of
50 with a full-width Previous / Next row. The header's search button searches the whole tree,
full screen.

**Sheets** (`Sheet`, Vaul)
- Every edit happens in a sheet. Typing sheets are full height, 40px below the top, above the
  keyboard. Header: Cancel, the title, Save as the copper pill, dim until something changes.
  This retires `MobileFormFooter` on the redesigned screens.
- Return moves to the next field. A date is one row, Kind menu · date · About, as on the
  desktop (`DateInput touch`, ADR 0048); a range's second box takes its own row with "and"/"to"
  under the menu. Places suggest the tree's places as rows.
- With unsaved changes, every way out (Cancel, Back, tapping outside, pulling down) springs
  back and asks "Discard your changes?". No drafts are kept.
- Three deep at most. A sheet opened from a sheet sits on top, the one below shrinks and dims,
  and pulling down closes only the top one.
- Small sheets (sort, pickers, menus) fit their content, close with ✕ and apply at once.
- Delete is the last row of an edit sheet, in red. It asks once, then offers Undo.

**Feedback**
- The Undo toast is a bottom card: 6 seconds with a time bar, paused while touched, swiped
  away to dismiss, one at a time. It is inverted (dark card in light mode, light in dark) with
  its own `--color-toast-bg` / `-fg` / `-action` tokens. Its Undo is light copper text on the
  dark card, the one named exception to "copper is never text". Plain confirmations use the
  same card with a tick and no Undo, for 2 seconds. `Toast.tsx` keeps sonner top-centre on
  pages not yet redesigned, which still have bottom action bars.
- The delete confirm is a card rising from the bottom that names what goes and what stays,
  with a red pill and an ink "Keep" under it.
- After an edit, the changed row flashes amber once.

**Roles.** One layout for every role; only affordances change. Contributors get the editor
view without Delete rows and without Undo (the audit revert refuses them). Viewers get no
pencil, Add rows, copper pill or "No source" prompts; content rows stop being tappable and
empty sections drop out. Citation chips still open the source.

**Touch.** Every target is at least 44 by 44 (Interaction states rule 6), the segmented
control aside. Swiping the page sideways changes tab once the drag passes 28% of the width; a
mostly vertical drag scrolls. A drag starting in the left 24px never changes tab, so the iOS
edge swipe always goes Back; chips, tabs, inputs and maps don't start a swipe either, and nor
does a drag on a pinched-in page. A swiped-to tab is announced in a polite live region. No swipe
to delete. Pulling a sheet down by its handle or header closes it. An open sheet (or the photo
viewer) adds one history step on the same URL, so the phone's Back closes the top sheet first,
with the discard prompt when it has changes, even on a page opened directly. Citation chips keep
their 18px face with a 44px-tall tap and 7px between neighbours.
`npm run test:mobile:scan` (part of `test:a11y`) checks the person page at 390px.

**App top bar.** Screens with their own dark header (home, lists, forms) and the person and
family pages, whose hero is the header (#1099), hide `TopRail`.

## Verification invariants (definition of done for a surface)
A surface is **not done** until verification produces *evidence* — an asserted, measurable
invariant — not a captured screenshot. A screenshot proves a render happened; it does **not**
prove the content is visible or correctly placed. (PR #87: round 3 was signed off with a
"Playwright mobile 390px" step, yet every mobile image rendered 0×0 — the screenshot was
taken, nothing asserted the image had non-zero size, and the regression shipped to user
testing.) For any *"is it actually visible / correctly placed"* property, assert it via
`browser_evaluate`:
1. **Visible** — the element's bounding rect has `width > 0 && height > 0` (catches collapsed
   flex stages, `max-height:0` caps, `display:none` parents). Screenshot-eyeballing does not.
2. **Placed** — positioned elements (popovers, tooltips, anchored menus) assert geometry, e.g.
   card horizontal center ≈ anchor center (±2px) — not "looks centered."
3. **Bounded** — images/media stay within the viewport box on both axes after a resize
   (`ResizeObserver`-driven caps): assert rect ≤ container, and **never** 0.

Real-device matrix — verify mobile-first surfaces on **real-device emulation early and
batched**, not desktop Chrome resized late:
- **Mobile** — a device profile (touch, true viewport, safe-area), at least **390×844**.
  Desktop-resized-to-390 (`DESKTOP_MODE` Playwright) hides collapsed-flex / safe-area / drawer-
  snap bugs — exactly the class that drove PR #87's four polish rounds.
- **Desktop** — at least one `md` width (e.g. 800) and one `lg+` width (e.g. 1400) when a
  surface is responsive across those breakpoints.
- **Deployment modes** — confirm the surface works in all three: local/static PGlite
  (`DATA_MODE==='local'`), desktop (`DESKTOP_MODE`), and authenticated web.

Behavior-heavy primitives (Embla/synced carousels, Vaul snap sheets, drag/focus-trap): do not
let a plan prescribe exact fix code until the mechanism is proven in a throwaway spike —
prescribe the **outcome + the assertion** instead. (PR #87 shipped an Embla-synced thumbnail
fix that "never scrolled," then reverted it — see issue #88.)

## Component contract (props)
See `app/components/ui/*.tsx`. Buttons: variant primary|tonal|outline|ghost|success|danger|danger-text,
size sm|md|lg, `icon`, `block`. Badge tone neutral|outline|evidence|warning|green|blue|red|violet|new,
shape tag (default) | pill (dismissible filter tokens only). StatusMark status living|deceased|unknown,
size sm|md|lg, `corner`, `label`. Lifespan variant compact|full, `birth`, `death`, `birthPlace`,
`deathPlace`, `status`, `preformatted`. SourcingMeter `sourced`, `total`, `label`, `info`. Avatar sex M|F. (Enforced by TypeScript + adherence lint in eslint.config.mjs.)

**DataTable** (`ui/DataTable`) — shared desktop table. Props: `columns: Column<T>[]`
(`{ key, header, render, sortable?, align?, width?, className?, headerClassName? }`), `rows`,
`rowKey`, optional `sort`/`onSortChange` (**controlled** — the consumer owns the comparator and
passes sorted `rows`; the table only reflects state and emits the clicked key), optional
`selection` (leading checkbox column), `empty`, `rowClassName`. Renders the desktop `<table>`
only — **pair it with a bespoke mobile card list** (`md:hidden`), since entity mobile layouts
differ. Sort arrows are shape-based (`↑ ↓ ↕`), colorblind-safe. Used by People, Families, Audit,
Places and the Library's Sources (#1153), which passes `bare` for an open-page table: no header
fill, only the rule under the header row.

## ESLint audit guardrails

Styling guardrails (issue #80): ESLint warns on raw hex values (`no-raw-hex-color`) and
bespoke/retiring class names (`.btn*`, `.section-card`, plus the #331-retired `.pill`/
`.input-field*`/`.link-view` so they can't ghost back) across the app; these are errors
inside `app/components/ui/**` to protect the primitive layer.

### Inline-style literal ratchet (issue #175)

The `ds/no-inline-static-literal` rule (`eslint-rules/no-inline-static-literal.mjs`, wired into
the main `eslint.config.mjs` so it runs in the CI `lint` gate) **errors on NEW static,
tokenizable literals inside inline `style={{}}`** — raw hex/`rgb()`/`hsl()` colors, raw
`px`/`em` length strings, and bare numeric spacing/size/weight (`fontSize: 22`, `gap: 14`,
`borderRadius: 16`, `fontWeight: 600`). It **allows computed/dynamic values** — anything using
`var()`/`calc()`/`env()`/`min()`/`max()`/`clamp()`, and any non-literal expression
(`left: x`, ``transform: `translate(${x}px)` ``, `opacity: visible ? 1 : 0`) — so tree/map
canvas positioning and safe-area math never trip it. Prefer a token-backed utility class or a
`var()` value; reach for inline style only for genuinely computed values.

The original ~1,725 violations (across 82 files) are captured in `eslint-suppressions.json` as a
**baseline-and-shrink ratchet** (ESLint bulk suppressions): existing sites are grandfathered, new
ones fail CI. The #175 cleanup waves have driven that baseline down to its **irreducible floor —
83 suppressions across 29 files** (as of 2026-07): what remains is React-Flow canvas node-renderers
and a residue of genuinely-computed/inline cases that can't be tokenized. **The endgame is decided:
the ratchet stays on permanently as the guardrail; it is not expected to reach zero and there is no
hard-error flip.** After de-literalizing a surface, run `npx eslint --prune-suppressions` to lower
the baseline further (it can only shrink).

### Structural-artifact guardrails

Beyond the styling audits, ESLint warns app-wide (errors in `app/components/ui/**`) on
two .NET-migration patterns: **imperative DOM** (`document.getElementById/querySelector`,
`innerHTML`) and **hand-rolled card markup** (`bg-card … rounded-xl` — use `<Card>`). A
**knip ratchet** (`npm run audit:knip:ci`, gated in CI) fails only on *new* dead code; the
baseline (`knip-baseline.json`) can only shrink. Full census: `npm run audit:artifacts`.
