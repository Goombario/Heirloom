import { afterEach, describe, it, expect, vi } from 'vitest';
import { configureMapLibreWorker, getMapStyleUrl, getMapWorkerUrl } from '@/lib/geo/map-style';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getMapStyleUrl', () => {
  it('returns the OpenFreeMap positron style for light theme', () => {
    expect(getMapStyleUrl('light')).toBe('https://tiles.openfreemap.org/styles/positron');
  });

  it('returns the OpenFreeMap dark style for dark theme', () => {
    expect(getMapStyleUrl('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
  });
});

describe('MapLibre worker configuration', () => {
  it('uses the public worker path at the site root by default', () => {
    expect(getMapWorkerUrl()).toBe('/maplibre/maplibre-gl-worker.mjs');
  });

  it('preserves the static build base path without a double slash', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/genealogy-nextjs/');
    expect(getMapWorkerUrl()).toBe('/genealogy-nextjs/maplibre/maplibre-gl-worker.mjs');
  });

  it('passes the resolved worker path to MapLibre', () => {
    const setWorkerUrl = vi.fn();
    configureMapLibreWorker({ setWorkerUrl });
    expect(setWorkerUrl).toHaveBeenCalledWith('/maplibre/maplibre-gl-worker.mjs');
  });
});
