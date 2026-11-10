import { describe, it, expect } from 'vitest';
import {
    buildMediaSidecar,
    parseMediaSidecar,
    type SidecarTagInput,
} from '@/lib/gedcom/media-sidecar';

function tagInput(overrides: Partial<SidecarTagInput> = {}): SidecarTagInput {
    return {
        FilePath: '5_169.jpg',
        PersonId: 5,
        RegionX: 10,
        RegionY: 20,
        RegionW: 30,
        RegionH: 40,
        ...overrides,
    };
}

describe('buildMediaSidecar', () => {
    it('emits the geometry-only shape keyed by media and person xrefs, as version 3 for the flat layout (#937)', () => {
        const sidecar = buildMediaSidecar(
            [{ Id: 1, FilePath: 'media/O1/photo.jpg', Title: 'Hidden metadata', Format: 'jpg', FocalX: 40, FocalY: 60, FocalRadius: 25 }],
            [{ MediaId: 2, FilePath: 'media/O2/tagged.jpg', PersonId: 5, RegionX: 10, RegionY: 20, RegionW: 30, RegionH: 40 }],
            new Map([[1, '@O1@'], [2, '@O2@']]),
            new Map([[5, '@I5@']]),
        );
        expect(sidecar).toEqual({
            version: 3,
            focalGeometry: [{ media: '@O1@', x: 40, y: 60, radius: 25 }],
            tags: [{ media: '@O2@', person: '@I5@', region: [10, 20, 30, 40] }],
        });
    });

    it('skips default focal geometry and tags with unmapped xrefs', () => {
        const sidecar = buildMediaSidecar(
            [{ Id: 1, FilePath: null, Title: null, Format: null, FocalX: 50, FocalY: 50, FocalRadius: 0 }],
            [tagInput({ MediaId: 2, PersonId: 99 })],
            new Map([[1, '@O1@'], [2, '@O2@']]),
            new Map([[5, '@I5@']]),
        );
        expect(sidecar.focalGeometry).toEqual([]);
        expect(sidecar.tags).toEqual([]);
    });
});

describe('parseMediaSidecar', () => {
    it('retains v1 library metadata and tag-primary input compatibility', () => {
        const parsed = parseMediaSidecar(JSON.stringify({
            version: 1,
            libraryMedia: [{ file: 'photo.jpg', title: 'Portrait', format: 'jpg', focalX: 25, focalY: 75, focalRadius: 30 }],
            tags: [{ file: 'photo.jpg', person: '@I5@', region: [10, 20, 30, 40], primary: true }],
        }));
        expect(parsed.libraryMedia).toEqual([{
            file: 'photo.jpg', title: 'Portrait', format: 'jpg', focalX: 25, focalY: 75, focalRadius: 30,
        }]);
        expect(parsed.tags).toEqual([{
            file: 'photo.jpg', person: '@I5@', region: [10, 20, 30, 40], primary: true,
        }]);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseMediaSidecar('{ not json')).toThrow();
    });

    it('returns empty arrays for an empty object', () => {
        expect(parseMediaSidecar('{}')).toEqual({ libraryMedia: [], tags: [] });
    });

    it('drops malformed tag entries (bad region, missing fields)', () => {
        const raw = JSON.stringify({
            version: 1,
            libraryMedia: [{ file: 'ok.jpg' }, { title: 'no file' }],
            tags: [
                { file: 'a.jpg', person: '@I5@', region: [1, 2, 3, 4], primary: true },
                { file: 'b.jpg', person: '@I6@', region: [1, 2, 3] }, // wrong length
                { file: 'c.jpg', region: [1, 2, 3, 4] }, // missing person
            ],
        });
        const parsed = parseMediaSidecar(raw);
        expect(parsed.libraryMedia).toEqual([
            { file: 'ok.jpg', title: null, format: null, focalX: null, focalY: null, focalRadius: null },
        ]);
        expect(parsed.tags).toEqual([
            { file: 'a.jpg', person: '@I5@', region: [1, 2, 3, 4], primary: true },
        ]);
    });

    it('drops non-finite and out-of-range v2 geometry', () => {
        const parsed = parseMediaSidecar(JSON.stringify({
            version: 2,
            focalGeometry: [
                { media: '@O1@', x: -1, y: 50, radius: 20 },
                { media: '@O2@', x: 50, y: 101, radius: 20 },
                { media: '@O3@', x: 50, y: 50, radius: 501 },
                { media: '@O4@', x: 25, y: 75, radius: 30 },
            ],
            tags: [
                { media: '@O1@', person: '@I1@', region: [-1, 10, 20, 20] },
                { media: '@O2@', person: '@I2@', region: [10, 10, 101, 20] },
                { media: '@O5@', person: '@I5@', region: [90, 90, 20, 20] },
                { media: '@O6@', person: '@I6@', region: [50, 50, 0, 0] },
                { media: '@O3@', person: '@I3@', region: [10, 20, 30, 40] },
            ],
        }));

        expect(parsed.focalGeometry).toEqual([
            { media: '@O4@', x: 25, y: 75, radius: 30 },
        ]);
        expect(parsed.v2Tags).toEqual([
            { media: '@O3@', person: '@I3@', region: [10, 20, 30, 40] },
        ]);
    });
});

describe('parseMediaSidecar dates (#802)', () => {
  it('keeps one clean date per media xref and drops malformed entries', () => {
    const parsed = parseMediaSidecar(JSON.stringify({
      version: 2, focalGeometry: [], tags: [],
      dates: [
        { media: '@O1@', date: 'ABT 1900' },
        { media: '@O1@', date: '1901' },
        { media: '@O2@', date: 'x'.repeat(101) },
        { media: '@O3@', date: 7 },
        { media: '@O4@', date: '1921\n05' },
        ...Array.from({ length: 5000 }, () => ({ media: '@O5@', date: '1930' })),
      ],
    }));
    expect(parsed.dates).toEqual([
      { media: '@O1@', date: '1901' },
      { media: '@O4@', date: '1921 05' },
      { media: '@O5@', date: '1930' },
    ]);
  });
});
