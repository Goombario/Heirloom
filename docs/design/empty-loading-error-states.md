# Empty, Loading & Error States

> Status: **Stub** — fill before Phase 15 begins (but design inputs needed earlier for individual phases).
>
> Per-page catalog of the three non-happy-path states: loading skeleton, empty collection, API error.

---

## Pattern Library

### Loading Skeleton
- Gray shimmer blocks (animated gradient) matching the approximate shape of the real content
- No spinners — skeletons only
- Duration: show after 200ms delay (prevent flash for fast loads)

### Empty State
- Centered in the content area
- Serif heading (Fraunces 20/26)
- Muted body text (Inter 14/22)
- One outline CTA button
- Subtle hatched/striped card background (per design-bible.jsx empty state example)

### Error State
- Red-bordered card or inline alert
- Brief, plain-language message (per voice guide: "Something went wrong loading this page.")
- Retry button where retrying makes sense
- Link to reload the page

---

## Per-Page Catalog

### Dashboard
- **Loading:** Shimmer resume card, shimmer case rows, shimmer activity rows, shimmer right rail
- **Empty (new user):** "Your tree is empty — start by adding a person" with two CTAs: "Add person" (primary), "Import GEDCOM" (outline)
- **Error:** "Couldn't load your dashboard." + Retry

### People List
- **Loading:** Shimmer table rows (8)
- **Empty:** "No people in this tree yet." + "Add person" CTA
- **Empty (filtered):** "No people match these filters." + "Clear filters" link
- **Error:** "Couldn't load people." + Retry

### Person Detail
- **Loading:** Shimmer hero (portrait rect + text lines), shimmer event rows, shimmer relationships
- **Error:** "Couldn't load this person." + Back link

### Family List
- **Loading:** Shimmer table rows
- **Empty:** "No families recorded yet." + "Add family" CTA
- **Error:** "Couldn't load families." + Retry

### Family Detail
- **Loading:** Shimmer partnership ribbon + shimmer timeline
- **Error:** "Couldn't load this family." + Back link

### Tree
- **Loading:** Spinner centered on tree canvas (single exception to no-spinner rule — canvas is not skeleton-able)
- **Empty (no people):** Centered message: "Add a person to get started." + CTA
- **Error:** Toast: "Tree failed to load." + Retry button

### Cases
- **Loading:** Shimmer card grid (6 cards)
- **Empty:** "No open cases." + "Start a case" CTA
- **Error:** "Couldn't load cases." + Retry

### Library
- **Loading:** Shimmer source cards (4)
- **Empty (tab):** Per tab — e.g. "No sources added yet. Attach a source to a person to see it here."
- **Error:** "Couldn't load library." + Retry

### Places
- **Loading:** Shimmer table rows
- **Empty:** "No places recorded yet. Add birth, death, or event places to people to see them here."
- **Error:** "Couldn't load places." + Retry

### Settings
- **Loading:** Shimmer form fields
- **Error:** "Couldn't load settings." + Retry

### Audit Log
- **Loading:** Shimmer log rows
- **Empty:** "No changes recorded yet."
- **Error:** "Couldn't load audit log." + Retry

---

## TODO (fill in before Phase 15)

- [ ] Finalize shimmer animation CSS (keyframes, gradient direction)
- [ ] Decide 200ms threshold for all pages or per-page tuning
- [ ] First-run onboarding (see missing-design-work.md) — does it replace the empty dashboard state?
- [ ] Error state for form validation failures (field-level vs. save-bar summary)
- [ ] Network offline state (browser offline API — banner? block form saves?)
