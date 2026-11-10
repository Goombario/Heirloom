import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';
import { roundTrip, normalizeBundle, omitMediaFile, stageFixtureMedia, type Bundle } from '../setup/gedcom-bundle';
import { normalizeGedcomArchivePaths } from '../setup/gedcom-canonical';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Drop the FILE/FORM sub-lines of every OBJE block, and their CONC/CONT children,
 * leaving every other line untouched. Deliberately OBJE-scoped rather than a
 * blanket tag match: the header carries `2 FORM LINEAGE-LINKED` and a PLAC can
 * carry its own `FORM`, and eating those would mask defect 3 — the exact class of
 * regression this assertion exists to catch.
 *
 * Recognises only INLINE `n OBJE` openers. A top-level `0 @O1@ OBJE` multimedia
 * record would put the xref in the tag position and go unnoticed — which is safe
 * (it under-strips, never over-strips) and unreachable today, since the generator
 * only ever emits inline OBJE blocks. Revisit if that changes.
 */
describe('GEDCOM bundle round-trip is a fixed point', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  let first: Bundle;
  let second: Bundle;
  let restoreDataDir: () => void;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1');
    ids = await seedRoundTripFixture(mdb);
    restoreDataDir = await stageFixtureMedia(mdb, ids);
    ({ first, second } = await roundTrip(ids));
  }, 60_000);
  afterAll(async () => {
    restoreDataDir?.();
    __setTestDb(null);
    await mdb.close();
  });

  // Archive basenames are the only deliberately volatile GEDCOM values: a
  // completed import mints a fresh upload filename. OBJE FILE/FORM content,
  // record order, and every other line remain strict fixed-point evidence.
  //
  //   - #400 (FIXED in slice 2): person events used to come back in a DIFFERENT
  //     ORDER. `getEventsByPersonId` sorts `ORDER BY "Date"` (events.ts:33) on a
  //     TEXT column, so ordering is lexicographic — chronological only while the
  //     values are ISO. The parser stored the RAW GEDCOM value for event dates, so
  //     after a reimport the fixture held '1 JAN 1930' (RESI) and '2 OCT 1837' (the
  //     custom EVEN), and '1' < '2' put RESI first where ISO had put 1837 first.
  //
  // Keep this comparison ORDER-SENSITIVE. The reordering above was invisible for as
  // long as it was, because the measurement that preceded this assertion diffed the
  // two exports as SETS — and a pure reordering has an empty set difference.
  //
  // FIXED since this quarantine was written — do not re-add:
  //   - Defect 2: a lone non-primary photo flipped to `_PRIM Y` on reimport.
  //     #401 / ADR 0014 — the generator now emits `_PRIM N` and both parser
  //     handlers read the negative.
  //   - Defect 3: HEAD.GEDC.FORM bleeding into HEAD.PLAC.FORM. See the passing
  //     regression guard below and __tests__/unit/gedcom-parser.test.ts.
  //   - Defect 4: note `@Nx@` xrefs were unstable across reimport. #405 — labels
  //     are now minted in first-reference order rather than by Note."Id", so they
  //     no longer depend on row ids a reimport reassigns.
  //   - #525: `flushEvents` (the batched OVERWRITE path) omitted "RawGedcom" from
  //     its Events column list, so every event's passthrough was dropped on an
  //     overwrite import while the inline merge path kept it. That was the lone
  //     `2 AGNC Ville de Montréal` line in the measured delta.
  //   - Defect 5: the overwrite import inserted each NameVariant twice. See the
  //     sources.json assertions below.
  it('re-exports an identical .ged after normalizing only archive paths', () => {
    expect(normalizeGedcomArchivePaths(second.ged)).toEqual(normalizeGedcomArchivePaths(first.ged));
  });

  it('retains OBJE FILE/FORM lines and the header FORM', () => {
    expect(first.ged).toMatch(/^1 FILE /m);
    expect(second.ged).toMatch(/^1 FILE /m);
    expect(second.ged).toContain('2 FORM LINEAGE-LINKED');
  });

  it('re-exports identical cases.json (modulo exported_at)', () => {
    expect(normalizeBundle(second).cases).toEqual(normalizeBundle(first).cases);
  });

  it('exports only structured case citations', () => {
    const cases = (first.cases.cases as Array<Record<string, unknown>>);
    expect(cases[0]).not.toHaveProperty('citations');
    // #1035: every Citation field rides along, keyed by the source's xref.
    expect(cases[0].sourceCitations).toEqual([{
      source: '@S1@', page: 'p. 8', note: null, quay: '2', dataText: 'Baptised the 3rd, godfather present.',
      dataDate: '3 JAN 1900', even: 'BAPM', role: 'CHIL', url: 'https://records.example.org/case/8',
    }]);
    // #801: a researcher's note keeps the old shape; a status line names its Kind.
    const comments = cases[0].comments as Array<Record<string, unknown>>;
    expect(comments.map(c => [c.Body, c.Kind])).toEqual([
      ['Check the original register before closing the case.', undefined],
      ['on_hold', 'status'],
    ]);
    // #1068: photos by the same media xrefs the .ged declares; #1035: the entry's citation.
    const objeXrefs = [...first.ged.matchAll(/^0 (@O\d+@) OBJE$/gm)].map(m => m[1]);
    expect(cases[0].media).toEqual([expect.stringMatching(/^@O\d+@$/)]);
    expect(objeXrefs).toContain((cases[0].media as string[])[0]);
    expect(objeXrefs).toContain(comments[0].media);
    expect(comments[0].citation).toEqual({
      source: '@S1@', page: 'p. 9', note: 'Margin note.', quay: '1', dataText: 'Entry 9, struck through.',
      url: 'https://records.example.org/journal/9',
    });
    expect(comments[1]).not.toHaveProperty('media');
    expect(comments[1]).not.toHaveProperty('citation');
  });

  // The whole sidecar is a fixed point again now that #398/#399 are fixed — the
  // `nameVariants` hold-out below is gone, so this covers `version`, `sources`
  // AND `nameVariants` together.
  it('re-exports identical sources.json', () => {
    expect(second.sources).toEqual(first.sources);
  });

  // places.json (#402) is the one sidecar that is PRIMARY rather than a mirror —
  // GEDCOM has no PLACE record, so an unreferenced row, the parent hierarchy and
  // the geocoder fields exist nowhere in the .ged. If the reimport ignored it,
  // the second export would come back with those fields stripped.
  it('re-exports identical places.json', () => {
    expect(second.places).toEqual(first.places);
  });

  it('carries the whole gazetteer, not only fact-referenced places', () => {
    const names = (first.places.places as Array<{ name: string }>).map(p => p.name);
    // 'France' and 'Canada' are named by no fact — they exist only as parents.
    expect(names).toContain('France');
    expect(names).toContain('Canada');
    expect(names).toContain('Paris, Île-de-France, France');
  });

  // Was quarantined as defect 5: the overwrite path inserted every NameVariant
  // twice (once from the `1 NICK` / `1 _AKA` line, once from the sources.json
  // loop), so the second export emitted four variants where the first emitted
  // two, doubling again on every round trip. The sidecar loop now reuses the
  // line path's row rather than inserting a second — ADR 0009.
  //
  // Kept as its own assertion despite being implied by the one above: this is the
  // channel that regressed, and a targeted failure names the defect directly.
  it('re-exports identical sources.json name variants', () => {
    expect(second.sources.nameVariants).toEqual(first.sources.nameVariants);
  });

  // The sidecar `version` must NOT move when fields are added — sidecars are
  // additive-only, and a bump is reserved for a non-additive change (ADR 0009).
  // isPrimary/fromDate/toDate landed under exactly that rule.
  it('keeps the sources.json version at 1 after adding optional fields', () => {
    expect(first.sources.version).toBe(1);
    expect(second.sources.version).toBe(1);
  });

  // Proves the harness's simulated re-upload step (roundTrip(), gedcom-bundle.ts)
  // restores every reimported Media row's FilePath before the second export, so
  // buildMediaSidecar (lib/gedcom/media-sidecar.ts:82,95) no longer drops
  // libraryMedia/tags entries for a null FilePath — media.json carries the same
  // entries end to end, matching what a completed browser import always leaves
  // behind. The `file` basename is excluded via `omitMediaFile`: a real
  // re-upload always renames the file (media-upload.ts:280 generates a fresh
  // `imported_<ts>_<uuid><ext>` name), so the basename itself is NOT a fixed
  // point even for a real, successful round trip — only the content is. Every
  // other field (title/format/focal*/person/region/primary) stays under full
  // equality.
  it('re-exports identical media.json apart from the churning file basename', () => {
    expect(omitMediaFile(second.media)).toEqual(omitMediaFile(first.media));
  });

  it('emits every expected bundle entry', () => {
    expect(first.cases).toHaveProperty('cases');
    expect(first.sources).toHaveProperty('nameVariants');
    expect(first.media).toHaveProperty('focalGeometry');
    expect(first.media).toHaveProperty('tags');
    expect((first.media as { dates?: Array<{ date: string }> }).dates?.map(d => d.date)).toEqual(['ABT 1900']);
  });

  it('uses the declared canonical media path for each exported byte entry', () => {
    const gedPaths = first.ged.split('\n')
      .filter((line) => /^1 FILE media\/O\d+-/.test(line))
      .map((line) => line.slice('1 FILE '.length));
    expect(new Set(gedPaths)).toEqual(new Set(first.mediaFiles.keys()));
  });

  it('carries a PDF document through export and re-import as a PDF (#510)', async () => {
    const pdfEntries = [...second.mediaFiles.keys()].filter((name) => name.endsWith('.pdf'));
    expect(pdfEntries).toHaveLength(1);
    expect(second.ged).toMatch(/^1 FILE media\/O\d+-birth-register\.pdf\n2 FORM PDF$/m);
    const r = await query(
      `SELECT "ContentType", "FilePath" FROM "Media" WHERE "TreeId" = $1 AND "Title" = 'Birth register'`, [ids.treeId],
    );
    expect(r.rows).toEqual([expect.objectContaining({ ContentType: 'application/pdf', FilePath: expect.stringMatching(/\.pdf$/) })]);
  });

  it('stages real media bytes into the first export zip', () => {
    expect(first.mediaFiles.size).toBeGreaterThan(0);
  });

  // Proves the harness's simulated re-upload step patches FilePath back onto
  // every reimported placeholder Media row, so exportGedcomService's
  // fs.existsSync guard (lib/services/gedcom-export.ts:275) finds real bytes on
  // disk for the second export too — not just the first.
  it('stages real media bytes into the second export zip too', () => {
    expect(second.mediaFiles.size).toBeGreaterThan(0);
  });

  // `importGedcomService` itself leaves EVERY reimported Media row with
  // `FilePath` NULL (measured: total=4, with_path=0 straight after reimport);
  // what fills them in is the browser's mandatory per-file recovery step
  // (`app/import-export/page.tsx` → `client.gedcom.materializeImportMedia` →
  // `lib/services/media-upload.ts`'s materialization service), which `roundTrip()`
  // (`__tests__/setup/gedcom-bundle.ts`) mirrors for each `mediaItems` entry.
  //
  // So this asserts the patch loop's COVERAGE, not merely that some rows have a
  // path: `with_path === total` means every reimported row was re-uploaded, the
  // state a completed browser import always leaves behind. A future fixture
  // media row the loop misses (one absent from `mediaItems`, say) is caught here
  // and NOT by the other media assertions in this file — the sidecar
  // comparisons only need enough rows to survive `buildMediaSidecar`'s
  // FilePath filter, so a partially-patched tree can still satisfy them.
  it('re-uploads every reimported Media row, not merely enough of them', async () => {
    const r = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT("FilePath")::int AS with_path,
              COUNT(*) FILTER (WHERE "FilePath" IS NULL AND "SourceFile" IS NOT NULL)::int AS references
         FROM "Media" WHERE "TreeId" = $1`, [ids.treeId],
    );
    const { total, with_path, references } = r.rows[0] as { total: number; with_path: number; references: number };
    expect(total).toBeGreaterThan(0);
    // The fixture's one desktop reference (#958) has no bytes to re-upload.
    expect(references).toBe(1);
    expect(with_path).toBe(total - references);
  });

  // Regression guard against silently going back to fabricating a `FilePath`
  // production never writes (the exact review finding this fix addresses): a
  // real re-upload always MINTS A NEW basename (media-upload.ts:280), so the
  // second export's stored basenames must be disjoint from the first's, not
  // merely non-null. If this ever failed, it would mean the harness stopped
  // materializing through the exact `mediaItems[].archivePath` identity again — the exact bug
  // FINDING 1 caught — and every other media assertion above would be
  // comparing a fabricated fixed point instead of the real one.
  // #802 (MD-2): archive names come from the photo's title, not the stored file
  // (which a re-upload renames), so they survive the round trip unchanged.
  it('names each exported media file from its title, stably across a round trip', () => {
    const names = [...first.mediaFiles.keys()];
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((name) => /^media\/O\d+-portrait\.jpg$/.test(name))).toBe(true);
    expect(new Set(second.mediaFiles.keys())).toEqual(new Set(names));
  });

  // Passing regression guard for the defect-3 fix (parser.ts headerPlacLevel
  // gating). Both quarantined-.ged assertions above are it.fails, so without
  // this, a regression that reintroduced the HEAD.GEDC.FORM bleed would be
  // invisible: the whole-.ged it.fails would just keep failing for a
  // different reason and nothing would flag it. The fixture's own places
  // ("Montréal, Québec, Canada" etc.) are never given an explicit Places.Form,
  // so a reappearing `3 FORM LINEAGE-LINKED` under one of their PLAC lines
  // (level 2 PLAC → level 3 FORM) would mean the header bleed is back, while
  // the header's own legitimate `2 FORM LINEAGE-LINKED` (under `1 GEDC`) must
  // still be present and untouched.
  it('never lets HEAD.GEDC.FORM leak into a place FORM on re-export', () => {
    expect(second.ged).not.toMatch(/^3 FORM LINEAGE-LINKED$/m);
    // Sanity: the header's own (legitimate) GEDC.FORM declaration is still there.
    expect(second.ged).toMatch(/^2 FORM LINEAGE-LINKED$/m);
  });
});
