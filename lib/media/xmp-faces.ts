/**
 * Reads face regions, a caption, a taken date, and EXIF orientation out of raw
 * image bytes.
 *
 * Isomorphic on purpose: the hosted build calls this from the upload service and
 * the static/desktop build calls it in the browser, so there is no `sharp`, no
 * `fs`, and no DOM parser here. XMP is read by targeted attribute extraction —
 * `DOMParser` does not exist in Node, and the payload is flat attributes.
 *
 * Never throws. A photo whose metadata cannot be read must still upload.
 */

interface ParsedFaceRegion {
  /** Verbatim from the file — normalisation for matching happens elsewhere. */
  name: string | null;
  /** Top-left origin, percent of image (0-100), orientation-corrected. */
  x: number; y: number; w: number; h: number;
}

export interface ParsedImageMetadata {
  faces: ParsedFaceRegion[];
  caption: string | null;
  /**
   * When the photo was taken, as YYYY, YYYY-MM or YYYY-MM-DD (#802): the original
   * date (EXIF DateTimeOriginal, else XMP's), falling back to the date it was
   * created (EXIF CreateDate, else XMP's). Upload stores it on the photo; a scan
   * or a phone copy of an old print carries the day it was digitised, so it stays
   * editable.
   */
  takenDate: string | null;
  orientation: number;
}

const EMPTY: ParsedImageMetadata = { faces: [], caption: null, takenDate: null, orientation: 1 };

/** Hard cap on regions accepted from one file. Exported for the test that pins it. */
export const MAX_REGIONS = 200;

/**
 * Hard cap on the XMP packet handed to any parser, in characters.
 *
 * A JPEG packet is bounded structurally: it lives in one APP1 segment, so it
 * cannot exceed ~64KB. The PNG/WebP fallback has no such bound — it returns
 * everything between `<x:xmpmeta` and `</x:xmpmeta>`, which on a crafted upload
 * is megabytes. The parsers below are regex- and split-based, and a packet of
 * repeated unterminated `<rdf:li>` / `<dc:title>` openers makes them rescan to
 * the end once per occurrence, blocking the whole event loop rather than just
 * the one request. A real packet is a few KB; 256KB is generous by two orders
 * of magnitude. Exported for the test that pins it.
 */
export const MAX_PACKET_CHARS = 256 * 1024;

/** Region in 0-1 fractions, top-left origin, before orientation correction. */
interface Frac { name: string | null; x: number; y: number; w: number; h: number }

export function parseImageMetadata(bytes: Uint8Array): ParsedImageMetadata {
  try {
    const xmp = extractXmpPacket(bytes);
    const orientation = extractOrientation(bytes);
    const exif = extractExifDates(bytes);
    if (!xmp) return { ...EMPTY, orientation, takenDate: exif.original ?? exif.created };

    // MWG wins outright. Merging the two schemas would emit every face twice,
    // because digiKam writes both and they describe the same rectangles.
    const all = parseMwgRegions(xmp) ?? parseMpRegions(xmp) ?? [];
    // These bytes are untrusted. A crafted or pathological file can declare tens
    // of thousands of regions, each of which would become a permanent row in a
    // table this design never prunes. A real photo has well under 50.
    const raw = all.length > MAX_REGIONS ? all.slice(0, MAX_REGIONS) : all;

    const faces: ParsedFaceRegion[] = [];
    for (const r of raw) {
      const o = applyOrientation(r, orientation);
      const x = clamp01(o.x), y = clamp01(o.y);
      // Clamp the far edge too, so a region cannot extend past the image.
      const w = clamp01(Math.min(o.w, 1 - x));
      const h = clamp01(Math.min(o.h, 1 - y));
      if (!(w > 0) || !(h > 0)) continue;
      faces.push({ name: o.name, x: x * 100, y: y * 100, w: w * 100, h: h * 100 });
    }

    // Every source's original date outranks any created date: a scanner that
    // writes only XMP's DateTimeOriginal still beats its own EXIF CreateDate.
    const takenDate = exif.original ?? parseXmpDate(xmp, ORIGINAL_XMP_DATES)
      ?? exif.created ?? parseXmpDate(xmp, CREATED_XMP_DATES);
    return { faces, caption: parseCaption(xmp), takenDate, orientation };
  } catch {
    return EMPTY;
  }
}

const XMP_MARKER = 'http://ns.adobe.com/xap/1.0/';
const XMP_EXTENSION_MARKER = 'http://ns.adobe.com/xmp/extension/';

