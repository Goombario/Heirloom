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

// `on('load', cb)` invokes the callback synchronously so the journey line
// (addSource/addLayer) is built during the test.
const setWorkerUrlMock = vi.fn();
const mapOn = vi.fn((evt: string, cb: () => void) => { if (evt === 'load') cb(); });
const mapAddSource = vi.fn();
const mapAddLayer = vi.fn();
const mapFitBounds = vi.fn();
const mapSetCenter = vi.fn();
const mapSetZoom = vi.fn();
const mapFlyTo = vi.fn();
const mapRemove = vi.fn();
const mapGetZoom = vi.fn(() => 5);
const MapMock = vi.fn(function (this: unknown, _opts: { center: number[]; zoom: number }) {
  return {
    on: mapOn, once: vi.fn(), getContainer: () => document.createElement('div'),
    addSource: mapAddSource, addLayer: mapAddLayer,
    fitBounds: mapFitBounds, setCenter: mapSetCenter, setZoom: mapSetZoom,
    flyTo: mapFlyTo, remove: mapRemove, getZoom: mapGetZoom,
  };
});

const PopupMock = vi.fn(function (this: unknown) {
  const p = { setHTML: vi.fn(() => p), isOpen: vi.fn(() => false) };
  return p;
});

const MarkerMock = vi.fn(function (this: unknown) {
  let lnglat: [number, number] | undefined;
  let popup: unknown;
  const m = {
    setLngLat: vi.fn((ll: [number, number]) => { lnglat = ll; return m; }),
    setPopup: vi.fn((p: unknown) => { popup = p; return m; }),
    addTo: vi.fn(() => m),
    getLngLat: vi.fn(() => lnglat),
    getPopup: vi.fn(() => popup),
    togglePopup: vi.fn(),
  };
  return m;
});

const LngLatBoundsMock = vi.fn(function (this: unknown) {
  const b = { extend: vi.fn(() => b) };
  return b;
});

vi.mock('maplibre-gl', () => ({
  Map: MapMock, Marker: MarkerMock, Popup: PopupMock, LngLatBounds: LngLatBoundsMock,
  setWorkerUrl: setWorkerUrlMock,
}));

import LocationJourneyModal, { type JourneyStop } from '@/app/components/LocationJourneyModal';

const STOPS: JourneyStop[] = [
  { lat: 51.5, lng: -0.12, label: 'London', title: 'Birth', date: '1900' },
  { lat: 48.85, lng: 2.35, label: 'Paris', title: 'Marriage', date: '1925' },
  { lat: 40.71, lng: -74.0, label: 'New York', title: 'Death', date: '1970' },
];

beforeEach(() => { vi.clearAllMocks(); });

describe('LocationJourneyModal', () => {
  it('configures the MapLibre v6 worker before creating the map', async () => {
    render(<LocationJourneyModal stops={STOPS} onClose={vi.fn()} />);
    await waitFor(() => expect(MapMock).toHaveBeenCalledTimes(1));
    expect(setWorkerUrlMock).toHaveBeenCalledWith('/maplibre/maplibre-gl-worker.mjs');
    expect(setWorkerUrlMock.mock.invocationCallOrder[0]).toBeLessThan(MapMock.mock.invocationCallOrder[0]);
  });

  it('builds a map with a marker per stop and a journey line', async () => {
    render(<LocationJourneyModal stops={STOPS} onClose={vi.fn()} />);
    await waitFor(() => expect(MapMock).toHaveBeenCalledTimes(1));
    expect(MarkerMock).toHaveBeenCalledTimes(STOPS.length);
    expect(mapAddSource).toHaveBeenCalledWith('journey', expect.objectContaining({ type: 'geojson' }));
    expect(mapAddLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'journey-line', type: 'line' }));
    expect(mapFitBounds).toHaveBeenCalledTimes(1);
    expect(mapSetCenter).not.toHaveBeenCalled();
  });

  it('frames the single stop via the constructor (center + zoom 9), no fitBounds', async () => {
    render(<LocationJourneyModal stops={[STOPS[0]]} onClose={vi.fn()} />);
    await waitFor(() => expect(MapMock).toHaveBeenCalledTimes(1));
    const opts = MapMock.mock.calls[0][0];
    expect(opts.center).toEqual([STOPS[0].lng, STOPS[0].lat]);
    expect(opts.zoom).toBe(9);
    expect(mapFitBounds).not.toHaveBeenCalled();
  });

  it('closes on Escape, backdrop click, and the close button', async () => {
    const onClose = vi.fn();
    const { container } = render(<LocationJourneyModal stops={STOPS} onClose={onClose} />);
    // Esc/scroll-lock/focus-trap now come from the shared <Modal>, whose Esc
    // listener is on `document` (a real keypress bubbles there); dispatch there.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    const backdrop = container.querySelector('.animate-backdrop-in') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText('close'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('reveals the legend on toggle and pans/opens a popup for the chosen stop', async () => {
    render(<LocationJourneyModal stops={STOPS} onClose={vi.fn()} />);
    await waitFor(() => expect(MarkerMock).toHaveBeenCalledTimes(STOPS.length));
    expect(screen.queryByText(/Paris/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Paris')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Paris').closest('button')!);
    const parisMarker = MarkerMock.mock.results[1].value as { togglePopup: ReturnType<typeof vi.fn> };
    expect(mapFlyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [STOPS[1].lng, STOPS[1].lat] }));
    expect(parisMarker.togglePopup).toHaveBeenCalledTimes(1);
  });

  it('tears the map down on unmount', async () => {
    const { unmount } = render(<LocationJourneyModal stops={STOPS} onClose={vi.fn()} />);
    await waitFor(() => expect(MapMock).toHaveBeenCalledTimes(1));
    unmount();
    expect(mapRemove).toHaveBeenCalled();
  });
});
