import { describe, it, expect } from 'vitest';
import { decodeAnsel, decodeGedcom, decodeGedcomWithCharset } from '@/lib/gedcom/charset';
import { parseGedcom } from '@/lib/gedcom/parser';

/** Build a byte array from ASCII strings and raw byte numbers. */
function bytes(...parts: (string | number)[]): Uint8Array {
  const arr: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') arr.push(p);
    else for (let i = 0; i < p.length; i++) arr.push(p.charCodeAt(i));
  }
  return new Uint8Array(arr);
}

describe('GEDCOM charset (Slice 0b)', () => {
  it('transcodes ANSEL combining diacritics (mark-before-base) to NFC Unicode', () => {
    // ANSEL: acute(0xE2)+e = é ; tilde(0xE4)+n = ñ ; umlaut(0xE8)+u = ü ; cedilla(0xF0)+c = ç
    expect(decodeAnsel(bytes(0xe2, 'e'))).toBe('é');
    expect(decodeAnsel(bytes(0xe4, 'n'))).toBe('ñ');
    expect(decodeAnsel(bytes(0xe8, 'u'))).toBe('ü');
    expect(decodeAnsel(bytes(0xf0, 'c'))).toBe('ç');
    // spacing special characters act as a base
    expect(decodeAnsel(bytes(0xa1))).toBe('Ł');
    expect(decodeAnsel(bytes(0xb5))).toBe('æ');
  });

  it('decodes an ANSEL-declared file with accents intact and no U+FFFD (GED-2)', () => {
    const ged = bytes(
      '0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Jos', 0xe2, 'e /Mu', 0xe4, 'noz/\n0 TRLR\n',
    );
    const text = decodeGedcom(ged);
    expect(text).toContain('José /Muñoz/');
    expect(text).not.toContain('�');

    const p = parseGedcom(text).people[0];
    expect(p.FirstName).toBe('José');
    expect(p.LastName).toBe('Muñoz');
  });

  it('passes UTF-8 through unchanged', () => {
    const utf8 = new TextEncoder().encode('0 HEAD\n1 CHAR UTF-8\n1 NAME Žiž /ka/\n');
    expect(decodeGedcom(utf8)).toContain('Žiž /ka/');
  });

  it('decodes UTF-16 via BOM', () => {
    const body = Buffer.from('0 HEAD\n1 NAME Élan /Vital/\n', 'utf16le');
    const withBom = new Uint8Array([0xff, 0xfe, ...body]);
    expect(decodeGedcom(withBom)).toContain('Élan /Vital/');
  });

  it('decodes ANSI (CP-1252) when declared', () => {
    // 0xE9 in CP-1252 is é (vs ANSEL where 0xE9 is a combining caron).
    const ged = bytes('0 HEAD\n1 CHAR ANSI\n1 NAME Andr', 0xe9, ' /Roy/\n');
    expect(decodeGedcom(ged)).toContain('André /Roy/');
  });

  it('falls back to UTF-8 for an unlabeled valid-UTF-8 file', () => {
    const utf8 = new TextEncoder().encode('0 HEAD\n1 NAME Łódź /City/\n');
    expect(decodeGedcom(utf8)).toContain('Łódź /City/');
  });

  it('falls back to ANSEL for an unlabeled non-UTF-8 file', () => {
    // 0xE2 0x65 is invalid UTF-8 but valid ANSEL (é).
    expect(decodeGedcom(bytes('1 NAME Jos', 0xe2, 'e //\n'))).toContain('José');
  });

  it('parses a GEDCOM string that starts with a UTF-8 BOM', () => {
    // Our export now prefixes one (Q8). Two independent mechanisms should cope:
    // decodeGedcom strips it from raw bytes, and String.trim() strips U+FEFF
    // from text because U+FEFF is in the ECMAScript WhiteSpace production.
    const ged = '﻿0 @I1@ INDI\n1 NAME Bom /Tolerant/\n0 TRLR';
    const result = parseGedcom(ged);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].FirstName).toBe('Bom');
    expect(result.people[0].LastName).toBe('Tolerant');
  });

  it('strips a UTF-8 BOM from raw bytes before decoding', () => {
    const ged = bytes(0xef, 0xbb, 0xbf, '0 @I1@ INDI\n1 NAME Byte /Order/\n0 TRLR');
    const text = decodeGedcom(ged);
    expect(text.startsWith('0 @I1@ INDI')).toBe(true);
  });

  it('decodes the ANSEL bytes missing from the original table', () => {
    // Verified against the LoC MARC-8 code tables, "Basic and Extended Latin".
    expect(decodeAnsel(bytes(0x8d))).toBe('‍');  // ZERO WIDTH JOINER
    expect(decodeAnsel(bytes(0x8e))).toBe('‌');  // ZERO WIDTH NON-JOINER
    expect(decodeAnsel(bytes(0xc8))).toBe('€');       // EURO SIGN
  });

  it('leaves the entries that other implementations get wrong alone', () => {
    // read-gedcom maps these to U+00D0, U+02BE and U+00B0 respectively. LoC
    // confirms ours. Regression guard against "reconciling" toward its table.
    expect(decodeAnsel(bytes(0xa3))).toBe('Đ');  // D WITH STROKE
    expect(decodeAnsel(bytes(0xae))).toBe('ʼ');  // ALIF
    expect(decodeAnsel(bytes(0xb0))).toBe('ʻ');  // AYN
  });

  it('drops the ANSEL non-sort control bytes instead of emitting control characters', () => {
    expect(decodeAnsel(bytes('The ', 0x88, 'Hague', 0x89))).toBe('The Hague');
  });
});

