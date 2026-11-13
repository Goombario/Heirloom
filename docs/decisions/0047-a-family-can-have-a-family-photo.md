# 0047 — A family can have a family photo, chosen as a portrait is

**Date:** 2026-11-13 · **Context:** #119, ADR 0030, ADR 0039 · **Status:** Proposed · **Area:** media / families

The locked desktop family page (board B, "Main") shows one photo filling the cover's 4:3 frame.
Without one it shows the partners' split portrait ("NoPhoto"). Families had no way to say which of
their photos that is. The maintainer asked for the split portrait first and the family photo after
it, as its own schema change, on 2026-11-12.

## Decision

1. **The family photo is a primary flag on the family's record-level link,** as a person's portrait
   is: `"MediaLink"."IsPrimary" = 1` on a row with `"OwnerTable" = 'Families'` and no `"OwnerFact"`.
   There is no new table or column.
2. **v71 widens the check.** The People-only check `medialink_primary_people_only` is dropped, and
   `medialink_primary_record_level` admits a record-level People or Families link. A fact link
   (ADR 0030) is still never primary. The partial unique index `idx_medialink_one_primary_person`
   was already per owner, so it also keeps a family to one photo.
3. **It is chosen in the lightbox,** from the family's Media section: **Set as family photo**, or,
   on the current one, **Stop using as family photo**. A photo shown on the family only because two
   of its members are tagged in it gains a link to the family when it is chosen. A PDF (ADR 0039)
   can't be one.
4. **Each choice is one audit entry** on the photo, `summary.kind = 'family_photo'`, with
   `familyId` and `FamilyPhotoMediaId` old and new. Undo (the change toast) reverts it, as a
   profile picture change is reverted. Like that change it is not reverted from the audit log page.
5. **GEDCOM carries it as a portrait is carried:** the photo's top-level `0 @O@ OBJE` record names
   the family with `1 _PRIM @F…@`, beside any `_PRIM @I…@`. Import reads the same pointer once
   every family has its id. A backup is a GEDCOM file, so it keeps the choice too.
6. **Removing the photo from the family, or deleting it, removes the choice with the link.** Deleting
   the family keeps its links, so Undo of the delete brings the photo back as well.

## Consequences

- Older apps ignore a `_PRIM` pointer they don't know, so the file stays readable; they just show no
  family photo.
- The cover's photo is not a button: the photo opens from the Media section, where the choice is made.
- A person's portrait and a family's photo can be the same photo.
