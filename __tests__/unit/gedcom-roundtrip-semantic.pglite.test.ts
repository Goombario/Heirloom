import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';
import { roundTrip, stageFixtureMedia } from '../setup/gedcom-bundle';
import { canonicalizeTree, sortByJson, type CanonicalRow, type CanonicalTree } from '../setup/gedcom-canonical';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The headline "nothing was lost" invariant: project the whole tree into a
 * canonical, surrogate-id-free, deterministically ordered document and assert it
 * is unchanged by an export -> import cycle.
 *
 * This is the semantic counterpart to the byte-level fixed point in
 * `gedcom-roundtrip-bundle.pglite.test.ts`, whose `.ged` byte-identity assertion is
 * quarantined behind known defects and therefore blind to any further `.ged`
 * regression. These assertions are the replacement safety net, so the quarantines
 * here are deliberately NARROW: where a channel loses exactly one field, the
 * channel is asserted strictly with that field omitted AND the unnarrowed
 * comparison is kept as an `it.fails`. A blanket `it.fails` on a whole channel
 * would hide every future regression in the fields that do survive.
 *
 * Nothing is omitted to make a channel green without a cited reason: each
 * omission names either a known quarantined defect, the GEDCOM 5.5.1 clause that
 * makes it unrepresentable, or a new bug reported to the maintainer.
 */
