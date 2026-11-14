// Resolves the MapLibre basemap style URL. Defaults to OpenFreeMap — no API key,
// no quota, production-friendly — so nothing secret ships to the public static
// build. Theme-aware: light = positron, dark = OpenFreeMap's dark style. Override
// via env (e.g. to self-host the style) without code changes.

const LIGHT_DEFAULT = 'https://tiles.openfreemap.org/styles/positron';
const DARK_DEFAULT = 'https://tiles.openfreemap.org/styles/dark';
const WORKER_PATH = '/maplibre/maplibre-gl-worker.mjs';

export function getMapStyleUrl(theme: 'light' | 'dark'): string {
  if (theme === 'dark') {
    return (
      process.env.NEXT_PUBLIC_MAP_STYLE_URL_DARK ||
      process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
      DARK_DEFAULT
    );
  }
  return process.env.NEXT_PUBLIC_MAP_STYLE_URL || LIGHT_DEFAULT;
}

/**
 * MapLibre GL JS v6 ships an ESM worker whose relative `import.meta.url` cannot
 * reliably survive application bundling. The build scripts copy the worker and
 * its shared module into public/maplibre; point MapLibre at that stable URL.
 *
 * Keep the static build's optional basePath in front of the worker path so the
 * same code works when Heirloom is served from a subpath rather than `/`.
 */
export function getMapWorkerUrl(): string {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
  return `${basePath}${WORKER_PATH}`;
}

interface MapLibreWorkerConfig {
  setWorkerUrl(url: string): void;
}

export function configureMapLibreWorker(maplibregl: MapLibreWorkerConfig): void {
  maplibregl.setWorkerUrl(getMapWorkerUrl());
}

// Structural slice of the MapLibre Map we need — avoids importing the heavy,
// client-only maplibre-gl module into this lib.
interface CreditControl {
  onAdd(): HTMLElement;
  onRemove(): void;
}
interface CreditMap {
  addControl(control: CreditControl, position?: 'bottom-right'): unknown;
}

export interface MapCreditLabels {
  /** "© OpenStreetMap", linked to the ODbL copyright page. */
  osm: string;
  /** "OpenMapTiles", the schema OpenFreeMap's tiles are built on. */
  tiles: string;
}

const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const OPENMAPTILES_URL = 'https://openmaptiles.org/';

// The basemap credit, always shown as plain text in the map's corner (#42).
// MapLibre's compact control collapsed it behind an ⓘ, and the OSMF attribution
// guidelines only allow that after five seconds or on interaction
// (osmfoundation.org/wiki/Licence/Attribution_Guidelines). A credit that never
// collapses needs no ⓘ, so every map is built with `attributionControl: false`
// and gets this control instead. OpenFreeMap asks for the OpenMapTiles and
// OpenStreetMap credit; naming OpenFreeMap itself is optional.
export function addMapCredit(map: CreditMap, labels: MapCreditLabels): void {
  let el: HTMLElement | null = null;
  map.addControl({
    onAdd() {
      el = document.createElement('div');
      el.className = 'maplibregl-ctrl map-credit';
      const link = (href: string, text: string) => {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = text;
        return a;
      };
      el.append(link(OSM_COPYRIGHT_URL, labels.osm), document.createTextNode(' · '), link(OPENMAPTILES_URL, labels.tiles));
      return el;
    },
    onRemove() {
      el?.remove();
      el = null;
    },
  }, 'bottom-right');
}
