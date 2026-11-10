import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// "Places"."UserId" REFERENCES "Users", so this suite needs a real Users row.
const SIDECAR_USER = 987663;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

const MINIMAL_GED = ['0 HEAD', '0 @I1@ INDI', '1 NAME A /B/', '0 TRLR'].join('\n');

/**
 * A .ged that actually carries PLAC.MAP coordinates and a PLAC.FORM for
 * 'Springfield' — deliberately DISAGREEING with what the curated tree holds.
 *
 * MINIMAL_GED has no PLAC lines at all, so `placeCoords` and `places` both come
 * back empty and the coordinate/promotion passes never run. Every assertion
 * written against it is therefore blind to anything those passes do, which is
 * exactly how two clobbers survived a green suite. Any test about "does a merge
 * protect curated gazetteer data" has to use THIS fixture, not that one.
 */
const GED_WITH_PLACE_COORDS = [
  '0 HEAD',
  '0 @I1@ INDI',
  '1 NAME A /B/',
  '1 BIRT',
  '2 PLAC Springfield',
  '3 FORM Township',
  '3 MAP',
  '4 LATI N11.1',
  '4 LONG W22.2',
  '0 TRLR',
].join('\n');

/**
 * #402 — the destructive edge of places.json.
 *
 * Overwrite wipes "Places" first (gedcom.ts), so the upsert's ON CONFLICT path is
 * only ever reached in MERGE mode. That is the dangerous direction: the target
 * tree's gazetteer is the user's own curation and the incoming bundle is the
 * stranger. These assert that a merge FILLS GAPS and never overwrites a decision.
 */
