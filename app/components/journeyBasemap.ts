import type { GeometryCollection, Topology } from 'topojson-specification';

/** A ring or line of [lng, lat] points. */
type Line = [number, number][];

/** One land polygon or border line, with its bounding box for quick culling. */
export interface BasemapShape {
  points: Line;
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

/** The journey sketch's outline map: land rings to fill and country borders to stroke. */
export interface Basemap {
  land: BasemapShape[];
  borders: BasemapShape[];
}

function shape(points: Line): BasemapShape {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { points, minLng, maxLng, minLat, maxLat };
}

let pending: Promise<Basemap> | null = null;

/**
 * Natural Earth's 1:50m land and country borders (public domain, packaged as
 * world-atlas), bundled with the app so the sketch draws real coastlines offline
 * and in the desktop app. Loaded on first use in its own chunk and kept for the
 * session. A failed load is retried on the next call.
 */
export function loadBasemap(): Promise<Basemap> {
  pending ??= Promise.all([import('world-atlas/countries-50m.json'), import('topojson-client')])
    .then(([atlas, { feature, mesh }]) => {
      const topo = (atlas.default ?? atlas) as unknown as Topology<{ land: GeometryCollection; countries: GeometryCollection }>;
      const land: BasemapShape[] = [];
      const landGeo = feature(topo, topo.objects.land);
      for (const f of landGeo.features) {
        const g = f.geometry;
        const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
        for (const poly of polys) for (const ring of poly) land.push(shape(ring as Line));
      }
      // Shared edges only, so coastlines are not stroked twice.
      const borderGeo = mesh(topo, topo.objects.countries, (a, b) => a !== b);
      const borders = borderGeo.coordinates.map((line) => shape(line as Line));
      return { land, borders };
    })
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}
