# 0027 — A child is linked to each partner, not to the family

**Date:** 2026-10-15 (#982)
**Status:** Accepted
**Area:** gedcom / families

Supersedes the child-linkage row of [0012](0012-gedcom-gap-matrix-decision-session.md)
(one `RelationshipType` per link, `Step` retired). The rest of 0012 stands.

## Context

`FamilyPerson."RelationshipType"` held one value per child link. A blended family can't be
described that way: the usual case is a child who is one partner's birth child and the other's
stepchild. FTM writes exactly this as `2 _FREL` / `2 _MREL` under `1 CHIL`, and #961 kept those
lines raw because the column had nowhere to put them. Gramps also keeps one value per parent.

## Decision

- **Two columns, one per partner slot.** `"Partner1Relationship"` and `"Partner2Relationship"`,
  each `Birth | Adoption | Foster | Step | Guardian | Unknown` (`lib/child-relationship.ts`),
  `NOT NULL DEFAULT 'Birth'`. The columns are unchecked TEXT: every writer validates with
  `isChildRelationshipType` / `parseChildRelationships`, including audit revert.
- **Import.** A mapped `PEDI` under `INDI.FAMC` sets both partners. `_FREL` (HUSB, Partner1) and
  `_MREL` (WIFE, Partner2) set their own partner over it, and the first typed line per partner
  leaves the passthrough. Untyped values (Related, Sealed, Private) and `PEDI step` / `sealing`
  stay raw and are reported. `PEDI step` stays raw because PEDI is one value per link and can't
  say which partner is the step-parent.
- **Export.** When the exported partners share a value PEDI can say, it goes out as `2 PEDI`
  (none for Birth). Otherwise each exported partner gets `_FREL` / `_MREL`. A raw PEDI or a raw
  `_FREL` / `_MREL` on the link keeps its place, and the derived value then goes out per partner
  so nothing is lost.
- **Migration (schema v59).** The old type is copied to both partners, then the link's raw
  `_FREL` / `_MREL` set each partner and leave the passthrough, using the parser's rules. The
  result matches a fresh re-import of the same file. The old column is then dropped.
- **Audit.** `familychild` entries carry `Partner1Relationship` / `Partner2Relationship` in their
  snapshot, and `fields` only for the partner that changed. Revert still reads entries written
  before v59, whose single `RelationshipType` applies to both partners.
- **Phone.** Adding a child from a person's page with Step sets Step only for that person's slot;
  the other partner stays Birth.

## Rejected alternatives

- **Keeping one value and adding a "step-parent" pointer.** It describes only Step, and every
  other per-parent value FTM and Gramps hold (adopted by one, fostered by the other) would still
  collapse.
- **Leaving `_FREL` / `_MREL` raw and reading them for display.** The app couldn't edit, check or
  undo them, and a retype would contradict the raw line on the next export.
- **Writing `_FREL` / `_MREL` on every link.** Most links are Birth to both; standard PEDI (or
  nothing) is what every other reader understands.
- **Mapping `PEDI step` to Step for both partners.** It would mark the child a stepchild of their
  own parent.

## Consequences

- Data checks that skip non-birth children skip them per partner, so a stepchild is still
  checked against the partner they were born to.
- The migration and the parser must stay in step: if import rules for `_FREL` / `_MREL` change,
  the v59 rule in `lib/db/init-schema.ts` describes what existing rows got.
- A one-partner family exports only that partner's value; the empty slot's value is not written.
