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
interface CompactAttribMap {
  getContainer(): HTMLElement;
}

// MapLibre's compact attribution control renders EXPANDED — but NOT at
// construction. On init the attribution HTML is still empty (sources haven't
// loaded), so the control carries `maplibregl-attrib-empty` and `_updateCompact`
// skips it. The `maplibregl-compact-show` + `open` are added asynchronously on
// the first `sourcedata`/`styledata` event, once the attribution string
// populates.
//
// The OSMF attribution guidelines let a map collapse its credit only after the
// user interacts with the map or after five seconds, not on load (checked
// 2026-10-13 for #740: osmfoundation.org/wiki/Licence/Attribution_Guidelines;
// OpenFreeMap asks for the same OpenMapTiles/OpenStreetMap credit MapLibre shows).
// So the credit opens as MapLibre shows it, then collapses to the ⓘ after five
// seconds or on the first pointer or wheel input on the map, whichever comes first.
// Clicking the ⓘ still expands it, so the licence stays one tap away. MapLibre
// won't re-add the show class later: its `_updateCompact` short-circuits on the
// now-present `maplibregl-compact` class.
const ATTRIBUTION_VISIBLE_MS = 5000;

export function collapseCompactAttribution(map: CompactAttribMap): void {
  const container = map.getContainer();
  const attrib = container.querySelector('.maplibregl-ctrl-attrib');
  if (!attrib) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const collapse = () => {
    if (timer) clearTimeout(timer);
    attrib.classList.remove('maplibregl-compact-show');
    attrib.removeAttribute('open');
    container.removeEventListener('pointerdown', onInput, true);
    container.removeEventListener('wheel', onInput, true);
  };
  // Input on the credit itself is the user opening or reading it, not leaving it.
  function onInput(e: Event) {
    if ((e.target as Element | null)?.closest?.('.maplibregl-ctrl-attrib')) return;
    collapse();
  }
  const arm = () => {
    if (timer) return;
    timer = setTimeout(collapse, ATTRIBUTION_VISIBLE_MS);
    container.addEventListener('pointerdown', onInput, true);
    container.addEventListener('wheel', onInput, true);
  };
  if (attrib.classList.contains('maplibregl-compact-show')) { arm(); return; }
  const observer = new MutationObserver(() => {
    if (attrib.classList.contains('maplibregl-compact-show')) {
      observer.disconnect();
      arm();
    }
  });
  observer.observe(attrib, { attributes: true, attributeFilter: ['class'] });
}
