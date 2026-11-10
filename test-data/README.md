# Private test material (git-ignored)

Drop **real** GEDCOM+media export zips here for local reproduction/debugging
(e.g. reproducing rendering bugs against a realistic tree).

**Everything in this folder except this README is git-ignored and must never be
committed.** These exports contain real family PII — names, dates, places, and
photos, potentially of minors. The repo's testing rule is: *tests use dummy /
fictional data only; never real family data.*

## How to use

1. Put your export zip here, e.g. `test-data/family_tree_export.zip`.
2. Import it in the local static build: `npm run dev:static` → **Tools →
   Import/Export → Choose file** → select the zip → **Preview import** →
   **Import** (Overwrite).
   - The zip format is `family_tree.ged` (required) + optional `media.json`
     (face-tag regions drive focal crops), `cases.json`, `sources.json`, and a
     `media/` folder of photos.
3. Committable, **anonymized/synthetic** fixtures (fictional data) belong under
   `__tests__/fixtures/`, not here — see `__tests__/fixtures/crop-repro/`.

## `vendor/`: public sample GEDCOMs

`node scripts/audit/fetch-vendor-gedcoms.mjs` downloads the public vendor and
parser-test GEDCOMs listed in `scripts/audit/vendor-gedcoms.json` (pinned
commits, licences and checksums) into `test-data/vendor/`, and
`npm run audit:gedcom-interop` imports, merges and round-trips every one
(#810, #869; results in `docs/testing/2026-10-02-gedcom-interop.md`). They hold
no real family data, but some licences don't allow redistribution, so they stay
out of git like everything else here.
