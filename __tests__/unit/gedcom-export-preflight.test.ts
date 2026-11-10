import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { FamilyWithRelations, Media, PersonWithRelations } from '@/lib/db/schema';
import {
  assembleGedcomExport,
  type GedcomExportAssemblyInput,
} from '@/lib/services/gedcom-export-core';
import { resolveHostedMediaFile } from '@/lib/services/gedcom-export';

function person(id: number): PersonWithRelations {
  return {
    Id: id, UserId: 1, FirstName: `Person ${id}`, LastName: 'Test', Sex: null,
    GedcomId: null, BirthDate: null, BirthPlace: null, DeathDate: null,
    DeathPlace: null, IsDeceased: null, UpdatedAt: null,
    EffectiveFirstName: null, Nickname: null, familiesAsSpouse: [],
    familiesAsChild: [], events: [], media: [],
  };
}

function media(id: number, filePath: string | null): Media {
  return {
    Id: id, UserId: 1, TreeId: 1, Title: `Media ${id}`, FilePath: filePath,
    Format: 'jpeg', ContentType: 'image/jpeg', FileSize: 1,
  };
}

function input(overrides: Partial<GedcomExportAssemblyInput> = {}): GedcomExportAssemblyInput {
  return {
    people: [person(1)],
    families: [] as FamilyWithRelations[],
    media: [media(10, 'one.jpg'), media(20, 'two.jpg')],
    mediaLinks: [
      { MediaId: 10, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 },
      { MediaId: 20, OwnerTable: 'People', OwnerId: 1, IsPrimary: 0 },
    ],
    mediaTags: [
      { MediaId: 10, FilePath: 'one.jpg', PersonId: 1, RegionX: 1, RegionY: 2, RegionW: 3, RegionH: 4 },
      { MediaId: 20, FilePath: 'two.jpg', PersonId: 1, RegionX: 5, RegionY: 6, RegionW: 7, RegionH: 8 },
    ],
    mediaImportItems: [],
    mediaAvailability: new Map([[10, true], [20, true]]),
    includeMedia: true,
    ...overrides,
  };
}