interface JpegSegment {
  marker: number;
  data: Uint8Array;
}

/**
 * Yields the metadata segments before JPEG image data. APP1 is not special
 * here: EXIF, standard XMP, extended XMP, and unrelated APP1 payloads all use
 * the same framing and must be allowed to coexist.
 */
function* iterateJpegSegments(bytes: Uint8Array): Generator<JpegSegment> {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;

  let offset = 2;
  while (offset < bytes.length) {
    // JPEG permits fill bytes between the marker prefix and marker code.
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) return;
    const segStart = offset + 2;
    const segEnd = Math.min(segStart + length - 2, bytes.length);
    yield { marker, data: bytes.subarray(segStart, segEnd) };
    if (segEnd < segStart + length - 2) return;
    offset = segEnd;
  }
}

/** Walks JPEG APP1 segments for the XMP packet. Returns null when absent. */
function extractXmpPacket(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    // Not a JPEG. Dedicated PNG iTXt / WebP chunk readers are out of scope for
    // now; a whole-buffer scan is the tolerant fallback for exactly those two
    // containers, and every other container returns null without decoding.
    return capPacket(scanForPacket(bytes));
  }
  const extended = new Map<string, { length: number; chunks: { offset: number; data: Uint8Array }[] }>();
  let standardPacket: string | null = null;
  for (const segment of iterateJpegSegments(bytes)) {
    if (segment.marker !== 0xe1) continue;
    const data = segment.data;
    const head = decode(data.subarray(0, Math.min(XMP_MARKER.length, data.length)));
    if (head === XMP_MARKER && data[XMP_MARKER.length] === 0) {
      if (standardPacket === null) standardPacket = decode(data.subarray(XMP_MARKER.length + 1));
      continue;
    }

    const extensionHead = decode(data.subarray(0, Math.min(XMP_EXTENSION_MARKER.length, data.length)));
    if (extensionHead !== XMP_EXTENSION_MARKER || data[XMP_EXTENSION_MARKER.length] !== 0) continue;
    const headerStart = XMP_EXTENSION_MARKER.length + 1;
    if (data.length < headerStart + 32 + 8) continue;
    const guid = decode(data.subarray(headerStart, headerStart + 32));
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const fullLength = view.getUint32(headerStart + 32, false);
    const offset = view.getUint32(headerStart + 36, false);
    const body = data.subarray(headerStart + 40);
    if (fullLength === 0 || fullLength > MAX_PACKET_CHARS || offset > fullLength || body.length > fullLength - offset) continue;
    const entry = extended.get(guid) ?? { length: fullLength, chunks: [] };
    if (entry.length !== fullLength) continue;
    entry.chunks.push({ offset, data: body.slice() });
    extended.set(guid, entry);
  }

  // Extension chunks can appear in any APP1 order. Reassemble only a complete,
  // contiguous packet; an incomplete packet is no metadata at all.
  const extensionPackets = new Map<string, string>();
  for (const [guid, entry] of extended) {
    const chunks = [...entry.chunks].sort((a, b) => a.offset - b.offset);
    const packetBytes = new Uint8Array(entry.length);
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.offset !== offset) {
        offset = -1;
        break;
      }
      packetBytes.set(chunk.data, offset);
      offset += chunk.data.length;
    }
    if (offset === entry.length) extensionPackets.set(guid, decode(packetBytes));
  }

  if (standardPacket !== null) {
    // A standard packet may carry the GUID of a companion extended packet.
    // Keeping both serialized fragments is sufficient for the flat attribute
    // readers below and preserves properties from each partition.
    const guid = /(?:xmpNote:HasExtendedXMP|HasExtendedXMP)\s*=\s*"([^"]+)"/.exec(standardPacket)?.[1];
    const extension = guid ? extensionPackets.get(guid) : undefined;
    return capPacket(extension ? `${standardPacket}\n${extension}` : standardPacket);
  }
  for (const packet of extensionPackets.values()) return capPacket(packet);
  return null;
}

/**
 * Fallback scan for the containers whose XMP actually lives in plain text near
 * the start of the file: PNG (`iTXt`) and WebP (`XMP ` chunk).
 *
 * Everything else bails BEFORE decoding. The scan turns the whole buffer into a
 * string, so a 10 MB GIF/BMP/HEIC upload was allocating a 10 MB string to look
 * for a packet those containers do not store this way in the first place.
 */
