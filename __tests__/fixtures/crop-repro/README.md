# crop-repro fixture (synthetic, safe to commit)

`crop-repro.zip` is a **fictional** GEDCOM+media import fixture for manually
reproducing profile-image rendering bugs (white flash / person-switch "crop
lag") in the local static build — no real family data required.

## What's in it

5 fictional people (the Faketon family: 2 parents + 3 children, all one family
so the person→person Relationship links drive **same-route client-side
switches** — the path that surfaced the crop lag). Each person has their **own**
photo with a **distinct focal crop** (`_FOCALX/_FOCALY/_FOCALR` on the GEDCOM
`OBJE`), spread to the four corners + centre. Every photo draws a white "face"
disc + big initial exactly at that focal point, so when the hero crops to the
focal you can *see* whether the correct person's crop is applied.

## Reproduce

1. `npm run dev:static`
2. Tools → Import/Export → **Choose file** → `__tests__/fixtures/crop-repro/crop-repro.zip`
   → **Preview import** → **Import** (Overwrite).
3. Open a person (e.g. Ada), then click a related person (Boris / a child) so it's
   a client-side switch. Watch the hero portrait during the swap:
   - **Correct:** the previous portrait holds at *its own* crop, then swaps
     atomically to the new person at *their* crop — no white frame, no wrong crop.
   - **Bug (pre-fix):** a white flash, or the previous photo shown at the new
     person's crop before the correct image loads.

## Regenerate

`node __tests__/fixtures/crop-repro/generate.mjs` (needs dev deps: `sharp`, `jszip`).
Edit `PEOPLE` / focal values there to change the topology.
