# 0034 — Dates that only identify a person are muted; amber is for dates read as facts

**Date:** 2026-10-25 (#935)
**Status:** Accepted
**Area:** design-system

## Context

The rule was that every date is evidence amber: "amber = evidence only: dates, citation
chips, complete sourcing", with lifespans amber "in both formats, rails included", which
overrode #742's proposal to mute rail dates. The idea was that dates are a record's most
important facts.

On screens that are mainly about people, that pulled the eye the wrong way. On the person
page's relationship rows, each parent, partner, child and sibling carried an amber lifespan
brighter than the serif name. On the tree, a canvas of cards gave every name a bright line
under it that competed with the portraits. On these screens a lifespan helps tell two
people apart; it is not the subject. The tree's horizontal bars already showed muted dates
by default behind a dev-only `barDateAmber` switch, so the canvas disagreed with itself.

## Decision

A date is **amber where it is a fact being read or checked**, and **muted where it only
helps identify a person** (the owner's design session, 2026-10-18).

- Amber (`.date-mono`): life events and timelines, the person and family heroes and the phone
  name bar, vitals, citations and source pages, data checks, the tree sidebar's date fields,
  photo dates, place records and journeys.
- Muted (`.date-mono.date-muted`, `--color-text-muted`): relationship and family rows, the
  People and Families tables and phone lists, pickers, global search, face rows, tree cards
  (both layouts), the descendants panel, cite-on person rows and the home resume card.
- Muted dates keep JetBrains Mono and its weight. Only the colour changes, so figures still
  line up and still read as dates.
- `Lifespan` takes `tone="evidence" | "muted"`. `full`, the hero format, defaults to
  evidence and `compact`, the row format, to muted. A call site overrides it only when its
  place breaks that pattern (the phone name bar is compact but a hero; the home resume card
  is full but a row).
- The tree has no date-colour setting: `barDateAmber` is removed and both card layouts are
  muted.

## Rejected alternatives

- **Keep all dates amber.** Consistent, but on people screens it makes the dates louder
  than the people.
- **Muted dates in the body font.** Loses the lining figures and the alignment in tables and
  rows, and stops a date reading as a date.
- **Keep the tree toggle and extend it to the portrait cards.** A setting for one colour
  choice on one screen; the owner chose a default with no toggle.
- **Keep the People and Families tables amber** because people scan and sort by date there.
  They are lists of people like the others, and the column header already says which column
  is a date.

## Consequences

- "Amber = evidence" is narrower but still true. A new date surface needs a verdict: is the
  date the thing being read, or a way to tell people apart? Default to muted in rows.
- `--color-text-muted` already clears WCAG AA on card, surface, `surface-2` and hover rows in
  both themes (`__tests__/unit/contrast-tokens.test.ts`), and the dark island overrides it, so
  a muted date needs no new token.
- `.date-muted` sits in the components layer after `.date-mono`, so a utility colour on a call
  site still wins.
