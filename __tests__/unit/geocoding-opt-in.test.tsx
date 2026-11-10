/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LocationField from '@/app/components/LocationField';
import { getGeocodingChoice, isGeocodingEnabled, setGeocodingEnabled } from '@/lib/geocode/prefs';

/**
 * #791 (task audit §9.6): live place lookup sends typed place names to an
 * outside geocoder, so it is opt-in. A fresh profile sends nothing until the
 * user answers a one-time prompt, and the answer is remembered.
 */
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const photonCalls: string[] = [];

beforeEach(() => {
  localStorage.clear();
  photonCalls.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://photon.komoot.io/')) photonCalls.push(url);
    return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Field() {
  const [value, setValue] = useState('');
  return <LocationField value={value} onChange={setValue} />;
}

async function typeAndWait(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
}

describe('live place lookup preference', () => {
  it('is off in a fresh profile, and keeps an explicit earlier choice', () => {
    expect(getGeocodingChoice()).toBeNull();
    expect(isGeocodingEnabled()).toBe(false);
    localStorage.setItem('geocodingEnabled', 'true');
    expect(isGeocodingEnabled()).toBe(true);
    localStorage.setItem('geocodingEnabled', 'false');
    expect(getGeocodingChoice()).toBe('off');
  });
});

describe('LocationField opt-in prompt', () => {
  it('sends nothing to the geocoder before the user opts in', async () => {
    render(<Field />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await typeAndWait(input, 'Dover, Kent');
    expect(photonCalls).toEqual([]);
    expect(screen.getByRole('group', { name: 'title' })).toBeInTheDocument();
  });

  it('turns lookup on from the prompt, looks up what was typed, and does not ask again', async () => {
    const { unmount } = render(<Field />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Dover, Kent' } });
    fireEvent.click(screen.getByRole('button', { name: 'turn_on' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });

    expect(localStorage.getItem('geocodingEnabled')).toBe('true');
    expect(photonCalls.length).toBeGreaterThan(0);
    expect(screen.queryByRole('group', { name: 'title' })).not.toBeInTheDocument();

    unmount();
    render(<Field />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByRole('group', { name: 'title' })).not.toBeInTheDocument();
  });

  it('remembers "Keep off": the prompt goes away and nothing is sent', async () => {
    render(<><Field /><Field /></>);
    const [first, second] = screen.getAllByRole('combobox');
    fireEvent.focus(first);
    fireEvent.click(screen.getByRole('button', { name: 'keep_off' }));
    expect(localStorage.getItem('geocodingEnabled')).toBe('false');
    expect(screen.queryByRole('group', { name: 'title' })).not.toBeInTheDocument();

    // Another field doesn't ask again.
    fireEvent.focus(second);
    expect(screen.queryByRole('group', { name: 'title' })).not.toBeInTheDocument();
    await typeAndWait(second, 'Dover, Kent');
    expect(photonCalls).toEqual([]);
  });

  it('follows a change made in Options', () => {
    render(<Field />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByRole('group', { name: 'title' })).toBeInTheDocument();
    act(() => setGeocodingEnabled(true));
    expect(screen.queryByRole('group', { name: 'title' })).not.toBeInTheDocument();
  });
});
