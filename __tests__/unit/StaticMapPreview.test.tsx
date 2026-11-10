/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/components/ThemeProvider', () => ({
  useTheme: () => ({ resolvedTheme: 'light', theme: 'light', setTheme: () => {} }),
}));

const setWorkerUrlMock = vi.fn();
const markerSetLngLat = vi.fn().mockReturnThis();
const markerAddTo = vi.fn().mockReturnThis();
const MapMock = vi.fn(function(this: unknown) {
  return {
    on: vi.fn(),
    once: vi.fn(),
    getContainer: () => document.createElement('div'),
    setMissingStyleImageResolver: vi.fn(),
    remove: vi.fn(),
  };
});
const MarkerMock = vi.fn(function(this: unknown) { return { setLngLat: markerSetLngLat, addTo: markerAddTo }; });
vi.mock('maplibre-gl', () => ({ Map: MapMock, Marker: MarkerMock, setWorkerUrl: setWorkerUrlMock }));

import StaticMapPreview, { HEADER_PREVIEW_ZOOM } from '@/app/components/StaticMapPreview';

const LAT = 51.5074;
const LNG = -0.1278;

beforeEach(() => vi.clearAllMocks());

describe('StaticMapPreview', () => {
  it('labels the control for the journey and titles it with the place', () => {
    render(<StaticMapPreview lat={LAT} lng={LNG} label="London, England" onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'view_journey');
    expect(button).toHaveAttribute('title', 'London, England');
  });

  it('offers no journey button when there is no journey', () => {
    render(<StaticMapPreview lat={LAT} lng={LNG} label="London" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  // #740: MapLibre mounts its credits button inside the map, so the journey button
  // must be the map's sibling, never its ancestor (axe nested-interactive).
  it('keeps the map, and so its credits button, outside the journey button', () => {
    const { container } = render(<StaticMapPreview lat={LAT} lng={LNG} label="London" onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    const wrapper = container.firstElementChild!;
    expect(wrapper.tagName).toBe('DIV');
    const mapEl = wrapper.firstElementChild!;
    expect(button.contains(mapEl)).toBe(false);
    expect(mapEl.contains(button)).toBe(false);
  });

  it('configures the MapLibre v6 worker before creating the map', async () => {
    render(<StaticMapPreview lat={LAT} lng={LNG} label="London" />);
    await waitFor(() => expect(MapMock).toHaveBeenCalled());
    expect(setWorkerUrlMock).toHaveBeenCalledWith('/maplibre/maplibre-gl-worker.mjs');
    expect(setWorkerUrlMock.mock.invocationCallOrder[0]).toBeLessThan(MapMock.mock.invocationCallOrder[0]);
  });

  it('builds a non-interactive map centered on the point at the preview zoom', async () => {
    render(<StaticMapPreview lat={LAT} lng={LNG} label="London" />);
    await waitFor(() => expect(MapMock).toHaveBeenCalled());
    const calls = MapMock.mock.calls as unknown as Array<[{ center: number[]; zoom: number; interactive: boolean }]>;
    const opts = calls[0][0];
    expect(opts.center).toEqual([LNG, LAT]); // [lng, lat]
    expect(opts.zoom).toBe(HEADER_PREVIEW_ZOOM);
    expect(opts.interactive).toBe(false);
  });

  it('places the ink pin marker at the point', async () => {
    render(<StaticMapPreview lat={LAT} lng={LNG} label="London" />);
    await waitFor(() => expect(MarkerMock).toHaveBeenCalled());
    expect(markerSetLngLat).toHaveBeenCalledWith([LNG, LAT]);
  });

  it('fires onClick when the preview is clicked', () => {
    const onClick = vi.fn();
    render(<StaticMapPreview lat={LAT} lng={LNG} label="London" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
