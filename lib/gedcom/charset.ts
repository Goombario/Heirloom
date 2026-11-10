/**
 * GEDCOM charset detection + decoding (Slice 0b, audit GED-2).
 *
 * GEDCOM 5.5.1 files may be ANSEL (the spec default), ASCII, ANSI (CP-1252),
 * UTF-8, or UNICODE (UTF-16). Reading them all as UTF-8 corrupts accented names
 * (mojibake / U+FFFD). We read raw bytes, look at `HEAD.CHAR`, and decode
 * accordingly — transcoding ANSEL to Unicode.
 *
 * ANSEL stores a combining diacritic BEFORE its base letter (e.g. "é" =
 * 0xE2 0x65 = acute, then 'e'); Unicode puts the mark AFTER the base. The
 * decoder buffers pending marks and emits them after the next base char, then
 * NFC-composes to precomposed characters.
 */

// Combining diacritics: ANSEL byte → Unicode combining mark (applied to the
// FOLLOWING base character). Covers the Z39.47 set; the European accents that
// dominate genealogy (grave/acute/circumflex/tilde/macron/breve/dot/umlaut/
// caron/ring/cedilla/ogonek/dot-below) are all here.
//
// DELIBERATE DIVERGENCE from the LoC table: LoC maps 0xEB/0xFA to the
// double-width marks U+0361/U+0360 with 0xEC/0xFB left unmapped — one mark
// spanning two base letters. We use the U+FE20–FE23 Combining Half Marks, which
// is what that Unicode block exists for and postdates the 2000 LoC table.
// Switching would change how already-imported records render. Keep as is.
const ANSEL_COMBINING: Record<number, string> = {
    0xe0: '̉', // hook above
    0xe1: '̀', // grave
    0xe2: '́', // acute
    0xe3: '̂', // circumflex
    0xe4: '̃', // tilde
    0xe5: '̄', // macron
    0xe6: '̆', // breve
    0xe7: '̇', // dot above
    0xe8: '̈', // diaeresis (umlaut)
    0xe9: '̌', // caron (háček)
    0xea: '̊', // ring above
    0xeb: '︠', // ligature, left half
    0xec: '︡', // ligature, right half
    0xed: '̕', // comma above right
    0xee: '̋', // double acute
    0xef: '̐', // candrabindu
    0xf0: '̧', // cedilla
    0xf1: '̨', // ogonek (right hook)
    0xf2: '̣', // dot below
    0xf3: '̤', // double dot below
    0xf4: '̥', // ring below
    0xf5: '̳', // double low line
    0xf6: '̲', // low line
    0xf7: '̦', // comma below
    0xf8: '̜', // left half ring below
    0xf9: '̮', // breve below
    0xfa: '︢', // double tilde, left half
    0xfb: '︣', // double tilde, right half
    0xfe: '̓', // comma above
};

// Spacing special characters: ANSEL byte → precomposed Unicode (acts as a base).
//
// Verified in full against the Library of Congress MARC-8 code tables, code
// table "Basic and Extended Latin" (January 2000):
//   https://www.loc.gov/marc/specifications/codetables.xml
// All entries below match LoC. Note that read-gedcom's widely-copied table is
// NOT a reliable reference — it maps 0xA3→U+00D0, 0xAE→U+02BE and
// 0xB0→U+00B0 (duplicating its own 0xC0), all three of which contradict LoC.
// It also adds 0xBE/0xBF/0xCE, which are absent from LoC Extended Latin; those
// are deliberately not adopted here.
const ANSEL_SPACING: Record<number, string> = {
    // Format characters. Not "spacing" strictly, but handled the same way —
    // emitted directly and flushing any pending combining mark.
    0x8d: '‍', // ZERO WIDTH JOINER
    0x8e: '‌', // ZERO WIDTH NON-JOINER
    0xa1: 'Ł', // Ł
    0xa2: 'Ø', // Ø
    0xa3: 'Đ', // Đ
    0xa4: 'Þ', // Þ
    0xa5: 'Æ', // Æ
    0xa6: 'Œ', // Œ
    0xa7: 'ʹ', // ʹ modifier prime
    0xa8: '·', // ·
    0xa9: '♭', // ♭
    0xaa: '®', // ®
    0xab: '±', // ±
    0xac: 'Ơ', // Ơ
    0xad: 'Ư', // Ư
    0xae: 'ʼ', // ʼ
    0xb0: 'ʻ', // ʻ
    0xb1: 'ł', // ł
    0xb2: 'ø', // ø
    0xb3: 'đ', // đ
    0xb4: 'þ', // þ
    0xb5: 'æ', // æ
    0xb6: 'œ', // œ
    0xb7: 'ʺ', // ʺ
    0xb8: 'ı', // ı (dotless i)
    0xb9: '£', // £
    0xba: 'ð', // ð
    0xbc: 'ơ', // ơ
    0xbd: 'ư', // ư
    0xc0: '°', // °
    0xc1: 'ℓ', // ℓ
    0xc2: '℗', // ℗
    0xc3: '©', // ©
    0xc4: '♯', // ♯
    0xc5: '¿', // ¿
    0xc6: '¡', // ¡
    0xc7: 'ß', // ß
    0xc8: '€', // € EURO SIGN (standard MARC-8 Extended Latin, not a vendor extension)
    0xcd: 'e', // e (rare; degrade gracefully)
};

