// Map markers for the current jurisdiction.
//
// The rule (redesign rationale, "Map fit"): pins are the geocoded places BELOW the
// current jurisdiction — every one of them, intermediate jurisdictions included,
// not only the leaves; the jurisdiction's own coordinate is used only when nothing
// below it is geocoded at all. Including a country's own pin alongside its towns
// blew the fitted bounds out to the country centroid, so the towns bunched into a
// corner of the well. Dropping only the top node's pin is what fixes that; pruning
// to true leaves as well would silently lose a county that has a coordinate and a
// single ungeocoded child.

import type { MapMarker } from '@/app/components/LocationMap';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';

const shortLabel = (name: string) => name.split(',')[0]?.trim() ?? name;

// The node's id rides along so a pin can select the place it stands for (#466) and be
// addressed by the hovered drill row (#416). It stays nullable: a place with no gazetteer
// row has no id to select by, and such a pin is left unclickable by LocationMap.
const pin = (n: PlaceTreeNode, lat: number, lng: number): MapMarker => ({
  lat, lng, label: shortLabel(n.name), id: n.id,
});

/** Own-coordinate markers for every geocoded node strictly BELOW `node`. */
function descendantPins(node: PlaceTreeNode): MapMarker[] {
  const out: MapMarker[] = [];
  const walk = (n: PlaceTreeNode) => {
    if (n.latitude != null && n.longitude != null) {
      out.push(pin(n, n.latitude, n.longitude));
    }
    n.children.forEach(walk);
  };
  node.children.forEach(walk);
  return out;
}

/** Markers for a set of jurisdictions: their geocoded descendants, or their own
 *  coordinate when nothing below them is geocoded. */
export function collectPins(nodes: PlaceTreeNode[]): MapMarker[] {
  const out: MapMarker[] = [];
  for (const node of nodes) {
    const below = descendantPins(node);
    if (below.length > 0) {
      out.push(...below);
    } else if (node.latitude != null && node.longitude != null) {
      out.push(pin(node, node.latitude, node.longitude));
    }
  }
  return out;
}
