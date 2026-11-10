import { describe, it, expect } from 'vitest';
import {
  buildSourcesSidecar,
  parseSourcesSidecar,
  type SidecarSourceInput,
  type SidecarNameVariantInput,
} from '@/lib/gedcom/sources-sidecar';

describe('buildSourcesSidecar', () => {
  const sources: SidecarSourceInput[] = [
    { Id: 1, RepositoryName: 'LAC', CallNumber: 'MS-44/2' },
    { Id: 2, RepositoryName: null, CallNumber: null },
  ];
  const sourceIdToXref = new Map<number, string>([[1, '@S1@'], [2, '@S2@']]);
  const dbIdToGedcomId = new Map<number, string>([[5, '@I5@']]);

  it('mirrors repository fields keyed by xref, skipping empty ones', () => {
    const out = buildSourcesSidecar(sources, [], [], sourceIdToXref, dbIdToGedcomId);
    expect(out.version).toBe(1);
    expect(out.sources).toEqual([{ xref: '@S1@', repositoryName: 'LAC', callNumber: 'MS-44/2' }]);
  });

  it('emits name variants with their citations, resolving person + source xrefs', () => {
    const variants: SidecarNameVariantInput[] = [
      { Id: 9, PersonId: 5, Type: 'Maiden', Name: 'Jane Doe' },
    ];
    const citations = [
      { FactTable: 'NameVariant', FactId: 9, SourceId: 1, Page: 'p.4', Note: null },
    ];
    const out = buildSourcesSidecar([], citations, variants, sourceIdToXref, dbIdToGedcomId);
    expect(out.nameVariants).toEqual([
      {
        person: '@I5@', type: 'Maiden', name: 'Jane Doe',
        isPrimary: false, fromDate: null, toDate: null,
        citations: [{ source: '@S1@', page: 'p.4', note: null }],
      },
    ]);
  });

  // #399: dropped by the bundle before this, so a round trip silently renamed
  // people (effectiveFirstName keys display off the flag — ADR 0001).
  it('carries IsPrimary and the date range', () => {
    const variants: SidecarNameVariantInput[] = [
      { Id: 9, PersonId: 5, Type: 'Nickname', Name: 'Bill', IsPrimary: 1, FromDate: '1901', ToDate: '1950' },
    ];
    const out = buildSourcesSidecar([], [], variants, sourceIdToXref, dbIdToGedcomId);
    expect(out.nameVariants[0]).toMatchObject({ isPrimary: true, fromDate: '1901', toDate: '1950' });
  });

  it('does not bump the sidecar version for additively-added fields (ADR 0009)', () => {
    const out = buildSourcesSidecar([], [], [], sourceIdToXref, dbIdToGedcomId);
    expect(out.version).toBe(1);
  });

  it('drops a name variant whose person is not in the xref map', () => {
    const variants: SidecarNameVariantInput[] = [{ Id: 9, PersonId: 999, Type: 'Alias', Name: 'X' }];
    const out = buildSourcesSidecar([], [], variants, sourceIdToXref, dbIdToGedcomId);
    expect(out.nameVariants).toEqual([]);
  });
});

describe('parseSourcesSidecar', () => {
  it('parses valid sidecar JSON', () => {
    const raw = JSON.stringify({
      version: 1,
      sources: [{ xref: '@S1@', repositoryName: 'LAC', callNumber: 'MS-44/2' }],
      nameVariants: [{ person: '@I5@', type: 'Maiden', name: 'Jane', citations: [{ source: '@S1@', page: 'p.4', note: null }] }],
    });
    const out = parseSourcesSidecar(raw);
    expect(out.sources[0].xref).toBe('@S1@');
    expect(out.nameVariants[0].citations[0].source).toBe('@S1@');
  });

  // The additive-only guarantee (ADR 0009): a bundle written BEFORE #399 has no
  // isPrimary/fromDate/toDate keys at all and must still import, defaulting
  // rather than throwing. This is why the new fields needed no version bump.
  it('defaults the fields a pre-#399 bundle does not carry', () => {
    const raw = JSON.stringify({
      version: 1,
      sources: [],
      nameVariants: [{ person: '@I5@', type: 'Nickname', name: 'Bill', citations: [] }],
    });
    const out = parseSourcesSidecar(raw);
    expect(out.nameVariants[0]).toEqual({
      person: '@I5@', type: 'Nickname', name: 'Bill',
      isPrimary: false, fromDate: null, toDate: null, citations: [],
    });
  });

  it('reads isPrimary as either a JSON boolean or a 0/1', () => {
    const entry = (isPrimary: unknown) => JSON.stringify({
      version: 1, sources: [],
      nameVariants: [{ person: '@I5@', type: 'Nickname', name: 'Bill', isPrimary, citations: [] }],
    });
    expect(parseSourcesSidecar(entry(true)).nameVariants[0].isPrimary).toBe(true);
    expect(parseSourcesSidecar(entry(1)).nameVariants[0].isPrimary).toBe(true);
    expect(parseSourcesSidecar(entry(false)).nameVariants[0].isPrimary).toBe(false);
    expect(parseSourcesSidecar(entry(0)).nameVariants[0].isPrimary).toBe(false);
  });

  it('drops malformed entries defensively', () => {
    const raw = JSON.stringify({
      sources: [{ repositoryName: 'no xref' }, { xref: '@S2@', repositoryName: 'ok', callNumber: null }],
      nameVariants: [{ type: 'no person/name' }],
    });
    const out = parseSourcesSidecar(raw);
    expect(out.sources).toEqual([{ xref: '@S2@', repositoryName: 'ok', callNumber: null }]);
    expect(out.nameVariants).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSourcesSidecar('{not json')).toThrow();
  });
});
