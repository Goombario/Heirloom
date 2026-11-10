import { describe, it, expect } from 'vitest';
import {
  encodeContainer,
  decodeContainer,
  BACKUP_CONTAINER_MAGIC,
  BACKUP_CONTAINER_VERSION,
  verifyContainer,
  type MediaRecord,
} from '@/lib/db/backup-container';

async function collect(blobs: AsyncIterable<MediaRecord>): Promise<MediaRecord[]> {
  const out: MediaRecord[] = [];
  for await (const r of blobs) out.push(r);
  return out;
}

async function* gen(records: MediaRecord[]): AsyncGenerator<MediaRecord> {
  for (const r of records) yield r;
}

describe('backup-container framing', () => {
  it('round-trips metadata and media records byte-identically', async () => {
    const metaGz = new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])]); // pretend-gzip bytes
    const records: MediaRecord[] = [
      { mediaId: 1, data: new Uint8Array([255, 0, 128, 7]) },
      { mediaId: 42, data: new Uint8Array([]) },
      { mediaId: 9, data: new Uint8Array([9, 9, 9, 9, 9]) },
    ];
    const container = await encodeContainer(metaGz, gen(records));

    const decoded = await decodeContainer(container);
    expect(decoded.version).toBe(BACKUP_CONTAINER_VERSION);
    expect(new Uint8Array(await decoded.metaGz.arrayBuffer())).toEqual(new Uint8Array([0x1f, 0x8b, 1, 2, 3]));
    const got = await collect(decoded.blobs);
    expect(got.map((r) => r.mediaId)).toEqual([1, 42, 9]);
    expect(Array.from(got[0].data)).toEqual([255, 0, 128, 7]);
    expect(Array.from(got[1].data)).toEqual([]);
    expect(Array.from(got[2].data)).toEqual([9, 9, 9, 9, 9]);
  });

  it('starts with the ASCII magic and version byte', async () => {
    const container = await encodeContainer(new Blob([new Uint8Array([1])]), gen([]));
    const head = new Uint8Array(await container.slice(0, 5).arrayBuffer());
    expect(String.fromCharCode(...head.slice(0, 4))).toBe(BACKUP_CONTAINER_MAGIC);
    expect(head[4]).toBe(BACKUP_CONTAINER_VERSION);
  });

  it('rejects a bad magic', async () => {
    const bogus = new Blob([new Uint8Array([0x1f, 0x8b, 0, 0, 2])]);
    await expect(decodeContainer(bogus)).rejects.toThrow(/backup format/i);
  });

  it('rejects an unknown version', async () => {
    const container = await encodeContainer(new Blob([new Uint8Array([1])]), gen([]));
    const bytes = new Uint8Array(await container.arrayBuffer());
    bytes[4] = 0x03; // tamper version
    await expect(decodeContainer(new Blob([bytes]))).rejects.toThrow(/version/i);
  });

  it('rejects a truncated container when the media stream is consumed', async () => {
    const container = await encodeContainer(
      new Blob([new Uint8Array([1])]),
      gen([{ mediaId: 1, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }]),
    );
    const bytes = new Uint8Array(await container.arrayBuffer());
    const truncated = new Blob([bytes.slice(0, bytes.length - 4)]); // cut into the record
    const decoded = await decodeContainer(truncated);
    await expect(collect(decoded.blobs)).rejects.toThrow(/truncat/i);
  });

  // #862: hostile or damaged lengths must fail before any caller touches live data.
  it('rejects a metadata length that runs past the end of the file', async () => {
    const container = await encodeContainer(new Blob([new Uint8Array([1, 2])]), gen([]));
    const bytes = new Uint8Array(await container.arrayBuffer());
    new DataView(bytes.buffer).setUint32(5, 0xffff_fff0, true);
    await expect(decodeContainer(new Blob([bytes]))).rejects.toThrow(/truncat/i);
  });

  it('rejects a record length that runs past the end of the file', async () => {
    const container = await encodeContainer(new Blob([new Uint8Array([1])]), gen([{ mediaId: 1, data: new Uint8Array([1, 2]) }]));
    const bytes = new Uint8Array(await container.arrayBuffer());
    // header 5 + meta len 4 + meta 1 + count 4 + mediaId 4 → the record's length field.
    new DataView(bytes.buffer).setUint32(18, 0x7fff_ffff, true);
    await expect(collect((await decodeContainer(new Blob([bytes]))).blobs)).rejects.toThrow(/truncat/i);
  });

  it('rejects a record count larger than the records present', async () => {
    const container = await encodeContainer(new Blob([new Uint8Array([1])]), gen([{ mediaId: 1, data: new Uint8Array([1]) }]));
    const bytes = new Uint8Array(await container.arrayBuffer());
    new DataView(bytes.buffer).setUint32(10, 2, true);
    await expect(collect((await decodeContainer(new Blob([bytes]))).blobs)).rejects.toThrow(/truncat/i);
  });

  it('decoding tolerates trailing bytes, but verification does not', async () => {
    const container = await encodeContainer(new Blob([new Uint8Array([1])]), gen([{ mediaId: 3, data: new Uint8Array([7]) }]));
    const padded = new Blob([container, new Uint8Array([0, 0])]);
    expect((await collect((await decodeContainer(padded)).blobs)).map((r) => r.mediaId)).toEqual([3]);
    expect(await verifyContainer(container)).toEqual({ mediaCount: 1 });
    await expect(verifyContainer(padded)).rejects.toThrow(/malformed/i);
  });
});
