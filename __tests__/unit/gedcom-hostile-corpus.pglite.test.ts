import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService, previewGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { openGedcomZip } from '@/lib/gedcom/zip-bundle';
import { findMissingMediaRefs } from '@/lib/gedcom/media-match';
import { archiveMediaFilename } from '@/lib/gedcom/media-archive-name';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import type { GedcomImportWarning } from '@/lib/data/types';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// The hostile GEDCOM corpus (#865): every file in the manifest, in both import
// modes, into a tree that already holds one sentinel person. The pinned outcome
// is the contract: imports exactly these records, or refuses and leaves the tree
// as it was. Nothing may crash, half-import or import silently wrong data.

const ROOT = join(process.cwd(), 'test-fixtures/gedcom-hostile');

interface Fixture {
  file: string;
  covers: string;
  issue: number;
  outcome: 'imports' | 'refuses' | 'zip_error';
  error?: string;
  zipError?: string;
  maxEntryBytes?: number;
  bundlePaths?: string[];
  people?: string[];
  birthDates?: Record<string, string>;
  families?: Array<{ p1: string | null; p2: string | null; kids: string | null; raw: string | null }>;
  notes?: string[];
  /** `text → OwnerTable[.OwnerFact]` per note, in import order (#959). */
  noteOwners?: string[];
  noteLengths?: number[];
  /** `FactTable[.Part]: Page` per citation, in any order: a merge writes events' first (#962, #990). */
  citations?: string[];
  /** Line runs the bare .ged export must contain, each joined by `\n` (#962). */
  exported?: string[];
  /** `Name < Parent` per place, by name; unchanged by export → re-import (#969). */
  places?: string[];
  warnings?: GedcomImportWarning[];
  mergeWarnings?: GedcomImportWarning[];
  preserved?: number;
  cases?: number;
  /** Each media item's bundle path, split by whether the zip holds that file (#1005). */
  media?: { matched: string[]; unmatched: string[] };
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as { fixtures: Fixture[] };

const USER_ID = 865865;
const SENTINEL = 'Sentinel Person';
let db: PGlite;
let treeId: number;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await query(
    'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
    [USER_ID, 'hostile-corpus@test.local', 'hostile-corpus'],
  );
  treeId = await resolveDefaultTree(USER_ID);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

async function seedSentinel() {
  for (const table of ['Cases', 'Citation', 'Families', 'People', 'Note', 'Sources']) {
    await query(`DELETE FROM "${table}" WHERE "TreeId" = $1`, [treeId]);
  }
  await query(
    `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, 'Sentinel', 'Person')`,
    [USER_ID, treeId],
  );
}

async function treeState() {
  const people = await query(
    `SELECT "FirstName", "LastName", "BirthDate" FROM "People" WHERE "TreeId" = $1 ORDER BY "Id"`,
    [treeId],
  );
  const families = await query(
    `SELECT (SELECT "FirstName" FROM "People" WHERE "Id" = f."Partner1Id") AS p1,
            (SELECT "FirstName" FROM "People" WHERE "Id" = f."Partner2Id") AS p2,
            (SELECT string_agg(CASE WHEN fp."Partner1Relationship" = fp."Partner2Relationship" THEN fp."Partner1Relationship"
                               ELSE fp."Partner1Relationship" || '/' || fp."Partner2Relationship" END, ',' ORDER BY fp."ChildrenId")
               FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id") AS kids,
            f."RawGedcom" AS raw
       FROM "Families" f WHERE f."TreeId" = $1 ORDER BY f."Id"`,
    [treeId],
  );
  const notes = await query(
    `SELECT n."Text",
            (SELECT string_agg(l."OwnerTable" || COALESCE('.' || l."OwnerFact", ''), ',' ORDER BY l."OwnerTable")
               FROM "NoteLink" l WHERE l."NoteId" = n."Id") AS owners
       FROM "Note" n WHERE n."TreeId" = $1 ORDER BY n."Id"`,
    [treeId],
  );
  const citations = await query(
    `SELECT "FactTable", "Part", "Page" FROM "Citation" WHERE "TreeId" = $1 ORDER BY "Id"`,
    [treeId],
  );
  const places = await query(
    `SELECT c."Name", p."Name" AS parent FROM "Places" c LEFT JOIN "Places" p ON p."Id" = c."ParentId"
      WHERE c."TreeId" = $1 ORDER BY c."Name"`,
    [treeId],
  );
  const rows = people.rows as Array<{ FirstName: string; LastName: string; BirthDate: string | null }>;
  // A kept pointer is stored as its record's id (#979); show whose it is instead.
  const firstNames = await query('SELECT "Id", "FirstName" FROM "People" WHERE "TreeId" = $1', [treeId]);
  const firstName = new Map((firstNames.rows as Array<{ Id: number; FirstName: string }>).map((p) => [p.Id, p.FirstName]));
  const pointers = (raw: string | null) => raw?.replace(/@~I:(\d+)@/g, (_, id: string) => `@~I:${firstName.get(Number(id))}@`) ?? null;
  return {
    places: (places.rows as Array<{ Name: string; parent: string | null }>).map((p) => `${p.Name} < ${p.parent}`),
    citations: (citations.rows as Array<{ FactTable: string; Part: string | null; Page: string | null }>)
      .map((c) => `${c.FactTable}${c.Part ? `.${c.Part}` : ''}: ${c.Page}`),
    people: rows.map((p) => `${p.FirstName} ${p.LastName}`),
    birthDates: Object.fromEntries(rows.filter((p) => p.BirthDate).map((p) => [`${p.FirstName} ${p.LastName}`, p.BirthDate])),
    families: (families.rows as Array<{ raw: string | null }>).map((f) => ({ ...f, raw: pointers(f.raw) })),
    notes: (notes.rows as Array<{ Text: string }>).map((n) => n.Text),
    noteOwners: (notes.rows as Array<{ Text: string; owners: string | null }>).map((n) => `${n.Text} → ${n.owners}`),
  };
}

async function load(fixture: Fixture) {
  const bytes = readFileSync(join(ROOT, fixture.file));
  if (!fixture.file.endsWith('.zip')) return { file: new File([bytes], 'tree.ged') };
  const bundle = await openGedcomZip(await JSZip.loadAsync(bytes), { maxEntryBytes: fixture.maxEntryBytes });
  if ('error' in bundle) return { zipError: bundle.error };
  return { file: bundle.gedFile, casesJson: bundle.sidecars['cases.json'], archiveManifest: bundle.manifest, bundlePaths: [...bundle.manifest].sort() };
}

describe('hostile GEDCOM corpus (#865)', () => {
  beforeEach(seedSentinel);

  for (const fixture of manifest.fixtures) {
    for (const mode of ['overwrite', 'merge'] as const) {
      it(`${fixture.file} (${mode}): ${fixture.outcome}`, async () => {
        const loaded = await load(fixture);
        if (fixture.outcome === 'zip_error') {
          expect(loaded).toEqual({ zipError: fixture.zipError });
          return;
        }
        if (!('file' in loaded) || !loaded.file) throw new Error(`zip refused: ${loaded.zipError}`);
        if (fixture.bundlePaths) expect(loaded.bundlePaths).toEqual(fixture.bundlePaths);

        const before = await treeState();
        if (fixture.media && mode === 'overwrite') {
          // The overwrite check must agree with the import: it refuses on exactly the unmatched files.
          const preview = await previewGedcomService({ file: loaded.file, mode, currentUserId: USER_ID });
          const entries = (loaded.archiveManifest ?? []).map((archivePath) => ({ archivePath, file: null }));
          expect(findMissingMediaRefs(preview.expectedMediaRefs ?? [], entries)).toEqual(fixture.media.unmatched);
        }
        const run = importGedcomService({ file: loaded.file, mode, casesJson: loaded.casesJson, archiveManifest: loaded.archiveManifest, currentUserId: USER_ID });
        if (fixture.outcome === 'refuses') {
          await expect(run).rejects.toThrow(fixture.error);
          expect(await treeState()).toEqual(before);
          return;
        }

        const result = await run;
        const expectedWarnings = mode === 'merge' && fixture.mergeWarnings ? fixture.mergeWarnings : fixture.warnings;
        expect(result.warnings).toEqual(expectedWarnings);
        if (fixture.preserved !== undefined) expect(result.preservedCount).toBe(fixture.preserved);
        if (fixture.cases !== undefined) expect(result.casesCount).toBe(fixture.cases);
        if (fixture.media) {
          // The browser uploads the zip entry at each item's exact path, so a path
          // missing from the manifest leaves that photo a placeholder.
          const inZip = new Set(loaded.archiveManifest);
          const paths = result.mediaItems.map((item) => item.archivePath).sort();
          expect({ matched: paths.filter((p) => inZip.has(p)), unmatched: paths.filter((p) => !inZip.has(p)) }).toEqual(fixture.media);
        }

        const after = await treeState();
        expect(after.people).toEqual(mode === 'merge' ? [SENTINEL, ...fixture.people!] : fixture.people);
        expect(after.birthDates).toEqual(fixture.birthDates ?? {});
        expect(after.families).toEqual(fixture.families ?? []);
        if (fixture.notes) expect(after.notes).toEqual(fixture.notes);
        if (fixture.noteOwners) expect(after.noteOwners).toEqual(fixture.noteOwners);
        if (fixture.noteLengths) expect(after.notes.map((n) => n.length)).toEqual(fixture.noteLengths);
        if (fixture.citations) expect([...after.citations].sort()).toEqual([...fixture.citations].sort());
        if (fixture.exported) {
          const out = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: false });
          if (out.kind !== 'ged') throw new Error(`expected a .ged, got ${out.kind}`);
          const text = out.content.split(/\r?\n/).join('\n');
          for (const run of fixture.exported) expect(text).toContain(run);
        }
        if (fixture.places) {
          expect(after.places).toEqual(fixture.places);
          const out = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: false });
          if (out.kind !== 'ged') throw new Error(`expected a .ged, got ${out.kind}`);
          await importGedcomService({ file: new File([out.content], 'tree.ged'), mode: 'overwrite', currentUserId: USER_ID });
          expect((await treeState()).places).toEqual(fixture.places);
        }
      });
    }
  }

  it('imports a large generated file (5,000 people, 2,500 families) in reasonable time', async () => {
    const lines = ['0 HEAD', '1 CHAR UTF-8'];
    for (let i = 1; i <= 5000; i++) {
      lines.push(`0 @I${i}@ INDI`, `1 NAME Given${i} /Surname${i % 300}/`, `1 SEX ${i % 2 ? 'M' : 'F'}`, '1 BIRT', `2 DATE ${1 + (i % 28)} JAN ${1800 + (i % 200)}`, '2 PLAC Springfield');
    }
    for (let f = 1; f <= 2500; f++) {
      lines.push(`0 @F${f}@ FAM`, `1 HUSB @I${2 * f - 1}@`, `1 WIFE @I${2 * f}@`);
      if (f > 1) lines.push(`1 CHIL @I${f - 1}@`);
    }
    lines.push('0 TRLR');
    const started = performance.now();
    const result = await importGedcomService({ file: new File([lines.join('\n')], 'large.ged'), mode: 'overwrite', currentUserId: USER_ID });
    const seconds = (performance.now() - started) / 1000;
    expect(result).toMatchObject({ peopleCount: 5000, familiesCount: 2500, warnings: [] });
    // Generous: PGlite in CI. The point is to catch an accidental N² or per-row round trip.
    expect(seconds).toBeLessThan(30);
  }, 180_000);

  it('names exported media safely whatever their title (media-archive-name)', () => {
    expect(archiveMediaFilename({ Title: '../../etc/passwd', FilePath: 'uploads/x.jpg' })).toBe('etc-passwd.jpg');
    expect(archiveMediaFilename({ Title: '..\\..\\boot.ini', FilePath: 'x.png' })).toBe('boot-ini.png');
  });
});
