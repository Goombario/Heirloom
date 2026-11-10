import { describe, it, expect } from 'vitest';
import { hashBytes, CONTENT_HASH_PATTERN } from '@/lib/media/content-hash';
import { ALLOWED_EXTENSIONS, classifyUpload, contentTypeForExtension, hasPdfSignature, isAllowedImageExtension } from '@/lib/media/allowed-extensions';

const enc = (s: string) => new TextEncoder().encode(s);

describe('hashBytes', () => {
  it('returns the known SHA-256 vector for "abc"', async () => {
    expect(await hashBytes(enc('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('returns the known vector for empty input', async () => {
    expect(await hashBytes(new Uint8Array()))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is stable across calls and accepts an ArrayBuffer', async () => {
    const once = await hashBytes(enc('heirloom'));
    const twice = await hashBytes(enc('heirloom').buffer as ArrayBuffer);
    expect(once).toBe(twice);
  });

  it('differs for a one-byte change', async () => {
    expect(await hashBytes(enc('photo-a'))).not.toBe(await hashBytes(enc('photo-b')));
  });

  // Buffer.from() hands back a view onto a shared pool, so a naive
  // digest(view) would hash the whole pool rather than these bytes.
  it('hashes only the view, not the underlying pooled buffer', async () => {
    const pool = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = pool.subarray(2, 5); // [3,4,5]
    expect(await hashBytes(view)).toBe(await hashBytes(new Uint8Array([3, 4, 5])));
  });

  it('produces values matching the boundary validation pattern', async () => {
    expect(await hashBytes(enc('abc'))).toMatch(CONTENT_HASH_PATTERN);
  });
});

describe('ALLOWED_EXTENSIONS', () => {
  it('is the single source of truth for both upload paths', () => {
    expect([...ALLOWED_EXTENSIONS].sort())
      .toEqual(['.bmp', '.gif', '.jpeg', '.jpg', '.pdf', '.png', '.svg', '.webp']);
  });

  it('matches case-insensitively through the helper', () => {
    expect(isAllowedImageExtension('.JPG')).toBe(true);
    expect(isAllowedImageExtension('.exe')).toBe(false);
    expect(isAllowedImageExtension('.pdf')).toBe(false);
  });
});

describe('document uploads (#510)', () => {
  it('classifies by extension and declared type together', () => {
    expect(classifyUpload('a.JPG', 'image/jpeg')).toBe('image');
    expect(classifyUpload('a.pdf', 'application/pdf')).toBe('pdf');
    expect(classifyUpload('a.pdf', '')).toBe('pdf');
    expect(classifyUpload('a.pdf', 'text/html')).toBeNull();
    expect(classifyUpload('a.jpg', 'application/pdf')).toBeNull();
    expect(classifyUpload('a.txt', 'text/plain')).toBeNull();
  });

  it('accepts only bytes that start with the PDF signature', () => {
    expect(hasPdfSignature(enc('%PDF-1.7\n'))).toBe(true);
    expect(hasPdfSignature(enc('%PDF'))).toBe(false);
    expect(hasPdfSignature(enc(' %PDF-1.7'))).toBe(false);
    expect(hasPdfSignature(enc('<html>'))).toBe(false);
  });

  it('hands a bundled PDF to the importer with its type', () => {
    expect(contentTypeForExtension('.PDF')).toBe('application/pdf');
    expect(contentTypeForExtension('.jpeg')).toBe('image/jpeg');
    expect(contentTypeForExtension('.exe')).toBe('application/octet-stream');
  });
});