/** Transcode ANSEL bytes to NFC Unicode. */
export function decodeAnsel(bytes: Uint8Array): string {
    let out = '';
    let pending = ''; // combining marks awaiting their base char
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0x80) {
            out += String.fromCharCode(b) + pending;
            pending = '';
        } else if (ANSEL_COMBINING[b] !== undefined) {
            pending += ANSEL_COMBINING[b];
        } else if (ANSEL_SPACING[b] !== undefined) {
            out += ANSEL_SPACING[b] + pending;
            pending = '';
        } else if (b === 0x88 || b === 0x89) {
            // Non-sort begin/end. LoC maps these to U+0098/U+009C, which are
            // themselves C1 controls; emitting either puts an invisible control
            // character inside a name. Drop them and keep any pending mark.
            continue;
        } else {
            // Unknown high byte: keep its codepoint rather than dropping data.
            out += String.fromCharCode(b) + pending;
            pending = '';
        }
    }
    if (pending) out += pending; // trailing mark with no base
    return out.normalize('NFC');
}

/** Read the `HEAD.CHAR` value by scanning the (ASCII) header as latin1. */
function peekChar(bytes: Uint8Array): string | null {
    const limit = Math.min(bytes.length, 2048);
    let head = '';
    for (let i = 0; i < limit; i++) head += String.fromCharCode(bytes[i]);
    const m = head.match(/(?:^|[\r\n])\s*1 CHAR\s+([^\r\n]+)/i);
    return m ? m[1].trim().toUpperCase() : null;
}

/** True if the bytes decode as valid UTF-8 (no malformed sequences). */
function looksUtf8(bytes: Uint8Array): boolean {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
    } catch {
        return false;
    }
}

/**
 * True when the high bytes read as ANSEL: most combining marks (0xE0–0xFE) sit
 * before an ASCII letter they compose with under NFC (#875). CP1252 puts its
 * accented letters in the same range, but there they follow a letter or end a
 * word ("José ", "Möller"), so the pair seldom composes.
 */
function looksAnsel(bytes: Uint8Array): boolean {
    let marks = 0;
    let composed = 0;
    for (let i = 0; i < bytes.length; i++) {
        if (ANSEL_COMBINING[bytes[i]] === undefined) continue;
        // 0xE9 is the ANSEL caron but also CP1252 "é", the commonest accented
        // byte in French. A caron composes with c, d, e, n, r, s, t and z, so
        // "été" or "Josée" would vote for ANSEL. It carries no evidence either way.
        if (bytes[i] === 0xe9) continue;
        let seq = '';
        let j = i;
        while (j < bytes.length && ANSEL_COMBINING[bytes[j]] !== undefined) seq += ANSEL_COMBINING[bytes[j++]];
        marks++;
        const base = bytes[j];
        if (base !== undefined && /[A-Za-z]/.test(String.fromCharCode(base))) {
            const raw = String.fromCharCode(base) + seq;
            if (raw.normalize('NFC').length < raw.length) composed++;
        }
        i = j - 1;
    }
    return marks > 0 && composed * 2 > marks;
}

/**
 * Some exporters wrap a long value with CONC in the middle of a multibyte UTF-8
 * character, which leaves both halves malformed (#875). Move the trailing
 * continuation bytes back onto the line they belong to, working on a latin1
 * view so every byte maps to one code unit.
 */
