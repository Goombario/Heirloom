/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { findMissingMediaRefs } from '@/lib/gedcom/media-match';
import { collectArchiveMediaPaths } from '@/app/import-export/useMediaImportRecovery';

describe('ZIP media preflight', () => {
  it('accepts a declared nested path but not an unrelated basename', () => {
    const nested = collectArchiveMediaPaths(['photos/a.jpg']);
    expect(findMissingMediaRefs(
      [{ archivePath: 'photos/a.jpg', originalFilename: 'a.jpg' }],
      nested.map((archivePath) => ({ archivePath, file: archivePath })),
    )).toEqual([]);

    const unrelated = collectArchiveMediaPaths(['other/a.jpg']);
    expect(findMissingMediaRefs(
      [{ archivePath: 'photos/a.jpg', originalFilename: 'a.jpg' }],
      unrelated.map((archivePath) => ({ archivePath, file: archivePath })),
    )).toEqual(['photos/a.jpg']);
  });

  it('does not treat a materializer-unsupported TIFF as recoverable media', () => {
    expect(collectArchiveMediaPaths(['photos/scan.tiff'])).toEqual([]);
  });
});
