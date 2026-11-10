# 0003 — GEDCOM exports carry a UTF-8 BOM

**Date:** 2026-07-23 (PR #369; recorded 2026-08-01)
**Status:** Accepted
**Area:** gedcom

## Context

Pre-Unicode and heuristic readers were importing our UTF-8 exports as mojibake, because
nothing in the file declared its encoding early enough for them to detect it.

## Decision

Prefix exported `.ged` files with a UTF-8 byte order mark (`EF BB BF`). This is legal and
optional per Unicode, and matches FamilySearch's own 5.5.1 output.

## Rejected alternatives

- **Rely on `HEAD.CHAR UTF-8` alone.** Correct per the spec, but it comes *after* the point at
  which many readers have already guessed an encoding. It did not solve the observed problem.
- **Export as ANSEL.** The historically "safest" 5.5.1 encoding, but lossy for the character
  set this app actually holds, and a step backwards. (ANSEL *decoding* is still supported on
  import — three missing byte mappings `0x8D`/`0x8E`/`0xC8` were fixed in the same tranche.)

## Consequences

- **Downstream breakage is possible and was accepted knowingly:** a naïve reader that
  byte-matches `0 HEAD` at file offset 0, rather than tolerating a leading BOM, will now
  reject our export.
- Our own importer tolerates it by two independent mechanisms — `decodeGedcom` strips the byte
  BOM, and `String.trim` strips U+FEFF from text. Keep both; they cover different entry paths.
- **Mention this in the user-facing release notes** for the version that ships it. It is a
  behaviour change visible outside the app.
