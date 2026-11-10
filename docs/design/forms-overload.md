# Forms — Overloaded New + Edit

> Status: **Stub** — fill before Phase 10 begins.
>
> Covers: how a single form component handles both create and edit flows, field set, save bar behavior, right rail.

---

## 1. Concept

One form component, two modes. The URL and initial data determine the mode:

- `/people/new` → empty form, POST on save
- `/people/[id]/edit` → pre-filled form, PUT on save

The form looks identical in both modes except the page title ("New person" vs "Edit [name]") and the save button label ("Save" vs "Save changes").

---

## 2. PersonForm Layout

Two-column: `main content (1fr)` + `320px right rail`

**Main column fields:**
- First name, last name, nickname (row)
- Sex (segmented: Female · Male · Non-binary · Unknown)
- Birth: date (mono input) + place
- Death: date (mono input) + place
- Notes (textarea)
- Name variants section (inline list + add row — calls NameVariant API)
- Empty cite pin on every field

**Right rail:**
- Relationships at-a-glance: current parents, partners, children (read-only mini-list with "Edit" links)
- Attach-to-family picker: search existing families or create new
- Duplicate warning: if first name + last name + birth year match an existing person, show amber warning card with "Compare" link

---

## 3. FamilyForm Layout

Two-column: `main content (1fr)` + `320px right rail`

**Main column fields:**
- Partner 1 (PersonPicker)
- Partner 2 (PersonPicker)
- Partnership type (Marriage / Civil union / Domestic partnership / Relationship / Unknown)
- Started: date + place
- Ended: date + reason (Divorce · Death of partner · Separation · Annulment · Unknown)
- Notes
- Empty cite pins on key fields

**Right rail:**
- Children list (drag to reorder, add/remove PersonPicker)

---

## 4. Sticky Save Bar

Pinned to the bottom of the viewport. Three actions:
- **Save** (primary) — saves and navigates to the person/family detail page
- **Save & add another** (outline) — saves and resets form for a new record
- **Cancel** (ghost) — navigates back without saving (no-op if form is unchanged)

Auto-save: NOT implemented (too risky for genealogy data). Explicit save only.

---

## 5. Keyboard Shortcuts

- `⌘S` / `Ctrl+S` — Save
- `⌘↵` / `Ctrl+Enter` — Save & add another
- `Esc` — Cancel (if form is unchanged) or show "Unsaved changes — discard?" confirm

---

## 6. TODO (fill in before Phase 10)

- [ ] Wireframe for the duplicate warning card
- [ ] How to handle "Save & add another" for families (clear partners? keep them?)
- [ ] Field validation messages — per-field inline or save-bar summary?
- [ ] Cite pin placement on multi-field rows (e.g. birth date + place share a single pin or one each?)
- [ ] Right rail behavior on narrow viewports (collapse to accordion or hide?)
