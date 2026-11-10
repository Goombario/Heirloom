# 0020 — Sources cited is a footnote list; citations are edited one fact at a time

**Date:** 2026-09-24 (#780; the EV-1 proposal from the 2026-09-23 UX sweep)
**Status:** Accepted
**Area:** citations / people / families

Supersedes two bullets of [0018](0018-citations-remain-fact-scoped.md): the Sources cited
ledger's assertion rows, and `CitationDrawer`'s owner-wide overview. Its core decision stands:
citations stay attached to exactly one persisted fact, and there is one citation editor.

## Context

0018 made the Sources cited rail a ledger: group by source, then list each supported
`fact label — value`. It also gave `CitationDrawer` an owner-wide mode ("Manage all
citations"), listing every cited fact with its citations. After #754 and #756, each chip carries
a page-local footnote number, and each fact's chip popover lists all the citations on that fact
with Open source and Edit citation. The ledger rows and the overview now repeated what the chips
show. The rail read as a second timeline, and its "(N)" counted facts while its rows were
sources.

## Decision

- **Sources cited is the page's footnote list:** one row per source, in footnote order, with
  its number and title, linking to the source. It lists no facts and has no action. Its count is
  the number of sources.
- **`CitationDrawer` is the single-fact citation workspace only.** It always opens on one fact
  (an empty pin's Add, or a popover's Edit citation) and renders `AttachSourceSidebar`. It has no
  owner-wide list and no path back to one. A pin whose fact the page doesn't describe opens that
  fact uncited (`citationFactFor`), rather than falling back to a list.

## Rejected alternatives

- **Keep the overview behind another entry point** (the hero sourcing meter, the rail title).
  It duplicates the popovers. The maintainer judged the panel unnecessary, not misplaced.
- **Keep the fact rows under each source.** "Which facts does this source support" is the
  source view's job (`/library?source=`, #755). On a record page, the fact is where the chip is.

## Consequences

- To see a record's evidence, read its chips, not a list of all its citations. Don't add a
  "Manage all" surface back to the rail. If a fact's citations are hard to reach, fix that fact's
  chip or popover.
- 0018's projection rules still govern which facts a page numbers, including the
  `FactTable #FactId` fallback that keeps stored evidence visible as a numbered source.
