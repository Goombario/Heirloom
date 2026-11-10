import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { FixtureIds } from './gedcom-roundtrip-fixture';
import { isExternalMediaReference } from '@/lib/gedcom/media-match';
import { contentTypeForExtension, fileExtension } from '@/lib/media/allowed-extensions';

export interface Bundle {
  ged: string;
  cases: Record<string, unknown>;
  sources: Record<string, unknown>;
  places: Record<string, unknown>;
  media: Record<string, unknown>;
  /** zip entry name → sha256 hex of its bytes. */
  mediaFiles: Map<string, string>;
  /** zip entry name → original bytes, used for exact-path retry materialization. */
  mediaBytes: Map<string, Buffer>;
}

export async function readBundle(buffer: Buffer): Promise<Bundle> {
  const zip = await JSZip.loadAsync(buffer);
  const text = async (name: string) => {
    const f = zip.file(name);
    if (!f) throw new Error(`bundle is missing ${name}`);
    return f.async('string');
  };
  const mediaFiles = new Map<string, string>();
  const mediaBytes = new Map<string, Buffer>();
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith('media/') || zip.files[name].dir) continue;
    const bytes = await zip.files[name].async('uint8array');
    mediaFiles.set(name, createHash('sha256').update(bytes).digest('hex'));
    mediaBytes.set(name, Buffer.from(bytes));
  }
  return {
    // Strip the UTF-8 BOM the exporter prepends so string compares are clean.
    ged: (await text('family_tree.ged')).replace(/^﻿/, ''),
    cases: JSON.parse(await text('cases.json')),
    sources: JSON.parse(await text('sources.json')),
    places: JSON.parse(await text('places.json')),
    media: JSON.parse(await text('media.json')),
    mediaFiles,
    mediaBytes,
  };
}

/**
 * Drop the `file` basename from every media.json entry. A real re-upload
 * renames every file (media-upload.ts:280), so `file` (a basename of
 * `Media.FilePath`) is not stable across a reimport — comparing it would
 * compare the churn, not the content. Every other field is left untouched.
 */
export function omitMediaFile(media: Bundle['media']): Bundle['media'] {
  const m = media as Record<string, unknown>;
  // v2 is geometry-only and has no filename fields to normalize.
  if (m.version === 2) return media;
  const v1 = media as { version: number; libraryMedia: Array<Record<string, unknown>>; tags: Array<Record<string, unknown>> };
  const drop = (arr: Array<Record<string, unknown>>) => arr.map(({ file: _file, ...rest }) => rest);
  return { ...v1, libraryMedia: drop(v1.libraryMedia ?? []), tags: drop(v1.tags ?? []) };
}

/** `exported_at` is a wall-clock stamp — the only legitimately volatile field. */
export function normalizeBundle(b: Bundle): Bundle {
  const { exported_at: _drop, cases: rawCases, ...caseEnvelope } = b.cases as {
    exported_at?: string;
    cases?: Array<Record<string, unknown>>;
  };
  // Case and comment timestamps round-trip since #789, so they stay in the
  // comparison. Legacy free-text citations are re-minted on import.
  const cases = (rawCases ?? []).map(({ citations, ...rest }) => ({
    ...rest,
    citations: (citations as Array<Record<string, unknown>> | undefined ?? [])
      .map(({ CreatedAt: _citationCreated, ...citation }) => citation),
  }));
  return { ...b, cases: { ...caseEnvelope, cases } };
}