function joinSplitUtf8Conc(bytes: Uint8Array): Uint8Array {
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    const joined = text.replace(
        /([\xC0-\xF7][\x80-\xBF]{0,2})(\r\n|\r|\n)([ \t]*\d+ CONC )([\x80-\xBF]{1,3})/g,
        '$1$4$2$3',
    );
    if (joined === text) return bytes;
    return Uint8Array.from(joined, (c) => c.charCodeAt(0));
}

/** The encoding a GEDCOM file was read with, and whether it was a guess. */
export interface DecodedGedcom {
    text: string;
    charset: 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'ANSEL' | 'Windows-1252';
    /**
     * Set when the file didn't say how it was encoded, or said UTF-8/ASCII over
     * bytes that aren't. The import reports it so a user can spot mojibake.
     */
    guessed: boolean;
}

/**
 * Decode raw GEDCOM bytes to a Unicode string, honoring the BOM / `HEAD.CHAR`,
 * and report the encoding actually used (#875).
 *
 * - A BOM wins. Without one, `0\0` / `\00` at the start is UTF-16 LE / BE.
 * - `CHAR ANSEL` and `ANSI`/`CP1252` are trusted.
 * - `CHAR UTF-8`/`ASCII` over bytes that aren't valid UTF-8 (older PAF and
 *   Legacy exports) falls back to Windows-1252, after repairing a character
 *   split across `CONC`.
 * - No or an unknown `CHAR` (including `IBMPC`): UTF-8 when valid, ANSEL when
 *   the bytes look like ANSEL, else Windows-1252.
 */
export function decodeGedcomWithCharset(bytes: Uint8Array): DecodedGedcom {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), charset: 'UTF-8', guessed: false };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), charset: 'UTF-16LE', guessed: false };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), charset: 'UTF-16BE', guessed: false };
    }
    // Every GEDCOM file opens with "0 HEAD", so a BOM-less UTF-16 file starts
    // with the digit and a zero byte in one order or the other.
    if (bytes.length >= 2 && bytes[0] === 0x30 && bytes[1] === 0x00) {
        return { text: new TextDecoder('utf-16le').decode(bytes), charset: 'UTF-16LE', guessed: false };
    }
    if (bytes.length >= 2 && bytes[0] === 0x00 && bytes[1] === 0x30) {
        return { text: new TextDecoder('utf-16be').decode(bytes), charset: 'UTF-16BE', guessed: false };
    }

    const utf8 = (b: Uint8Array): DecodedGedcom => ({ text: new TextDecoder('utf-8').decode(b), charset: 'UTF-8', guessed: false });
    const cp1252 = (guessed: boolean): DecodedGedcom => ({ text: new TextDecoder('windows-1252').decode(bytes), charset: 'Windows-1252', guessed });

    const charset = peekChar(bytes);
    switch (charset) {
        case 'ANSEL':
            return { text: decodeAnsel(bytes), charset: 'ANSEL', guessed: false };
        case 'UNICODE':
        case 'UTF-16':
            return { text: new TextDecoder('utf-16le').decode(bytes), charset: 'UTF-16LE', guessed: false };
        case 'ANSI':
        case 'CP1252':
        case 'WINDOWS-1252':
            return cp1252(false);
        case 'ASCII':
        case 'UTF-8':
        case 'UTF8': {
            if (looksUtf8(bytes)) return utf8(bytes);
            const repaired = joinSplitUtf8Conc(bytes);
            if (repaired !== bytes && looksUtf8(repaired)) return utf8(repaired);
            return cp1252(true);
        }
        default: {
            if (looksUtf8(bytes)) return utf8(bytes);
            const repaired = joinSplitUtf8Conc(bytes);
            if (repaired !== bytes && looksUtf8(repaired)) return utf8(repaired);
            if (looksAnsel(bytes)) return { text: decodeAnsel(bytes), charset: 'ANSEL', guessed: true };
            return cp1252(true);
        }
    }
}

/** Decode raw GEDCOM bytes to a Unicode string (see `decodeGedcomWithCharset`). */
export function decodeGedcom(bytes: Uint8Array): string {
    return decodeGedcomWithCharset(bytes).text;
}

/** Read a File's bytes and decode per its GEDCOM charset. */
export async function readGedcomText(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<DecodedGedcom> {
    return decodeGedcomWithCharset(new Uint8Array(await file.arrayBuffer()));
}
