# GEDCOM interop: vendor exports (2026-10-02)

Release gate #810: import GEDCOM from other genealogy apps and check what survives. The same run measured the data checks for #869.

## Method

**Corpus.** We have no accounts in the vendor apps, so the corpus is 72 public sample files, listed with their pinned commit, licence and sha256 in `scripts/audit/vendor-gedcoms.json`. None holds real family data: they are invented trees, fiction, historical royalty and parser test files.

- **Seed exports.** One invented 14-person tree (`seed-for-import.ged`, from cacack/gedcom-go) re-exported by Ancestry (2025.08), FamilySearch, Gramps 6.0.6, MyHeritage and RootsMagic 11. These are the closest thing to "the same tree from each app", and the seed gives the source counts.
- **Real vendor trees.** 15 trees of 110–34,020 people, exported by FTM, MyHeritage Family Tree Builder 8, Legacy 10, PAF, Brother's Keeper, Family Origins, Ancestris, TMG and Gramps.
- **Dialects and hostile files.** Vendor custom-tag samples (FTM, Legacy, Family Historian, Heredis, Geni, MacFamilyTree, Swedish apps), the GEDitCOM torture files, encodings (ANSEL, CP437, CP1252, Win1251, UTF-16) and the GEDCOM 5.5.5 samples.

MacFamilyTree is covered only by a hand-made dialect stub. There is no public export of it.

**Probe.** `scripts/audit/gedcom-interop-probe.vitest.ts` runs the real import and export services on PGlite. For each file it:
1. imports it (overwrite) and records the counts and warnings;
2. runs the data checks and the duplicate check;
3. merges the same file again, which should change nothing;
4. exports, then re-imports the export into a second tree;
5. lists every tag path (`INDI.BIRT.DATE` …) that the export has fewer of than the input.

```
node scripts/audit/fetch-vendor-gedcoms.mjs   # into the gitignored test-data/vendor/
npm run audit:gedcom-interop                  # ~8 minutes; writes test-data/vendor/report.json
INTEROP_ONLY=Habsburg INTEROP_SAVE_EXPORTS=1 npm run audit:gedcom-interop
```

**Hosted build.** The probe runs the hosted services on PGlite, and the #868 suite keeps the two engines in step. The one engine-specific defect, #957, affects only PGlite.

**Spot checks by eye.** Mary Johnson (Ancestry seed) shows #959. Robert Baratheon (MyHeritage `GoT.ged`) shows #964. Frances Folsom and the Coolidge family (Brother's Keeper) are source-data errors. Bare marriages are in Legacy `legacy10-2025-export.ged`, and custom events in the Tudor and Habsburg trees.

## Results

