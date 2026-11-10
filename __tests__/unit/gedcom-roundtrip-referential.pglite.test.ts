import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';
import { readBundle, stageFixtureMedia, type Bundle } from '../setup/gedcom-bundle';
import { isExternalMediaReference } from '@/lib/gedcom/media-match';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Cross-channel referential integrity of ONE export.
 *
 * The zip bundle splits a tree across four channels: `family_tree.ged` holds the
 * INDI/FAM/SOUR records, and `cases.json` / `sources.json` / `media.json` point
 * back into it by xref (`@I5@`, `@S1@`) while `media/*` binaries are matched by
 * file basename. Nothing in the format checks those pointers, so a sidecar can
 * reference an xref that names a DIFFERENT person and the bundle still imports
 * cleanly — silently reattributing photos and name variants. That is the bug
 * class Task 1 fixed (sidecars derived xrefs by array index while the generator
 * honoured stored `GedcomId`s); these assertions encode the invariant.
 *
 * Deliberately a FIRST export only, never a round trip: reimport does not restore
 * `Media.FilePath` (by design — the browser re-uploads bytes as a separate phase),
 * and `buildMediaSidecar` drops entries with a null `FilePath`, so a second export
 * has empty `libraryMedia`/`tags` and every media assertion here would go vacuous.
 */
