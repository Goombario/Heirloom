/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTreeSearch } from '@/app/tree/useTreeSearch';

const people = [
    {
        id: 1,
        name: 'Ada Fiction',
        allNames: null,
        isRoot: true,
        isLeaf: false,
        hasAncestors: true,
        hasDescendants: true,
        isIsolated: false,
    },
];

describe('useTreeSearch guarded selection', () => {
    it('keeps the attempted search state when sidebar navigation is declined', () => {
        const onSelect = vi.fn(() => false);
        const { result } = renderHook(() => useTreeSearch(people, onSelect));

        act(() => {
            result.current.setSearchQuery('Ada');
            result.current.setShowDropdown(true);
            result.current.handlePersonSelect(1);
        });

        expect(onSelect).toHaveBeenCalledWith(1);
        expect(result.current.searchQuery).toBe('Ada');
        expect(result.current.showDropdown).toBe(true);
    });

    it('clears the search after a permitted person selection', () => {
        const onSelect = vi.fn(() => true);
        const { result } = renderHook(() => useTreeSearch(people, onSelect));

        act(() => {
            result.current.setSearchQuery('Ada');
            result.current.setShowDropdown(true);
            result.current.handlePersonSelect(1);
        });

        expect(onSelect).toHaveBeenCalledWith(1);
        expect(result.current.searchQuery).toBe('');
        expect(result.current.showDropdown).toBe(false);
    });
});
