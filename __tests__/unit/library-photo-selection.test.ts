/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePhotoSelection } from '@/app/library/usePhotoSelection';

const selected = (ids: ReadonlySet<number>) => [...ids].sort((a, b) => a - b);

describe('usePhotoSelection', () => {
  it('enters and exits select mode, and toggles a tile', () => {
    const { result } = renderHook(() =>
      usePhotoSelection({ visibleIds: [3, 1], active: true, treeId: 7 }),
    );

    expect(result.current.mode).toBe('browse');
    act(() => result.current.enter());
    expect(result.current.mode).toBe('select');
    act(() => result.current.toggle(3));
    expect(selected(result.current.selectedIds)).toEqual([3]);
    act(() => result.current.toggle(3));
    expect(selected(result.current.selectedIds)).toEqual([]);
    act(() => result.current.exit());
    expect(result.current).toMatchObject({ mode: 'browse', selectedIds: new Set() });
  });

  it('selects all current results and clear keeps select mode', () => {
    const { result } = renderHook(() =>
      usePhotoSelection({ visibleIds: [9, 2, 5], active: true, treeId: 7 }),
    );
    act(() => result.current.enter());
    act(() => result.current.selectVisible());
    expect(selected(result.current.selectedIds)).toEqual([2, 5, 9]);
    act(() => result.current.clear());
    expect(result.current.mode).toBe('select');
    expect(selected(result.current.selectedIds)).toEqual([]);
  });

  it('intersects selection when result membership changes', () => {
    const initial = { visibleIds: [1, 2, 3], active: true, treeId: 7 };
    const { result, rerender } = renderHook((props) => usePhotoSelection(props), {
      initialProps: initial,
    });
    act(() => result.current.enter());
    act(() => result.current.selectVisible());
    rerender({ visibleIds: [3, 4], active: true, treeId: 7 });
    expect(selected(result.current.selectedIds)).toEqual([3]);
  });

  it('does not change membership after sort-only reordering', () => {
    const { result, rerender } = renderHook(
      (visibleIds: number[]) => usePhotoSelection({ visibleIds, active: true, treeId: 7 }),
      { initialProps: [3, 1, 2] },
    );
    act(() => result.current.enter());
    act(() => result.current.toggle(2));
    rerender([1, 2, 3]);
    expect(selected(result.current.selectedIds)).toEqual([2]);
  });

  it('clears selection when photos become inactive', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => usePhotoSelection({ visibleIds: [1], active, treeId: 7 }),
      { initialProps: { active: true } },
    );
    act(() => result.current.enter());
    act(() => result.current.toggle(1));
    rerender({ active: false });
    expect(result.current).toMatchObject({ mode: 'browse', selectedIds: new Set() });
  });

  it.each([
    ['number to another number', 7, 8],
    ['number to null', 7, null],
    ['null to number', null, 7],
  ])('clears selection on tree transition (%s)', (_label, from, to) => {
    const { result, rerender } = renderHook(
      ({ treeId }: { treeId: number | null }) =>
        usePhotoSelection({ visibleIds: [1], active: true, treeId }),
      { initialProps: { treeId: from } },
    );
    act(() => result.current.enter());
    act(() => result.current.toggle(1));
    rerender({ treeId: to });
    expect(result.current).toMatchObject({ mode: 'browse', selectedIds: new Set() });
  });

  it('retains only failed IDs after a mixed delete result', () => {
    const { result } = renderHook(() =>
      usePhotoSelection({ visibleIds: [1, 2, 3], active: true, treeId: 7 }),
    );
    act(() => result.current.enter());
    act(() => result.current.selectVisible());
    act(() => result.current.retain([2]));
    expect(result.current.mode).toBe('select');
    expect(selected(result.current.selectedIds)).toEqual([2]);
  });
});