d('places.json restore does not clobber a curated gazetteer on merge (#402)', () => {
  let treeId: number;

  beforeEach(async () => {
    await query(
      `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)
       ON CONFLICT ("Id") DO NOTHING`,
      [SIDECAR_USER, `sidecar-${SIDECAR_USER}@example.com`, `sidecar-${SIDECAR_USER}`],
    );
    treeId = await resolveDefaultTree(SIDECAR_USER);
  });

  afterEach(async () => {
    await query('DELETE FROM "Places" WHERE "UserId" = $1', [SIDECAR_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [SIDECAR_USER]);
    await query('DELETE FROM "Users" WHERE "Id" = $1', [SIDECAR_USER]);
  });

  const merge = (placesJson: string) => importGedcomService({
    file: gedFile(MINIMAL_GED),
    mode: 'merge',
    placesJson,
    currentUserId: SIDECAR_USER,
    requestedTreeId: treeId,
  });

  it('fills a NULL field from the bundle', async () => {
    await query(
      `INSERT INTO "Places" ("UserId","TreeId","Name") VALUES ($1,$2,'Springfield')`,
      [SIDECAR_USER, treeId],
    );
    await merge(JSON.stringify({ version: 1, places: [{ name: 'Springfield', form: 'City', latitude: 39.8 }] }));
    const r = await query(`SELECT "Form", "Latitude" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Springfield'`, [treeId]);
    expect(r.rows[0]).toMatchObject({ Form: 'City' });
    expect(Number((r.rows[0] as { Latitude: number }).Latitude)).toBeCloseTo(39.8);
  });

  it('never replaces a value the user already set', async () => {
    await query(
      `INSERT INTO "Places" ("UserId","TreeId","Name","Form","Latitude") VALUES ($1,$2,'Springfield','Village',1.5)`,
      [SIDECAR_USER, treeId],
    );
    await merge(JSON.stringify({ version: 1, places: [{ name: 'Springfield', form: 'City', latitude: 39.8 }] }));
    const r = await query(`SELECT "Form", "Latitude" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Springfield'`, [treeId]);
    expect(r.rows[0]).toMatchObject({ Form: 'Village' });
    expect(Number((r.rows[0] as { Latitude: number }).Latitude)).toBeCloseTo(1.5);
  });

  // PinSuppressed is a boolean, so it has no NULL to distinguish "unset" from
  // "deliberately false" — COALESCE cannot protect it and it is never overwritten.
  it('does not un-suppress a pin the user deliberately suppressed', async () => {
    await query(
      `INSERT INTO "Places" ("UserId","TreeId","Name","PinSuppressed") VALUES ($1,$2,'Nowhere',TRUE)`,
      [SIDECAR_USER, treeId],
    );
    await merge(JSON.stringify({ version: 1, places: [{ name: 'Nowhere', pinSuppressed: false }] }));
    const r = await query(`SELECT "PinSuppressed" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Nowhere'`, [treeId]);
    expect((r.rows[0] as { PinSuppressed: boolean }).PinSuppressed).toBe(true);
  });

  it('does not re-parent a place the user deliberately re-parented', async () => {
    for (const n of ['Illinois', 'Massachusetts']) {
      await query(`INSERT INTO "Places" ("UserId","TreeId","Name") VALUES ($1,$2,$3)`, [SIDECAR_USER, treeId, n]);
    }
    const mass = await query(`SELECT "Id" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Massachusetts'`, [treeId]);
    const massId = (mass.rows[0] as { Id: number }).Id;
    await query(
      `INSERT INTO "Places" ("UserId","TreeId","Name","ParentId") VALUES ($1,$2,'Springfield',$3)`,
      [SIDECAR_USER, treeId, massId],
    );

    await merge(JSON.stringify({ version: 1, places: [{ name: 'Springfield', parent: 'Illinois' }] }));

    const r = await query(
      `SELECT p."Name" AS "ParentName" FROM "Places" c JOIN "Places" p ON p."Id" = c."ParentId"
       WHERE c."TreeId" = $1 AND c."Name" = 'Springfield'`,
      [treeId],
    );
    expect((r.rows[0] as { ParentName: string }).ParentName).toBe('Massachusetts');
  });

  it('still links a parent when the place has none yet', async () => {
    await merge(JSON.stringify({
      version: 1,
      places: [{ name: 'Illinois' }, { name: 'Springfield', parent: 'Illinois' }],
    }));
    const r = await query(
      `SELECT p."Name" AS "ParentName" FROM "Places" c JOIN "Places" p ON p."Id" = c."ParentId"
       WHERE c."TreeId" = $1 AND c."Name" = 'Springfield'`,
      [treeId],
    );
    expect((r.rows[0] as { ParentName: string }).ParentName).toBe('Illinois');
  });

  // A hand-edited or merged-from-elsewhere bundle can name two places as each
  // other's parent. Both edges pass a naive self-link check, and the resulting
  // cycle silently corrupts every breadcrumb and rollup that walks ParentId.
  it('refuses a parent edge that would close a cycle', async () => {
    await merge(JSON.stringify({
      version: 1,
      places: [{ name: 'Alpha', parent: 'Beta' }, { name: 'Beta', parent: 'Alpha' }],
    }));
    const r = await query(
      `SELECT "Name", "ParentId" FROM "Places" WHERE "TreeId" = $1 AND "Name" IN ('Alpha','Beta') ORDER BY "Name"`,
      [treeId],
    );
    const rows = r.rows as Array<{ Name: string; ParentId: number | null }>;
    expect(rows).toHaveLength(2);
    // Exactly one edge survives — never both, which is what would form the loop.
    expect(rows.filter((x) => x.ParentId !== null)).toHaveLength(1);
  });

  it('refuses a self-parent edge', async () => {
    await merge(JSON.stringify({ version: 1, places: [{ name: 'Solo', parent: 'Solo' }] }));
    const r = await query(`SELECT "ParentId" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Solo'`, [treeId]);
    expect((r.rows[0] as { ParentId: number | null }).ParentId).toBeNull();
  });

  /**
   * The sidecar restore runs FIRST and keeps the existing value on conflict — but
   * two later passes in the same import also write "Places" by name, and they did
   * not share that rule. The restore's protection was undone a few hundred lines
   * later, for the commonest input there is: a bundle whose .ged encodes the same
   * places the sidecar describes.
   *
   * These use GED_WITH_PLACE_COORDS so those passes actually execute, and give the
   * .ged DIFFERENT values from the curated tree so a clobber is visible. Identical
   * values are why the round-trip fixture could not see this.
   */
  describe('later passes must not undo the restore', () => {
    const mergeWithPlaces = (placesJson?: string) => importGedcomService({
      file: gedFile(GED_WITH_PLACE_COORDS),
      mode: 'merge',
      placesJson,
      currentUserId: SIDECAR_USER,
      requestedTreeId: treeId,
    });

    it('keeps a curated coordinate when the .ged PLAC.MAP disagrees', async () => {
      await query(
        `INSERT INTO "Places" ("UserId","TreeId","Name","Latitude","Longitude")
         VALUES ($1,$2,'Springfield',39.8,-89.6)`,
        [SIDECAR_USER, treeId],
      );

      await mergeWithPlaces(JSON.stringify({
        version: 1,
        places: [{ name: 'Springfield', latitude: 39.8, longitude: -89.6 }],
      }));

      const r = await query(
        `SELECT "Latitude", "Longitude" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Springfield'`,
        [treeId],
      );
      const row = r.rows[0] as { Latitude: number; Longitude: number };
      expect(Number(row.Latitude)).toBeCloseTo(39.8);
      expect(Number(row.Longitude)).toBeCloseTo(-89.6);
    });

    it('keeps a curated Form when the .ged PLAC.FORM disagrees', async () => {
      await query(
        `INSERT INTO "Places" ("UserId","TreeId","Name","Form") VALUES ($1,$2,'Springfield','City')`,
        [SIDECAR_USER, treeId],
      );

      await mergeWithPlaces(JSON.stringify({
        version: 1,
        places: [{ name: 'Springfield', form: 'City' }],
      }));

      const r = await query(
        `SELECT "Form" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Springfield'`,
        [treeId],
      );
      expect(r.rows[0]).toMatchObject({ Form: 'City' });
    });

    // The same protection must hold with no sidecar at all — a plain .ged merged
    // into a curated tree is the case a places.json-shaped fix would miss.
    it('keeps curated values on a plain .ged merge with no sidecar', async () => {
      await query(
        `INSERT INTO "Places" ("UserId","TreeId","Name","Form","Latitude","Longitude")
         VALUES ($1,$2,'Springfield','City',39.8,-89.6)`,
        [SIDECAR_USER, treeId],
      );

      await mergeWithPlaces(undefined);

      const r = await query(
        `SELECT "Form", "Latitude", "Longitude" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Springfield'`,
        [treeId],
      );
      const row = r.rows[0] as { Form: string; Latitude: number; Longitude: number };
      expect(row.Form).toBe('City');
      expect(Number(row.Latitude)).toBeCloseTo(39.8);
      expect(Number(row.Longitude)).toBeCloseTo(-89.6);
    });

    // Gap-filling must still work — the fix is "never replace", not "never write".
    it('still fills an empty gazetteer row from the .ged', async () => {
      await query(
        `INSERT INTO "Places" ("UserId","TreeId","Name") VALUES ($1,$2,'Springfield')`,
        [SIDECAR_USER, treeId],
      );

      await mergeWithPlaces(undefined);

      const r = await query(
        `SELECT "Form", "Latitude", "Longitude" FROM "Places" WHERE "TreeId" = $1 AND "Name" = 'Springfield'`,
        [treeId],
      );
      const row = r.rows[0] as { Form: string; Latitude: number; Longitude: number };
      expect(row.Form).toBe('Township');
      expect(Number(row.Latitude)).toBeCloseTo(11.1);
      expect(Number(row.Longitude)).toBeCloseTo(-22.2);
    });
  });
});
