# Partnerships — Design Spec

> Status: **Stub** — fill before Phase 9 begins.
>
> Covers: two-partner gender-neutral model, migration from HusbandId/WifeId, polycule representation, UX for partnership forms and display.

---

## 1. Two-Partner Model

Each `Family` row has exactly two slots: `Partner1Id` and `Partner2Id`. Both are nullable. No semantic difference between slot 1 and slot 2 — order is purely positional.

**No junction table.** No `Role` enum. No `OrderIndex`. The common case (one partnership of two people) maps cleanly to GEDCOM HUSB/WIFE. The complexity of flexible roles is deferred; it's not needed for the MVP.

---

## 2. Migration

`Family.HusbandId` → `Family.Partner1Id`
`Family.WifeId` → `Family.Partner2Id`

Compatibility view (`FamilyCompat`) exposes old column names for one release, then dropped.

All reads in `lib/db/queries/families.ts` return `partner1`/`partner2`. All writes accept `partner1Id`/`partner2Id`. No caller should reference `husband`/`wife` after Phase 9.

---

## 3. Polycules (3+ partners)

Represented as multiple overlapping `Family` rows. If A, B, and C are in a triad: three `Family` rows exist (A-B, A-C, B-C).

Each row round-trips through GEDCOM independently. No special data model needed.

**UI:** Family list shows each `Family` row as a separate partnership. No "triad" grouping in V1.

---

## 4. UX — Partnership Form

→ See `app/components/FamilyForm.tsx` and `app/components/family-form/`

Key points:
- Partner 1 and Partner 2 pickers — no gender labels, no "Husband"/"Wife" anywhere in the form
- Partnership type: Marriage / Civil union / Domestic partnership / Relationship / Unknown
- Started date/place, Ended date/reason
- Ended reason options: Divorce · Death of partner · Separation · Annulment · Unknown

---

## 5. UX — Partnership Display

**Family list:** Columns "Partner 1" and "Partner 2" — avatar + name for each.

**Family detail hero:** Partner ribbon — two avatars side by side in a card with relationship type pill and dates.

**Person detail Relationships panel:** Partnership listed as "Partner of [name]", not "Husband of" or "Wife of".

---

## 6. GEDCOM

Export: `Partner1Id` → `HUSB`, `Partner2Id` → `WIFE`. Standard tools treat these as positional tags; no gender is assumed on import.

Import: `HUSB` → `Partner1Id`, `WIFE` → `Partner2Id`.

---

## 7. TODO (fill in before Phase 9)

- [ ] Wireframe for "Add partnership" flow from a person's Relationships panel
- [ ] How to handle re-ordering Partners 1 and 2 (swap button? drag?)
- [ ] Ended partnership display on person detail (timeline entry or relationship panel?)
- [ ] How "1 of 2" / "2 of 2" sequential marriages are indicated in the tree (see missing-design-work.md)
