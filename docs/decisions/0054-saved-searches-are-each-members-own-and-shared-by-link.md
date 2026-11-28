# 0054 — Saved searches are each member's own, and shared by link

**Date:** 2026-11-25 · **Context:** #247 · **Status:** Proposed · **Area:** people / search

The People list could filter by name, surname, sex, living, parents, children and photo, but not
answer questions such as "died between 1939 and 1945 in Poland, or a female relative of James".
The maintainer locked the design for #247 on 2026-11-22 (canvas options A, P1 and S1): a condition
panel above the list, the existing chips kept as shortcuts into it, and saved searches that belong
to the person who saved them, shared by copying a link.

## Decision

1. **A query is groups of conditions, one level deep.** Inside a group the conditions are all
   (AND) or any (OR) of them; groups are joined by OR. Each condition is a field, a condition and a
   value, in plain words; no GEDCOM tags reach the screen. The fields are names, sex, living, birth
   and death date and place, age at death, event type, relationship, parents, children, sources,
   media, research cases, data checks, notes, and created and edited dates. There is no "sounds
   like" and no decade condition, and the Places list has no advanced search.
2. **The server evaluates a query over the tree the reader can see.** `POST
   /api/people/advanced-search` loads only the slices of the tree the query's fields need and
   returns the matching ids; the local build caches the slices until the next write. Dates match
   when their range overlaps the range asked for, so "about 1940" is between 1939 and 1945. "Is in"
   matches a place and every place inside it, and text with no place record by its comma parts.
   "Related to" walks parents, children and partners up to a step limit (six by default), and can
   count blood relatives only.
3. **An empty result explains itself:** the response can carry, for each condition, how many people
   match without it, and the list offers to remove that one.
4. **The query lives in the URL** (`?q=`, base64url JSON, validated and capped on read), so a link
   to the People list is the search.
5. **A saved search is a name and a query, owned by one member in one tree:** the `"SavedSearch"`
   table (schema v77), keyed by `"UserId"` and `"TreeId"`, with a `"Page"` column that only allows
   `people` for now. Any reader of a tree can save, list and delete their own; nobody sees another
   member's. Saving asks only for a name. The Saved menu shows each one's count as it is now.
6. **Sharing is the link, not the row.** "Copy link to this search" copies the URL; whoever opens
   it sees the matches in the tree as they can see it.

## Consequences

- A saved search survives renames and edits of the people it matched; it is re-run each time.
- Deleting a member or a tree deletes their saved searches (`ON DELETE CASCADE`).
- A saved search whose fields a later version drops loses those conditions when read, rather than
  failing.
- Backups and GEDCOM export don't carry saved searches; they are a member's view, not tree data.
