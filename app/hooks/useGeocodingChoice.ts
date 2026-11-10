'use client';

import { useSyncExternalStore } from 'react';
import { getGeocodingChoice, subscribeGeocodingChoice, type GeocodingChoice } from '@/lib/geocode/prefs';

/** The live place lookup choice, kept in step across every field and tab (#791). */
export function useGeocodingChoice(): GeocodingChoice {
  return useSyncExternalStore(subscribeGeocodingChoice, getGeocodingChoice, () => null);
}
