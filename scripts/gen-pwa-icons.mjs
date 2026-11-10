#!/usr/bin/env node
/**
 * Generate placeholder PWA icons from the existing app/favicon.ico.
 *
 * The favicon is a multi-image .ico; sharp can't decode .ico directly, but the
 * file embeds a 256x256 PNG entry — we extract that and resize it. These are
 * explicit PLACEHOLDERS reusing the favicon art; re-run this after dropping in a
 * real icon (swap SOURCE, or replace favicon.ico) to regenerate:
 *
 *   node scripts/gen-pwa-icons.mjs
 *
 * Outputs to public/: icon-192.png, icon-512.png, icon-512-maskable.png,
 * apple-touch-icon.png (180). The maskable variant centres the mark at 70% on a
 * slate (#475569, nav colour) field so it survives Android's circle/squircle mask.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const ICO = 'app/favicon.ico';
const OUT = 'public';
const SLATE = '#475569';

/** Extract the largest embedded PNG from an .ico buffer. */
function extractPng(buf) {
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    let w = buf.readUInt8(o);
    if (w === 0) w = 256;
    const size = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    const sig = buf.subarray(off, off + 4);
    const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
    if (isPng && (!best || w > best.w)) best = { w, off, size };
  }
  if (!best) throw new Error('No embedded PNG found in favicon.ico');
  return buf.subarray(best.off, best.off + best.size);
}

const src = extractPng(readFileSync(ICO));

async function main() {
  await sharp(src).resize(192, 192).png().toFile(`${OUT}/icon-192.png`);
  await sharp(src).resize(512, 512).png().toFile(`${OUT}/icon-512.png`);
  await sharp(src).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);

  const mark = await sharp(src).resize(358, 358).png().toBuffer(); // 70% of 512
  await sharp({ create: { width: 512, height: 512, channels: 4, background: SLATE } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(`${OUT}/icon-512-maskable.png`);

  console.log('Generated: icon-192, icon-512, icon-512-maskable, apple-touch-icon (in public/)');
}

main().catch((e) => { console.error(e); process.exit(1); });
