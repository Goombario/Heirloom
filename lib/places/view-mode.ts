export type PlacesViewMode = 'explore' | 'cards' | 'list';

export const PLACES_VIEW_MODE_KEY = 'places-view-mode';

type ViewModeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Migrate persisted modes without allowing retired values into render branches. */
export function normalizePlacesViewMode(value: string | null): PlacesViewMode | null {
  if (value === 'tree') return 'explore';
  if (value === 'explore' || value === 'cards' || value === 'list') return value;
  return null;
}

/** Read the persisted mode and migrate the retired tree value in place. */
export function readPlacesViewMode(storage: ViewModeStorage): PlacesViewMode {
  const raw = storage.getItem(PLACES_VIEW_MODE_KEY);
  const saved = normalizePlacesViewMode(raw);
  if (saved !== null) {
    if (raw === 'tree') storage.setItem(PLACES_VIEW_MODE_KEY, saved);
    return saved;
  }
  return 'explore';
}
