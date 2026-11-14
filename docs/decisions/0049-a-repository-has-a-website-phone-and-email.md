# 0049 — A repository has a website, phone and email

**Date:** 2026-11-14 · **Context:** #40, `#966`, `#1017` · **Status:** Proposed · **Area:** sources / gedcom

A GEDCOM `REPO` record can carry a website (`WWW`), phone (`PHON`) and email (`EMAIL`), up to three
of each. `#966` kept them as passthrough (`"Repository"."RawGedcom"`) so they survive a round trip, but
nobody could see or change them. The maintainer chose to model them on 2026-10-18 (`#813`).

## Decision

1. **A repository has one website, one phone and one email:** `"Repository"."Website"`, `"Phone"`
   and `"Email"`, nullable text, added in schema v72. They are edited beside its name and address.
2. **Import and a one-time backfill lift the first `1 WWW`, `1 PHON` and `1 EMAIL` out of the
   passthrough,** with the same helper. A line is lifted only when it has a value and no lines under
   it. Later occurrences stay in the passthrough and are exported as before, so nothing is written
   twice. The backfill runs until it has finished once; the comment on `"Repository"."Website"` marks
   that, as `"Citation"."Url"`'s does for ADR 0025's link backfill.
3. **A merge fills a field only where the repository has none.** Where it has one, the file's line
   is dropped if it says the same thing and otherwise kept as passthrough, so a merge neither loses a
   different value nor writes the same one twice.
4. **Export writes them after the address and before notes:** `1 PHON`, `1 EMAIL`, `1 WWW`, then the
   passthrough. GEDCOM 5.5.1 needs an `ADDR` whenever any of them is used, so a repository with
   contact details but no address writes an empty `1 ADDR`, as one with only structured address
   lines already does.
5. **The website is shown as a link only when it starts with `http://` or `https://`.** Anything
   else is shown as text, so a stored value can't become a script link. The email is a `mailto:`
   link and the phone a `tel:` link.
6. **Fax and the structured address parts (`ADR1`, `CITY`, …) stay passthrough.**

## Consequences

- A repository edited in the app loses no further `WWW`, `PHON` or `EMAIL` lines; they keep
  exporting from the passthrough after the modeled one.
- Clearing a field in the app doesn't promote the next passthrough occurrence; that one stays where
  it was.
- `#1017` can now give the automatic repository the record site's website.
