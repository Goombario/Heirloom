# 0028 — Phone screens: Undo is an audit revert, and sheet content mounts late

**Date:** 2026-10-17 (umbrella #1067; foundation #1060, #1044, #1095, #1111, #1114)
**Status:** Accepted
**Area:** design-system

## Context

Below `md`, the redesigned phone screens (home, person, family, both lists and both forms)
share one set of parts: `Sheet`, the Undo toast (`showChangeToast`), `MobileControls`,
`MobileListKit` and `PersonPickerSheet`. The shared style is in `design-system.md` → Mobile,
and the person page's own traps are in [0026](0026-the-phone-person-page-handles-back-swipe-and-the-keyboard.md).
This record keeps what those parts rely on across screens that would break quietly if
someone simplified it. Each item was found on a phone or in review, not by a failing test.

## Decision

- **Undo reverts exactly the audit entries the write returned.** Every write on the phone
  person and family pages returns `{ auditIds }` through the HTTP and the local PGlite client
  alike (#1044). `useChange` (`app/people/view/mobile/useChange.ts`, shared by both pages)
  runs the write, reloads, then offers Undo as `audit.revert(auditIds)`. A compound action
  (create a person and link them, delete a death and change the status) returns every id it
  created, and Undo takes them all back together. A write that returns no ids gets the plain
  confirmation with no Undo.
- **Only editors get Undo and Delete.** `revertAuditService` refuses `view` and `contribute`
  (`lib/services/audit.ts`), so both record pages pass `canUndo: role === 'editor'` and
  hide Delete rows from contributors.
- **Sheet content mounts a render after `open` turns true.** Vaul portals the panel in late,
  so a ref read in an effect keyed on `open` is still null. Measure or focus with a callback
  ref when the element mounts, as `CropScreen` (`PortraitSheets.tsx`) and the viewport fit in
  `Sheet.tsx` do.
- **`ProfileImage` crops to a circle unless told otherwise.** A rectangular frame, such as
  the family hero halves, the home "Pick up" portrait or the Family tab's photo stack, must
  pass `circular={false}`. Without it the photo is clipped to an oval inside its frame (#1114).
- **A list chip's 44px hit goes on each of its buttons, not on the shell.** A dismissible
  `MobileListChip` holds two buttons. A positioned `::before` on the shell paints over both
  and takes every tap. jsdom can't see this, so only a real browser catches it (#1095).

## Rejected alternatives

- **Undo by writing the old values back from the client.** That's a second write path that
  has to know every table a change touched, citations and family links included. The audit
  log already records what changed, and the History page reverts through it too.
- **Offering contributors Undo and letting the server refuse it.** Every tap on it would end
  in an error toast.

## Consequences

- A new phone write needs its audit ids returned in both data layers before it can offer
  Undo. A write that returns none (today `people.remove`) shows a confirmation, not Undo.
- `npm run test:mobile:scan` draws the crop stage, so the late-mount trap is checked there
  for the crop. Other sheets that measure themselves aren't checked.
