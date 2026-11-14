# Accessibility and responsive checklist

A manual pass to run on every page, in both themes, on desktop and on a phone. It covers what
`npm run test:a11y` can't: that scan checks colour contrast, the page shell, focus rings and the
phone person page, on empty pages from the static build only.

This file is the procedure, not a record. Each finding becomes a GitHub issue; a pass is noted in
the issue or PR that ran it, with the date, the build and what it found.

## Setup

- Use a tree with data in every section: people with photos, events, notes and sources; a family
  with children; a place with a map; a research case with leads, findings and journal entries.
  `npm run db:seed:synthetic` fills a hosted database (see `docs/testing/synthetic-data.md`).
  Never use real family data in an issue.
- Run each page at these sizes:
  - desktop, 1440 × 900;
  - small laptop, 1024 × 768;
  - phone, 390 × 844 (iPhone 13);
  - narrow phone, 320 × 640.
- Run each page in light and dark, and once with **Options → Colorblind mode** and
  **Options → Show status symbols** on.

## Pages

Do every route, in its filled state and its empty state where it has one:

| Area | Routes |
|---|---|
| Home | `/` |
| People | `/people`, `/people/view?id=`, `/people/new` |
| Families | `/families`, `/families/view?id=`, `/families/new`, `/families/edit?id=` |
| Places | `/places`, `/places/view?id=` |
| Library | `/library` (each tab), `/library/view?id=`, `/library/new`, `/library/repository?id=`, `/library/faces` |
| Research | `/cases`, `/cases/view?id=`, `/cases/new` |
| Tree | `/tree` (each layout), `/relationship` |
| Tools | `/data-checks`, `/import-export`, `/audit`, `/members`, `/options`, `/about` |
| Sign-in (hosted) | `/auth/signin`, `/auth/error` |

Also open each overlay these pages own: modals, phone sheets, the lightbox, menus, pickers and the
person sidebar on the tree.

## Keyboard

- [ ] Tab reaches every control, in reading order, and nothing hidden takes focus.
- [ ] The skip link is first and moves focus to the main content.
- [ ] Every focused control shows the focus ring, including on dark surfaces (the person and
      family cover bands, `.dark-island`, the lightbox rail).
- [ ] A modal, sheet or menu keeps focus inside while open and gives it back to its opener on close.
- [ ] Escape closes overlays. The deliberate exceptions: a dirty sheet asks before it closes, and the
      person form does not cancel on Escape.
- [ ] Menus and comboboxes work with the arrow keys, Home, End and Enter.
- [ ] No keyboard trap anywhere, including the map, the tree canvas and rich text fields.

## Semantics

- [ ] Each page has one `h1`, and headings descend without skipping a level.
- [ ] Each form field has a label a screen reader announces (a visible label, or `aria-label`).
- [ ] Each icon-only button has an accessible name and a matching `title`.
- [ ] Status and error messages are announced (`role="status"`, `role="alert"` or a live region),
      not only shown in colour.
- [ ] Landmarks: one `main`, the nav is a `nav`, and page regions have names where there are several.
- [ ] Images have `alt` text; decorative ones have `alt=""`.
- [ ] Tables have header cells, and sortable headers say how they sort.

## Colour

- [ ] Text and controls meet AA contrast in both themes (`npm run test:a11y` covers empty pages;
      check filled ones by eye or with the axe browser extension).
- [ ] Nothing is said by colour alone. Living status shows a dot and a word (and `†` / `?` with
      Show status symbols on); the tree's shape markers are the reference pattern (`lib/tree/geometry.ts`).
- [ ] With Colorblind mode on, sex and status colours stay distinguishable.

## Reflow and scaling

- [ ] At 320px wide, the page never scrolls sideways. Wide content (tables, the tree, a long place
      name) scrolls inside its own box or wraps.
- [ ] At 200% browser zoom on desktop, nothing is cut off or overlaps, and every action is still
      reachable.
- [ ] With the phone's largest text size, labels wrap rather than truncate where the text matters.
- [ ] Touch targets are at least 44 × 44px on the phone.
- [ ] The phone keyboard never hides the field being typed into or the sheet's Save, and the sheet
      returns to its place when the keyboard closes.
- [ ] In the home-screen app, nothing sits under the notch or the home indicator.

## Recording a pass

For each finding, file an issue with:

- the page and the size, theme and options it needs;
- what happens and what should happen;
- a screenshot on synthetic data;
- the checklist line it fails.

Then note the pass in the issue or PR that ran it: the date, the build or commit, the pages done
and the issues filed.
