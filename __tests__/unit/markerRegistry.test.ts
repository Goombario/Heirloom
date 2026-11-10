import { describe, it, expect } from 'vitest';
import {
  diffMarkers,
  highlightNamesOne,
  highlightTransition,
  keyMarkers,
  keysForIds,
} from '@/app/components/markerRegistry';
import type { MapMarker } from '@/app/components/LocationMap';

const m = (over: Partial<MapMarker> & { label: string }): MapMarker => ({
  lat: 51.1, lng: 1.3, ...over,
});

const registry = (markers: MapMarker[]) =>
  new Map(keyMarkers(markers).map(({ key, marker }) => [key, marker]));

describe('keyMarkers', () => {
  it('keys by gazetteer id when there is one', () => {
    // Same shape keysForIds produces, which is what lets a highlight address a marker.
    expect(keyMarkers([m({ label: 'Dover', id: 7 })])[0].key).toBe('#7');
    expect(keysForIds([7])).toEqual(new Set(['#7']));
  });

  it('keys id-less markers by label, not position, so a moved one stays itself', () => {
    const [{ key }] = keyMarkers([m({ label: 'Dover', lat: 51.1, lng: 1.3 })]);
    // Nothing in keysForIds can ever produce this shape, so an id-less pin is
    // unreachable by a highlight — as it must be: there is no id to point at it with.
    expect(key).toBe('@Dover');
    expect(keyMarkers([m({ label: 'Dover', lat: 48.85, lng: 2.35 })])[0].key).toBe('@Dover');
  });

  it('moves an id-less marker instead of rebuilding it when its position changes', () => {
    // The dragged pin on /places/view has no gazetteer id. Rebuilding it on every drag
    // and every keystroke would throw away the element being dragged.
    const before = registry([m({ label: 'Dover', lat: 51.1, lng: 1.3 })]);
    const diff = diffMarkers(before, [m({ label: 'Dover', lat: 51.2, lng: 1.4 })]);
    expect(diff.updated.map((u) => u.key)).toEqual(['@Dover']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('disambiguates exact duplicates so neither shadows the other', () => {
    const keys = keyMarkers([m({ label: 'Dover' }), m({ label: 'Dover' })]).map((k) => k.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('diffMarkers', () => {
  it('adds markers the registry has never seen', () => {
    const diff = diffMarkers(registry([m({ label: 'Dover', id: 1 })]), [
      m({ label: 'Dover', id: 1 }),
      m({ label: 'Faversham', id: 2, lat: 51.3, lng: 0.9 }),
    ]);
    expect(diff.added.map((a) => a.key)).toEqual(['#2']);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it('removes markers that dropped out of the list', () => {
    const diff = diffMarkers(
      registry([m({ label: 'Dover', id: 1 }), m({ label: 'Faversham', id: 2 })]),
      [m({ label: 'Dover', id: 1 })],
    );
    expect(diff.removed).toEqual(['#2']);
    expect(diff.added).toEqual([]);
  });

  it('updates a marker in place when it moves or is relabelled', () => {
    const diff = diffMarkers(registry([m({ label: 'Dover', id: 1 })]), [
      m({ label: 'Dover', id: 1, lat: 51.2 }),
    ]);
    expect(diff.updated.map((u) => u.key)).toEqual(['#1']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('reports nothing to do when the same markers come back', () => {
    const markers = [m({ label: 'Dover', id: 1 }), m({ label: 'Faversham', id: 2 })];
    const diff = diffMarkers(registry(markers), [...markers]);
    expect(diff).toEqual({ added: [], removed: [], updated: [] });
  });

  it('treats an href change as an update, not a rebuild', () => {
    const diff = diffMarkers(registry([m({ label: 'Dover', id: 1 })]), [
      m({ label: 'Dover', id: 1, href: '/places/view?name=Dover' }),
    ]);
    expect(diff.updated.map((u) => u.key)).toEqual(['#1']);
  });
});

describe('keysForIds', () => {
  it('maps place ids to registry keys', () => {
    expect(keysForIds([1, 2])).toEqual(new Set(['#1', '#2']));
    expect(keysForIds([])).toEqual(new Set());
  });
});

describe('highlightNamesOne', () => {
  const set = (...keys: string[]) => new Set(keys);

  it('names a highlight that draws exactly one pin', () => {
    expect(highlightNamesOne(set('#1'), set('#1', '#2'))).toBe(true);
  });

  it('names a jurisdiction hover whose only DRAWN pin is one town', () => {
    // The case the id count got wrong: a geocoded country plus its one geocoded town are
    // two highlighted ids, but collectPins does not draw the country's own pin.
    expect(highlightNamesOne(set('#1', '#2'), set('#2'))).toBe(true);
  });

  it('does not name a highlight covering several drawn pins', () => {
    expect(highlightNamesOne(set('#1', '#2'), set('#1', '#2'))).toBe(false);
  });

  it('names nothing when the highlight draws nothing', () => {
    expect(highlightNamesOne(set('#9'), set('#1'))).toBe(false);
    expect(highlightNamesOne(set(), set('#1'))).toBe(false);
  });
});

describe('highlightTransition', () => {
  const set = (...keys: string[]) => new Set(keys);

  it('does nothing when the highlight has not moved', () => {
    expect(highlightTransition(set('#1'), set('#1'))).toEqual({ off: [], on: [] });
    expect(highlightTransition(set(), set())).toEqual({ off: [], on: [] });
  });

  it('moves the highlight between two markers', () => {
    expect(highlightTransition(set('#1'), set('#2'))).toEqual({ off: ['#1'], on: ['#2'] });
  });

  it('clears the highlight when hover leaves the list', () => {
    expect(highlightTransition(set('#1'), set())).toEqual({ off: ['#1'], on: [] });
  });

  it('sets the first highlight', () => {
    expect(highlightTransition(set(), set('#2'))).toEqual({ off: [], on: ['#2'] });
  });

  it('touches only the difference when a jurisdiction hover overlaps the previous one', () => {
    // Hovering a parent then its child: the shared pin must not be toggled off and
    // back on, or it would flicker mid-hover.
    expect(highlightTransition(set('#1', '#2', '#3'), set('#2', '#4'))).toEqual({
      off: ['#1', '#3'],
      on: ['#4'],
    });
  });
});
