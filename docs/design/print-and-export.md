# Print & Export Design

> Status: **Stub** — fill before Phase 15 begins.
>
> Covers: print stylesheet rules, JPEG/PDF export design, what to show/hide, page-break rules, citation numbering in print mode.

---

## 1. Print Stylesheet

Target: `@media print` CSS applied globally.

### Elements to hide

- Navigation (Topbar, left rail, breadcrumbs)
- Sidebar panels (PersonSidebar, AttachSourceSidebar, DescendantsPanel)
- Interactive controls (Edit buttons, filter chips, pagination)
- Tree minimap and toolbar
- Toast notifications

### Elements to show / adjust

- Page titles: larger, no truncation
- Cite chips: replace amber chip with footnote-style superscript `[n]`
- Sources cited section: always expanded and shown (even if collapsed in the screen layout)
- Expand all collapsed sections (Names & aliases, Notes)
- URL or ID in footer for traceability: e.g. "Heirloom · Person #14 · Printed May 2026"

### Page-break rules

- Avoid page breaks inside a person's hero section
- Avoid page breaks inside event rows
- Allow breaks between major sections (Life events / Relationships / Names)

### Typography in print

- Remove web fonts if not embeddable; fall back to Georgia (serif) / system-ui (sans)
- Ensure sufficient contrast on white paper (all text should be black or dark gray)

---

## 2. JPEG Export (Tree)

Existing: `app/tree/page.tsx` has a JPEG export button that captures the visible canvas.

Updates needed (Phase 6 chrome refresh):
- Match new toolbar styling
- Confirm export captures the full tree layout (not just the visible viewport)
- Add a legend: citation count key, sex color key (if colorblind mode is off)

---

## 3. PDF Export (Future)

Not implemented. Considered for: individual person profiles, family reports, tree excerpts.

### Person profile PDF

- Portrait format (A4 / Letter)
- Hero section, life events, relationships, sources cited — all on one or multiple pages
- Citation footnotes at the bottom of the last page

### Tree excerpt PDF

- Landscape format
- User selects root and depth; app renders to a vector-capable canvas and exports
- Maximum depth recommendation: 4 generations (to keep legible on A4)

---

## 4. GEDCOM Export (see also citations.md)

GEDCOM export design is covered in `docs/design/citations.md`.

Full backup: `.zip` containing:
- `export.ged` — GEDCOM 5.5.1 file
- `cases.json` — sidecar for Cases (no GEDCOM analog)
- `media/` — uploaded photos

---

## 5. TODO

- [ ] Write print CSS and test on a person detail page
- [ ] Decide footnote style for cite chips in print (superscript `[n]` or inline parenthetical `(Source #n)`)
- [ ] Design the per-page print footer
- [ ] PDF export: choose rendering approach (html2canvas, Playwright headless, server-side PDF library)
- [ ] Tree JPEG: verify full-canvas capture vs. visible-viewport capture