function scanForPacket(bytes: Uint8Array): string | null {
  if (!isPng(bytes) && !isWebp(bytes)) return null;
  const text = decode(bytes);
  const start = text.indexOf('<x:xmpmeta');
  if (start < 0) return null;
  const end = text.indexOf('</x:xmpmeta>', start);
  return end < 0 ? null : text.slice(start, end + '</x:xmpmeta>'.length);
}

/**
 * Drops a packet too large for the parsers to be safe on. Applied to EVERY
 * packet before any parser sees it — region parsers and the caption parser
 * alike — so the bound holds no matter which container it came from. Dropping
 * rather than truncating: a truncated packet parses into half-regions, and
 * these bytes are untrusted, so the honest answer is "no metadata".
 */
function capPacket(packet: string | null): string | null {
  if (packet === null || packet.length > MAX_PACKET_CHARS) return null;
  return packet;
}

/** \x89 P N G \r \n \x1a \n */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

/** "RIFF" .... "WEBP" */
function isWebp(bytes: Uint8Array): boolean {
  return bytes.length > 12
    && decode(bytes.subarray(0, 4)) === 'RIFF'
    && decode(bytes.subarray(8, 12)) === 'WEBP';
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** EXIF orientation (1-8) from the APP1 Exif segment; 1 when absent. */
function extractOrientation(bytes: Uint8Array): number {
  for (const segment of iterateJpegSegments(bytes)) {
    if (segment.marker === 0xe1 && decode(segment.data.subarray(0, 4)) === 'Exif') {
      const value = readOrientationFromTiff(segment.data, 6);
      if (value >= 1 && value <= 8) return value;
    }
  }
  return 1;
}

function readOrientationFromTiff(bytes: Uint8Array, tiffStart: number): number {
  if (tiffStart + 8 > bytes.length) return 1;
  const le = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const u16 = (p: number) => (le ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]);
  const u32 = (p: number) => (le
    ? bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)
    : (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;

  const ifd = tiffStart + u32(tiffStart + 4);
  if (ifd + 2 > bytes.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

/** EXIF DateTimeOriginal (0x9003) and CreateDate (0x9004, "DateTimeDigitized"). */
const EXIF_DATE_ORIGINAL = 0x9003;
const EXIF_CREATE_DATE = 0x9004;

/** XMP's taken-date properties, by kind, in order of preference. */
const ORIGINAL_XMP_DATES = ['exif:DateTimeOriginal', 'photoshop:DateCreated'];
const CREATED_XMP_DATES = ['xmp:CreateDate', 'exif:DateTimeDigitized'];

/** The EXIF original and created dates from the APP1 Exif segment; null when absent. */
function extractExifDates(bytes: Uint8Array): { original: string | null; created: string | null } {
  let original: string | null = null;
  let created: string | null = null;
  for (const segment of iterateJpegSegments(bytes)) {
    if (segment.marker === 0xe1 && decode(segment.data.subarray(0, 4)) === 'Exif') {
      original ??= readExifDate(segment.data, 6, EXIF_DATE_ORIGINAL);
      created ??= readExifDate(segment.data, 6, EXIF_CREATE_DATE);
      if (original) break;
    }
  }
  return { original, created };
}

/** IFD0 → Exif sub-IFD (0x8769) → a date tag, "YYYY:MM:DD HH:MM:SS". */
function readExifDate(bytes: Uint8Array, tiffStart: number, tag: number): string | null {
  if (tiffStart + 8 > bytes.length) return null;
  const le = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const u16 = (p: number) => (le ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]);
  const u32 = (p: number) => (le
    ? bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)
    : (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
  const findEntry = (ifd: number, tag: number): number => {
    if (ifd + 2 > bytes.length) return -1;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      if (u16(entry) === tag) return entry;
    }
    return -1;
  };

  const pointer = findEntry(tiffStart + u32(tiffStart + 4), 0x8769);
  if (pointer < 0) return null;
  const entry = findEntry(tiffStart + u32(pointer + 8), tag);
  if (entry < 0 || u32(entry + 4) < 10) return null;
  const at = tiffStart + u32(entry + 8);
  if (at + 10 > bytes.length) return null;
  return normalizeTakenDate(decode(bytes.subarray(at, at + 10)));
}

/** The first of `names` XMP carries as a date, as an attribute or an element. */
function parseXmpDate(xmp: string, names: readonly string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const value = attr(xmp, name) ?? new RegExp(`<${escaped}>([^<]*)</${escaped}>`).exec(xmp)?.[1] ?? null;
    const date = value ? normalizeTakenDate(value.trim()) : null;
    if (date) return date;
  }
  return null;
}

/** "1921:05:14 …", "1921-05-14T…", "1921-05" or "1921" → ISO; null for zeros or nonsense. */
function normalizeTakenDate(value: string): string | null {
  const match = /^(\d{4})(?:[:-](\d{2})(?:[:-](\d{2}))?)?/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(year) < 1826 || Number(year) > 2200) return null;
  if (month === undefined) return year;
  if (Number(month) < 1 || Number(month) > 12) return year;
  if (day === undefined || Number(day) < 1 || Number(day) > 31) return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

/** Returns the item blocks from RDF Bag and Seq containers, in document order. */
function rdfListBlocks(xmp: string): string[] {
  const blocks: string[] = [];
  const lists = /<rdf:(?:Bag|Seq)\b[^>]*>([\s\S]*?)(?:<\/rdf:(?:Bag|Seq)>|$)/g;
  for (const match of xmp.matchAll(lists)) {
    blocks.push(...match[1].split(/<rdf:li\b/).slice(1));
  }
  return blocks;
}

/** MWG areas are CENTRE-relative — the centre must be shifted to a top-left origin. */
function parseMwgRegions(xmp: string): Frac[] | null {
  if (!xmp.includes('mwg-rs:RegionList')) return null;
  const out: Frac[] = [];
  // Each region is one rdf:Description carrying Name/Type plus a nested Area.
  const blocks = rdfListBlocks(xmp);
  for (const block of blocks) {
    if (!block.includes('stArea:x')) continue;
    const type = attr(block, 'mwg-rs:Type');
    if (type && type.toLowerCase() !== 'face') continue;
    const x = num(attr(block, 'stArea:x'));
    const y = num(attr(block, 'stArea:y'));
    const w = num(attr(block, 'stArea:w'));
    const h = num(attr(block, 'stArea:h'));
    if ([x, y, w, h].some(v => v === null)) continue;
    out.push({
      name: attr(block, 'mwg-rs:Name'),
      x: (x as number) - (w as number) / 2,
      y: (y as number) - (h as number) / 2,
      w: w as number,
      h: h as number,
    });
  }
  return out.length > 0 ? out : null;
}

/** MP rectangles are already top-left: "x, y, w, h". */
function parseMpRegions(xmp: string): Frac[] | null {
  if (!xmp.includes('MPReg:Rectangle')) return null;
  const out: Frac[] = [];
  const blocks = rdfListBlocks(xmp);
  for (const block of blocks) {
    const rect = attr(block, 'MPReg:Rectangle');
    if (!rect) continue;
    const parts = rect.split(',').map(p => num(p.trim()));
    if (parts.length !== 4 || parts.some(v => v === null)) continue;
    out.push({
      name: attr(block, 'MPReg:PersonDisplayName'),
      x: parts[0] as number, y: parts[1] as number,
      w: parts[2] as number, h: parts[3] as number,
    });
  }
  return out.length > 0 ? out : null;
}

function parseCaption(xmp: string): string | null {
  const alt = /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(xmp);
  if (alt) return decodeEntities(alt[1].trim()) || null;
  const acdsee = attr(xmp, 'acdsee:caption');
  return acdsee ? decodeEntities(acdsee) || null : null;
}

function attr(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*=\\s*"([^"]*)"`).exec(source);
  return match ? decodeEntities(match[1]) : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function num(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Rotates a region from the file's own coordinate space into the upright space
 * the stored pixels will occupy. `sharp.rotate()` bakes EXIF orientation in at
 * upload, so without this every box on a rotated phone photo lands wrong.
 */
function applyOrientation(r: Frac, orientation: number): Frac {
  const { name, x, y, w, h } = r;
  switch (orientation) {
    case 2: return { name, x: 1 - x - w, y, w, h };
    case 3: return { name, x: 1 - x - w, y: 1 - y - h, w, h };
    case 4: return { name, x, y: 1 - y - h, w, h };
    case 5: return { name, x: y, y: x, w: h, h: w };
    case 6: return { name, x: 1 - y - h, y: x, w: h, h: w };
    case 7: return { name, x: 1 - y - h, y: 1 - x - w, w: h, h: w };
    case 8: return { name, x: y, y: 1 - x - w, w: h, h: w };
    default: return r;
  }
}
