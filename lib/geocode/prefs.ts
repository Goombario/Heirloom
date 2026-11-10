const KEY = 'geocodingEnabled';
const CHANGE_EVENT = 'geocoding-choice-change';

/** 'on' / 'off' once the user has answered, null before they have. */
export type GeocodingChoice = 'on' | 'off' | null;

/**
 * Live place lookup is opt-in (#791): typed place names go to an outside
 * geocoder, so nothing is sent until the user says yes, once, in the prompt or
 * in Options. A stored 'true' or 'false' (an explicit choice made before the
 * default changed) is kept. Client-only; reads localStorage.
 */
export function getGeocodingChoice(): GeocodingChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'true' ? 'on' : value === 'false' ? 'off' : null;
  } catch {
    return null;
  }
}

export function isGeocodingEnabled(): boolean {
  return getGeocodingChoice() === 'on';
}

export function setGeocodingEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, String(on));
  } catch {
    // Storage blocked: the choice lasts until reload, via the event below.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Notify on any change to the choice, here or in another tab. */
export function subscribeGeocodingChoice(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) onChange(); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
