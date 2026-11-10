/** Builds a minimal JPEG byte stream carrying an XMP APP1 segment. */
export function buildJpegWithXmp(xmpPacket: string, exifOrientation?: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI

  if (exifOrientation != null) {
    // Minimal little-endian TIFF header with a single Orientation (0x0112) tag.
    const tiff: number[] = [
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", 42, IFD0 offset 8
      0x01, 0x00,                                     // 1 entry
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112, SHORT, count 1
      exifOrientation & 0xff, 0x00, 0x00, 0x00,       // value inline
      0x00, 0x00, 0x00, 0x00,                         // next IFD = 0
    ];
    const header = [...Array.from(new TextEncoder().encode('Exif')), 0x00, 0x00];
    const payload = [...header, ...tiff];
    const len = payload.length + 2;
    parts.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }

  const xmpHeader = Array.from(new TextEncoder().encode('http://ns.adobe.com/xap/1.0/'));
  const xmpBody = Array.from(new TextEncoder().encode(xmpPacket));
  const payload = [...xmpHeader, 0x00, ...xmpBody];
  const len = payload.length + 2;
  parts.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);

  parts.push(0xff, 0xd9); // EOI
  return new Uint8Array(parts);
}

/** MWG regions, centre-relative normalised fractions. */
export function mwgPacket(regions: { name: string; x: number; y: number; w: number; h: number; type?: string }[]): string {
  const items = regions.map(r => `
    <rdf:li><rdf:Description mwg-rs:Name="${r.name}" mwg-rs:Type="${r.type ?? 'Face'}">
      <mwg-rs:Area stArea:x="${r.x}" stArea:y="${r.y}" stArea:w="${r.w}" stArea:h="${r.h}" stArea:unit="normalized"/>
    </rdf:Description></rdf:li>`).join('');
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
    xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#">
    <rdf:Description rdf:about="">
      <mwg-rs:Regions rdf:parseType="Resource"><mwg-rs:RegionList><rdf:Bag>${items}
      </rdf:Bag></mwg-rs:RegionList></mwg-rs:Regions>
    </rdf:Description></rdf:RDF></x:xmpmeta>`;
}

/** Microsoft People regions, top-left normalised fractions. */
export function mpPacket(regions: { name: string; rect: string }[]): string {
  const items = regions.map(r =>
    `<rdf:li MPReg:PersonDisplayName="${r.name}" MPReg:Rectangle="${r.rect}"/>`).join('');
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:MP="http://ns.microsoft.com/photo/1.2/"
    xmlns:MPRI="http://ns.microsoft.com/photo/1.2/t/RegionInfo#"
    xmlns:MPReg="http://ns.microsoft.com/photo/1.2/t/Region#">
    <rdf:Description rdf:about="">
      <MP:RegionInfo rdf:parseType="Resource"><MPRI:Regions><rdf:Bag>${items}
      </rdf:Bag></MPRI:Regions></MP:RegionInfo>
    </rdf:Description></rdf:RDF></x:xmpmeta>`;
}

/** A dc:title caption packet. */
export function captionPacket(caption: string): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
    <rdf:Description rdf:about=""><dc:title><rdf:Alt>
      <rdf:li xml:lang="x-default">${caption}</rdf:li>
    </rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>`;
}
