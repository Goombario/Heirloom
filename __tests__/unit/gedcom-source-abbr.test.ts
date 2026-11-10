import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom, type GedcomExportSource } from '@/lib/gedcom/generator';

/**
 * #501: `1 ABBR <SOURCE_FILED_BY_ENTRY>` (ged551-2.txt:251) — "a short title used
 * for sorting, filing, and retrieving source records" (ged551-4.txt:82).
 *
 * It previously arrived only via Sources."RawGedcom" passthrough. Modelling it means
 * adding it to HANDLED_SOUR_L1 in the SAME change, or the value would be captured
 * twice and emitted twice.
 *
 * DATA/EVEN/AGNC stay unmodelled by decision (ADR 0012's "accept-and-document is the
 * default outcome, not maximal coverage") and keep riding passthrough.
 */
const GED = [
  '0 HEAD',
  '0 @S1@ SOUR',
  '1 TITL 1881 England Census — Glasgow Hutchesontown',
  '1 ABBR Smith 1881',
  '1 AUTH Registrar',
  '0 TRLR',
].join('\n');

function exportSource(s: Partial<GedcomExportSource>): string {
  return generateGedcom([], [], undefined, {
    sources: [{
      Id: 1, Title: 'T', Author: null, PublicationInfo: null, Text: null,
      Contents: null, Type: null, Num: null,
      RepositoryName: null, CallNumber: null, ...s,
    } as GedcomExportSource],
  });
}

describe('source ABBR is modelled, not passthrough (#501)', () => {
  it('imports into Sources.Abbreviation', () => {
    expect(parseGedcom(GED).sources[0].Abbreviation).toBe('Smith 1881');
  });

  // The double-emit hazard. If ABBR were left out of HANDLED_SOUR_L1 it would ALSO
  // be swept into rawLines, and the export would carry two `1 ABBR` lines.
  it('does not also land in RawGedcom passthrough', () => {
    expect(parseGedcom(GED).sources[0].rawLines).toEqual([]);
  });

  it('re-exports exactly once', () => {
    const ged = exportSource({ Title: 'Census', Abbreviation: 'Smith 1881' });
    expect(ged.match(/^1 ABBR /gm)).toHaveLength(1);
    expect(ged).toMatch(/^1 ABBR Smith 1881$/m);
  });

  it('emits nothing when unset', () => {
    expect(exportSource({ Title: 'Census' })).not.toMatch(/^1 ABBR/m);
  });

  it('round-trips as a fixed point', () => {
    const first = parseGedcom(GED).sources[0];
    const out = exportSource({ Title: first.Title, Abbreviation: first.Abbreviation });
    const second = parseGedcom(out).sources[0];
    expect(second.Abbreviation).toBe('Smith 1881');
    expect(second.rawLines).toEqual([]);
  });

  // ABBR is `{0:M}` in the spec but the column holds one, so repeats take the same
  // route as a second BIRT (#513) rather than overwriting or being dropped.
  it('keeps a second ABBR verbatim instead of overwriting the first', () => {
    const ged = [
      '0 @S1@ SOUR', '1 TITL T',
      '1 ABBR First filing',
      '1 ABBR Second filing',
      '0 TRLR',
    ].join('\n');
    const s = parseGedcom(ged).sources[0];
    expect(s.Abbreviation).toBe('First filing');
    expect(s.rawLines).toEqual(['1 ABBR Second filing']);
  });

  it('still treats AGNC/DATA/EVEN as passthrough (won\'t-do, ADR 0012)', () => {
    const ged = [
      '0 @S1@ SOUR', '1 TITL T', '1 ABBR Short',
      '1 AGNC Ville de Montréal',
      '0 TRLR',
    ].join('\n');
    const s = parseGedcom(ged).sources[0];
    expect(s.Abbreviation).toBe('Short');
    expect(s.rawLines).toContain('1 AGNC Ville de Montréal');
  });
});
