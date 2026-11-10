import { describe, expect, it, vi } from 'vitest';
import { PLACES_VIEW_MODE_KEY, normalizePlacesViewMode, readPlacesViewMode } from '@/lib/places/view-mode';

describe('normalizePlacesViewMode', () => {
  it('migrates the retired Tree preference to Explore', () => {
    expect(normalizePlacesViewMode('tree')).toBe('explore');
  });

  it('migrates the retired localStorage value to Explore', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue('tree'),
      setItem: vi.fn(),
    };
    expect(readPlacesViewMode(storage)).toBe('explore');
    expect(storage.setItem).toHaveBeenCalledWith(PLACES_VIEW_MODE_KEY, 'explore');
  });

  it('preserves supported modes and ignores unknown values', () => {
    expect(normalizePlacesViewMode('explore')).toBe('explore');
    expect(normalizePlacesViewMode('cards')).toBe('cards');
    expect(normalizePlacesViewMode('list')).toBe('list');
    expect(normalizePlacesViewMode('unknown')).toBeNull();
    expect(normalizePlacesViewMode(null)).toBeNull();
  });
});
