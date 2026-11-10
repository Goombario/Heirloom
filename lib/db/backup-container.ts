/** 4-byte ASCII magic identifying a Heirloom hybrid backup container. */
export const BACKUP_CONTAINER_MAGIC = 'HLBK';
/** Current container format version. */
export const BACKUP_CONTAINER_VERSION = 2;

const MAGIC_BYTES = new Uint8Array([0x48, 0x4c, 0x42, 0x4b]); // "HLBK"

/** One raw media blob and the MediaId it belongs to. */
export interface MediaRecord {
  mediaId: number;
  data: Uint8Array;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true); // little-endian
  return b;
}

async function readU32le(blob: Blob, offset: number): Promise<number> {
  const buf = await blob.slice(offset, offset + 4).arrayBuffer();
  if (buf.byteLength < 4) throw new Error('Truncated backup container');
  return new DataView(buf).getUint32(0, true);
}

/**
 * Assemble a `.hlbak` container: magic + version, the gzipped metadata section,
 * then one `[u32 mediaId][u32 len][bytes]` record per media blob. Pulls one blob
 * at a time and drops each source `Uint8Array` after wrapping it in a per-record
 * sub-Blob, so the caller (streamWorkerMediaBlobs) never materializes more than
 * one blob in the JS heap at once.
 *
 * NOTE: the sub-Blobs accumulate in `records` until final assembly. Whether that
 * keeps total-media bytes resident depends on the runtime: browsers may spill
 * large Blob storage to disk (the mobile memory goal), but small Blobs can stay
 * in RAM — validate with the memory-measurement gate before trusting the peak.
 */
export async function encodeContainer(
  metaGz: Blob,
  blobs: AsyncIterable<MediaRecord>,
): Promise<Blob> {
  const metaGzBytes = new Uint8Array(await metaGz.arrayBuffer());
  const records: BlobPart[] = [];
  let count = 0;
  for await (const { mediaId, data } of blobs) {
    records.push(new Blob([u32le(mediaId), u32le(data.byteLength), data] as BlobPart[]));
    count++;
  }
  return new Blob([
    MAGIC_BYTES,
    new Uint8Array([BACKUP_CONTAINER_VERSION]),
    u32le(metaGzBytes.byteLength),
    metaGzBytes,
    u32le(count),
    ...records,
  ] as BlobPart[]);
}

/**
 * Parse a `.hlbak` container. Reads the fixed header + u32 lengths via cheap
 * `blob.slice(...)` reads and yields media records lazily. Throws on a bad magic,
 * an unknown version, or a truncated container — before any caller touches live
 * data.
 */
export async function decodeContainer(
  blob: Blob,
): Promise<{ version: number; metaGz: Blob; blobs: AsyncIterable<MediaRecord> }> {
  if (blob.size < 5) throw new Error('Unrecognized backup format');
  const magic = String.fromCharCode(...new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
  if (magic !== BACKUP_CONTAINER_MAGIC) throw new Error('Unrecognized backup format');
  const version = new Uint8Array(await blob.slice(4, 5).arrayBuffer())[0];
  if (version !== BACKUP_CONTAINER_VERSION) {
    throw new Error(`Unsupported backup version ${version}`);
  }

  let offset = 5;
  const metaGzLen = await readU32le(blob, offset);
  offset += 4;
  const metaGz = blob.slice(offset, offset + metaGzLen);
  offset += metaGzLen;
  const blobCount = await readU32le(blob, offset);
  offset += 4;

  const recordsStart = offset;
  async function* iterate(): AsyncGenerator<MediaRecord> {
    let off = recordsStart;
    for (let i = 0; i < blobCount; i++) {
      const mediaId = await readU32le(blob, off);
      off += 4;
      const len = await readU32le(blob, off);
      off += 4;
      const data = new Uint8Array(await blob.slice(off, off + len).arrayBuffer());
      if (data.byteLength < len) throw new Error('Truncated backup container');
      off += len;
      yield { mediaId, data };
    }
  }
  return { version, metaGz, blobs: iterate() };
}

/**
 * Read a whole container through to its last byte: header, every media record,
 * and nothing left over. Throws on a short or overlong file. Drive backup runs
 * this before pruning older backups, so it never deletes the last good one in
 * favour of a container it couldn't read back (#878).
 */
export async function verifyContainer(blob: Blob): Promise<{ mediaCount: number }> {
  const { metaGz, blobs } = await decodeContainer(blob);
  let end = 5 + 4 + metaGz.size + 4;
  let mediaCount = 0;
  for await (const { data } of blobs) {
    end += 8 + data.byteLength;
    mediaCount++;
  }
  if (metaGz.size === 0 || end !== blob.size) throw new Error('Malformed backup container');
  return { mediaCount };
}