describe('GEDCOM export preflight and shared assembly', () => {
  it('rejects absolute, traversing, symlinked, and non-file hosted media paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gedcom-export-safe-'));
    try {
      fs.writeFileSync(path.join(root, 'flat.jpg'), 'synthetic');
      fs.mkdirSync(path.join(root, 'directory'));

      expect(resolveHostedMediaFile(root, 'flat.jpg')).toMatchObject({
        filename: 'flat.jpg',
      });
      expect(resolveHostedMediaFile(root, path.join(root, 'flat.jpg'))).toBeNull();
      expect(resolveHostedMediaFile(root, 'C:\\outside.jpg')).toBeNull();
      expect(resolveHostedMediaFile(root, '\\\\server\\share\\outside.jpg')).toBeNull();
      expect(resolveHostedMediaFile(root, 'nested\\..\\flat.jpg')).toBeNull();
      expect(resolveHostedMediaFile(root, '../flat.jpg')).toBeNull();
      expect(resolveHostedMediaFile(root, 'directory')).toBeNull();

      try {
        fs.symlinkSync(path.join(root, 'flat.jpg'), path.join(root, 'linked.jpg'));
        expect(resolveHostedMediaFile(root, 'linked.jpg')).toBeNull();
      } catch {
        // Symlink creation may be unavailable in a restricted Windows test runner.
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('classifies each media row once and returns only aggregate omission data', () => {
    const result = assembleGedcomExport(input({
      mediaImportItems: [
        { id: 1, importId: 'private', documentMediaId: '@O1@', treeId: 1, mediaId: 10, archivePath: 'private/one.jpg', originalFilename: 'one.jpg', status: 'pending', failureCode: null, skipFaceCapture: false },
        { id: 2, importId: 'private', documentMediaId: '@O2@', treeId: 1, mediaId: 20, archivePath: 'private/two.jpg', originalFilename: 'two.jpg', status: 'failed', failureCode: null, skipFaceCapture: false },
      ],
      mediaAvailability: new Map([[10, false], [20, false]]),
    }));

    expect(result.preflight).toEqual({
      canExport: false,
      omittedTotal: 2,
      byReason: {
        pending: 1,
        missing: 0,
        failed: 1,
        backing_missing: 0,
        legacy_materialization_unknown: 0,
      },
    });
    expect(JSON.stringify(result.preflight)).not.toMatch(/private|one\.jpg|two\.jpg|@O/);
    expect(result.omissionReport).toEqual({
      version: 1,
      omitted: { total: 2, byReason: { pending: 1, missing: 0, failed: 1, backing_missing: 0, legacy_materialization_unknown: 0 } },
      staleMediaPointers: 0,
    });
  });

  it('exports a pending or missing reference as its FILE text, but still omits failed bytes (#958)', () => {
    const reference = (id: number, sourceFile: string): Media => ({ ...media(id, null), SourceFile: sourceFile });
    const item = (id: number, status: 'pending' | 'missing' | 'failed') => ({
      id, importId: 'i', documentMediaId: `@O${id}@`, treeId: 1, mediaId: id, archivePath: `p${id}.jpg`,
      originalFilename: `p${id}.jpg`, status, failureCode: null, skipFaceCapture: false,
    });
    const result = assembleGedcomExport(input({
      media: [
        reference(1, 'C:\\FTM\\pending.jpg'),
        reference(2, 'http://x.org/missing.jpg'),
        reference(3, 'photos/failed.jpg'),
        reference(4, 'http://x.org/a\n0 @I9@ INDI'),
      ],
      mediaImportItems: [item(1, 'pending'), item(2, 'missing'), item(3, 'failed')],
      mediaAvailability: new Map([[1, false], [2, false], [3, false], [4, false]]),
    }));

    expect(result.preflight.byReason).toMatchObject({ pending: 0, missing: 0, failed: 1 });
    expect(result.media.map((m) => m.Id)).toEqual([1, 2, 4]);
    expect(result.gedcom).toContain('1 FILE C:\\FTM\\pending.jpg');
    expect(result.gedcom).toContain('1 FILE http://x.org/missing.jpg');
    expect(result.gedcom).not.toContain('photos/failed.jpg');
    // A line break in the stored text goes out as CONT, never as a raw record.
    expect(result.gedcom).toContain('1 FILE http://x.org/a\n2 CONT 0 @I9@ INDI');
    expect(result.gedcom).not.toMatch(/^0 @I9@ INDI/m);
  });

  it('filters omitted media, links, and tags before assigning deterministic xrefs', () => {
    const result = assembleGedcomExport(input({
      mediaImportItems: [
        { id: 1, importId: 'i', documentMediaId: '@O1@', treeId: 1, mediaId: 10, archivePath: 'one.jpg', originalFilename: 'one.jpg', status: 'missing', failureCode: null, skipFaceCapture: false },
      ],
    }));

    expect(result.media.map((item) => item.Id)).toEqual([20]);
    expect(result.mediaLinks.map((link) => link.MediaId)).toEqual([20]);
    expect(result.mediaTags.map((tag) => tag.MediaId)).toEqual([20]);
    expect([...result.mediaIdToXref]).toEqual([[20, '@O1@']]);
    expect(result.gedcom).toContain('0 @O1@ OBJE');
    expect(result.gedcom).not.toContain('one.jpg');
    expect(result.gedcom).not.toContain('@O2@');
  });

  it('emits no multimedia records or pointers for a plain GEDCOM export', () => {
    const result = assembleGedcomExport(input({
      includeMedia: false,
      people: [{ ...person(1), RawGedcom: '1 OBJE @O99@\n2 FILE forgotten.jpg' }],
    }));

    expect(result.gedcom).not.toMatch(/^0 @O\d+@ OBJE$/m);
    expect(result.gedcom).not.toMatch(/^\d+ OBJE(?: |$)/m);
    expect(result.media).toEqual([]);
    expect(result.mediaLinks).toEqual([]);
    expect(result.mediaTags).toEqual([]);
  });

  it('classifies a ready row without physical bytes as backing_missing', () => {
    const result = assembleGedcomExport(input({ mediaAvailability: new Map([[10, false], [20, true]]) }));

    expect(result.preflight.byReason.backing_missing).toBe(1);
    expect(result.preflight.omittedTotal).toBe(1);
  });

  it('classifies a legacy placeholder without import identity explicitly', () => {
    const result = assembleGedcomExport(input({
      media: [media(10, null)],
      mediaLinks: [{ MediaId: 10, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 }],
      mediaTags: [],
      mediaAvailability: new Map([[10, false]]),
    }));

    expect(result.preflight.byReason.legacy_materialization_unknown).toBe(1);
    expect(result.preflight.byReason.backing_missing).toBe(0);
  });

  it('keeps an ordinary local upload with null hosted path when bytes are available', () => {
    const result = assembleGedcomExport(input({
      media: [media(10, null)],
      mediaLinks: [{ MediaId: 10, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 }],
      mediaTags: [],
      mediaAvailability: new Map([[10, true]]),
    }));

    expect(result.preflight).toEqual({
      canExport: true,
      omittedTotal: 0,
      byReason: {
        pending: 0,
        missing: 0,
        failed: 0,
        backing_missing: 0,
        legacy_materialization_unknown: 0,
      },
    });
    expect(result.media.map((item) => item.Id)).toEqual([10]);
  });

  it('throws when one media row has duplicate import lineage', () => {
    expect(() => assembleGedcomExport(input({
      mediaImportItems: [
        { id: 1, importId: 'first', documentMediaId: '@O1@', treeId: 1, mediaId: 10, archivePath: 'one.jpg', originalFilename: 'one.jpg', status: 'ready', failureCode: null, skipFaceCapture: false },
        { id: 2, importId: 'second', documentMediaId: '@O1@', treeId: 1, mediaId: 10, archivePath: 'other.jpg', originalFilename: 'other.jpg', status: 'ready', failureCode: null, skipFaceCapture: false },
      ],
    }))).toThrow(/duplicate media import lineage/i);
  });
});
