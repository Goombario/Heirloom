// Pure marker bookkeeping for LocationMap.
//
// LocationMap used to tear the whole map down (`map.remove()`) whenever its marker
// values changed, which made per-marker state — a hover highlight (#416) — impossible:
// encoding the highlight in the marker list re-initialized the map, refetching tiles on
// every hover. The map instance now survives marker changes, and this module works out
// what actually changed so the effect can add / remove / move individual markers.
//
// It is deliberately DOM-free and MapLibre-free: the map itself is not unit-testable, so
// the decision logic lives here and is tested on its own (same split as groupFactLinks).

import type { MapMarker } from './LocationMap';

export interface KeyedMarker {
  key: string;
  marker: MapMarker;
}

/** Stable identity for a marker across renders. Gazetteer id when there is one; otherwise
 *  the label, which is all an id-less marker has. Deliberately NOT the position: a marker
 *  that moves must be the same marker moved (`updated`), not a new one — a dragged pin
 *  (#566) would otherwise be destroyed and rebuilt on every drag and every keystroke,
 *  losing its drag state mid-edit. Same-label duplicates are separated below. */
function baseKey(m: MapMarker): string {
  return m.id != null ? `#${m.id}` : `@${m.label}`;
}

/** Keys a marker list, disambiguating exact duplicates (two id-less places sharing a
 *  coordinate and a name) with an occurrence suffix so neither shadows the other. */
export function keyMarkers(markers: readonly MapMarker[]): KeyedMarker[] {
  const seen = new Map<string, number>();
  return markers.map((marker) => {
    const base = baseKey(marker);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: n === 0 ? base : `${base}~${n}`, marker };
  });
}

export interface MarkerDiff {
  /** Not in the registry — construct and add. */
  added: KeyedMarker[];
  /** In the registry, gone from the list — remove. */
  removed: string[];
  /** Same key, different position or content — update the existing marker in place. */
  updated: KeyedMarker[];
}

function sameMarker(a: MapMarker, b: MapMarker): boolean {
  return a.lat === b.lat && a.lng === b.lng && a.label === b.label && a.href === b.href;
}

export function diffMarkers(
  prev: ReadonlyMap<string, MapMarker>,
  next: readonly MapMarker[],
): MarkerDiff {
  const keyed = keyMarkers(next);
  const nextKeys = new Set(keyed.map((k) => k.key));
  const added: KeyedMarker[] = [];
  const updated: KeyedMarker[] = [];

  for (const entry of keyed) {
    const before = prev.get(entry.key);
    if (!before) added.push(entry);
    else if (!sameMarker(before, entry.marker)) updated.push(entry);
  }

  const removed = [...prev.keys()].filter((key) => !nextKeys.has(key));
  return { added, removed, updated };
}

/** Registry keys for a set of place ids. A hovered jurisdiction highlights every pin
 *  BELOW it (#570), so the highlight is a set, not one marker: at the root the drill
 *  lists countries while the pins are their descendants, and a single id matched nothing. */
export function keysForIds(ids: readonly number[]): Set<string> {
  return new Set(ids.map((id) => `#${id}`));
}

/** Whether a highlight resolves to exactly one DRAWN pin — which is when it gets a name
 *  chip, several chips in one county being an unreadable stack. Counting the highlighted
 *  ids instead would miss the case the chip exists for: a geocoded country with one
 *  geocoded town below it highlights two ids, but `collectPins` does not draw the
 *  country's own pin, so the single lit pin would have gone unnamed. */
export function highlightNamesOne(
  keys: ReadonlySet<string>,
  present: ReadonlySet<string>,
): boolean {
  let found = 0;
  for (const key of keys) {
    if (present.has(key) && ++found > 1) return false;
  }
  return found === 1;
}

/** Which marker elements lose the highlight and which gain it. Both empty when the
 *  highlight did not move, so a re-render touches no DOM at all. */
export function highlightTransition(
  prev: ReadonlySet<string>,
  next: ReadonlySet<string>,
): { off: string[]; on: string[] } {
  return {
    off: [...prev].filter((key) => !next.has(key)),
    on: [...next].filter((key) => !prev.has(key)),
  };
}
