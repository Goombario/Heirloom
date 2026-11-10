# Accessibility

> Status: **Stub** — fill before Phase 15 begins.
>
> Covers: color contrast, keyboard navigation, ARIA patterns, focus order for citation pins, screen reader considerations.

---

## 1. Color Contrast

Target: **WCAG 2.1 AA** for all text/background pairs (4.5:1 body, 3:1 large text / UI components).

Pairs to verify:

| Foreground | Background | Ratio (approx) | Target |
|---|---|---|---|
| `--text` (#1C1917) | `--card` (#FFFFFF) | ~18:1 | ✅ AAA |
| `--text-2` (#44403C) | `--card` (#FFFFFF) | ~8:1 | ✅ AAA |
| `--text-muted` (#78716C) | `--card` (#FFFFFF) | ~4.6:1 | ✅ AA |
| `--accent` (#B45309) on white | `--card` (#FFFFFF) | ~4.7:1 | ✅ AA |
| `--accent` (#B45309) on accent-bg | `--accent-bg` (#FEF3C7) | TBD | Verify |
| White text on `--primary` (#475569) | — | ~4.8:1 | ✅ AA |
| `--success` (#047857) on success-bg | `--success-bg` (#D1FAE5) | TBD | Verify |
| `--error` (#B91C1C) on error-bg | `--error-bg` (#FEE2E2) | TBD | Verify |

Action: Run all pairs through a contrast checker before Phase 15. Document results here.

---

## 2. Keyboard Navigation

### Global shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open global search |
| `⌘S` / `Ctrl+S` | Save (on form pages) |
| `⌘↵` / `Ctrl+Enter` | Save & add another (on form pages) |
| `Esc` | Close modal/sidebar; cancel form if unchanged |
| `/` | Focus search input (on list pages) |

### Tab order rules

- Navigation links before page content
- Page content in document order
- Citation pins: Tab in document order; filled pins receive focus before empty pins within the same fact section
- Modal / sidebar: focus trapped within; first focusable element receives focus on open; focus returns to trigger on close
- Tree canvas: keyboard pan (arrow keys) and zoom (+ / -); person nodes receive focus with Tab; Enter opens sidebar

### Skip link

A "Skip to main content" link must be the first focusable element on every page.

---

## 3. ARIA Patterns

| Component | ARIA |
|---|---|
| Modal (AttachSourceModal) | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title |
| Sidebar (AttachSourceSidebar, PersonSidebar) | `role="complementary"` or `role="dialog"` depending on whether focus-trapped |
| Filled cite chip | `aria-label="Source [n]: [title]. View in library."` |
| Empty cite chip | `aria-label="Attach source for [field name]"` |
| Filter chips (active) | `aria-pressed="true"` |
| Tree nodes | `role="button"`, `aria-label="[name], born [year], died [year]. Open profile."` |
| Progress bar (cited-facts) | `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` |
| Tab panels (Library) | `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected` |

---

## 4. Focus Order — Citation Pins

On a person detail page, cite pins are inline with fact values. The reading order should match the document order:

1. Hero action buttons (Edit, Descendants, View in tree, More)
2. Life events section: each event row, then its cite pin(s)
3. Relationships section: each relationship row
4. Names & aliases: each name row, then its cite pin
5. Sources cited: each source row
6. Notes

Empty cite pins are focusable. Filled cite pins open a tooltip/popover on Enter.

---

## 5. Colorblind Mode

Opt-in setting in Settings → Appearance. Replaces sex-based avatar colors (blue/pink) with shape + saturation differences:
- Female → amber / circle
- Male → slate / square
- Unknown → gray / diamond

All status colors (success/error/warning/info) are accompanied by an icon or text label, not color alone.

---

## 6. Screen Reader Considerations

- Date fields: render as `datetime` or include `aria-label` with the full date (e.g. "14 March 1882" not "14/03/1882")
- Person names: wrap in a single element — don't split first, nickname, last into separate elements without `aria-label` on the container
- Audit log diffs: use `<ins>` / `<del>` for added/removed values; don't rely solely on green/red color

---

## 7. TODO (fill in before Phase 15)

- [ ] Run full contrast audit and fill in the table above
- [ ] Verify skip link present on every page
- [ ] Test keyboard nav through cite pin flow (empty → sidebar → attach → filled)
- [ ] Test tree keyboard navigation (tab to nodes, enter to open sidebar, esc to close)
- [ ] Audit modal focus trap implementation
- [ ] Colorblind mode implementation (CSS class on `<html>`, toggled in Settings)
- [ ] Playwright a11y tests (axe-core integration)
