import { describe, expect, it } from 'vitest';
import { archiveMediaFilename, archiveMediaPath } from '@/lib/gedcom/media-archive-name';

// #802 (MD-2): an exported photo is named from its title, not its stored file.
describe('archiveMediaFilename', () => {
  it('slugs the title and keeps the stored extension', () => {
    expect(archiveMediaFilename({ Title: 'Grandmother Anna, 1921', FilePath: 'case_1719_ab12.JPG' })).toBe('grandmother-anna-1921.jpg');
  });

  it('keeps letters in any script', () => {
    expect(archiveMediaFilename({ Title: 'Семья Белозёровых', FilePath: 'x/imported_1.jpeg' })).toBe('семья-белозёровых.jpeg');
  });

  it('drops a file extension the title carried over from the upload', () => {
    expect(archiveMediaFilename({ Title: 'family-1900.jpg', FilePath: 'upload_9.jpg' })).toBe('family-1900.jpg');
  });

  it('falls back to the stored name without a usable title', () => {
    expect(archiveMediaFilename({ Title: null, FilePath: 'dir/case_1.png' })).toBe('case_1.png');
    expect(archiveMediaFilename({ Title: '—', FilePath: 'case_2.png' })).toBe('case_2.png');
  });
});

describe('archiveMediaFilename on Windows', () => {
  it('never names a file after a device (security review, #820)', () => {
    expect(archiveMediaFilename({ Title: 'Con', FilePath: 'case_3.jpg' })).toBe('case_3.jpg');
    expect(archiveMediaFilename({ Title: 'COM1', FilePath: 'case_4.jpg' })).toBe('case_4.jpg');
    expect(archiveMediaFilename({ Title: 'Console room', FilePath: 'case_5.jpg' })).toBe('console-room.jpg');
  });
});

// #937: bundle v3 keeps every photo in one folder, prefixed with its xref.
describe('archiveMediaPath', () => {
  it('puts the photo flat under media/ with its xref as a prefix', () => {
    expect(archiveMediaPath('@O3@', { Title: 'Grandmother Anna, 1921', FilePath: 'case_1.jpg' })).toBe('media/O3-grandmother-anna-1921.jpg');
  });

  it('keeps two photos with the same title apart', () => {
    const a = archiveMediaPath('@O1@', { Title: 'Census', FilePath: 'a.jpg' });
    const b = archiveMediaPath('@O2@', { Title: 'Census', FilePath: 'b.jpg' });
    expect(a).toBe('media/O1-census.jpg');
    expect(b).toBe('media/O2-census.jpg');
  });

  it('stays well under Windows path limits with the longest slug', () => {
    expect(archiveMediaPath('@O12345@', { Title: 'x'.repeat(200), FilePath: 'a.jpeg' }).length).toBeLessThan(110);
  });

  it('files a photo with no xref under media/library/', () => {
    expect(archiveMediaPath(undefined, { Title: 'Loose', FilePath: 'a.png' })).toBe('media/library/loose.png');
  });
});
