import { describe, it, expect } from 'vitest';
import { parseImageMetadata, MAX_REGIONS, MAX_PACKET_CHARS } from '@/lib/media/xmp-faces';
import { buildJpegWithXmp, mwgPacket, mpPacket, captionPacket } from '../fixtures/xmp/build-fixture';

function app1(payload: Uint8Array): number[] {
  const length = payload.length + 2;
  return [0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function jpegWithApp1Segments(segments: Uint8Array[]): Uint8Array {
  const bytes = [0xff, 0xd8, ...segments.flatMap(segment => app1(segment)), 0xff, 0xd9];
  return new Uint8Array(bytes);
}

function standardXmpPayload(packet: string): Uint8Array {
  const encoder = new TextEncoder();
  return new Uint8Array([
    ...encoder.encode('http://ns.adobe.com/xap/1.0/'),
    0,
    ...encoder.encode(packet),
  ]);
}

function extendedXmpPayload(guid: string, packet: string, offset = 0, fullLength = new TextEncoder().encode(packet).length): Uint8Array {
  const encoder = new TextEncoder();
  const body = encoder.encode(packet);
  const signature = encoder.encode('http://ns.adobe.com/xmp/extension/');
  const headerStart = signature.length + 1;
  const result = new Uint8Array(headerStart + 32 + 4 + 4 + body.length);
  result.set(signature, 0);
  result.set([0], signature.length);
  result.set(encoder.encode(guid.padEnd(32, '0').slice(0, 32)), headerStart);
  const view = new DataView(result.buffer);
  view.setUint32(headerStart + 32, fullLength, false);
  view.setUint32(headerStart + 36, offset, false);
  result.set(body, headerStart + 40);
  return result;
}

describe('parseImageMetadata', () => {
  it('converts MWG centre-relative fractions to top-left percentages', () => {
    // Real digiKam values: MWG x 0.354167 w 0.0542636 => MP x 0.327035
    const bytes = buildJpegWithXmp(mwgPacket([
      { name: 'Ada Whitcombe', x: 0.354167, y: 0.241848, w: 0.0542636, h: 0.101902 },
    ]));
    const { faces } = parseImageMetadata(bytes);
    expect(faces).toHaveLength(1);
    expect(faces[0].name).toBe('Ada Whitcombe');
    expect(faces[0].x).toBeCloseTo(32.7035, 3);
    expect(faces[0].y).toBeCloseTo(19.0897, 3);
    expect(faces[0].w).toBeCloseTo(5.42636, 4);
    expect(faces[0].h).toBeCloseTo(10.1902, 4);
  });

  it('scales MP rectangles without re-centring them', () => {
    const bytes = buildJpegWithXmp(mpPacket([
      { name: 'Ada Whitcombe', rect: '0.327035, 0.190897, 0.0542636, 0.101902' },
    ]));
    const { faces } = parseImageMetadata(bytes);
    expect(faces[0].x).toBeCloseTo(32.7035, 3);
    expect(faces[0].y).toBeCloseTo(19.0897, 3);
  });

  it('walks past unrelated APP1 segments and reads XMP from a later segment', () => {
    const packet = mwgPacket([
      { name: 'Later Segment', x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    ]);
    const result = parseImageMetadata(jpegWithApp1Segments([
      new TextEncoder().encode('Exif\0\0not-face-metadata'),
      extendedXmpPayload('fedcba9876543210fedcba9876543210', '<irrelevant>'),
      standardXmpPayload(packet),
    ]));
    expect(result.faces).toEqual([
      { name: 'Later Segment', x: 40, y: 40, w: 20, h: 20 },
    ]);
  });

  it('reassembles extended XMP split across APP1 segments', () => {
    const packet = mwgPacket([
      { name: 'Extended Segment', x: 0.4, y: 0.3, w: 0.2, h: 0.1 },
    ]);
    const encoded = new TextEncoder().encode(packet);
    const split = Math.floor(encoded.length / 2);
    const guid = '0123456789abcdef0123456789abcdef';
    const extensionA = new TextDecoder().decode(encoded.slice(0, split));
    const extensionB = new TextDecoder().decode(encoded.slice(split));
    const result = parseImageMetadata(jpegWithApp1Segments([
      new TextEncoder().encode('Exif\0\0irrelevant'),
      extendedXmpPayload(guid, extensionB, split, encoded.length),
      extendedXmpPayload(guid, extensionA, 0, encoded.length),
    ]));
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].name).toBe('Extended Segment');
    expect(result.faces[0].x).toBeCloseTo(30, 8);
    expect(result.faces[0].y).toBeCloseTo(25, 8);
    expect(result.faces[0].w).toBeCloseTo(20, 8);
    expect(result.faces[0].h).toBeCloseTo(10, 8);
  });

  it('accepts RDF Seq lists as well as RDF Bag lists', () => {
    const packet = mwgPacket([
      { name: 'Sequence One', x: 0.25, y: 0.25, w: 0.1, h: 0.1 },
      { name: 'Sequence Two', x: 0.75, y: 0.75, w: 0.1, h: 0.1 },
    ]).replace('<rdf:Bag>', '<rdf:Seq>').replace('</rdf:Bag>', '</rdf:Seq>');
    expect(parseImageMetadata(buildJpegWithXmp(packet)).faces.map(face => face.name)).toEqual([
      'Sequence One', 'Sequence Two',
    ]);
  });

  it('prefers MWG and does not emit a face twice when both schemas are present', () => {
    const both = mwgPacket([{ name: 'Ada', x: 0.354167, y: 0.241848, w: 0.0542636, h: 0.101902 }])
      + mpPacket([{ name: 'Ada', rect: '0.327035, 0.190897, 0.0542636, 0.101902' }]);
    const { faces } = parseImageMetadata(buildJpegWithXmp(both));
    expect(faces).toHaveLength(1);
  });

  it('skips MWG regions that are not faces', () => {
    const bytes = buildJpegWithXmp(mwgPacket([
      { name: 'Ada', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      { name: 'Rex', x: 0.2, y: 0.2, w: 0.1, h: 0.1, type: 'Pet' },
    ]));
    const { faces } = parseImageMetadata(bytes);
    expect(faces.map(f => f.name)).toEqual(['Ada']);
  });

  it('drops degenerate regions and clamps out-of-range ones', () => {
    const bytes = buildJpegWithXmp(mwgPacket([
      { name: 'Zero', x: 0.5, y: 0.5, w: 0, h: 0.1 },
      { name: 'Over', x: 0.99, y: 0.99, w: 0.5, h: 0.5 },
    ]));
    const { faces } = parseImageMetadata(bytes);
    expect(faces.map(f => f.name)).toEqual(['Over']);
    expect(faces[0].x + faces[0].w).toBeLessThanOrEqual(100);
  });

  it('reads a dc:title caption', () => {
    const bytes = buildJpegWithXmp(captionPacket('With all my love, Emm, June 1936'));
    expect(parseImageMetadata(bytes).caption).toBe('With all my love, Emm, June 1936');
  });

  it('returns empty for bytes with no XMP', () => {
    const result = parseImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(result.faces).toEqual([]);
    expect(result.caption).toBeNull();
  });

  it('never throws on malformed or truncated input', () => {
    expect(() => parseImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00]))).not.toThrow();
    expect(() => parseImageMetadata(buildJpegWithXmp('<x:xmpmeta><broken'))).not.toThrow();
    expect(() => parseImageMetadata(new Uint8Array(0))).not.toThrow();
  });

  it('caps the number of regions one file may declare', () => {
    // Untrusted bytes: a crafted file could otherwise declare tens of thousands
    // of regions, each a permanent row in a table nothing prunes (#487 review).
    const many = Array.from({ length: MAX_REGIONS + 50 }, (_, i) => ({
      name: `P${i}`, x: 0.5, y: 0.5, w: 0.01, h: 0.01,
    }));
    const { faces } = parseImageMetadata(buildJpegWithXmp(mwgPacket(many)));
    expect(faces).toHaveLength(MAX_REGIONS);
  });

  it('finds an XMP packet in a PNG, and does not scan containers it cannot read', () => {
    const packet = new TextEncoder().encode(mwgPacket([
      { name: 'Ada Whitcombe', x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    ]));
    const withHeader = (header: number[]) => {
      const bytes = new Uint8Array(header.length + packet.length);
      bytes.set(header, 0);
      bytes.set(packet, header.length);
      return bytes;
    };
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(parseImageMetadata(withHeader(png)).faces).toHaveLength(1);

    // A GIF carries no XMP we can read this way, so the whole-buffer decode is
    // pure waste and is skipped, even when a packet is literally present.
    const gif = Array.from(new TextEncoder().encode('GIF89a')).concat([0, 0, 0, 0, 0, 0]);
    expect(parseImageMetadata(withHeader(gif)).faces).toHaveLength(0);
  });

  it('drops an oversized packet instead of running the parsers over it', () => {
    // The PNG/WebP fallback is not bounded by a 64KB APP1 segment, so a crafted
    // upload can hand the parsers megabytes. Repeated UNTERMINATED `<dc:title>`
    // and `<rdf:li>` openers are the pathological shape: each one makes a lazy
    // regex rescan to the end of the packet, which is quadratic and blocks the
    // whole event loop, not just the request (#487 review).
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const filler = '<dc:title><rdf:li>x'.repeat(Math.ceil(MAX_PACKET_CHARS / 19) + 100);
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/">${filler}</x:xmpmeta>`;
    expect(packet.length).toBeGreaterThan(MAX_PACKET_CHARS);

    const body = new TextEncoder().encode(packet);
    const bytes = new Uint8Array(png.length + body.length);
    bytes.set(png, 0);
    bytes.set(body, png.length);

    // The assertion is on the RESULT, not on a timeout: an oversized packet is
    // treated as no metadata at all, so no parser ever sees those characters.
    const result = parseImageMetadata(bytes);
    expect(result.faces).toEqual([]);
    expect(result.caption).toBeNull();
  });

  it('still reads a large but in-bounds PNG packet', () => {
    // The cap must not be so eager that a real packet with a long description
    // is thrown away.
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const base = mwgPacket([{ name: 'Ada Whitcombe', x: 0.5, y: 0.5, w: 0.2, h: 0.2 }]);
    const padding = ' '.repeat(MAX_PACKET_CHARS - base.length - 1);
    // Padded INSIDE the packet, so the packet itself is one character under the cap.
    const body = new TextEncoder().encode(base.replace('<rdf:RDF', `${padding}<rdf:RDF`));
    const bytes = new Uint8Array(png.length + body.length);
    bytes.set(png, 0);
    bytes.set(body, png.length);

    expect(parseImageMetadata(bytes).faces).toHaveLength(1);
  });
});