// #875: each mislabelled or unlabelled encoding from the data audit (§2).
describe('GEDCOM charset detection (#875)', () => {
  // "José Möller" in Windows-1252: é = 0xE9, ö = 0xF6.
  const josé = ['1 NAME Jos', 0xe9, ' /M', 0xf6, 'ller/\n'];

  it('falls back to Windows-1252 when CHAR UTF-8 or ASCII sits over CP1252 bytes', () => {
    for (const declared of ['UTF-8', 'ASCII']) {
      const result = decodeGedcomWithCharset(bytes(`0 HEAD\n1 CHAR ${declared}\n0 @I1@ INDI\n`, ...josé, '0 TRLR\n'));
      expect(result).toMatchObject({ charset: 'Windows-1252', guessed: true });
      expect(result.text).toContain('José /Möller/');
    }
  });

  it('reads CP1252 as Windows-1252, not ANSEL, with no CHAR or CHAR IBMPC', () => {
    for (const header of ['0 HEAD\n', '0 HEAD\n1 CHAR IBMPC\n']) {
      const result = decodeGedcomWithCharset(bytes(header, '0 @I1@ INDI\n', ...josé, '0 TRLR\n'));
      expect(result).toMatchObject({ charset: 'Windows-1252', guessed: true });
      expect(result.text).toContain('José /Möller/');
    }
  });

  it('reads unlabelled French CP1252 as Windows-1252, not ANSEL carons', () => {
    // "Josée Hélène, été" in CP1252: é = 0xE9 (the ANSEL caron), è = 0xE8.
    const result = decodeGedcomWithCharset(bytes('0 HEAD\n0 @I1@ INDI\n1 NAME Jos', 0xe9, 'e /H', 0xe9, 'l', 0xe8, 'ne/\n1 NOTE ', 0xe9, 't', 0xe9, '\n0 TRLR\n'));
    expect(result).toMatchObject({ charset: 'Windows-1252', guessed: true });
    expect(result.text).toContain('Josée /Hélène/');
  });

  it('still reads unlabelled ANSEL as ANSEL', () => {
    const result = decodeGedcomWithCharset(bytes('0 HEAD\n0 @I1@ INDI\n1 NAME Jos', 0xe2, 'e /M', 0xe8, 'oller/\n0 TRLR\n'));
    expect(result).toMatchObject({ charset: 'ANSEL', guessed: true });
    expect(result.text).toContain('José /Möller/');
  });

  it('detects UTF-16 without a BOM, in both byte orders', () => {
    const text = '0 HEAD\n1 CHAR UNICODE\n0 @I1@ INDI\n1 NAME José /Möller/\n0 TRLR\n';
    const le = new Uint8Array(text.length * 2);
    const be = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      le[i * 2] = text.charCodeAt(i);
      be[i * 2 + 1] = text.charCodeAt(i);
    }
    expect(decodeGedcomWithCharset(le)).toEqual({ text, charset: 'UTF-16LE', guessed: false });
    expect(decodeGedcomWithCharset(be)).toEqual({ text, charset: 'UTF-16BE', guessed: false });
    expect(parseGedcom(decodeGedcom(le)).people[0]).toMatchObject({ FirstName: 'José', LastName: 'Möller' });
  });

  it('rejoins a UTF-8 character split across a CONC boundary', () => {
    // é is C3 A9 in UTF-8; the exporter wrapped between the two bytes.
    const ged = bytes('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NOTE Jos', 0xc3, '\n2 CONC ', 0xa9, ' end\n0 TRLR\n');
    const result = decodeGedcomWithCharset(ged);
    expect(result).toMatchObject({ charset: 'UTF-8', guessed: false });
    expect(parseGedcom(result.text).people[0].notes[0].text).toBe('José end');
  });

  it('does not flag a correctly labelled file', () => {
    const utf8 = new TextEncoder().encode('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME José /Möller/\n0 TRLR\n');
    expect(decodeGedcomWithCharset(utf8)).toMatchObject({ charset: 'UTF-8', guessed: false });
  });
});
