# UI standards

Applies to everything under `app/`, regardless of agent. Claude loads this file automatically;
other agents should read it before changing UI.

> **Design system:** See [`../design-system.md`](../design-system.md) for the token vocabulary,
> the `@/app/components/ui` primitives, and the "ink acts, amber proves" colour rule (#688). Use the
> primitives instead of re-implementing buttons/cards/badges/dates inline.

Consistent class usage across all pages. When adding new UI, follow these patterns. The
utility classes and token values below are defined in `app/globals.css`; use that file as
the source of truth when this guide and the stylesheet disagree.

**Pages:**
- Every top-level route renders `PageShell` (`@/app/components/ui`) with `variant` `list`, `detail`
  or `workspace` (#689). It owns the page's single `<main>`, the content column and, for `list`,
  the title block (`title`, `subtitle`, `actions`). Don't hand-roll `min-h-app` + `container`
  wrappers, white header bands or a second `<main>`.

**Cards & Containers:**
- Prefer the `Card` primitive (`@/app/components/ui`) for new cards. The legacy `section-card`
  alias is still available for existing call sites and expands to `bg-card rounded-card
  shadow-card p-6`.
- Empty states: the `EmptyState` primitive. `variant="empty"` explains what goes here and offers the
  create action; `variant="filtered"` says what is filtered and renders the one "Clear filters" reset (#696).
  Never tell an empty list that filters are set.
- Interactive cards: use the `Card` primitive (`@/app/components/ui`) plus hover/focus states
  per design-system.md. The legacy `.card-interactive` class is retired and no longer exists.
- Modals: use `Modal` (`@/app/components/Modal`) or `ConfirmDialog`, never a hand-built overlay.
  They provide the backdrop, `role="dialog"`, the focus trap, Esc and focus restore; titles use `.title-dialog`.
- Dark islands: use `.hero-dark` for person/family heroes and `.dark-island` for other
  permanently dark surfaces. Inside them, reference overridden `--color-*` variables
  directly; the root `--text*` aliases do not follow island overrides.

**Buttons:**
- Use the `Button` primitive with variants `primary`, `outline`, `ghost`, `success`, or
  `danger` and sizes `sm`, `md`, or `lg`. `primary` (copper fill) is the view's one main action;
  everything else is `outline` or `ghost`. `tonal` (a translucent copper wash) is only the person
  hero's Edit. Copper is a fill only, never text. The old `.btn-primary`/`.btn-secondary`/
  `.btn-danger` classes were removed; only the supporting `.btn-glow` and `.btn-close`
  helpers remain live in `globals.css`.
- Sizes are control heights (#693): sm 32, md 36, lg 44, matching `Input` md 36 and sm 32. Create CTAs
  read "Add …" for records and "New …" for workspaces, in sentence case, with `icon={<Plus …/>}` and never a typed "+".
  A delete confirm uses `variant="danger"`; an edit panel's way into it is `danger-text`
  on the left of the action row. A full-width bar uses `block`.
- Navigation "View →" links: `inline-flex items-center gap-1 text-sm text-link hover:underline` + chevron SVG — ink, regular weight, underline on hover (the legacy `.link-view`/`.link-entity` classes are retired — #331)

**Form Inputs:**
- Use the `Input` primitive (`@/app/components/ui`), or `fieldClass()` / `fieldClass('sm')` from the same module for controls it can't wrap (`<textarea>`, DateInput, LocationField). A form select is `SelectField` (same field chrome, a select-only combobox); a filter dropdown in a toolbar is `Select`. Don't add a native `<select>` (#770). The legacy `.input-field`/`.input-field-sm` classes are retired (#331). md fields are `text-base` (14px), sm are `text-sm` (13px); both carry the `.input-nozoom` iOS auto-zoom guard.
- Focus rings: add the `focus-ring` utility (2px `--color-focus` outline, 2px offset; #690), or rely on the base `:focus-visible` rule. Use `focus-ring-inset` for full-width rows in clipped popovers and `focus-ring-within` for a borderless field inside a styled shell. Never hand-roll `outline-none ring-2 ring-primary`. See design-system.md → Interaction states for focus return and menu semantics.

**Avatars (initials circles):**
- Table rows: `w-10 h-10 rounded-full shadow-sm`
- Card heroes: `w-16 h-16 rounded-full shadow-md`
- Detail page heroes: `w-20 h-20 rounded-full`
- Nested children: `w-8 h-8 rounded-full`
- Always use `avatar-male`, `avatar-female`, `avatar-nonbinary`, or `avatar-neutral` classes
  for gender coloring.

**Text Hierarchy:**
- Headings follow the ramp in `design-system.md` (#687): page title `.title` (28),
  record title `.title-record` (32), dialog and form-bar title `DialogHeader` /
  `FormTopBarTitle` (22), sections and rails through `SectionHeader`. Never hand-type heading sizes.
- Text sizes come from the ramp: `text-xs` 11, `text-meta` 12, `text-sm` 13, `text-base` 14,
  `text-md` 16. `ds/no-arbitrary-font-size` blocks new `text-[Npx]` classes.
- Person names are serif when the name is a card's title, and on the v1.1 desktop pages also in
  rail rows and table name cells (`PersonIdentity nameStyle="serif"`, #55 C9). They stay sans
  in pickers, finders, chips and the pages not yet moved to v1.1 (TYPE-5).
- Labels/metadata (dates, roles like "Mother"): `text-text-muted`. Descriptive facts (sex,
  role) are a muted text line, never `Badge`s; tags are for states only.
- Living status: `StatusMark` (a dot; `†` / `?` only with the Accessibility option on) beside
  its word, or on an avatar via `PersonAvatar status`. Sourcing: `SourcingMeter` on the person
  hero, "X of Y" text in lists and on the dashboard; never a sourced tag.
- Supplementary content (places, descriptions): `text-text-secondary`
- Dates and lifespans: `.date-mono` (JetBrains Mono plus the theme-aware date color).
  `.text-date` and `.font-serif` are retired; use `.serif` for the canonical serif treatment.
- Never use hardcoded Tailwind color classes (`gray-*`, `blue-*`) — always use CSS variable-based classes

**Colors:**
- Never use `dark:` prefix with hardcoded colors — the theme system handles dark mode via CSS variables
- Use token-backed utilities such as `bg-primary`, `text-text`, `text-text-secondary`,
  `text-text-muted`, `bg-card`, `bg-card-alt`, `border-border`, `bg-success`, and `bg-error`.
- Hover surfaces (rows, list items): `hover:bg-hover-surface`
- Links: `text-link` (slate ink) at regular weight with `hover:underline`. A link inside running
  text is always underlined: slate is close to muted text in lightness, so colour alone can't mark it. Entity names in lists (people,
  partners, children) stay `text-text` with a hover underline.
- Selected states: neutral, never a colour. A selected choice in a control is the ink fill
  `bg-text text-card` (`SegmentedControl`, active `FilterChip`; #691); a selected list or menu row is `bg-surface-2`.
- Slate is chrome and, as slate ink, links and focus; copper is the main-action fill; amber is evidence. Reserve `text-evidence`,
  `bg-evidence-soft` and `.date-mono` for dates, citations and complete sourcing — never for
  links, buttons, selection, emphasis or warnings (warnings use the orange `warning-*` tokens).

**Shared UI helpers:**
- `control-h` is the shared height for adjacent controls: 36px normally and 50px for coarse
  pointers so segmented-control buttons retain a 44px touch target.
- Use `scroll-area` for themed scrollbar colors and `hscroll-strip` for a horizontal strip
  with hidden scrollbars. `list-filter-chips` wraps on desktop and scrolls horizontally on
  mobile inside `.mobile-sticky-filters`.
- `fieldClass()` / `Input` add `.input-nozoom`; do not restore the retired `.input-field`
  or `.input-field-sm` classes.

**API Responses:**
- List endpoints: `{ entityPlural: [...], count: number }`
- Search endpoints: `{ entityPlural: [...] }` (wrapped, not raw arrays)
- Single entity: `{ entitySingular: {...} }`
- Errors: `{ error: "message" }` with appropriate HTTP status code
- All POST/PUT routes must catch `ValidationError` and return 400
- Query params: always `new URL(request.url).searchParams` (not `request.nextUrl`)
