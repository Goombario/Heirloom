import { describe, it, expect } from 'vitest';
import {
  dropDanglingPointers,
  markRawPointers,
  maskRawPointers,
  resolveRawPointerMarkers,
  resolveRawPointerTokens,
} from '@/lib/gedcom/raw-pointers';

// Pointers kept in GEDCOM passthrough (#979): the file's xref → a marker → the
// record's id → the export's own xref.
const RECORDS = new Map([['@S3@', 'SOUR'], ['@N1@', 'NOTE'], ['@I2@', 'INDI'], ['@U1@', 'SUBM'], ['@X1@', '_PLAC']]);

describe('markRawPointers', () => {
  it('marks each pointer with its record kind and drops the ones the app does not keep', () => {
    const { lines, dropped } = markRawPointers([
      '1 TITL Count', '2 SOUR @S3@', '3 PAGE 7',
      '1 ANCI @U1@', '2 _NOTE gone with it',
      '1 _LOC @X1@', '1 ASSO @I9@',
      '1 ASSO @I2@', '2 RELA Godfather',
    ], RECORDS);
    expect(lines).toEqual(['1 TITL Count', '2 SOUR @~?S:S3@', '3 PAGE 7', '1 ASSO @~?I:I2@', '2 RELA Godfather']);
    expect(dropped).toEqual(['ANCI', '_LOC', 'ASSO']);
  });

  it('leaves values that are not one whole pointer alone', () => {
    const lines = ['2 DATE @#DJULIAN@ 1700', '1 EMAIL a@@b.example', '1 NOTE see @S3@ too'];
    expect(markRawPointers(lines, RECORDS)).toEqual({ lines, dropped: [] });
  });

  it("drops a file's own value shaped like a marker or token", () => {
    expect(markRawPointers(['1 _X @~S:1@', '1 _Y @~?S:S3@'], RECORDS).lines).toEqual([]);
  });
});

describe('resolveRawPointerMarkers', () => {
  it('stores each marker as its record id, and drops one whose record was not kept', () => {
    const ids = new Map([['S:@S3@', 41], ['I:@I2@', 7]]);
    const result = resolveRawPointerMarkers(
      '1 TITL Count\n2 SOUR @~?S:S3@\n3 PAGE 7\n1 NOTE @~?N:N1@\n2 CONT gone\n1 ASSO @~?I:I2@',
      (kind, xref) => ids.get(`${kind}:${xref}`),
    );
    expect(result).toEqual({ raw: '1 TITL Count\n2 SOUR @~S:41@\n3 PAGE 7\n1 ASSO @~I:7@', dropped: ['NOTE'] });
  });

  it('returns null when nothing is left', () => {
    expect(resolveRawPointerMarkers('1 NOTE @~?N:N1@', () => undefined)).toEqual({ raw: null, dropped: ['NOTE'] });
  });
});

describe('resolveRawPointerTokens', () => {
  it("rewrites a token to the export's xref and drops one the export doesn't hold", () => {
    const lines = resolveRawPointerTokens(
      ['1 TITL Count', '2 SOUR @~S:41@', '3 PAGE 7', '1 ASSO @~I:8@', '2 RELA Gone', '1 _X @~?S:S3@', '1 ASSO @I2@'],
      (kind, id) => (kind === 'S' && id === 41 ? '@S2@' : undefined),
    );
    expect(lines).toEqual(['1 TITL Count', '2 SOUR @S2@', '3 PAGE 7', '1 ASSO @I2@']);
  });
});

describe('dropDanglingPointers', () => {
  it('drops pointer lines to xrefs the file does not define, with their sub-lines', () => {
    const lines = ['0 HEAD', '1 SUBM @U1@', '0 @I1@ INDI', '1 FAMS @F1@', '1 ASSO @I1@', '2 RELA Self', '1 SOUR @S9@', '2 PAGE 1', '1 TITL Sir', '0 TRLR'];
    expect(dropDanglingPointers(lines)).toEqual(['0 HEAD', '0 @I1@ INDI', '1 ASSO @I1@', '2 RELA Self', '1 TITL Sir', '0 TRLR']);
  });
});

describe('maskRawPointers', () => {
  it('compares passthrough the same whatever form its pointers are in', () => {
    expect(maskRawPointers('2 SOUR @S3@')).toBe(maskRawPointers('2 SOUR @~S:41@'));
    expect(maskRawPointers('2 SOUR @~?S:S3@')).toBe('2 SOUR @@');
    expect(maskRawPointers(null)).toBeNull();
  });
});