- **People and families: nothing is lost.** Every file that imports keeps every `INDI` and `FAM` (49,987 people). Dangling pointers are reported (`dropped_links`: Queen 622, Habsburg 7).
- **Three of the 15 real trees can't be imported at all** (#958). Their absolute or URL media paths (`C:\FTM\…`) refuse the whole file. Without those lines they import completely.
- **Large trees wedged the static build** (#957, fixed in this PR). Any file with more than 8,191 places overflowed PGlite's bind parameters. Habsburg (8,658 places) left the database answering every query with no rows.
- **All five seed exports import exactly** and are stable under a second merge. Each still loses some detail on the way out: #959, #962, #964 and #966.
- **Silent losses** are filed under #810, one issue per defect (table below). None of them drops a person, a family or a dated event.

| Issue | Severity | What | Files |
|---|---|---|---|
| #957 | P1, fixed | More than 8,191 places wedge the PGlite database | Habsburg |
| #958 | P1, fixed | An absolute or URL media `FILE` refuses the whole import | Queen (MyHeritage FTB), pres2020 and ftm-general (FTM) |
| #959 | P2, fixed | A person-level `NOTE` after an event is stored on that event | 15 files, 314 of 504 notes |
| #960 | P2, fixed | Merging the same file again adds media placeholders, citations, sources and empty families | 23 files |
| #961 | P2, fixed | FTM `_FREL`/`_MREL` (Adopted, Step, Guardian) dropped; the link becomes Birth | FTM files; Habsburg has 92 non-natural |
| #963 | P2, fixed (#981 documented) | Citations on name variants, note records, and inline `SOUR` are lost | Habsburg (64), TGC, Ancestris, RootsMagic 7 |
| #962 | P3, fixed | A marriage citation comes back on the whole family | 12 files, 5,539 |
| #964 | P3, fixed | `NPFX`, `NSFX`, `NICK`, `SPFX` (and `NAME.TYPE`) dropped | 18 files |
| #965 | P3, fixed | A bare `1 MARR` (married, no date) is lost | 13 files, 2,391 |
| #966 | P3, fixed | Repository address, phone, email and web address dropped | 12 files |
| #967 | P3, documented | Level-0 custom records (`_EVENT_DEFN`, `_EVDEF`, `_PLAC`) dropped | Legacy, Family Origins, Family Historian |
| #968 | P3, fixed | Alternative `BIRT` records lost on the round trip | 4 files, 171 |
| #969 | P3, fixed | The place count changes across export and re-import | 5 files |
| #979 | P2, fixed | Kept passthrough pointers name the source file's xrefs, so they cite the wrong record after export | Habsburg (5,004 TITL citations) |
| #976 | P3, fixed | Media under a citation, and FILE sub-lines such as FTM's `_DATE` / `_TEXT`, are lost | pres2020 (369, 171, 150), 6 more |
| #977 | P3, documented | A GEDCOM 5.5 `BLOB` image imports without the image | TGC (1 each) |
| #980 | P2, fixed | Vendor tags under a citation (`_LINK`, `_FOOT`, `_ABBR`, …) are dropped or kept under the wrong fact | FTM, RootsMagic |
| #981 | P3, documented | Citations on NOTE and OBJE records have no home (counted) | TGC, Ancestris |
| #989 | P3, fixed | Legacy's preferred-spouse flag `_PREF` under `HUSB`/`WIFE` is dropped | Tudor (290), 2 Legacy samples |
| #990 | P3, fixed | A citation under an event's `DATE` or `PLAC` comes back on the whole event | TMG (66), TGC (1 each) |
| #995 | P3, documented | A `NOTE` record nothing points at is dropped (counted) | Gramps (1) |
| #991 | P4, fixed | `DIV N` / `ANUL N` ("didn't happen") is dropped | royal92 (9) |
| #992 | P4, documented | ArkivDigital's structured place `_ADPL` under `PLAC` is dropped (counted) | ArkivDigital |
| #993 | P4, documented | MyHeritage's level-0 `_PUBLISH` record is dropped (rightly; counted) | Queen (MyHeritage FTB) |
| #994 | P4, documented | A `NOTE` record's `CHAN` is dropped | TGC (33, 35), Ancestris (5) |
| #996 | P4, fixed | A second `TYPE` under one `EVEN` is dropped (invalid, but holds data) | Heredis (2 files) |
| #985 | P4, fixed | A REPO pointer in kept lines (Legacy's `_TODO` / `2 REPO @R1@`) is dropped; kept pointers now name repositories too | 2 Legacy samples |

## Per file

Rerun after phase 3 of #973 (2026-10-03), the with-media export. The 2026-10-02 run refused three files (#958) and grew on a second merge in five.

"Merge again: media only" means only media rows without their files were added: a merge can't match media whose bytes aren't in the bundle, and says so (`merge_media_without_files`, #960). "Remaining" names what the export still loses:

- **variants**: a non-first NAME exports as `_AKA` or `NICK` (#872), so the probe counts its `NAME` sub-lines as lost although the variant is kept.
- **#980**: open at the rerun, since fixed.
- **limits**: a known limit below.
- **other**: a loss filed after the rerun (#989–#996). Gramps' `INDI.FAMC.PEDI` (8 → 0) isn't one: the export leaves out `PEDI birth` because Birth is the default (ADR 0012), and it re-imports the same.

Dangling pointers (`dropped_links`), duplicate `CHIL` lines and inline OBJE written back as records aren't counted as losses.

| App | File | Kind | Import | People | Families | Warnings | Merge again | Round trip | Remaining |
|---|---|---|---|---:|---:|---|---|---|---|
| Ancestris | `vendor-ancestris11-export.ged` | export | imports | 303 | 139 | citations_unplaced | media only | stable | variants #980 limits other |
| Ancestry | `ancestry-2025-export.ged` | export | imports | 14 | 5 | — | stable | stable | variants |
| Ancestry | `ancestry-extensions.ged` | dialect | imports | 1 | 0 | — | stable | stable | #980 |
| ArkivDigital | `arkivdigital.ged` | dialect | imports | 5 | 2 | child_relationship_unmapped | media only | stable | #980 limits other |
| Family Historian | `famhistcustomtags.ged` | export | imports | 3 | 1 | custom_records_dropped | media only | stable | limits |
| Family Historian | `vendor-familyhistorian.ged` | export | imports | 3 | 1 | custom_records_dropped | media only | stable | limits |
| Family Origins | `vendor-familyorigins5.ged` | export | imports | 529 | 114 | — | stable | stable | — |
| Family Tree Maker | `ftm-general.ged` | export | imports | 1 | 2 | external_media_references | media only | stable | limits |
| Family Tree Maker | `ftm-link-test.ged` | export | imports | 2 | 0 | — | stable | stable | #980 |
| Family Tree Maker | `ftm-photo-test.ged` | export | imports | 3 | 0 | — | media only | stable | — |
| Family Tree Maker | `ftmcustomtags.ged` | export | imports | 3 | 2 | child_relationship_unmapped | media only | stable | — |
| Family Tree Maker | `Habsburg.ged` | export | imports | 34,020 | 15,411 | child_relationship_unmapped, dropped_links | stable | stable | variants #980 |
| Family Tree Maker | `pres2020.ged` | export | imports | 2,322 | 1,115 | external_media_references | media only | stable | variants #980 |
| Family Tree Maker | `vendor-ftm.ged` | export | imports | 3 | 2 | child_relationship_unmapped | media only | stable | — |
| FamilySearch | `familysearch-2025-export.ged` | export | imports | 14 | 5 | — | stable | stable | — |
| FamilySearch | `familysearch-extensions.ged` | dialect | imports | 2 | 1 | — | stable | stable | — |
| Geni | `test_geni.ged` | export | imports | 5 | 3 | — | stable | stable | — |
| Genney | `genney.ged` | dialect | imports | 2 | 1 | — | stable | stable | — |
| Gramps | `gramps-2025-export.ged` | export | imports | 14 | 5 | — | stable | stable | other |
| Gramps | `sample.ged` | export | imports | 42 | 15 | — | stable | stable | — |
| Gramps | `vendor-gramps.ged` | dialect | imports | 5 | 2 | — | stable | stable | variants |
| Heredis | `imp_Paris.ged` | export | imports | 22 | 1 | — | stable | stable | other |
| Heredis | `vendor-heredis.ged` | export | imports | 22 | 1 | — | stable | stable | other |
| Holger | `holger.ged` | dialect | imports | 2 | 1 | — | stable | stable | — |
| Legacy | `EnglishTudorRoyalFamily.ged` | export | imports | 347 | 200 | custom_records_dropped | stable | stable | variants limits other |
| Legacy | `legacy10-2025-export.ged` | export | imports | 1,288 | 495 | — | stable | stable | — |
| Legacy | `legacycustomtags.ged` | export | imports | 8 | 2 | custom_records_dropped, raw_pointers_dropped | media only | stable | #980 limits other |
| Legacy | `vendor-legacy.ged` | export | imports | 8 | 2 | custom_records_dropped, raw_pointers_dropped | media only | stable | #980 limits other |
| MacFamilyTree | `macfamilytree.ged` | dialect | imports | 2 | 1 | — | stable | stable | — |
| My Roots | `vendor-myroots-palmos.ged` | export | imports | 20 | 11 | — | stable | stable | — |
| MyHeritage | `GoT.ged` | export | imports | 501 | 172 | — | stable | stable | — |
| MyHeritage | `mhftb8-export.ged` | export | imports | 4,683 | 2,863 | dropped_links, external_media_references | media only | stable | variants other |
| MyHeritage | `myheritage-2025-export.ged` | export | imports | 14 | 5 | — | stable | stable | — |
| MyHeritage | `vendor-myheritage.ged` | dialect | imports | 3 | 1 | — | media only | stable | limits |
| PAF | `royal92.ged` | export | imports | 3,010 | 1,422 | — | stable | stable | other |
| PAF | `vendor-paf5.ged` | export | imports | 33 | 14 | — | stable | stable | — |
| RootsMagic | `rootsmagic-2026-export.ged` | export | imports | 14 | 5 | custom_records_dropped | stable | stable | #980 limits |
| RootsMagic | `vendor-rootsmagic.ged` | export | imports | 2 | 0 | inline_citations_kept | stable | stable | — |
| seed | `seed-for-import.ged` | seed | imports | 14 | 5 | — | stable | stable | — |
| TMG | `vendor-tmg12.ged` | export | imports | 110 | 58 | — | stable | Places 24→23 | variants #980 limits other |
| webtreeprint | `vendor-webtreeprint.ged` | export | imports | 14 | 4 | — | stable | stable | — |

## What held up

- **Encodings.** ANSEL, CP1252 (FTM 17), Win1251 labelled ANSI or ANSEL, damaged UTF-8 and UTF-16 BE/LE all import. CP437 (`CHAR IBMPC`, Brother's Keeper) imports as a guessed Windows-1252 and says so (`charset_guessed`).
- **Custom tags inside records** are kept verbatim and re-exported (`preservedCount`: Habsburg 18,238, Family Origins 592). This includes citations under unmodelled attributes (`RELI`, `TITL`, custom `EVEN`). They survive the round trip but don't appear as citations in the app.
- **Dates.** Dual years, B.C. and other calendars are kept as text, not mangled (#876). The data checks read a dual year as its later, Gregorian year and B.C. (and the vendors' `BC`, `BCE` and `AD`) as a negative year, so they check those dates (#971). Calendar escapes (`@#DJULIAN@`, `@#DHEBREW@`, `@#DFRENCH R@`) are still listed as unreadable, as accepted in the September 2026 data audit. On the corpus, unreadable `DATE` values fell from 3,128 to 1,421; what's left is mostly non-dates (`SUBMITTED`, `<unknown>`) and LDS status codes.
- **Torture files.** TGC 5.5 and 5.5.1 in both line-ending forms, 100 levels of nesting (refused: there are no records), and every gedcom.org sample.

## Known limits

Losses that #810's acceptance lets stand because this section documents them. The import report counts most of them; each bullet says whether it does.

- **Vendor level-0 records** (#967): Legacy's `_EVENT_DEFN` (event definitions with sentence templates), Family Origins' `_EVDEF`, Family Historian's `_PLAC` / `_PLAC_DEFN` and MyHeritage's `_PUBLISH` (#993). The app has no home for another app's own record types, so they aren't kept or exported again. The import counts them by tag (`custom_records_dropped`). Re-exporting to the app that wrote them loses its custom event sentences; the events themselves, and their places, are kept. `_PUBLISH` is MyHeritage's site-publishing setting, with the exporting user's account name (`_USERNAME`), so it is counted but deliberately not kept: copying it into another app's export would leak that account. MyHeritage writes it as `0  _PUBLISH`, with two spaces after the level and no xref; the import reads it either way.
- **BLOB media** (#977): GEDCOM 5.5 could embed an image in an `OBJE` record as `BLOB` data. 5.5.1 and 7.0 removed it, and only the TGC torture files use it (one each). The app doesn't decode it into a stored file, so the record imports as media with its title but no image, and no export writes it. The import counts it (`media_blobs_dropped`).
- **Media record lines other than FILE** (after #976): an `OBJE` record's own `REFN`, `RIN`, `NOTE`, `CHAN` and vendor tags (MyHeritage's `_PHOTO_RIN`) aren't kept, nor sub-lines of its `TITL`. A FILE's other sub-lines, and media under a citation, are. Only TGC and the gedcom-go custom-tag torture file use most of them. The import doesn't count them.
- **Text after BIRT or DEAT**: the app keeps a birth's or death's facts, not a value written on the `1 BIRT` / `1 DEAT` line itself, which 5.5.1 limits to `Y`. Habsburg writes 192 such values (`1 BIRT illegitim` 112 times, `getauft`, `totgeboren`, …), and pres2020 writes 50 on DEAT (a cemetery, `Age: 73`). The birth or death is kept and exports with its date, place and citations, but without that text. The import doesn't count these values.
- **Pointers kept before #979**: passthrough stored by an import before #979 still names records by the source file's xrefs. Export drops such a pointer when the file it writes defines no record with that xref. One that happens to match a record the export numbered the same way still names that record, which may be the wrong one. Importing the original file again (replace) stores them as ids.
- **Notes with their own sub-lines**: TMG (and Ancestris) write a person `NOTE` with `DATE`, `PLAC` and `SOUR` under it. The note text is kept; the lines under it are not. TMG's one such place, Kilauea Crater, is why its place count goes from 24 to 23 across export and re-import. The import doesn't count them.
- **NOTE records only passthrough points at**: a note record is kept when a modelled field points at it. One that only kept passthrough points at, such as `4 NOTE @N26@` under a citation's `OBJE` in the TGC files, isn't kept, so the pointer is dropped. The import counts it (`raw_pointers_dropped`, tag `NOTE`).
- **NOTE records nothing points at** (#995): Gramps writes the tree's own description as a `0 @N@ NOTE` record with no pointer to it. The app keeps a note only on a record it describes and has no tree-level note, so the record isn't kept or exported again. The import counts it (`notes_unattached`).
- **Lines under a place** (#992): ArkivDigital writes a structured place, `_ADPL` with `_LOCALITY`, `_PARISH`, `_PARISH_AID`, `_COUNTY`, `_COUNTRY` and `_JUDICIAL`, under a fact's `PLAC`. A place keeps its name, `FORM`, `MAP` coordinates, notes and citations; other lines under it aren't kept or exported again. The place name already carries most of the parts; what's lost is `_PARISH_AID`, the link to ArkivDigital's parish records. Under an event the app doesn't model, the whole event is kept, `_ADPL` included. The import counts them by tag (`place_lines_dropped`).
- **A NOTE record's change date** (#994): a shared `0 @N@ NOTE` record's `1 CHAN` (`2 DATE`, `3 TIME`) isn't kept; the note's text and its links are. The app has no home for a note record's own lines, and the export writes no `CHAN` of its own for a note. TGC writes 33 and 35, Ancestris 5. The import doesn't count them.
- **Citations on NOTE and OBJE records** (#981, ADR 0024): GEDCOM 5.5.1 lets a shared `0 @N@ NOTE` record or an `0 @O@ OBJE` record carry `SOURCE_CITATION`s. A citation here belongs to a fact (ADR 0018), and notes and media aren't facts, so these citations, with their `PAGE`, `QUAY`, `DATA` and `EVEN`/`ROLE`, aren't kept or exported again. The note and the media themselves are. TGC 5.5.1 and 5.5C and Ancestris write 7 `NOTE.SOUR` in all, and the gedcom-go custom-tag torture file one `OBJE.SOUR`. The import counts them (`citations_unplaced`). Citing the same source on the fact the note describes keeps the evidence in the app.
- **Filed after the 2026-10-03 rerun** (in the loss table above): Legacy's `_PREF` (#989), citations under a `DATE` or `PLAC` (#990), a second `EVEN.TYPE` (#996) and `DIV N` / `ANUL N` (#991, kept on the family and exported again; it creates no event) are fixed; ArkivDigital's `_ADPL` (#992) and MyHeritage's `_PUBLISH` (#993) are counted; a `NOTE` record's `CHAN` (#994) is documented above.

## Not covered

- **Counts against the vendor app.** These counts are against the file, not the app's own totals.
- **Real vendor zips with photos.** No public sample exists, and #810 waived building them. Instead, hand-written zips in the hostile corpus (#1005) cover the shapes vendors write: a relative media folder beside the `.ged` inside a top folder, Windows backslash paths, absolute Windows paths matched by file name (an ambiguous name stays a placeholder and is reported), and a FILE whose case differs from the zip entry. Each pins which photos match, and that the overwrite check refuses on exactly the ones that don't. Zips whose entry names aren't UTF-8 (older Windows "Send to compressed folder" with non-ASCII names) aren't covered.
- **The static build's UI flow** is now checked separately (#1006): `npm run test:static-import` imports through Import & Export in a browser. It covers a `.ged` in Overwrite and then Merge, the import warnings, an Overwrite the missing-photo check refuses, three vendor-shaped zips whose photos must all land, and Habsburg (34,020 people in about 200 s, after which the People page still opens). Its first runs found four bugs:
  - photos in a zip whose `.ged` sits in a folder were all reported missing, including the app's own export re-zipped with its folder (fixed in #1006);
  - a new browser's first import created three default trees, so a second merge could land in another tree (#1007, fixed);
  - reloading in the first seconds after an import could lose all of it (#1008, fixed: an import now waits for one full flush to IndexedDB before it reports success);
  - a reload can leave the page waiting for good on the database worker (#1009, open). The check moves between steps without reloading, so #1009 doesn't fail it.
