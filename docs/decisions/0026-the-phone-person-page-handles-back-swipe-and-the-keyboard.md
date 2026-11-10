# 0026 — The phone person page handles Back, swipe and the keyboard itself, and vitals own birth and death

**Date:** 2026-10-15 (tracking #1054; #1046–#1053, #1091, #1092)
**Status:** Accepted
**Area:** design-system / people

## Context

Below `md`, the person page is its own component, `app/people/view/mobile/MobilePersonPage.tsx`:
a photo hero, sticky tabs and read-only panes, with every edit in a Vaul `Sheet`. The layout is
in `design-system.md` → Mobile and the locked mockup. This record keeps the parts that look
like they could be simpler and can't be. Each one was found on a phone, and a "cleanup"
would bring the bug back without any test going red, except where noted.

## Decision

- **An open sheet owns one history step** (`app/components/ui/sheetStack.ts`). While any
  `Sheet` (or the phone `MediaLightbox`) is open, there is one extra same-URL history entry.
  `UnsavedChangesProvider`'s guard asks `sheetsTakeBack()` first: Back takes the step and
  closes the top sheet, or asks "Discard your changes?" and pushes the step again. Closing the
  last sheet another way removes the step. A step left behind under a page opened from inside
  a sheet is stepped over on the way back.
- **Tab swipe uses touch events** (`useTabSwipe.ts`), not `touch-action: pan-y`. A drag is
  ignored when it starts in the left 24px, in a field, on the tab strip, inside anything that
  scrolls sideways, on a map, or while the page is pinched in. Each tab keeps its own scroll
  place once the hero has scrolled away, and the incoming tab is drawn at the place it will
  land on. Tab panels are at least a screen tall.
- **Full-height sheets follow the visible viewport.** `size="full"` sheets set their own
  `bottom` and `height` from `visualViewport`, and Vaul's `repositionInputs` is off for them.
- **Birth, death and living status are edited only from the vitals strip.** Edit person has
  the birth name, sex and Delete only. Choosing Living or Unknown when a death is recorded
  confirms, then clears the death. Deleting a death leaves the person deceased.
- **Roles on the phone come from the server's rules.** Contributors get the editor's sheets
  without Delete rows and without Undo, because the server refuses their deletes
  (`lib/services/people.ts`) and their audit reverts (`revertAuditService`). Delete person has
  no Undo for anyone, because `people.remove` returns no audit ids.
- **Phones always get the phone page, under the app top bar.** CSS chooses between the phone
  and desktop pages, so a phone never paints the desktop page first. There's no "Open the full
  page" fallback.

## Rejected alternatives

- **Letting the history guard hold Back with no step of its own.** The guard can only cancel
  a same-document traversal. On a page opened directly (from a link, a bookmark or a reload),
  the entry before it is another document, so Back left the page with the sheet still open.
- **`touch-action: pan-y` on the page.** It would stop the browser scrolling sideways during
  a swipe for free, but it also stops a pinched-in page from panning sideways. The left 24px
  belong to iOS's own back gesture.
- **Jumping to the top of the new tab on every switch.** That is what phase 7 shipped. On a
  phone it read as the page jumping back to the top, and the incoming tab slid in showing the
  wrong part of itself.
- **Vaul's keyboard fitting for typing sheets.** It resizes the sheet, but iOS still scrolls
  the visible area to the caret. That carried the header and Save off the top of the
  biography sheet.
- **Status and death in Edit person.** That makes two places to edit the same state, and one
  of them could contradict a recorded death without asking.
- **Showing contributors Delete and Undo and letting the server say no.** Every tap on them
  would end in an error.
- **Hiding the app top bar on this page, and keeping the full page as an escape hatch.** Both
  were trial switches at the bottom of the page during #1054. The owner chose the top bar and
  asked for the section to go (#1092).

## Consequences

- A new `Sheet` gets the history step and the discard prompt without doing anything. Code
  that closes a sheet and navigates in the same tick can race the step's removal; nothing does
  that today.
- Anything new on the page that scrolls sideways, or takes a horizontal drag of its own, must
  scroll for real or be marked `data-no-tab-swipe`. Otherwise it fights the swipe.
- `npm run test:mobile:scan` (part of `test:a11y`) checks the swipe, its announcement, each
  tab's scroll place, Back with a clean and a dirty sheet, 44px targets and axe at 390×844.
  The keyboard fit can't be checked off a real iPhone.
- The Died panel reads "Status" when no death is recorded and the person may still be living,
  using the same 100-year cutoff as the rest of the app (`MAY_BE_LIVING_YEARS` in
  `lib/living.ts`). Changing that cutoff changes this panel too.