export async function roundTrip(ids: FixtureIds): Promise<{ first: Bundle; second: Bundle }> {
  // Lazy imports: the connection mock must be installed before the services load.
  const { exportGedcomService } = await import('@/lib/services/gedcom-export');
  const { importGedcomService } = await import('@/lib/services/gedcom');
  const { patchMediaFile } = await import('@/lib/db/queries/media');
  const { query: dbQuery } = await import('@/lib/db/connection');

  const exportOnce = async (): Promise<Bundle> => {
    const result = await exportGedcomService({
      requestedTreeId: ids.treeId,
      requestedOwnerId: null,
      currentUserId: ids.userId,
      includeMedia: true,
    });
    if (result.kind !== 'zip') throw new Error('expected a zip bundle');
    return readBundle(result.buffer);
  };

  const first = await exportOnce();

  // Reimport exactly what the browser importer sends: the .ged as a File plus
  // each sidecar as a JSON string (the route unzips client-side).
  const importResult = await importGedcomService({
    file: new File([first.ged], 'family_tree.ged', { type: 'text/plain' }),
    mode: 'overwrite',
    casesJson: JSON.stringify(first.cases),
    mediaJson: JSON.stringify(first.media),
    sourcesJson: JSON.stringify(first.sources),
    placesJson: JSON.stringify(first.places),
    currentUserId: ids.userId,
    requestedTreeId: ids.treeId,
  });

  const formatByArchivePath = new Map<string, string>();
  const gedLines = first.ged.split('\n');
  for (let i = 0; i < gedLines.length - 1; i++) {
    const fileMatch = gedLines[i].match(/^1 FILE (.+)$/);
    const formMatch = gedLines[i + 1].match(/^2 FORM (.+)$/);
    if (fileMatch && formMatch) formatByArchivePath.set(fileMatch[1], formMatch[1]);
  }

  // Mirror the browser's recovery phase: materialize each durable item from
  // the archive entry at its exact canonical archivePath. Basenames are never
  // consulted; the duplicate portrait fixture guards this identity boundary.
  const { materializeImportMediaService } = await import('@/lib/services/media-upload');
  for (const item of importResult.mediaItems) {
    const bytes = first.mediaBytes.get(item.archivePath);
    // A desktop path or URL (#958) ships no bytes in any bundle: it stays pending.
    const declared = new RegExp(`^0 ${item.documentMediaId} OBJE\\n1 FILE (.+)$`, 'm').exec(first.ged)?.[1];
    if (!bytes && declared && isExternalMediaReference(declared)) continue;
    if (!bytes) throw new Error(`missing exact archive entry for ${item.archivePath}`);
    await materializeImportMediaService({
      itemId: item.id,
      archivePath: item.archivePath,
      file: new File([new Uint8Array(bytes) as unknown as BlobPart], item.originalFilename, {
        type: contentTypeForExtension(fileExtension(item.archivePath)),
      }),
      requestedTreeId: ids.treeId,
      requestedOwnerId: null,
      currentUserId: ids.userId,
    });
    // The fixture seeds `Format` as the original GEDCOM FORM spelling. The
    // real materializer normalizes it to the upload output format; restore the
    // exact path's original FORM only so the deterministic round-trip assertion
    // remains about archive identity rather than codec spelling.
    const current = await dbQuery(
      'SELECT "FilePath", "ContentType", "Format", "FileSize", "ContentHash" FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2',
      [item.mediaId, ids.treeId],
    );
    const row = current.rows[0] as { FilePath: string | null; ContentType: string | null; Format: string | null; FileSize: number | null; ContentHash: string | null } | undefined;
    if (row && formatByArchivePath.has(item.archivePath)) {
      await patchMediaFile(item.mediaId, ids.treeId, {
        FilePath: row.FilePath,
        ContentType: row.ContentType ?? 'image/jpeg',
        Format: formatByArchivePath.get(item.archivePath)!,
        FileSize: row.FileSize ?? 0,
        ContentHash: row.ContentHash,
      });
    }
  }

  const second = await exportOnce();
  return { first, second };
}

/**
 * The fixture's seeded `Media.FilePath` values point at files that do not
 * exist on disk. Stage each safe relative path under the owner's exact hosted
 * media root so export preflight sees the same storage contract as production.
 *
 * Stages a temp uploads tree with distinct dummy bytes per seeded `Media` row
 * and points `DATA_DIR` at it. Returns a restore function that puts `DATA_DIR`
 * back and removes the temp tree — call it in the caller's `afterAll`.
 *
 * Two rows deliberately share the basename `portrait.jpg`, but one lives at
 * `nested/portrait.jpg`; staging the exact relative paths prevents the harness
 * from collapsing those distinct identities.
 */
export async function stageFixtureMedia(db: PGlite, ids: FixtureIds): Promise<() => void> {
  const previousDataDir = process.env.DATA_DIR;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gedcom-roundtrip-media-'));
  const mediaDir = path.join(tmpRoot, 'uploads', String(ids.userId), 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const { rows } = await db.query<{ FilePath: string | null }>(
    'SELECT "FilePath" FROM "Media" WHERE "TreeId" = $1 AND "FilePath" IS NOT NULL ORDER BY "Id"',
    [ids.treeId],
  );
  for (const [index, row] of rows.entries()) {
    const relativePath = (row.FilePath as string).replaceAll('/', path.sep);
    const absolutePath = path.join(mediaDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const color = { r: (index * 53) % 255, g: (index * 97) % 255, b: (index * 151) % 255 };
    const bytes = relativePath.endsWith('.pdf')
      ? Buffer.from(`%PDF-1.4\n% fixture ${index}\n%%EOF\n`)
      : await sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).jpeg().toBuffer();
    fs.writeFileSync(absolutePath, bytes);
  }

  process.env.DATA_DIR = tmpRoot;
  return () => {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  };
}
