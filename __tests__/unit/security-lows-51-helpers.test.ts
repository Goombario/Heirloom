import { describe, expect, it } from 'vitest';
import { readJsonObject } from '@/lib/api/read-json';
import { parseBodyId } from '@/lib/utils/parse-id';
import { hasPassthroughImageSignature } from '@/lib/media/allowed-extensions';
import { ValidationError } from '@/lib/validation';

const req = (body: string) => new Request('http://x/api', { method: 'POST', body });
const bytes = (text: string) => new TextEncoder().encode(text);

describe('readJsonObject (#51, L-1)', () => {
  it('turns malformed, empty, null, array and scalar bodies into a ValidationError', async () => {
    for (const body of ['{', '', 'null', '[1]', '"x"', '5']) {
      await expect(readJsonObject(req(body))).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('returns a JSON object body', async () => {
    await expect(readJsonObject(req('{"a":1}'))).resolves.toEqual({ a: 1 });
  });
});

describe('parseBodyId (#51, L-1)', () => {
  it('accepts whole positive ids as numbers or digit strings', () => {
    expect(parseBodyId(5, 'id')).toBe(5);
    expect(parseBodyId('12', 'id')).toBe(12);
    expect(parseBodyId(null, 'id')).toBeNull();
    expect(parseBodyId(undefined, 'id')).toBeUndefined();
  });

  it('rejects arrays, fractions, booleans, zero and out-of-range ids', () => {
    for (const v of [[5], 1.5, true, 0, -1, 2 ** 31, '1e3', {}]) {
      expect(() => parseBodyId(v, 'id')).toThrow(ValidationError);
    }
  });
});

describe('hasPassthroughImageSignature (#51, L-3)', () => {
  it('checks GIF signatures', () => {
    expect(hasPassthroughImageSignature('.gif', bytes('GIF89a....'))).toBe(true);
    expect(hasPassthroughImageSignature('.gif', bytes('<html>'))).toBe(false);
  });

  it('checks that an SVG is markup with an svg element', () => {
    expect(hasPassthroughImageSignature('.svg', bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
    expect(hasPassthroughImageSignature('.svg', bytes('﻿<?xml version="1.0"?>\n<!-- x -->\n<svg/>'))).toBe(true);
    expect(hasPassthroughImageSignature('.svg', bytes('<html><body>hi</body></html>'))).toBe(false);
    expect(hasPassthroughImageSignature('.svg', bytes('GIF89a'))).toBe(false);
    expect(hasPassthroughImageSignature('.svg', new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0x00]))).toBe(false);
  });
});
