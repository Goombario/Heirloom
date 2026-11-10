# 0023 — Child links carry their own GEDCOM passthrough

**Date:** 2026-10-02 (#954, #961, tracking #973)
**Status:** Accepted
**Area:** gedcom

## Context

GEDCOM describes a child's link to a family in two places: `2 PEDI` and other sub-lines under
the child's `1 FAMC`, and vendor tags such as FTM's `2 _FREL` / `2 _MREL` under the family's
`1 CHIL`. The app models one value per link, `FamilyPerson."RelationshipType"`, closed to
`Birth | Adoption | Foster` by ADR 0012. Anything else (`PEDI step`, `PEDI sealing`, `2 STAT`)
had no home: ADR 0013 accepted dropping `FAMC`'s unmodeled sub-tags until a per-`FAMC` raw
column existed. The #810 vendor run showed the loss is silent and common.

## Decision

- `FamilyPerson."FamcRawGedcom"` holds a link's `FAMC` passthrough: the verbatim sub-lines the
  parser doesn't model, captured through the #423 `subRawTarget` path, plus a `2 PEDI` whose
  value has no `RelationshipType`, spelled as the file spelled it. The generator re-emits it
  under that link's `1 FAMC`, after any mapped `2 PEDI`.
- `FamilyPerson."ChilRawGedcom"` holds the same link's sub-lines under the family's `1 CHIL`,
  verbatim, and re-emits them there. FTM's `_FREL` / `_MREL` also set the type: `Natural` is
  Birth, `Adopted` is Adoption and `Foster` is Foster. One link has one type, so a non-birth
  type that either parent states applies to the link. Two different ones leave the default,
  and a standard `PEDI` always wins. When a file's own unmapped `PEDI` and a derived type
  coexist, export writes only the file's `PEDI`.
- `Step`, `sealing`, `Guardian` and other values stay out of `RelationshipType` (ADR 0012). The
  import reports a `child_relationship_unmapped` warning with the number of links and the values.
- When a user sets a link's type, the raw `2 PEDI`, `2 _FREL` and `2 _MREL` are removed, because
  they would contradict the new type on export. The other sub-lines stay. Moving a child to another family, or undoing a
  link delete, creates the link without passthrough; those lines described the old link.

## Consequences

- A raw sub-line that points at a record (`2 NOTE @N1@`) is kept as text, like every other
  passthrough column, and doesn't follow xref re-minting (ADR 0015).
- The audit log doesn't record the passthrough. Undoing a type change restores the type but not
  the raw relationship line it removed, and re-selecting the type a link already has changes
  nothing, so its raw line stays.
- The passthrough maps are keyed by pointer text from the file, so they have no prototype.
- A new column on `FamilyPerson` must be added to the `FamilyPerson` inserts in
  `lib/services/gedcom.ts`, the export query and the round-trip fixture's coverage ratchet.
