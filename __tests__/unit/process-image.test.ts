import { describe, it, expect } from 'vitest';
import { processForUpload, SKIP_COMPRESSION_TYPES } from '@/lib/media/process-image';

describe('processForUpload — passthrough formats', () => {
  it('passes an SVG through unchanged', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const file = new File([svg], 'icon.svg', { type: 'image/svg+xml' });
    const out = await processForUpload(file);
    expect(out.contentType).toBe('image/svg+xml');
    expect(out.format).toBe('SVG');
    expect(new TextDecoder().decode(out.bytes)).toContain('<svg');
  });

  it('passes a GIF through unchanged', async () => {
    const file = new File([new Uint8Array([0x47, 0x49, 0x46])], 'a.gif', { type: 'image/gif' });
    const out = await processForUpload(file);
    expect(out.contentType).toBe('image/gif');
    expect(out.format).toBe('GIF');
    expect(Array.from(out.bytes)).toEqual([0x47, 0x49, 0x46]);
  });

  it('exposes the passthrough type set', () => {
    expect(SKIP_COMPRESSION_TYPES.has('image/svg+xml')).toBe(true);
    expect(SKIP_COMPRESSION_TYPES.has('image/gif')).toBe(true);
  });
});
