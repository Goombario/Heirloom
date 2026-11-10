import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { bundlePathsByEntry, openGedcomZip, readBundleFile, resolveGedcomZipLayout } from '@/lib/gedcom/zip-bundle';
import { decodeGedcom } from '@/lib/gedcom/charset';

// #883: the sidecars used to be read only at the zip root, so a re-zipped export
// folder imported its .ged but silently dropped cases, face tags, sources and places.

// "José" in ANSEL (acute 0xE2 before its base letter), to check the .ged's bytes too (#875).
const GED = new Uint8Array([
  ...new TextEncoder().encode('0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Jos'), 0xe2,
  ...new TextEncoder().encode('e /Roy/\n0 TRLR\n'),
]);
const SIDECARS = {
  'cases.json': '{"version":1,"cases":[]}',
  'media.json': '{"version":1,"media":[]}',
  'sources.json': '{"version":1,"sources":[],"nameVariants":[]}',
  'places.json': '{"version":1,"places":[]}',
};

async function zipOf(files: Record<string, Uint8Array | string>): Promise<JSZip> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
}

function exportFiles(prefix: string): Record<string, Uint8Array | string> {
  const files: Record<string, Uint8Array | string> = { [`${prefix}family_tree.ged`]: GED, [`${prefix}media/p1.jpg`]: 'jpg' };
  for (const [name, text] of Object.entries(SIDECARS)) files[`${prefix}${name}`] = text;
  return files;
}

describe('openGedcomZip (#883)', () => {
  it.each([
    ['the export layout', exportFiles('')],
    ['a re-zipped export folder', exportFiles('family_tree_export/')],
    ['a macOS zip', {
      ...exportFiles('family_tree_export/'),
      '__MACOSX/family_tree_export/._family_tree.ged': 'AppleDouble',
      'family_tree_export/.DS_Store': 'junk',
    }],
  ])('finds the .ged and every sidecar in %s', async (_layout, files) => {
    const bundle = await openGedcomZip(await zipOf(files));
    if ('error' in bundle) throw new Error(bundle.error);
    expect(bundle.sidecars).toEqual(SIDECARS);
    // Bundle paths are relative to the .ged's folder, as media.json expects.
    expect([...bundle.layout.entries.keys()].sort()).toEqual(
      ['cases.json', 'family_tree.ged', 'media.json', 'media/p1.jpg', 'places.json', 'sources.json'],
    );
    expect(bundle.gedFile.name).toBe('family_tree.ged');
    // The zipped .ged reaches the importer as the same bytes as a bare one.
    const bytes = new Uint8Array(await bundle.gedFile.arrayBuffer());
    expect(bytes).toEqual(GED);
    expect(decodeGedcom(bytes)).toContain('José /Roy/');
  });

  it('refuses a zip with two .ged files, and one with none', async () => {
    expect(await openGedcomZip(await zipOf({ 'a.ged': '0 HEAD', 'b/c.GED': '0 HEAD' }))).toEqual({ error: 'multiple_ged' });
    expect(await openGedcomZip(await zipOf({ '__MACOSX/._a.ged': 'x', 'notes.txt': 'x' }))).toEqual({ error: 'no_ged' });
  });

  it('refuses two entries that reach the same bundle path', () => {
    expect(resolveGedcomZipLayout(['tree.ged', 'media\\a.jpg', 'media/a.jpg'])).toEqual({ error: 'unsafe_paths' });
  });

  it('skips dotfiles by name only, so a bundle inside a dot-folder still imports', () => {
    const layout = resolveGedcomZipLayout(['.backup/tree.ged', '.backup/media/a.jpg', '.backup/media/.DS_Store']);
    expect(layout).toEqual({
      gedEntryName: '.backup/tree.ged',
      entries: new Map([['tree.ged', '.backup/tree.ged'], ['media/a.jpg', '.backup/media/a.jpg']]),
    });
  });

  it('caps a photo entry like the .ged', async () => {
    const zip = await zipOf({ 'tree.ged': '0 HEAD', 'media/bomb.jpg': new Uint8Array(2 * 1024 * 1024) });
    expect(await readBundleFile(zip, 'media/bomb.jpg', 1024 * 1024)).toBeNull();
    expect(await readBundleFile(zip, 'media/bomb.jpg')).toHaveLength(2 * 1024 * 1024);
  });

  it('leaves entries outside the .ged folder out of the bundle', () => {
    const layout = resolveGedcomZipLayout(['export/tree.ged', 'export/media/a.jpg', 'other/media/b.jpg']);
    expect(layout).toEqual({
      gedEntryName: 'export/tree.ged',
      entries: new Map([['tree.ged', 'export/tree.ged'], ['media/a.jpg', 'export/media/a.jpg']]),
    });
  });
});

describe('bundlePathsByEntry (#1006)', () => {
  it('maps a foldered zip to paths relative to its .ged, leaving outside entries out', () => {
    expect(bundlePathsByEntry(['Lee Export/Lee.ged', 'Lee Export/Lee_media/ann.png', 'Lee Export\\Photos\\bob.png', 'other/cat.png']))
      .toEqual(new Map([['Lee Export/Lee.ged', 'Lee.ged'], ['Lee Export/Lee_media/ann.png', 'Lee_media/ann.png'], ['Lee Export\\Photos\\bob.png', 'Photos/bob.png']]));
  });

  it('keeps a photos-only archive at its own paths', () => {
    expect(bundlePathsByEntry(['media/a.png', './b.png'])).toEqual(new Map([['media/a.png', 'media/a.png'], ['./b.png', 'b.png']]));
  });
});
