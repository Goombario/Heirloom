import { describe, it, expect } from 'vitest';
import { collectPins } from '@/app/places/explore/collectPins';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';

function node(over: Partial<PlaceTreeNode> & { name: string }): PlaceTreeNode {
  return {
    id: null, parentId: null, latitude: null, longitude: null,
    children: [], ownCount: 0, rolledCount: 0, peopleCount: 0,
    pinSuppressed: false, pinState: 'none', faces: [],
    ...over,
  };
}

describe('collectPins', () => {
  it('uses the geocoded places below a jurisdiction, not the jurisdiction itself', () => {
    const kent = node({
      name: 'Kent, England', latitude: 51.2, longitude: 0.8,
      children: [
        node({ name: 'Dover, Kent, England', latitude: 51.1279, longitude: 1.3134 }),
        node({ name: 'Faversham, Kent, England', latitude: 51.3149, longitude: 0.8912 }),
      ],
    });

    const pins = collectPins([kent]);

    expect(pins.map((p) => p.label)).toEqual(['Dover', 'Faversham']);
  });

  it('falls back to the jurisdiction\'s own coordinate when nothing below it is geocoded', () => {
    const kent = node({
      name: 'Kent, England', latitude: 51.2, longitude: 0.8,
      children: [node({ name: 'Cannington, Kent, England' })],
    });

    expect(collectPins([kent])).toEqual([{ lat: 51.2, lng: 0.8, label: 'Kent', id: null }]);
  });

  it('carries each place id so a pin can be clicked and highlighted', () => {
    const pins = collectPins([
      node({
        name: 'Kent, England', id: 4,
        children: [node({ name: 'Dover, Kent, England', id: 9, latitude: 51.1, longitude: 1.3 })],
      }),
    ]);

    expect(pins).toEqual([{ lat: 51.1, lng: 1.3, label: 'Dover', id: 9 }]);
  });

  it('returns nothing when neither the node nor anything below it is geocoded', () => {
    expect(collectPins([node({ name: 'Nowhere', children: [node({ name: 'Also nowhere' })] })])).toEqual([]);
  });

  it('keeps a geocoded intermediate jurisdiction, not only true leaves', () => {
    // Kent has a coordinate and one ungeocoded child. Pruning to leaves would drop
    // Kent's pin and leave the county unrepresented on the map.
    const pins = collectPins([
      node({
        name: 'England',
        children: [
          node({
            name: 'Kent, England', latitude: 51.2, longitude: 0.8,
            children: [node({ name: 'Cannington, Kent, England' })],
          }),
        ],
      }),
    ]);

    expect(pins.map((p) => p.label)).toEqual(['Kent']);
  });

  it('collects across several roots', () => {
    const pins = collectPins([
      node({ name: 'England', children: [node({ name: 'Dover', latitude: 51.1, longitude: 1.3 })] }),
      node({ name: 'Canada', latitude: 56.1, longitude: -106.3 }),
    ]);

    expect(pins.map((p) => p.label)).toEqual(['Dover', 'Canada']);
  });
});