describe('sidecar xrefs resolve to the right records in the .ged', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  let bundle: Bundle;
  let restoreDataDir: () => void;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1');
    ids = await seedRoundTripFixture(mdb);
    // Without staged files on disk the exporter's fs.existsSync guard zips no
    // media at all, and the media assertions below would pass on empty sets.
    restoreDataDir = await stageFixtureMedia(mdb, ids);
    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const result = await exportGedcomService({
      requestedTreeId: ids.treeId,
      requestedOwnerId: null,
      currentUserId: ids.userId,
      includeMedia: true,
    });
    if (result.kind !== 'zip') throw new Error('expected a zip bundle');
    bundle = await readBundle(result.buffer);
  }, 60_000);

  afterAll(async () => {
    restoreDataDir?.();
    __setTestDb(null);
    await mdb.close();
  });

  /** Every `0 @X@ TAG` record header in the file, as the set of xrefs for `tag`. */
  function xrefsOfType(ged: string, tag: string): Set<string> {
    const out = new Set<string>();
    for (const line of ged.split(/\r?\n/)) {
      const m = /^0 (@[A-Za-z0-9]+@) ([A-Z]+)$/.exec(line.trim());
      if (m && m[2] === tag) out.add(m[1]);
    }
    return out;
  }

  /**
   * The `1 NAME` value under a given INDI xref — identity, not just presence.
   * Returns a marker string rather than null when the xref resolves to no INDI
   * (or a nameless one) so a dangling pointer fails the `toContain` assertion
   * with a readable message instead of a type error.
   */
  function nameOf(ged: string, xref: string): string {
    const lines = ged.split(/\r?\n/);
    const start = lines.findIndex(l => l.trim() === `0 ${xref} INDI`);
    if (start === -1) return `<no INDI ${xref}>`;
    for (let i = start + 1; i < lines.length && !lines[i].startsWith('0 '); i++) {
      const m = /^1 NAME (.*)$/.exec(lines[i].trim());
      if (m) return m[1];
    }
    return `<INDI ${xref} has no NAME>`;
  }

  it('every media.json tag person xref exists as an INDI', () => {
    const indis = xrefsOfType(bundle.ged, 'INDI');
    const { tags } = bundle.media as { tags: Array<{ person: string }> };
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(indis, `tag person ${t.person}`).toContain(t.person);
  });

  it('the face tag resolves to the tagged person, not whoever sits at that index', async () => {
    // The fixture tags the canonical primary owner, so the sidecar xref must
    // resolve to that exact INDI rather than an index-derived neighbouring row.
    const { assignPersonXrefs } = await import('@/lib/gedcom/generator');
    // Reuse the exporter's own reader: assignPersonXrefs allocates fresh xrefs in
    // array order, so a different ORDER BY here would give a different answer.
    const { getPeopleForExport } = await import('@/lib/db/queries/gedcom-export');
    const expected = assignPersonXrefs(await getPeopleForExport(ids.treeId)).get(ids.personIds.stored);
    expect(expected).toBeDefined();

    const { tags } = bundle.media as { tags: Array<{ person: string }> };
    expect(tags).toHaveLength(1);
    expect(tags[0].person).toBe(expected);
    expect(nameOf(bundle.ged, tags[0].person)).toContain('Élodie');
  });

  it('every sources.json nameVariant person xref exists as an INDI', () => {
    const indis = xrefsOfType(bundle.ged, 'INDI');
    const { nameVariants } = bundle.sources as { nameVariants: Array<{ person: string }> };
    expect(nameVariants.length).toBeGreaterThan(0);
    for (const nv of nameVariants) {
      expect(indis, `nameVariant person ${nv.person}`).toContain(nv.person);
    }
  });

  it('the name variants resolve to the person that actually owns them', () => {
    // Both fixture variants belong to `stored` (Élodie); they must not drift onto
    // a neighbouring INDI the way an index-derived xref would.
    const { nameVariants } = bundle.sources as { nameVariants: Array<{ person: string; name: string }> };
    expect(nameVariants.map(nv => nv.name).sort()).toEqual(['Ellie', 'É. Smith']);
    for (const nv of nameVariants) {
      expect(nameOf(bundle.ged, nv.person), `nameVariant ${nv.name}`).toContain('Élodie');
    }
  });

  it('every sidecar source xref exists as a SOUR record', () => {
    const sours = xrefsOfType(bundle.ged, 'SOUR');
    const { sources } = bundle.sources as { sources: Array<{ xref: string }> };
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(sours, `source ${s.xref}`).toContain(s.xref);
  });

  it('defines each media xref once and resolves every owner pointer', () => {
    const definitions = [...bundle.ged.matchAll(/^0 (@O\d+)@? OBJE$/gm)].map(m => m[1].endsWith('@') ? m[1] : `${m[1]}@`);
    const uniqueDefinitions = new Set(definitions);
    expect(definitions.length).toBeGreaterThan(0);
    expect(uniqueDefinitions.size).toBe(definitions.length);

    const pointers = [...bundle.ged.matchAll(/^\d+ OBJE (@O\d+@)$/gm)].map(m => m[1]);
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) expect(uniqueDefinitions).toContain(pointer);
  });

  it('preserves exact shared and ownerless media link cardinality', async () => {
    const shared = await mdb.query<{ Id: number }>(
      `SELECT "Id" FROM "Media" WHERE "TreeId" = $1 AND "Title" = 'Shared all-owner photo'`, [ids.treeId],
    );
    expect(shared.rows).toHaveLength(1);
    const links = await mdb.query<{ OwnerTable: string; IsPrimary: number }>(
      `SELECT "OwnerTable", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1 ORDER BY "OwnerTable"`, [shared.rows[0].Id],
    );
    expect(links.rows).toEqual([
      { OwnerTable: 'Events', IsPrimary: 0 },
      { OwnerTable: 'Families', IsPrimary: 0 },
      { OwnerTable: 'People', IsPrimary: 1 },
      { OwnerTable: 'Sources', IsPrimary: 0 },
    ]);
    const ownerless = await mdb.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "Media" m
        WHERE m."TreeId" = $1 AND m."Title" = 'Library photo'
          AND NOT EXISTS (SELECT 1 FROM "MediaLink" l WHERE l."MediaId" = m."Id")`, [ids.treeId],
    );
    expect(ownerless.rows[0].n).toBe(1);
  });

  it('every media.json xref is defined and present in the zip', () => {
    const { focalGeometry, tags } = bundle.media as {
      focalGeometry: Array<{ media: string }>;
      tags: Array<{ media: string }>;
    };
    const mediaXrefs = new Set([...focalGeometry, ...tags].map(m => m.media));
    expect(focalGeometry.length).toBeGreaterThan(0);
    expect(tags.length).toBeGreaterThan(0);
    for (const xref of mediaXrefs) {
      expect(bundle.ged).toMatch(new RegExp(`^0 ${xref} OBJE$`, 'm'));
      // A pending desktop reference (#958) keeps its own FILE text and ships no bytes.
      const declared = new RegExp(`^0 ${xref} OBJE\\n1 FILE ([^\\r\\n]+)$`, 'm').exec(bundle.ged)?.[1];
      if (declared && isExternalMediaReference(declared)) continue;
      // Bundle v3 (#937): the FILE line is the zip entry's path, `media/O<n>-<name>`.
      expect(declared).toMatch(new RegExp(`^media/${xref.slice(1, -1)}-[^/]+$`));
      expect([...bundle.mediaFiles.keys()]).toContain(declared);
    }
  });

  it('zips exactly one entry per distinct stored media basename, and nothing else', async () => {
    // Media files are keyed across channels by BASENAME alone: the exporter zips
    // `media/${path.basename(FilePath)}`, both sidecars emit the same basename,
    // and the importer's `basenameToMediaId` map pairs an uploaded blob back to
    // its placeholder row by that key. So the invariant worth locking is a
    // bijection — every distinct stored basename reaches the zip exactly once,
    // and the zip carries no entry that no Media row accounts for.
    //
    // The fixture deliberately seeds two Media rows sharing the basename
    // `portrait.jpg`, and the two collapse into a single observed entry. Note
    // WHERE that happens: the exporter does NOT dedupe — archiver appends one
    // entry per Media row (lib/services/gedcom-export.ts:273-275 inside the
    // per-media loop), so the zip really does carry two same-named members. The
    // collapse is on the READ side, because `JSZip.files` is an object keyed by
    // entry name, so the second load overwrites the first
    // (__tests__/setup/gedcom-bundle.ts:19-29). This assertion therefore does not
    // prove anything about exporter dedupe in either direction — it locks the
    // basename bijection as observed through a zip reader.
    // The collision is NOT asserted as a defect, because it is unreachable in
    // production: the
    // upload service is the only writer of `Media.FilePath` (it is excluded from
    // ALLOWED_MEDIA_FIELDS in lib/db/queries/media.ts, and GEDCOM import inserts
    // NULL then patches via the same service), and every name it mints carries a
    // millisecond stamp plus 8 hex chars of a random UUID —
    // `<personId>_<ts>_<uuid8>.jpg`, `case_<ts>_<uuid8>.jpg`,
    // `imported_<ts>_<uuid8>.jpg` (lib/services/media-upload.ts:152-153,244).
    const expectedEntries = [...bundle.ged.matchAll(/^0 (@O\d+@) OBJE\n1 FILE (media\/[^\r\n]+)$/gm)]
      .map(m => m[2]).sort();
    expect(expectedEntries.length).toBeGreaterThan(1);
    expect([...bundle.mediaFiles.keys()].sort()).toEqual(expectedEntries);
  });
});
