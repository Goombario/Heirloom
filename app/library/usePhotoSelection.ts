import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

type PhotoSelectionState = {
  mode: 'browse' | 'select';
  selectedIds: ReadonlySet<number>;
};

type PhotoSelectionAction =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'toggle'; id: number }
  | { type: 'select-visible'; ids: readonly number[] }
  | { type: 'clear' }
  | { type: 'intersect-visible'; ids: readonly number[] }
  | { type: 'retain'; ids: readonly number[] };

const initialState: PhotoSelectionState = { mode: 'browse', selectedIds: new Set() };

function selectionReducer(
  state: PhotoSelectionState,
  action: PhotoSelectionAction,
): PhotoSelectionState {
  switch (action.type) {
    case 'enter':
      return state.mode === 'select' ? state : { ...state, mode: 'select' };
    case 'exit':
      return state.mode === 'browse' && state.selectedIds.size === 0
        ? state
        : { mode: 'browse', selectedIds: new Set() };
    case 'toggle': {
      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(action.id)) selectedIds.delete(action.id);
      else selectedIds.add(action.id);
      return { ...state, selectedIds };
    }
    case 'select-visible':
      return {
        ...state,
        selectedIds: new Set([...state.selectedIds, ...action.ids]),
      };
    case 'clear':
      return state.selectedIds.size === 0 ? state : { ...state, selectedIds: new Set() };
    case 'intersect-visible': {
      const visible = new Set(action.ids);
      const selectedIds = new Set([...state.selectedIds].filter((id) => visible.has(id)));
      return selectedIds.size === state.selectedIds.size ? state : { ...state, selectedIds };
    }
    case 'retain':
      return { ...state, selectedIds: new Set(action.ids) };
  }
}

export function usePhotoSelection({
  visibleIds,
  active,
  treeId,
}: {
  visibleIds: readonly number[];
  active: boolean;
  treeId: number | null;
}) {
  const [state, dispatch] = useReducer(selectionReducer, initialState);
  const previousTreeId = useRef(treeId);
  const canonicalVisibleIds = useMemo(
    () => [...new Set(visibleIds)].sort((a, b) => a - b),
    [visibleIds],
  );
  useEffect(() => {
    const treeChanged = previousTreeId.current !== treeId;
    previousTreeId.current = treeId;
    if (!active || treeChanged) dispatch({ type: 'exit' });
  }, [active, treeId]);

  useEffect(() => {
    dispatch({ type: 'intersect-visible', ids: canonicalVisibleIds });
  }, [canonicalVisibleIds]);

  const enter = useCallback(() => dispatch({ type: 'enter' }), []);
  const exit = useCallback(() => dispatch({ type: 'exit' }), []);
  const toggle = useCallback((id: number) => dispatch({ type: 'toggle', id }), []);
  const selectVisible = useCallback(
    () => dispatch({ type: 'select-visible', ids: canonicalVisibleIds }),
    [canonicalVisibleIds],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const retain = useCallback((ids: readonly number[]) => dispatch({ type: 'retain', ids }), []);

  return { ...state, enter, exit, toggle, selectVisible, clear, retain };
}
