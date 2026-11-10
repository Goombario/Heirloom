import { describe, it, expect } from 'vitest';
import { buildPlaceTree, groupByRoot, collapseEmptyIntermediaries } from '@/lib/places/hierarchy';
import type { PlaceSummary, PlaceGazetteerNode } from '@/lib/data/types';

const gz = (id: number, name: string, parentId: number | null, extra: Partial<PlaceGazetteerNode> = {}): PlaceGazetteerNode =>
  ({ id, name, parentId, latitude: null, longitude: null, displayName: null, pinSuppressed: false, ...extra });
const sm = (id: number | null, name: string, parentId: number | null, count: number, extra: Partial<PlaceSummary> = {}): PlaceSummary =>
  ({ id, name, parentId, count, peopleCount: count, faces: [], latitude: null, longitude: null, ...extra });

describe('collapseEmptyIntermediaries', () => {
  it('skips a fact-less intermediary, promoting its children', () => {
    // United States(0) → New York(0) → Brooklyn(3): New York is skipped.
    const gazetteer = [gz(10, 'United States', null), gz(11, 'New York', 10), gz(12, 'Brooklyn', 11)];
    const roots = collapseEmptyIntermediaries(buildPlaceTree([sm(12, 'Brooklyn', 11, 3)], gazetteer));
    expect(roots[0].name).toBe('United States');
    expect(roots[0].children.map((c) => c.name)).toEqual(['Brooklyn']);
  });

  it('collapses a multi-level empty chain', () => {
    const gazetteer = [gz(10, 'US', null), gz(11, 'NY', 10), gz(12, 'Kings', 11), gz(13, 'Brooklyn', 12)];
    const roots = collapseEmptyIntermediaries(buildPlaceTree([sm(13, 'Brooklyn', 12, 2)], gazetteer));
    expect(roots[0].children.map((c) => c.name)).toEqual(['Brooklyn']);
  });

  it('re-sorts a level after promoting a collapsed node\'s children into it', () => {
    // The browse order is decided AFTER collapsing, not before: promoting Kent's children
    // splices them in at Kent's old position, so a level that was sorted stops being.
    // Reported against the drill: geocoded towns promoted out of an empty county sat
    // below ungeocoded ones of equal weight.
    // Kent is geocoded and sorts above Minster on name, so its UNGEOCODED child inherits
    // that slot when Kent collapses — the promoted row is ordered by the parent it
    // replaced, not by itself.
    const gazetteer = [
      gz(1, 'United Kingdom', null),
      gz(2, 'Kent', 1, { latitude: 51.2, longitude: 0.8 }),              // 0 own facts → collapses
      gz(3, 'Shepway', 2),                                               // promoted, ungeocoded
      gz(4, 'Minster', 1, { latitude: 51.4, longitude: 0.8 }),           // direct child, geocoded
    ];
    const places = [sm(3, 'Shepway', 2, 1), sm(4, 'Minster', 1, 1, { latitude: 51.4, longitude: 0.8 })];

    const [uk] = collapseEmptyIntermediaries(buildPlaceTree(places, gazetteer));

    expect(uk.children.map((c) => c.name)).toEqual(['Minster', 'Shepway']);
  });

  it('keeps a fact-bearing intermediary and always keeps roots', () => {
    // NY has its own fact → kept; US is an empty root → kept.
    const gazetteer = [gz(10, 'US', null), gz(11, 'NY', 10), gz(12, 'Brooklyn', 11)];
    const roots = collapseEmptyIntermediaries(buildPlaceTree([sm(11, 'NY', 10, 1), sm(12, 'Brooklyn', 11, 3)], gazetteer));
    expect(roots[0].name).toBe('US');
    expect(roots[0].children.map((c) => c.name)).toEqual(['NY']);
    expect(roots[0].children[0].children.map((c) => c.name)).toEqual(['Brooklyn']);
  });
});

