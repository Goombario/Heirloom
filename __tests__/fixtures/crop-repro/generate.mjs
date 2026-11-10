/**
 * Regenerates `crop-repro.zip` — a synthetic (fictional, no PII) GEDCOM+media
 * fixture for manually reproducing profile-image rendering bugs (white flash /
 * "crop lag") in the local static build. Run: `node __tests__/fixtures/crop-repro/generate.mjs`
 *
 * Each of the 5 fictional people has their OWN photo with a DISTINCT focal crop
 * (`_FOCALX/_FOCALY/_FOCALR` on the GEDCOM OBJE). Every photo draws a white "face"
 * disc + big initial exactly at that focal point, so when the hero crops to the
 * focal you can SEE whether the correct person's crop is applied. They're all one
 * family, so the person→person Relationship links drive same-route (client-side)
 * switches — the exact path that surfaced the crop lag.
 */
import sharp from 'sharp';
import JSZip from 'jszip';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const outDir = dirname(fileURLToPath(import.meta.url));

// [xref, given, surname, sex, birthYear, bg, focalX, focalY] — focal spread to the
// four corners + centre so each crop is unmistakably different from its neighbours.
const PEOPLE = [
  ['@I1@', 'Ada',   'Faketon', 'F', 1970, '#c0392b', 25, 25],
  ['@I2@', 'Boris', 'Faketon', 'M', 1968, '#2980b9', 75, 25],
  ['@I3@', 'Cleo',  'Faketon', 'F', 1996, '#27ae60', 50, 50],
  ['@I4@', 'Dane',  'Faketon', 'M', 1998, '#8e44ad', 25, 75],
  ['@I5@', 'Elsa',  'Faketon', 'F', 2001, '#16a085', 75, 75],
];
const FOCAL_R = 30; // % — zoom in so the crop difference is obvious
const W = 1200, H = 900;

async function photo(given, bg, fx, fy) {
  const cx = Math.round(W * fx / 100), cy = Math.round(H * fy / 100);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    <rect width="${W}" height="${H}" fill="none" stroke="#ffffff" stroke-width="6" stroke-dasharray="24 16"/>
    <circle cx="${cx}" cy="${cy}" r="120" fill="#ffffff"/>
    <text x="${cx}" y="${cy + 55}" font-size="150" text-anchor="middle" fill="${bg}" font-family="sans-serif" font-weight="bold">${given[0]}</text>
    <text x="${W / 2}" y="${H - 40}" font-size="60" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${given} — focal ${fx},${fy}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

function gedcom() {
  let g = '0 HEAD\n1 SOUR GenealogyApp\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SUBM @SUBM@\n0 @SUBM@ SUBM\n1 NAME Crop Repro Fixture\n';
  for (const [xref, given, surname, sex, birth, , fx, fy] of PEOPLE) {
    const n = xref.replace(/@|I/g, '');
    g += `0 ${xref} INDI\n1 NAME ${given} /${surname}/\n1 SEX ${sex}\n1 BIRT\n2 DATE ${birth}\n1 DEAT N\n`;
    g += `1 OBJE\n2 FILE p${n}.jpg\n3 FORM JPEG\n2 TITL p${n}.jpg\n2 _PRIM Y\n2 _FOCALX ${fx}\n2 _FOCALY ${fy}\n2 _FOCALR ${FOCAL_R}\n`;
    g += xref === '@I1@' || xref === '@I2@' ? '1 FAMS @F1@\n' : '1 FAMC @F1@\n';
  }
  g += '0 @F1@ FAM\n1 HUSB @I2@\n1 WIFE @I1@\n1 CHIL @I3@\n1 CHIL @I4@\n1 CHIL @I5@\n1 MARR\n2 DATE 1994\n';
  g += '0 TRLR\n';
  return g;
}

const zip = new JSZip();
zip.file('family_tree.ged', gedcom());
zip.file('media.json', JSON.stringify({ version: 1, libraryMedia: [], tags: [] }, null, 2));
const media = zip.folder('media');
for (const [xref, given, , , , bg, fx, fy] of PEOPLE) {
  const n = xref.replace(/@|I/g, '');
  media.file(`p${n}.jpg`, await photo(given, bg, fx, fy));
}
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(join(outDir, 'crop-repro.zip'), buf);
console.log(`wrote crop-repro.zip (${(buf.length / 1024).toFixed(0)} KB, ${PEOPLE.length} people)`);
