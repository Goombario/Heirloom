import { describe, expect, it } from 'vitest';
import { parseImageMetadata } from '@/lib/media/xmp-faces';
import { buildJpegWithXmp } from '../fixtures/xmp/build-fixture';

/**
 * #802: upload stores the photo's own date. EXIF DateTimeOriginal (0x9003) and
 * CreateDate (0x9004) live in the Exif sub-IFD that IFD0's 0x8769 entry points to.
 */
function jpegWithExifDates(dates: Array<[tag: number, value: string]>, bigEndian = false): Uint8Array {
  const exifIfd = 26;
  const valuesAt = exifIfd + 2 + dates.length * 12 + 4;
  const tiff = new Uint8Array(valuesAt + dates.length * 20);
  const view = new DataView(tiff.buffer);
  const le = !bigEndian;
  tiff.set(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49], 0);
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le); // IFD0
  view.setUint16(8, 1, le);
  view.setUint16(10, 0x8769, le); view.setUint16(12, 4, le); view.setUint32(14, 1, le); view.setUint32(18, exifIfd, le);
  view.setUint16(exifIfd, dates.length, le);
  dates.forEach(([tag, value], i) => {
    const entry = exifIfd + 2 + i * 12;
    const at = valuesAt + i * 20;
    view.setUint16(entry, tag, le); view.setUint16(entry + 2, 2, le); view.setUint32(entry + 4, 20, le); view.setUint32(entry + 8, at, le);
    tiff.set(new TextEncoder().encode(value), at);
  });
  const data = new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...tiff]);
  const length = data.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...data, 0xff, 0xd9]);
}

const ORIGINAL = 0x9003;
const CREATED = 0x9004;
const jpegWithDateTimeOriginal = (value: string, bigEndian = false) => jpegWithExifDates([[ORIGINAL, value]], bigEndian);

const xmp = (inner: string) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${inner}</rdf:RDF></x:xmpmeta>`;

describe('taken date from photo metadata (#802)', () => {
  it('prefers the original date to the created date, in either order in the IFD', () => {
    expect(parseImageMetadata(jpegWithExifDates([[CREATED, '2019:03:02 09:00:00'], [ORIGINAL, '1921:05:14 10:30:00']])).takenDate).toBe('1921-05-14');
    expect(parseImageMetadata(jpegWithExifDates([[ORIGINAL, '1921:05:14 10:30:00'], [CREATED, '2019:03:02 09:00:00']])).takenDate).toBe('1921-05-14');
  });

  it('falls back to EXIF CreateDate when there is no original date', () => {
    expect(parseImageMetadata(jpegWithExifDates([[CREATED, '2019:03:02 09:00:00']])).takenDate).toBe('2019-03-02');
  });

  it("reads XMP's original date, and XMP CreateDate as the last fallback", () => {
    const original = xmp('<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:DateTimeOriginal="1899-07-02T12:00:00"/>');
    expect(parseImageMetadata(buildJpegWithXmp(original)).takenDate).toBe('1899-07-02');
    const created = xmp('<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreateDate="2004-06-30T08:00:00"/>');
    expect(parseImageMetadata(buildJpegWithXmp(created)).takenDate).toBe('2004-06-30');
  });

  it('reads EXIF DateTimeOriginal in either byte order', () => {
    expect(parseImageMetadata(jpegWithDateTimeOriginal('1921:05:14 10:30:00')).takenDate).toBe('1921-05-14');
    expect(parseImageMetadata(jpegWithDateTimeOriginal('2003:12:01 08:00:00', true)).takenDate).toBe('2003-12-01');
  });

  it('ignores a zeroed camera clock', () => {
    expect(parseImageMetadata(jpegWithDateTimeOriginal('0000:00:00 00:00:00')).takenDate).toBeNull();
  });

  it('falls back to XMP, keeping a partial date partial', () => {
    const attr = xmp('<rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:DateCreated="1921-05"/>');
    expect(parseImageMetadata(buildJpegWithXmp(attr)).takenDate).toBe('1921-05');
    const element = xmp('<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/"><exif:DateTimeOriginal>1899-07-02T12:00:00</exif:DateTimeOriginal></rdf:Description>');
    expect(parseImageMetadata(buildJpegWithXmp(element)).takenDate).toBe('1899-07-02');
  });

  it('is null without a date', () => {
    expect(parseImageMetadata(buildJpegWithXmp(xmp('<rdf:Description/>'))).takenDate).toBeNull();
    expect(parseImageMetadata(new Uint8Array([1, 2, 3])).takenDate).toBeNull();
  });
});