describe('buildPlaceTree ordering', () => {
  it('breaks a count tie in favour of the geocoded place', () => {
    const gazetteer = [
      gz(1, 'Anywhere', null),
      gz(2, 'Bexley', 1),
      gz(3, 'Ashford', 1, { latitude: 51.1, longitude: 0.8 }),
    ];
    const places = [
      sm(2, 'Bexley', 1, 2),
      sm(3, 'Ashford', 1, 2, { latitude: 51.1, longitude: 0.8 }),
    ];

    // Equal counts, and 'Ashford' would win on name anyway — so also check the case the
    // name rule would lose: the geocoded one sorts first regardless of alphabet.
    expect(buildPlaceTree(places, gazetteer)[0].children.map((c) => c.name)).toEqual(['Ashford', 'Bexley']);

    const flipped = buildPlaceTree(
      [sm(2, 'Bexley', 1, 2, { latitude: 51.4, longitude: 0.1 }), sm(3, 'Ashford', 1, 2)],
      [gz(1, 'Anywhere', null), gz(2, 'Bexley', 1, { latitude: 51.4, longitude: 0.1 }), gz(3, 'Ashford', 1)],
    );
    expect(flipped[0].children.map((c) => c.name)).toEqual(['Bexley', 'Ashford']);
  });

  it('keeps the record count ahead of geocoding', () => {
    // The deliberate consequence of making coordinates the TIEBREAK and not the primary
    // key: a busy ungeocoded jurisdiction still outranks a quiet geocoded hamlet.
    const gazetteer = [
      gz(1, 'Anywhere', null),
      gz(2, 'United Kingdom', 1),
      gz(3, 'Hamlet', 1, { latitude: 51.1, longitude: 0.8 }),
    ];
    const places = [
      sm(2, 'United Kingdom', 1, 12),
      sm(3, 'Hamlet', 1, 1, { latitude: 51.1, longitude: 0.8 }),
    ];
    expect(buildPlaceTree(places, gazetteer)[0].children.map((c) => c.name)).toEqual(['United Kingdom', 'Hamlet']);
  });
});

describe('buildPlaceTree', () => {
  it('materializes a 0-fact parent and rolls up descendant counts', () => {
    const gazetteer = [gz(1, 'England', null), gz(2, 'Kent', 1), gz(3, 'Dover, Kent, England', 2, { latitude: 51.1, longitude: 1.3 })];
    const places = [sm(3, 'Dover, Kent, England', 2, 6, { latitude: 51.1, longitude: 1.3 })];
    const roots = buildPlaceTree(places, gazetteer);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('England');
    expect(roots[0].ownCount).toBe(0);
    expect(roots[0].rolledCount).toBe(6);
    expect(roots[0].children[0].name).toBe('Kent');
    expect(roots[0].children[0].children[0].name).toBe('Dover, Kent, England');
  });

  it('parent that is also a place keeps ownCount AND children', () => {
    const gazetteer = [gz(1, 'England', null, { latitude: 52.3, longitude: -1.5 }), gz(2, 'Kent', 1)];
    const places = [sm(1, 'England', null, 4, { latitude: 52.3, longitude: -1.5 }), sm(2, 'Kent', 1, 3)];
    const roots = buildPlaceTree(places, gazetteer);
    expect(roots[0].ownCount).toBe(4);
    expect(roots[0].rolledCount).toBe(7);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].pinState).toBe('own');
    expect(roots[0].children[0].pinState).toBe('inherited'); // Kent inherits England's pin
  });

  it('marks PinSuppressed as none even under a pinned ancestor', () => {
    const gazetteer = [gz(1, 'England', null, { latitude: 52.3, longitude: -1.5 }), gz(2, 'Kent', 1, { pinSuppressed: true })];
    const roots = buildPlaceTree([sm(2, 'Kent', 1, 1)], gazetteer);
    expect(roots[0].children[0].pinState).toBe('none');
  });

  it('terminates on a ParentId cycle (treats the node as a root)', () => {
    const gazetteer = [gz(1, 'A', 2), gz(2, 'B', 1)];
    const roots = buildPlaceTree([sm(1, 'A', 2, 1), sm(2, 'B', 1, 1)], gazetteer);
    // No infinite loop; both surface as roots.
    expect(roots.length).toBeGreaterThanOrEqual(1);
    const names = roots.map((r) => r.name).sort();
    expect(names).toContain('A');
  });

  it('places a fact place with no gazetteer row as a standalone root', () => {
    const roots = buildPlaceTree([sm(null, 'Nowhere', null, 2)], []);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('Nowhere');
    expect(roots[0].ownCount).toBe(2);
  });
});

describe('groupByRoot', () => {
  it('buckets fact places under their outermost ancestor and orphans separately', () => {
    const gazetteer = [gz(1, 'England', null), gz(2, 'Kent', 1), gz(3, 'Dover, Kent, England', 2)];
    const places = [sm(3, 'Dover, Kent, England', 2, 6), sm(null, 'Brooklyn', null, 9)];
    const { groups, other } = groupByRoot(places, gazetteer);
    expect(groups).toHaveLength(1);
    expect(groups[0].root.name).toBe('England');
    expect(groups[0].places.map((p) => p.name)).toEqual(['Dover, Kent, England']);
    expect(other.map((p) => p.name)).toEqual(['Brooklyn']); // singleton root → Other
  });

  it('includes a fact-bearing root as a card in its own group', () => {
    const gazetteer = [gz(1, 'England', null), gz(2, 'Kent', 1)];
    const places = [sm(1, 'England', null, 4), sm(2, 'Kent', 1, 3)];
    const { groups } = groupByRoot(places, gazetteer);
    expect(groups[0].places.map((p) => p.name).sort()).toEqual(['England', 'Kent']);
  });
});