describe('the tree is semantically unchanged by an export -> import round trip', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  let before: CanonicalTree;
  let after: CanonicalTree;
  let restoreDataDir: () => void;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1');
    ids = await seedRoundTripFixture(mdb);
    // Without staged files on disk the exporter's fs.existsSync guard zips no
    // media at all, so the media channels would be comparing an empty export.
    restoreDataDir = await stageFixtureMedia(mdb, ids);
    before = await canonicalizeTree(ids.treeId);
    await roundTrip(ids);
    after = await canonicalizeTree(ids.treeId);
  }, 120_000);

  afterAll(async () => {
    restoreDataDir?.();
    __setTestDb(null);
    await mdb.close();
  });

  /**
   * Drop quarantined fields and re-sort with the projection's own comparator —
   * without the re-sort, a change in a dropped field could reshuffle the array
   * and fail the narrowed comparison for the very reason it excludes.
   */
  const omit = (rows: CanonicalRow[], ...keys: string[]): CanonicalRow[] =>
    sortByJson(rows.map(row => {
      const kept: CanonicalRow = {};
      for (const [k, v] of Object.entries(row)) if (!keys.includes(k)) kept[k] = v;
      return kept;
    }));

  const naturalKey = (p: CanonicalRow) => `${p.FirstName ?? ''}|${p.LastName ?? ''}|${p.BirthDate ?? ''}`;

  /**
   * Guards every channel below against passing vacuously: `toEqual([], [])` is
   * theatre, and a channel that silently seeded nothing would look like coverage.
   */
  it('every channel carries data on both sides of the round trip', () => {
    const channels = Object.keys(before) as Array<keyof CanonicalTree>;
    expect(channels).toHaveLength(13);
    for (const channel of channels) {
      expect(before[channel].length, `before.${channel}`).toBeGreaterThan(0);
      expect(after[channel].length, `after.${channel}`).toBeGreaterThan(0);
    }
  });

  // ── People ────────────────────────────────────────────────────────────────

  // The `Notes` omission this used to carry is gone with the column itself (#524 /
  // ADR 0010) — a person's note round-trips as a first-class Note + NoteLink and is
  // asserted, with its links, by 'preserves notes at every scope' below.
  it('preserves every person field except the GEDCOM xref', () =>
    expect(omit(after.people, 'GedcomId')).toEqual(omit(before.people, 'GedcomId')));

  it('keeps a stored GEDCOM xref that was unique and usable', () => {
    // The xref is the merge-reimport match key, so preserving the ones that CAN
    // be preserved is the semantic half of the quarantine below.
    const counts = new Map<string, number>();
    for (const p of before.people) {
      if (typeof p.GedcomId === 'string') counts.set(p.GedcomId, (counts.get(p.GedcomId) ?? 0) + 1);
    }
    const stable = before.people.filter(p => typeof p.GedcomId === 'string' && counts.get(p.GedcomId as string) === 1);
    expect(stable.length).toBeGreaterThan(0);
    const afterByKey = new Map(after.people.map(p => [naturalKey(p), p]));
    for (const p of stable) {
      expect(afterByKey.get(naturalKey(p))?.GedcomId, `xref of ${naturalKey(p)}`).toBe(p.GedcomId);
    }
  });

  // ACCEPTED, not quarantined — #404, ADR 0014. Every record is written as
  // `0 @XREF@ INDI`, and "Uniqueness of the cross-reference identifier is required
  // within the transmission file" (GEDCOM Specs/extracted/ged551-4.txt:225-227). A
  // person whose stored GedcomId is NULL, malformed, or shared with another person
  // therefore CANNOT keep it: `assignPersonXrefs` (lib/gedcom/generator.ts:265-296)
  // mints a fresh one. Preserving those verbatim would emit an invalid file, so
  // there is nothing to fix and this asserts the rule rather than quarantining it.
  //
  // The other half of the rule — an xref that WAS unique and usable survives
  // untouched — is asserted directly above; that is the half that matters, since
  // the xref is the merge-reimport match key.
  //
  // Deliberately NOT asserted: that a reminted xref differs from the value it
  // replaced. `nextFreeXref` counts up from '@I1@' skipping only xrefs it considers
  // usable, and a duplicated xref is by definition not usable — so a remint may
  // legitimately land back on the discarded value.
  it('remints exactly the xrefs that cannot legally survive, and keeps them unique', () => {
    const INDI_XREF = /^@I[A-Za-z0-9]+@$/;

    const counts = new Map<string, number>();
    for (const p of before.people) {
      if (typeof p.GedcomId === 'string') counts.set(p.GedcomId, (counts.get(p.GedcomId) ?? 0) + 1);
    }
    const isUsable = (p: CanonicalRow) =>
      typeof p.GedcomId === 'string'
      && INDI_XREF.test(p.GedcomId)
      && counts.get(p.GedcomId) === 1;

    // Non-vacuous: the fixture seeds both unusable shapes on purpose (pinned by
    // gedcom-roundtrip-coverage.pglite.test.ts's 'hostile shapes' guard).
    const unusable = before.people.filter(p => !isUsable(p));
    expect(before.people.some(p => p.GedcomId === null)).toBe(true);
    expect([...counts.values()].some(n => n > 1)).toBe(true);
    expect(unusable.length).toBeGreaterThan(1);

    // Every person comes back addressable by a well-formed INDI xref — a dropped or
    // malformed xref would make the record unreferenceable by FAMC/FAMS/OBJE.
    const afterByKey = new Map(after.people.map(p => [naturalKey(p), p]));
    for (const p of after.people) {
      expect(String(p.GedcomId), `xref of ${naturalKey(p)}`).toMatch(INDI_XREF);
    }
    // …including each one that had to be reminted.
    for (const p of unusable) {
      expect(String(afterByKey.get(naturalKey(p))?.GedcomId), `reminted xref of ${naturalKey(p)}`)
        .toMatch(INDI_XREF);
    }

    // The spec requirement itself: unique within the transmission.
    const afterIds = after.people.map(p => p.GedcomId);
    expect(new Set(afterIds).size, 'duplicate xref survived the round trip').toBe(afterIds.length);
  });

  // ── Families ──────────────────────────────────────────────────────────────

  it('preserves families and their children', () =>
    expect(after.families).toEqual(before.families));

  // ── Events ────────────────────────────────────────────────────────────────

  it('preserves every event field except the date', () =>
    expect(omit(after.events, 'Date')).toEqual(omit(before.events, 'Date')));

  // FIXED (#400, slice 2) — was quarantined as "NEW BUG #1, import side". The export
  // half had already been fixed (generator.ts routes person events through
  // formatDateForGedcom, matching the family path); the import half assigned the RAW
  // `value` to `currentEvent.Date` while BIRT/DEAT/MARR got `parseDate`, so
  // Events."Date" ended up holding two formats at once. It is now `parseDate(value)
  // ?? value` at all five sites, and existing rows were repaired by the v23 backfill
  // (lib/db/backfill-event-dates.ts). Do not re-quarantine.
  //
  // The companion assertion this replaces ("only their representation shifts",
  // comparing `after` against formatDateForGedcom(before)) is deliberately GONE
  // rather than kept: it encoded the shift as expected, so it would now fail on
  // correct behaviour. Its one useful part was the vacuity guard, retained below —
  // without it an all-empty date channel would satisfy the equality trivially.
  it('preserves event dates exactly', () => {
    expect(before.events.some(e => e.Date)).toBe(true);
    expect(after.events).toEqual(before.events);
  });

  // ── Sources, repositories, citations ──────────────────────────────────────

  it('preserves sources', () => expect(after.sources).toEqual(before.sources));

  it('preserves repositories', () => expect(after.repositories).toEqual(before.repositories));

  it('preserves citations and the facts they cite', () =>
    expect(after.citations).toEqual(before.citations));

  // ── Notes ─────────────────────────────────────────────────────────────────

  it('preserves notes attached to families and events', () => {
    const nonPerson = (rows: CanonicalRow[]) => rows.filter(n => n.OwnerTable !== 'People');
    expect(nonPerson(before.notes).length).toBeGreaterThan(0);
    expect(nonPerson(after.notes)).toEqual(nonPerson(before.notes));
  });

  // QUARANTINED — NEW BUG; needs a design decision, deliberately NOT fixed here.
  // UNQUARANTINED. This documented a real drop: a Note linked with
  // OwnerTable='People' had no export path at all — the shared-note set excluded
  // People (to avoid double-emitting against the legacy `People."Notes"` column)
  // while `generatePersonRecord` never read noteXrefsByOwner('People:<id>') the
  // way Events/Families/Sources do. The quarantine note called for a design call
  // rather than a patch — that call is ADR 0010 (#407): People move onto the
  // shared Note + NoteLink path. #524 finished it by dropping the column, so this
  // is now the ONLY assertion standing between a person's notes and silent loss.
  it('preserves notes at every scope', () =>
    expect(after.notes).toEqual(before.notes));

  // ── Name variants ─────────────────────────────────────────────────────────

  // Was quarantined for the double-insert (#398): the `1 NICK` / `1 _AKA` line
  // path and the sources.json loop each persisted the same row, so two variants
  // came back as four and doubled again on every round trip. The sidecar loop now
  // REUSES the row the line path created, matching on the variant's value tuple
  // (PersonId, Type, Name, FromDate, ToDate) per ADR 0009, and merges its
  // citations onto that row instead of a second one.
  it('preserves name variants apart from their primary flag', () =>
    expect(omit(after.nameVariants, 'IsPrimary')).toEqual(omit(before.nameVariants, 'IsPrimary')));

  // Was quarantined for the dropped primary flag (#399). `IsPrimary` now rides
  // sources.json — the channel ADR 0001 named — alongside FromDate/ToDate, which
  // were dropped for the same reason and are load-bearing in the identity tuple
  // above. Added as optional fields with no version bump: sidecars are
  // additive-only (ADR 0009).
  //
  // Do NOT "fix" a regression here by relaxing effectiveFirstName. Requiring
  // IsPrimary there is deliberate (ADR 0001) — it is what made 36 nicknames
  // invisible once, and the resolution was to SET the flag, not to stop requiring
  // it. A round trip that drops the flag silently renames people.
  //
  // Strictly a superset of the assertion above, so it also covers the duplicate.
  it('preserves the name-variant primary flag', () =>
    expect(after.nameVariants).toEqual(before.nameVariants));

  // ── Places ────────────────────────────────────────────────────────────────

  it('keeps Form and coordinates for a place a fact actually references', () => {
    // 'Paris, Île-de-France, France' is the fixture's BirthPlace/MarriagePlace, so
    // its gazetteer row reaches the .ged as PLAC.FORM + PLAC.MAP and comes back.
    const paris = (t: CanonicalTree) => t.places.find(p => p.Name === 'Paris, Île-de-France, France');
    expect(paris(before)).toBeDefined();
    expect(omit([paris(after) as CanonicalRow], 'parent'))
      .toEqual(omit([paris(before) as CanonicalRow], 'parent'));
  });

  it('never re-imports the header FORM as a place Form', () =>
    // Regression guard for the D3 fix in 1947a59: the header's
    // `1 FORM LINEAGE-LINKED` used to leak into every place's Form on import.
    expect(after.places.map(p => p.Form)).not.toContain('LINEAGE-LINKED'));

  // QUARANTINED — GEDCOM 5.5.1 format limitation.
  // The 5.5.1 record vocabulary is FAM / INDIVIDUAL / MULTIMEDIA / NOTE /
  // REPOSITORY / SOURCE / SUBMISSION / SUBMITTER
  // (GEDCOM Specs/extracted/ged551-2.txt:113-289); PLACE_STRUCTURE
  // (ged551-2.txt:659) is only ever a substructure of an event, so there is no
  // place record and a gazetteer row that no fact references has nowhere to go.
  // The fixture's 'France' row is referenced only as Paris's PARENT, so its
  // Form='Country' and coordinates (46.6, 2.2) are lost and the row is then
  // re-created empty by the importer's place-promotion pass
  // (lib/services/gedcom.ts:1400-1440), which also derives a deeper hierarchy
  // from the comma segments ('Île-de-France, France', 'Québec, Canada', …).
  // Carrying the gazetteer losslessly would mean a new bundle sidecar — a product
  // call, not a bug fix.
  it('preserves the gazetteer', () =>
    expect(after.places).toEqual(before.places));

  // ── Media ─────────────────────────────────────────────────────────────────

  it('preserves media apart from the fields the re-upload phase restores', () =>
    // "FilePath"/"ContentType" ARE now restored together by `patchMediaFile`
    // (lib/db/queries/media.ts:310-319) — the harness's `roundTrip()` runs the
    // same re-upload step a completed browser import always runs before this
    // channel is read (gedcom-bundle.ts). "file" (the basename of `FilePath`)
    // still can't be compared, though: the real route generates a FRESH
    // filename on every re-upload (media-upload.ts:280), so the basename
    // itself is not a fixed point even when the byte content is. "ContentType"
    // stays omitted too — the harness restores it from a pre-reimport snapshot
    // rather than re-running the real `sharp` compression pipeline on
    // (non-decodable) fixture bytes, so it is not independently exercised here
    // the way `file`'s renaming behavior is.
    // "IsPrimary" is NO LONGER omitted here — D2 is fixed (#401), so the flag is
    // now inside the strict comparison and a regression would fail this test.
    expect(omit(after.media, 'file', 'ContentType', 'IsPrimary'))
      .toEqual(omit(before.media, 'file', 'ContentType', 'IsPrimary')));

  // Proves the harness's simulated re-upload step (roundTrip(), gedcom-bundle.ts)
  // restores every reimported placeholder Media row's content — the same
  // fields `patchMediaFile` restores in a real browser import — so the record
  // is a fixed point apart from `file`. `file` (the basename of `FilePath`) is
  // excluded on purpose, not because it goes unrestored: a real re-upload
  // ALWAYS renames the file (media-upload.ts:280 generates a fresh
  // `imported_<ts>_<uuid><ext>` name per upload), so the basename is not a
  // fixed point even for a completed, successful round trip — only the
  // content behind it is. D2 (the fixture's lone non-primary photo on `fresh`
  // flipping to primary) is separately fixed — #401 / ADR 0014.
  it('preserves media records apart from the churning file basename', () =>
    expect(omit(after.media, 'file', 'IsPrimary')).toEqual(omit(before.media, 'file', 'IsPrimary')));

  it('preserves face tag regions and the person each tag names', () =>
    // 'file' is the tag's Media."FilePath" basename — excluded for the same
    // reason as the media test above: a real re-upload renames the file.
    expect(omit(after.mediaTags, 'file')).toEqual(omit(before.mediaTags, 'file')));

  // Proves the harness's simulated re-upload step restores the joined Media
  // row's tag-relevant fields before the tags are re-read. `file` stays
  // excluded here too: media-upload.ts:280 renames every file on a real
  // re-upload, so the basename is genuinely not stable across a round trip —
  // this asserts everything else that IS stable (region, person, primary,
  // title).
  it('preserves media face tags apart from the churning file basename', () =>
    expect(omit(after.mediaTags, 'file')).toEqual(omit(before.mediaTags, 'file')));
});
